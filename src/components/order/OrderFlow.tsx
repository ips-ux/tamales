// The customer order flow, shared by the order page, the mobile order page,
// and the kiosk. The props below are the contract between those screens.
// The rules are in orderFlowLogic.ts. See docs/V1_DESIGN.md section 9.
import { ArrowLeft, ArrowRight, CircleAlert } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CreateOrderResult, EventRecord, OrderKind, OrderSource, PaymentMethod } from "../../../shared/model";
import { DEFAULT_TIME_ZONE, dateKeyInZone } from "../../../shared/orderNumber";
import { DEFAULT_TAX_RATE_BPS } from "../../../shared/pricing";
import { quantityLabel } from "../../../shared/quantity";
import { ApiError, createOrder, quoteDelivery } from "../../lib/api";
import { useBusinessSettings } from "../../lib/businessSettings";
import { useMenuProducts } from "../../lib/menuStore";
import { formatMoney } from "../../lib/money";
import { useEventStock, useOrderingSettings, usePaymentHandles } from "../../lib/publicData";
import { useSiteContent } from "../../lib/siteContent";
import { formatWindow } from "../../lib/time";
import { formatPhone } from "../publicForm";
import { OrderSummary } from "../OrderSummary";
import { configuredPayPalClientId } from "../tracker/paypalSdk";
import { ProductCard } from "../ProductCard";
import {
  HoneypotField,
  TURNSTILE_WAIT_MESSAGE,
  TurnstileWidget,
  turnstileEnabled,
  type TurnstileHandle
} from "../TurnstileWidget";
import { HeadsUpDialog } from "./HeadsUpDialog";
import {
  ADDRESS_MAX,
  ADDRESS_NOT_FOUND_MESSAGE,
  NOTE_MAX,
  OUTSIDE_AREA_MESSAGE,
  SEND_FAILED_MESSAGE,
  TIME_RANGE_MAX,
  attemptKeyFor,
  buildCreateOrderInput,
  capCartToStock,
  cartToLines,
  deliveryFeeCents,
  deliveryLine,
  detailsNeedQuote,
  effectiveFulfillment,
  estimateOrder,
  flowSteps,
  formatDateKey,
  fulfillmentChoices,
  menuForFlow,
  minRequestDate,
  needsApproval,
  newAttemptKey,
  paymentChoices,
  policyKeys,
  quoteMatches,
  reviewPaymentNote,
  stepLabel,
  stockLeft,
  submitLabel,
  usesPayPalCheckout,
  usesStock,
  validateDetails,
  validateMenu,
  validateOrderContact,
  validatePayment,
  type AttemptKey,
  type Cart,
  type ContactFields,
  type DetailsFields,
  type QuoteState,
  type StepId
} from "./orderFlowLogic";

export interface OrderFlowProps {
  /** live = at an event now. preorder = for an event. batch = no event. */
  kind: OrderKind;
  /** web = order page. mobile = /e/{id} on a phone. kiosk = the tablet at the event. */
  source: OrderSource;
  /** Required for live and preorder. For a kiosk batch request, the kiosk's event. */
  event?: EventRecord;
  /** Required when source is "kiosk". */
  kioskToken?: string;
  /** Called 1 time after the Worker saves the order. */
  onDone: (result: CreateOrderResult) => void;
  /** Shows a "Back" action on the first step when present. */
  onCancel?: () => void;
}

const emptyContact: ContactFields = { firstName: "", lastName: "", email: "", phone: "", note: "" };
const emptyDetails: DetailsFields = { fulfillment: "", address: "", date: "", timeRange: "" };
const QUOTE_FAILED_MESSAGE = "We could not check this address. Check your connection, then try again.";
const CART_CHANGED_MESSAGE = "We changed your order to match the tamales that are left.";

const paymentLabels: Record<PaymentMethod, string> = {
  unset: "",
  paypal: "PayPal or card",
  venmo: "Venmo",
  cashapp: "Cash App",
  cash: "Cash at the booth"
};

