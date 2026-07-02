import { ArrowLeft, ArrowRight, Check, CircleAlert } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { navigate } from "../App";
import { OrderSummary } from "../components/OrderSummary";
import { ProductCard } from "../components/ProductCard";
import {
  availabilityWindows,
  businessSettings,
  menuProducts,
  pickupLocations
} from "../data/fixtures";
import { createLocalOrderRecord, generateIdempotencyKey, orderItemCount } from "../lib/order";
import { formatWindow, isWindowSelectable } from "../lib/time";
import type { BulkOrderInfo, CartSelection, CustomerInfo, FulfillmentType, OrderRecord } from "../lib/types";

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

function quantityMapToSelections(quantities: Record<string, number>): CartSelection[] {
  return menuProducts.flatMap((product) =>
    product.variants.map((variant) => ({
      productId: product.id,
      variantId: variant.id,
      quantity: quantities[variant.id] ?? 0
    }))
  );
}

export function OrderPage() {
  const [step, setStep] = useState(0);
  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>("scheduled_pickup");
  const [windowId, setWindowId] = useState("sat-morning-westminster");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [customer, setCustomer] = useState<CustomerInfo>(emptyCustomer);
  const [bulk, setBulk] = useState<BulkOrderInfo>(emptyBulk);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const selections = useMemo(() => quantityMapToSelections(quantities), [quantities]);
  const activeSelections = useMemo(
    () => selections.filter((selection) => selection.quantity > 0),
    [selections]
  );
  const visibleWindows = availabilityWindows.filter(
    (window) => window.fulfillmentType === fulfillmentType
  );
  const selectedWindow = availabilityWindows.find((window) => window.id === windowId);
  const selectedLocation = selectedWindow
    ? pickupLocations.find((location) => location.id === selectedWindow.locationId)
    : undefined;

  function validate(nextStep = step): string[] {
    const nextErrors: string[] = [];
    if (nextStep >= 1 && (!selectedWindow || !isWindowSelectable(selectedWindow))) {
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
      const response = await fetch("/api/public/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft)
      });
      if (!response.ok) throw new Error("Local API unavailable.");
      record = (await response.json()) as OrderRecord;
    } catch {
      record = createLocalOrderRecord(draft);
    }
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
                  onChange={() => {
                    setFulfillmentType("scheduled_pickup");
                    setWindowId("sat-morning-westminster");
                  }}
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
                  onChange={() => {
                    setFulfillmentType("event_pickup");
                    setWindowId("sun-event-northglenn");
                  }}
                />
                <span>
                  <strong>Event or pop-up pickup</strong>
                  <small>Order for a vendor table or temporary pickup event.</small>
                </span>
              </label>
            </fieldset>
          )}

          {step === 1 && (
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
              {menuProducts.map((product) => (
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
                  value={customer.mobile}
                  onChange={(event) => setCustomer({ ...customer, mobile: event.target.value })}
                  autoComplete="tel"
                />
              </label>
              <label>
                Email
                <input
                  value={customer.email}
                  onChange={(event) => setCustomer({ ...customer, email: event.target.value })}
                  autoComplete="email"
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
