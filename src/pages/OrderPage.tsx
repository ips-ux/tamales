import { ArrowLeft, ArrowRight, Check, CircleAlert } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { navigate } from "../App";
import { OrderSummary } from "../components/OrderSummary";
import { ProductCard } from "../components/ProductCard";
import { useAvailabilityWindows, usePickupLocations } from "../lib/availabilityStore";
import { useBusinessSettings } from "../lib/businessSettings";
import { receiptEmailConfigured, sendReceiptEmail } from "../lib/emailReceipt";
import { submitPublicOrder } from "../lib/firestoreClient";
import { useMenuProducts } from "../lib/menuStore";
import { formatMoney } from "../lib/money";
import {
  createLocalOrderRecord,
  generateIdempotencyKey,
  isPreorderable,
  orderItemCount
} from "../lib/order";
import {
  formatBusinessDateTime,
  formatWindow,
  isWindowSelectable,
  nextAvailableWindows
} from "../lib/time";
import type {
  BulkOrderInfo,
  CartSelection,
  CustomerInfo,
  FulfillmentType,
  MenuProduct,
  OrderRecord
} from "../lib/types";

const steps = ["Fulfillment", "Time", "Products", "Contact", "Review"];

const emptyCustomer: CustomerInfo = {
  name: "",
  mobile: "",
  email: "",
  preferredContact: "text",
  notes: ""
};

const emptyBulk: BulkOrderInfo = {
  enabled: false,
  occasion: "",
  guestCount: "",
  desiredReadyTime: "",
  packagingRequest: "",
  additionalInstructions: ""
};

function quantityMapToSelections(
  quantities: Record<string, number>,
  products: MenuProduct[]
): CartSelection[] {
  return products.flatMap((product) =>
    product.variants.map((variant) => ({
      productId: product.id,
      variantId: variant.id,
      quantity: quantities[variant.id] ?? 0
    }))
  );
}