export function OrderFlow({ kind, source, event, kioskToken = "", onDone, onCancel }: OrderFlowProps) {
  const content = useSiteContent();
  const business = useBusinessSettings();
  const menu = useMenuProducts();
  const { ordering, loading: orderingLoading } = useOrderingSettings();
  const handles = usePaymentHandles();
  const fixed = usesStock(kind, event);
  const { stock, loading: stockLoading } = useEventStock(fixed && event ? event.id : "");

  const steps = useMemo(() => flowSteps(kind, source, ordering), [kind, source, ordering]);
  const [stepIndex, setStepIndex] = useState(0);
  const index = Math.min(stepIndex, steps.length - 1);
  const step: StepId = steps[index];
  const isLastStep = index === steps.length - 1;

  const [cart, setCart] = useState<Cart>({});
  const [details, setDetails] = useState<DetailsFields>(emptyDetails);
  const [quote, setQuote] = useState<QuoteState>({ status: "idle" });
  const [contact, setContact] = useState<ContactFields>(emptyContact);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("unset");
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [headsUpOpen, setHeadsUpOpen] = useState(false);
  const [website, setWebsite] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");

  const headsUpAsked = useRef(false);
  const attemptRef = useRef<AttemptKey | null>(null);
  const pendingQuote = useRef<{ address: string; promise: Promise<QuoteState | null> } | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownIndex = useRef(index);

  const timeZone = business.timezone || DEFAULT_TIME_ZONE;
  const taxRateBps = Number.isFinite(business.taxRateBps) ? business.taxRateBps : DEFAULT_TAX_RATE_BPS;
  const todayKey = dateKeyInZone(new Date(), timeZone);
  const earliestDate = minRequestDate(todayKey, ordering.minNoticeDays);
  const choices = fulfillmentChoices(ordering);
  const flowDetails: DetailsFields = { ...details, fulfillment: effectiveFulfillment(details.fulfillment, ordering) };

  const entries = useMemo(() => menuForFlow(kind, menu, event), [kind, menu, event]);
  const leftFor = useCallback(
    (itemId: string): number | null => (fixed && event ? stockLeft(itemId, event, stock) : null),
    [fixed, event, stock]
  );

  // A sold-out change or a new stock count can make the cart too large. Lower it and say so.
  useEffect(() => {
    if (fixed && stockLoading) return;
    const next = capCartToStock(cart, entries, leftFor);
    if (next !== cart) {
      setCart(next);
      setNotice(CART_CHANGED_MESSAGE);
    }
  }, [cart, entries, leftFor, fixed, stockLoading]);

  // Move the focus to the new step, so a screen reader and the scroll start at the top.
  useEffect(() => {
    if (shownIndex.current === index) return;
    shownIndex.current = index;
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [index]);

  const lines = useMemo(() => cartToLines(cart, entries), [cart, entries]);
  const deliveryFee = deliveryFeeCents(kind, flowDetails, quote);
  const usesPayPal = usesPayPalCheckout(kind, paymentMethod);
  const estimate = useMemo(
    () =>
      estimateOrder(lines, menu, {
        deliveryFeeCents: deliveryFee,
        taxRateBps,
        deliveryFeeTaxable: ordering.deliveryFeeTaxable,
        usesPayPal,
        feeSettings: ordering
      }),
    [lines, menu, deliveryFee, taxRateBps, ordering, usesPayPal]
  );
  // The kiosk has no PayPal buttons. A customer who wants PayPal orders on a phone.
  const payChoices = paymentChoices(handles, source !== "kiosk" && Boolean(configuredPayPalClientId()));
  const hasPaymentLink = payChoices.some((choice) => choice.method === "venmo" || choice.method === "cashapp");
  const approval = needsApproval(kind, event);
  const paymentNote = reviewPaymentNote(kind, event, ordering);

  function updateContact(field: keyof ContactFields, value: string) {
    setContact((current) => ({ ...current, [field]: value }));
  }

  function updateDetails(field: keyof DetailsFields, value: string) {
    setDetails((current) => ({ ...current, [field]: value }));
    if (field === "address") setQuote({ status: "idle" });
  }

  /** Asks the Worker for the delivery fee. Returns the result, or null when the check failed. */
  async function checkAddress(): Promise<QuoteState | null> {
    const address = details.address.trim();
    if (!address) {
      setErrors(["Enter the delivery address."]);
      return null;
    }
    if (address.length > ADDRESS_MAX) {
      setErrors([`Make the delivery address ${ADDRESS_MAX} characters or shorter.`]);
      return null;
    }
    if (quoteMatches(quote, address)) return quote;
    if (pendingQuote.current?.address === address) return pendingQuote.current.promise;

    setQuote({ status: "checking" });
    const promise = quoteDelivery({ address })
      .then((result): QuoteState => {
        const next: QuoteState = {
          address,
          status: result.status,
          feeCents: result.feeCents,
          distanceMiles: result.distanceMiles
        };
        setQuote(next);
        return next;
      })
      .catch((caught: unknown) => {
        setQuote({ status: "error", message: caught instanceof ApiError ? caught.message : QUOTE_FAILED_MESSAGE });
        return null;
      })
      .finally(() => {
        if (pendingQuote.current?.address === address) pendingQuote.current = null;
      });
    pendingQuote.current = { address, promise };
    return promise;
  }

  function validateStep(id: StepId, currentQuote: QuoteState = quote): string[] {
    switch (id) {
      case "menu":
        return validateMenu(kind, estimate.tamales, ordering);
      case "details":
        return validateDetails(flowDetails, { source, ordering, todayKey, quote: currentQuote });
      case "contact":
        return validateOrderContact(contact);
      case "payment":
        return validatePayment(
          paymentMethod,
          payChoices.map((choice) => choice.method)
        );
      default:
        return [];
    }
  }

  async function goNext() {
    let currentQuote = quote;
    if (step === "details" && detailsNeedQuote(flowDetails, quote)) {
      const checked = await checkAddress();
      if (!checked) return;
      currentQuote = checked;
    }
    const problems = validateStep(step, currentQuote);
    setErrors(problems);
    if (problems.length > 0) return;
    setNotice("");
    setStepIndex(Math.min(index + 1, steps.length - 1));
  }

  function goBack() {
    setErrors([]);
    setNotice("");
    if (index === 0) onCancel?.();
    else setStepIndex(index - 1);
  }

  async function placeOrder(optIn: boolean) {
    const input = buildCreateOrderInput({
      kind,
      source,
      eventId: event?.id ?? "",
      kioskToken,
      lines,
      contact,
      marketingOptIn: optIn,
      details: flowDetails,
      paymentMethod
    });
    attemptRef.current = attemptKeyFor(attemptRef.current, input, newAttemptKey);
    setSubmitting(true);
    setErrors([]);
    try {
      const result = await createOrder({
        ...input,
        idempotencyKey: attemptRef.current.key,
        turnstileToken,
        website
      });
      if (!result.trackerToken) throw new ApiError(SEND_FAILED_MESSAGE, 400);
      onDone({
        trackerToken: result.trackerToken,
        orderNumber: result.orderNumber ?? "",
        state: result.state ?? (approval ? "requested" : "received")
      });
    } catch (caught) {
      setErrors([caught instanceof ApiError ? caught.message : SEND_FAILED_MESSAGE]);
      turnstileRef.current?.reset();
      setSubmitting(false);
    }
  }

  function finish() {
    const problems = steps.flatMap((id) => validateStep(id));
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }
    if (turnstileEnabled() && !turnstileToken) {
      setErrors([TURNSTILE_WAIT_MESSAGE]);
      return;
    }
    if (!marketingOptIn && !headsUpAsked.current) {
      setHeadsUpOpen(true);
      return;
    }
    void placeOrder(marketingOptIn);
  }

  function answerHeadsUp(optIn: boolean) {
    headsUpAsked.current = true;
    setHeadsUpOpen(false);
    setMarketingOptIn(optIn);
    void placeOrder(optIn);
  }

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    // While an address check runs, Continue waits for it.
    if (submitting) return;
    if (isLastStep) finish();
    else void goNext();
  }

  // --- States before the form -------------------------------------------------

  if (kind === "batch" && orderingLoading) {
    return <p className="empty-state" aria-live="polite">Loading the order form.</p>;
  }
  if (kind === "batch" && choices.length === 0) {
    return (
      <section className="empty-state">
        <p>We do not take batch requests now.</p>
        {onCancel && (
          <button className="button button-ghost" type="button" onClick={onCancel}>
            <ArrowLeft size={18} aria-hidden="true" />
            Back
          </button>
        )}
      </section>
    );
  }
  if (fixed && stockLoading) {
    return <p className="empty-state" aria-live="polite">Loading the menu.</p>;
  }

  const primaryLabel = isLastStep ? (submitting ? "Sending..." : submitLabel(kind, event)) : "Continue";
  const showBack = index > 0 || Boolean(onCancel);

  return (
    <form className="order-flow" onSubmit={handleSubmit} noValidate>
      <div className="order-panel order-flow-panel">
        <h2 className="order-flow-step" ref={headingRef} tabIndex={-1}>
          {stepLabel(steps, index)}
        </h2>

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
        <div aria-live="polite">{notice && <p className="form-notice order-flow-notice">{notice}</p>}</div>

        {step === "menu" && (
          <>
            <p className="allergen-notice">
              <strong>Allergen notice.</strong> {content.allergenNotice}
            </p>
            {kind === "batch" && ordering.minBatchTamales > 1 && (
              <p className="muted">The smallest batch request is {quantityLabel(ordering.minBatchTamales)}.</p>
            )}
            {entries.length === 0 ? (
              <p className="muted">No menu items are for sale now.</p>
            ) : (
              <div className="product-grid">
                {entries.map((entry) => (
                  <ProductCard
                    key={entry.item.id}
                    entry={entry}
                    cart={cart}
                    left={leftFor(entry.item.id)}
                    onQuantityChange={(key, quantity) => {
                      setNotice("");
                      setCart((current) => ({ ...current, [key]: quantity }));
                    }}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {step === "details" && (
          <div className="form-grid">
            <fieldset className="choice-grid full-span">
              <legend>Pickup or delivery</legend>
              {choices.includes("pickup") && (
                <label>
                  <input
                    type="radio"
                    name="fulfillment"
                    checked={flowDetails.fulfillment === "pickup"}
                    onChange={() => updateDetails("fulfillment", "pickup")}
                  />
                  <span>
                    <strong>Pickup</strong>
                    {ordering.pickupAreaName && <small>Pickup area: {ordering.pickupAreaName}</small>}
                  </span>
                </label>
              )}
              {choices.includes("delivery") && (
                <label>
                  <input
                    type="radio"
                    name="fulfillment"
                    checked={flowDetails.fulfillment === "delivery"}
                    onChange={() => updateDetails("fulfillment", "delivery")}
                  />
                  <span>
                    <strong>Delivery</strong>
                    <small>We bring the order to your address.</small>
                  </span>
                </label>
              )}
            </fieldset>

            {flowDetails.fulfillment === "delivery" && (
              <div className="full-span order-address">
                <label>
                  Delivery address
                  <input
                    name="deliveryAddress"
                    type="text"
                    autoComplete="street-address"
                    maxLength={ADDRESS_MAX}
                    value={details.address}
                    onChange={(changeEvent) => updateDetails("address", changeEvent.target.value)}
                    onBlur={() => {
                      if (details.address.trim()) void checkAddress();
                    }}
                    required
                  />
                </label>
                <button
                  className="button button-ghost"
                  type="button"
                  onClick={() => void checkAddress()}
                  disabled={quote.status === "checking"}
                >
                  {quote.status === "checking" ? "Checking..." : "Check Address"}
                </button>
                <div aria-live="polite">
                  {quote.status === "error" && <p className="form-notice form-notice-error">{quote.message}</p>}
                  {quoteMatches(quote, details.address) && quote.status === "ok" && (
                    <p className="form-notice">Delivery fee: {formatMoney(quote.feeCents)}</p>
                  )}
                  {quoteMatches(quote, details.address) && quote.status === "outside" && (
                    <p className="form-notice form-notice-error">{OUTSIDE_AREA_MESSAGE}</p>
                  )}
                  {quoteMatches(quote, details.address) && quote.status === "not_found" && (
                    <p className="form-notice order-notice-plain">{ADDRESS_NOT_FOUND_MESSAGE}</p>
                  )}
                </div>
              </div>
            )}

            {source !== "kiosk" && (
              <>
                <label>
                  Date
                  <input
                    name="requestedDate"
                    type="date"
                    min={earliestDate}
                    value={details.date}
                    onChange={(changeEvent) => updateDetails("date", changeEvent.target.value)}
                    required
                  />
                </label>
                <label>
                  Time range (optional)
                  <input
                    name="timeRange"
                    type="text"
                    autoComplete="off"
                    maxLength={TIME_RANGE_MAX}
                    placeholder="5:00 PM - 7:00 PM"
                    value={details.timeRange}
                    onChange={(changeEvent) => updateDetails("timeRange", changeEvent.target.value)}
                  />
                </label>
              </>
            )}
          </div>
        )}

        {step === "contact" && (
          <div className="form-grid">
            <label>
              First name
              <input
                name="firstName"
                type="text"
                autoComplete="given-name"
                maxLength={60}
                value={contact.firstName}
                onChange={(changeEvent) => updateContact("firstName", changeEvent.target.value)}
                required
              />
            </label>
            <label>
              Last name
              <input
                name="lastName"
                type="text"
                autoComplete="family-name"
                maxLength={60}
                value={contact.lastName}
                onChange={(changeEvent) => updateContact("lastName", changeEvent.target.value)}
                required
              />
            </label>
            <label>
              Email address
              <input
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                maxLength={254}
                value={contact.email}
                onChange={(changeEvent) => updateContact("email", changeEvent.target.value)}
                required
              />
            </label>
            <label>
              Phone (optional)
              <input
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                maxLength={30}
                value={contact.phone}
                onChange={(changeEvent) => updateContact("phone", changeEvent.target.value)}
              />
            </label>
            <label className="full-span">
              Note (optional)
              <textarea
                name="note"
                rows={3}
                maxLength={NOTE_MAX}
                value={contact.note}
                onChange={(changeEvent) => updateContact("note", changeEvent.target.value)}
              />
              <span className="field-count">
                {contact.note.length} of {NOTE_MAX} characters
              </span>
            </label>
            <label className="toggle-row full-span order-optin">
              <input
                type="checkbox"
                checked={marketingOptIn}
                onChange={(changeEvent) => setMarketingOptIn(changeEvent.target.checked)}
              />
              <span>Send me pop-up dates and specials</span>
            </label>
          </div>
        )}

        {step === "payment" && (
          <fieldset className="choice-grid payment-choices">
            <legend className="sr-only">Payment method</legend>
            {payChoices.map((choice) => (
              <label key={choice.method}>
                <input
                  type="radio"
                  name="paymentMethod"
                  checked={paymentMethod === choice.method}
                  onChange={() => setPaymentMethod(choice.method)}
                />
                <span>
                  <strong>{choice.label}</strong>
                  {choice.method === "paypal" && paymentMethod === "paypal" && (
                    <small>This adds an online ordering fee of {formatMoney(estimate.totals.onlineFeeCents)}.</small>
                  )}
                  {choice.method === "venmo" && <small>@{handles.venmoHandle.replace(/^@/, "")}</small>}
                  {choice.method === "cashapp" && <small>${handles.cashAppCashtag.replace(/^\$/, "")}</small>}
                  {choice.method === "cash" && <small>Pay when you pick up your order.</small>}
                </span>
              </label>
            ))}
            {paymentMethod === "paypal" && (
              <p className="payment-fee-line">
                <span>Online ordering fee</span>
                <strong>{formatMoney(estimate.totals.onlineFeeCents)}</strong>
              </p>
            )}
            {hasPaymentLink && paymentMethod !== "paypal" && (
              <p className="muted">We show the payment link after you place the order.</p>
            )}
          </fieldset>
        )}

        {step === "review" && (
          <div className="review-stack">
            <OrderSummary
              lines={estimate.lines}
              totals={estimate.totals}
              delivery={deliveryLine(kind, flowDetails, quote)}
              approvalNote={approval}
            />
            <dl className="review-details">
              {event && kind !== "batch" && (
                <div>
                  <dt>Pickup</dt>
                  <dd>
                    {event.name}, {event.areaName}
                    <br />
                    {formatWindow(event)}
                  </dd>
                </div>
              )}
              {kind === "batch" && (
                <div>
                  <dt>{flowDetails.fulfillment === "delivery" ? "Delivery" : "Pickup"}</dt>
                  <dd>
                    {[
                      flowDetails.fulfillment === "delivery"
                        ? details.address.trim()
                        : ordering.pickupAreaName && `Pickup area: ${ordering.pickupAreaName}`,
                      source !== "kiosk" && details.date
                        ? [formatDateKey(details.date), details.timeRange.trim()].filter(Boolean).join(", ")
                        : ""
                    ]
                      .filter(Boolean)
                      .map((text) => (
                        <span className="review-line" key={text as string}>
                          {text}
                        </span>
                      ))}
                  </dd>
                </div>
              )}
              {kind === "live" && (
                <div>
                  <dt>Payment</dt>
                  <dd>{paymentLabels[paymentMethod]}</dd>
                </div>
              )}
              <div>
                <dt>Contact</dt>
                <dd>
                  {contact.firstName.trim()} {contact.lastName.trim()}
                  <br />
                  {contact.email.trim()}
                  {contact.phone.trim() && (
                    <>
                      <br />
                      {formatPhone(contact.phone)}
                    </>
                  )}
                </dd>
              </div>
            </dl>
            {paymentNote && <p className="review-payment-note">{paymentNote}</p>}
            {policyKeys(kind, event).map((key) => (
              <p className="muted review-policy" key={key}>
                {content[key]}
              </p>
            ))}
            <HoneypotField value={website} onChange={setWebsite} />
            <TurnstileWidget ref={turnstileRef} onToken={setTurnstileToken} />
          </div>
        )}
      </div>

      <div className="order-flow-bar">
        <div className="order-flow-total" aria-live="polite">
          <span>{quantityLabel(estimate.tamales)}</span>
          <strong>Total {formatMoney(estimate.totals.totalCents)}</strong>
        </div>
        <div className="order-flow-actions">
          {showBack && (
            <button className="button button-ghost" type="button" onClick={goBack} disabled={submitting}>
              <ArrowLeft size={18} aria-hidden="true" />
              Back
            </button>
          )}
          <button className="button button-primary" type="submit" disabled={submitting}>
            {primaryLabel}
            {!submitting && <ArrowRight size={18} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {headsUpOpen && (
        <HeadsUpDialog onAnswer={answerHeadsUp} onClose={() => setHeadsUpOpen(false)} />
      )}
    </form>
  );
}
