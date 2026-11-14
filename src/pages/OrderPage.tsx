import { ArrowLeft, ArrowRight, Check, CircleAlert } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { navigate } from "../App";
import { OrderSummary } from "../components/OrderSummary";
import { ProductCard } from "../components/ProductCard";
import {
  HoneypotField,
  TURNSTILE_WAIT_MESSAGE,
  TurnstileWidget,
  turnstileEnabled,
  type TurnstileHandle
} from "../components/TurnstileWidget";
import { ApiError, sendOrder } from "../lib/api";
import { useAvailabilityWindows, usePickupLocations } from "../lib/availabilityStore";
import { useMenuProducts } from "../lib/menuStore";
import { useSiteContent } from "../lib/siteContent";
import {
  createLocalOrderRecord,
  generateIdempotencyKey,
  isPreorderable,
  orderItemCount
} from "../lib/order";
import { formatWindow, isWindowSelectable, nextAvailableWindows } from "../lib/time";
import type {
  BulkOrderInfo,
  CartSelection,
  CustomerInfo,
  FulfillmentType,
  MenuProduct,
  OrderRecord
} from "../lib/types";

const steps = ["Type", "Date", "Menu", "Contact", "Review"];

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
  const content = useSiteContent();
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
  const [website, setWebsite] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileRef = useRef<TurnstileHandle>(null);

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
      nextErrors.push("Select a date that is open.");
    }
    if (nextStep >= 3 && orderItemCount(activeSelections) === 0) {
      nextErrors.push("Select a minimum of 1 menu item.");
    }
    if (nextStep >= 4) {
      if (!customer.name.trim()) nextErrors.push("Enter your name.");
      if (!customer.mobile.trim()) nextErrors.push("Enter your mobile number.");
      if (!customer.email.trim()) nextErrors.push("Enter your email address.");
      if (bulk.enabled && !bulk.guestCount.trim()) {
        nextErrors.push("Enter the number of people.");
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
    if (turnstileEnabled() && !turnstileToken) {
      setErrors([TURNSTILE_WAIT_MESSAGE]);
      return;
    }

    setSubmitting(true);
    const draft = {
      fulfillmentType,
      availabilityWindowId: selectedWindow.id,
      items: activeSelections,
      customer,
      bulk,
      idempotencyKey: generateIdempotencyKey()
    };

    let saved: OrderRecord;
    try {
      const record = createLocalOrderRecord(draft, menuProducts);
      // The Worker computes the totals again and issues the order number and
      // the public token. Use its copy from here on.
      const result = await sendOrder({ order: record, turnstileToken, website });
      if (!result.order) throw new ApiError("We could not send your order. Reload the page, then try again.", 400);
      saved = result.order;
    } catch (caught) {
      setErrors([
        caught instanceof ApiError
          ? caught.message
          : "We could not send your order. Check your connection, then try again."
      ]);
      turnstileRef.current?.reset();
      setSubmitting(false);
      return;
    }

    // Keep a local copy so the confirmation page renders instantly.
    sessionStorage.setItem(`bbt-order-${saved.publicToken}`, JSON.stringify(saved));
    setSubmitting(false);
    navigate(`/order/confirmation/${saved.publicToken}`);
  }

  return (
    <main className="page-shell order-page">
      <section className="order-heading">
        <h1>Build your order.</h1>
        <p>{content.orderPolicy}</p>
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
              <CircleAlert size={20} aria-hidden="true" />
              <ul>
                {errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          )}

          {step === 0 && (
            <fieldset className="choice-grid">
              <legend>Select an order type</legend>
              <label>
                <input
                  type="radio"
                  name="fulfillment"
                  checked={fulfillmentType === "scheduled_pickup"}
                  onChange={() => setFulfillmentType("scheduled_pickup")}
                />
                <span>
                  <strong>Pickup</strong>
                  <small>Pick up your order at a set date and time.</small>
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
                  <strong>Pop-up event</strong>
                  <small>Place a pre-order, then pick it up at a pop-up.</small>
                </span>
              </label>
            </fieldset>
          )}

          {step === 1 && bookableWindows.length === 0 && (
            <div className="choice-grid">
              <p className="muted">
                {upcomingWindows.length > 0
                  ? "No dates are open for this order type. These dates open soon:"
                  : "No events are on the calendar. Check back soon."}
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
              <legend>Select a date</legend>
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
                      <small>{location?.name} · {window.capacity - window.committedOrders} orders left</small>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          )}

          {step === 2 && (
            <p className="allergen-notice">
              <strong>Allergen notice.</strong> {content.allergenNotice}
            </p>
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
                  type="text"
                  value={customer.name}
                  onChange={(event) => setCustomer({ ...customer, name: event.target.value })}
                  autoComplete="name"
                  required
                />
              </label>
              <label>
                Mobile number
                <input
                  type="tel"
                  inputMode="tel"
                  value={customer.mobile}
                  onChange={(event) => setCustomer({ ...customer, mobile: event.target.value })}
                  autoComplete="tel"
                  required
                />
              </label>
              <label>
                Email address
                <input
                  type="email"
                  inputMode="email"
                  value={customer.email}
                  onChange={(event) => setCustomer({ ...customer, email: event.target.value })}
                  autoComplete="email"
                  required
                />
              </label>
              <label>
                Contact method
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
                <span>Add details for a large order</span>
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
                    Number of people
                    <input
                      value={bulk.guestCount}
                      onChange={(event) => setBulk({ ...bulk, guestCount: event.target.value })}
                      inputMode="numeric"
                    />
                  </label>
                  <label>
                    Time you need the order
                    <input
                      value={bulk.desiredReadyTime}
                      onChange={(event) =>
                        setBulk({ ...bulk, desiredReadyTime: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Packaging notes
                    <input
                      value={bulk.packagingRequest}
                      onChange={(event) =>
                        setBulk({ ...bulk, packagingRequest: event.target.value })
                      }
                    />
                  </label>
                  <label className="full-span">
                    Other instructions
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
                  Contact method: {customer.preferredContact}
                </p>
              </section>
              <section className="review-card">
                <h2>Payment</h2>
                <p>{content.paymentPolicy}</p>
              </section>
              <HoneypotField value={website} onChange={setWebsite} />
              <TurnstileWidget ref={turnstileRef} onToken={setTurnstileToken} />
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
                {submitting ? "Sending..." : "Place Order"}
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