export function OrderPage() {
  const businessSettings = useBusinessSettings();
  const menuProducts = useMenuProducts();
  const availabilityWindows = useAvailabilityWindows();
  const pickupLocations = usePickupLocations();
  const [step, setStep] = useState(0);
  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>("scheduled_pickup");
  const [windowId, setWindowId] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [customer, setCustomer] = useState<CustomerInfo>(emptyCustomer);
  const [bulk, setBulk] = useState<BulkOrderInfo>(emptyBulk);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const preorderProducts = useMemo(
    () => menuProducts.filter((product) => isPreorderable(product)),
    [menuProducts]
  );
  const selections = useMemo(
    () => quantityMapToSelections(quantities, preorderProducts),
    [quantities, preorderProducts]
  );
  const activeSelections = useMemo(
    () => selections.filter((selection) => selection.quantity > 0),
    [selections]
  );
  const visibleWindows = availabilityWindows.filter(
    (window) => window.fulfillmentType === fulfillmentType
  );
  const bookableWindows = visibleWindows.filter((window) => isWindowSelectable(window));
  const upcomingWindows = nextAvailableWindows(availabilityWindows, fulfillmentType, 3);
  const selectedWindow = availabilityWindows.find((window) => window.id === windowId);
  const selectedLocation = selectedWindow
    ? pickupLocations.find((location) => location.id === selectedWindow.locationId)
    : undefined;

  // Keep the selection pointed at a real, bookable window instead of a
  // hardcoded id — it auto-picks the soonest one for the current fulfillment
  // type whenever that type changes or the live window list updates, and
  // otherwise leaves the customer's own choice alone.
  useEffect(() => {
    const candidates = availabilityWindows.filter(
      (window) => window.fulfillmentType === fulfillmentType && isWindowSelectable(window)
    );
    if (candidates.some((window) => window.id === windowId)) return;
    setWindowId(candidates[0]?.id ?? "");
  }, [availabilityWindows, fulfillmentType, windowId]);

  function validate(nextStep = step): string[] {
    const nextErrors: string[] = [];
    // Gates entry to Products (step 2), the same way the checks below gate
    // entry to the step after the one that fulfills them — so choosing a
    // window is required to leave the Time step, not to reach it.
    if (nextStep >= 2 && (!selectedWindow || !isWindowSelectable(selectedWindow))) {
      nextErrors.push("Choose an available pickup window.");
    }
    if (nextStep >= 3 && orderItemCount(activeSelections) === 0) {
      nextErrors.push("Choose at least one tamale package.");
    }
    if (nextStep >= 4) {
      if (!customer.name.trim()) nextErrors.push("Name is required.");
      if (!customer.mobile.trim()) nextErrors.push("Mobile number is required.");
      if (!customer.email.trim()) nextErrors.push("Email is required.");
      if (bulk.enabled && !bulk.guestCount.trim()) {
        nextErrors.push("Guest count is required for bulk order details.");
      }
    }
    return nextErrors;
  }

  function goNext() {
    const nextErrors = validate(step + 1);
    setErrors(nextErrors);
    if (nextErrors.length === 0) setStep((value) => Math.min(value + 1, steps.length - 1));
  }

  function goBack() {
    setErrors([]);
    setStep((value) => Math.max(value - 1, 0));
  }

  async function submitOrder(event: FormEvent) {
    event.preventDefault();
    const nextErrors = validate(steps.length - 1);
    setErrors(nextErrors);
    if (nextErrors.length > 0 || !selectedWindow) return;

    setSubmitting(true);
    const draft = {
      fulfillmentType,
      availabilityWindowId: selectedWindow.id,
      items: activeSelections,
      customer,
      bulk,
      idempotencyKey: generateIdempotencyKey()
    };

    let record: OrderRecord;
    try {
      record = createLocalOrderRecord(draft, menuProducts);
      await submitPublicOrder(record);
    } catch {
      setErrors(["Your request could not be submitted. Check your connection and try again."]);
      setSubmitting(false);
      return;
    }

    // Confirmation email is best-effort — never block the order on it.
    if (receiptEmailConfigured() && record.customer.email) {
      sendReceiptEmail({
        toEmail: record.customer.email,
        businessName: businessSettings.name,
        ticketNumber: record.orderNumber,
        purchasedAt: formatBusinessDateTime(record.createdAtUtc),
        items: record.items.map((line) => ({
          name: `${line.productName} — ${line.variantLabel}`,
          quantity: line.quantity,
          unitPrice: formatMoney(line.unitPriceCents),
          lineTotal: formatMoney(line.lineTotalCents)
        })),
        subtotal: formatMoney(record.totals.subtotalCents),
        tax: formatMoney(record.totals.taxCents),
        total: formatMoney(record.totals.totalCents),
        paymentMethod: "Pay at pickup",
        customerName: record.customer.name,
        heading: "Order Request",
        footerNote: `This is an order request — ${businessSettings.shortName} will confirm by text, call, or email before it's final.`
      }).catch(() => undefined);
    }

    // Keep a local copy so the confirmation page renders instantly.
    sessionStorage.setItem(`bbt-order-${record.publicToken}`, JSON.stringify(record));
    setSubmitting(false);
    navigate(`/order/confirmation/${record.publicToken}`);
  }

  return (
    <main className="page-shell order-page">
      <section className="order-heading">
        <p className="eyebrow">Order Request</p>
        <h1>Build your tamale batch.</h1>
        <p>{businessSettings.orderPolicy}</p>
      </section>

      <form className="order-layout" onSubmit={submitOrder}>
        <div className="order-panel">
          <ol className="stepper" aria-label="Order steps">
            {steps.map((item, index) => (
              <li className={index === step ? "active" : index < step ? "complete" : ""} key={item}>
                <span>{index < step ? <Check size={16} /> : index + 1}</span>
                {item}
              </li>
            ))}
          </ol>

          {errors.length > 0 && (
            <div className="error-summary" role="alert">
              <CircleAlert size={20} />
              <div>
                <strong>Check a few things</strong>
                <ul>
                  {errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {step === 0 && (
            <fieldset className="choice-grid">
              <legend>Choose fulfillment</legend>
              <label>
                <input
                  type="radio"
                  name="fulfillment"
                  checked={fulfillmentType === "scheduled_pickup"}
                  onChange={() => setFulfillmentType("scheduled_pickup")}
                />
                <span>
                  <strong>Scheduled pickup</strong>
                  <small>Preorder for an owner-confirmed pickup window.</small>
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  name="fulfillment"
                  checked={fulfillmentType === "event_pickup"}
                  onChange={() => setFulfillmentType("event_pickup")}
                />
                <span>
                  <strong>Event or pop-up pickup</strong>
                  <small>Order for a vendor table or temporary pickup event.</small>
                </span>
              </label>
            </fieldset>
          )}

          {step === 1 && bookableWindows.length === 0 && (
            <div className="choice-grid">
              <p className="muted">
                We're not currently taking new requests for this option.
                {upcomingWindows.length > 0
                  ? " Here are the next openings — check back once one is up:"
                  : " Check back soon for upcoming pickup windows."}
              </p>
              {upcomingWindows.map((window) => {
                const location = pickupLocations.find((item) => item.id === window.locationId);
                return (
                  <article className="choice-disabled" key={window.id}>
                    <strong>{window.label}</strong>
                    <small>{formatWindow(window)}</small>
                    <small>{location?.name}</small>
                  </article>
                );
              })}
            </div>
          )}

          {step === 1 && bookableWindows.length > 0 && (
            <fieldset className="choice-grid">
              <legend>Choose a pickup window</legend>
              {visibleWindows.map((window) => {
                const location = pickupLocations.find((item) => item.id === window.locationId);
                const disabled = !isWindowSelectable(window);
                return (
                  <label className={disabled ? "choice-disabled" : ""} key={window.id}>
                    <input
                      type="radio"
                      name="pickupWindow"
                      checked={windowId === window.id}
                      disabled={disabled}
                      onChange={() => setWindowId(window.id)}
                    />
                    <span>
                      <strong>{window.label}</strong>
                      <small>{formatWindow(window)}</small>
                      <small>{location?.name} · {window.capacity - window.committedOrders} spots left</small>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          )}

          {step === 2 && (
            <div className="product-grid">
              {preorderProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  quantities={quantities}
                  onQuantityChange={(variantId, quantity) =>
                    setQuantities((current) => ({ ...current, [variantId]: quantity }))
                  }
                />
              ))}
            </div>
          )}

          {step === 3 && (
            <div className="form-grid">
              <label>
                Name
                <input
                  value={customer.name}
                  onChange={(event) => setCustomer({ ...customer, name: event.target.value })}
                  autoComplete="name"
                />
              </label>
              <label>
                Mobile number
                <input
                  type="tel"
                  value={customer.mobile}
                  onChange={(event) => setCustomer({ ...customer, mobile: event.target.value })}
                  autoComplete="tel"
                  required
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={customer.email}
                  onChange={(event) => setCustomer({ ...customer, email: event.target.value })}
                  autoComplete="email"
                  required
                />
              </label>
              <label>
                Preferred contact
                <select
                  value={customer.preferredContact}
                  onChange={(event) =>
                    setCustomer({
                      ...customer,
                      preferredContact: event.target.value as CustomerInfo["preferredContact"]
                    })
                  }
                >
                  <option value="text">Text</option>
                  <option value="phone">Phone</option>
                  <option value="email">Email</option>
                </select>
              </label>
              <label className="full-span">
                Order notes
                <textarea
                  value={customer.notes}
                  onChange={(event) => setCustomer({ ...customer, notes: event.target.value })}
                  rows={4}
                />
              </label>
              <label className="toggle-row full-span">
                <input
                  type="checkbox"
                  checked={bulk.enabled}
                  onChange={(event) => setBulk({ ...bulk, enabled: event.target.checked })}
                />
                <span>Include bulk-order details</span>
              </label>
              {bulk.enabled && (
                <>
                  <label>
                    Occasion
                    <input
                      value={bulk.occasion}
                      onChange={(event) => setBulk({ ...bulk, occasion: event.target.value })}
                    />
                  </label>
                  <label>
                    Guest count
                    <input
                      value={bulk.guestCount}
                      onChange={(event) => setBulk({ ...bulk, guestCount: event.target.value })}
                      inputMode="numeric"
                    />
                  </label>
                  <label>
                    Desired ready time
                    <input
                      value={bulk.desiredReadyTime}
                      onChange={(event) =>
                        setBulk({ ...bulk, desiredReadyTime: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Packaging request
                    <input
                      value={bulk.packagingRequest}
                      onChange={(event) =>
                        setBulk({ ...bulk, packagingRequest: event.target.value })
                      }
                    />
                  </label>
                  <label className="full-span">
                    Additional instructions
                    <textarea
                      value={bulk.additionalInstructions}
                      onChange={(event) =>
                        setBulk({ ...bulk, additionalInstructions: event.target.value })
                      }
                      rows={3}
                    />
                  </label>
                </>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="review-stack">
              <OrderSummary selections={activeSelections} compact />
              <section className="review-card">
                <h2>Pickup</h2>
                <p>
                  <strong>{selectedWindow?.label}</strong>
                  <br />
                  {selectedWindow && formatWindow(selectedWindow)}
                  <br />
                  {selectedLocation?.name}: {selectedLocation?.instructions}
                </p>
              </section>
              <section className="review-card">
                <h2>Contact</h2>
                <p>
                  {customer.name}
                  <br />
                  {customer.mobile} · {customer.email}
                  <br />
                  Preferred: {customer.preferredContact}
                </p>
              </section>
              <section className="review-card">
                <h2>Confirmation Policy</h2>
                <p>{businessSettings.paymentPolicy}</p>
              </section>
            </div>
          )}

          <div className="order-actions">
            {step > 0 && (
              <button className="button button-ghost" type="button" onClick={goBack}>
                <ArrowLeft size={18} />
                Back
              </button>
            )}
            {step < steps.length - 1 ? (
              <button className="button button-primary" type="button" onClick={goNext}>
                Continue
                <ArrowRight size={18} />
              </button>
            ) : (
              <button className="button button-primary" type="submit" disabled={submitting}>
                {submitting ? "Sending..." : "Submit Request"}
                <ArrowRight size={18} />
              </button>
            )}
          </div>
        </div>
        <OrderSummary selections={activeSelections} />
      </form>
    </main>
  );
}
