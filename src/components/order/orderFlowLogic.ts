// Pure rules for the customer order flow: steps, the menu for each order
// kind, the cart, stock limits, validation, and the request body.
// No React and no browser APIs, so tests can import this file.

import { eventItemIds } from "../../../shared/eventRules";
import type {
  CreateOrderInput,
  DeliveryQuoteResult,
  EventRecord,
  EventStock,
  Fulfillment,
  OrderCustomer,
  OrderKind,
  OrderLine,
  OrderLineInput,
  OrderSource,
  OrderTotals,
  OrderingSettings,
  PaymentMethod
} from "../../../shared/model";
import { addDaysToDateKey } from "../../../shared/orderNumber";
import { buildOrderLines, computeTotals, MAX_LINE_QUANTITY, SINGLE_VARIANT_ID } from "../../../shared/pricing";
import { quantityLabel } from "../../../shared/quantity";
import { isEmail } from "../publicForm";

export const NOTE_MAX = 500;
export const ADDRESS_MAX = 200;
export const TIME_RANGE_MAX = 100;

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export type StepId = "menu" | "details" | "contact" | "payment" | "review";

export const STEP_NAMES: Record<StepId, string> = {
  menu: "Menu",
  details: "Details",
  contact: "Contact",
  payment: "Payment",
  review: "Review"
};

/**
 * The steps for an order kind. A kiosk batch request has a Details step only
 * when the customer can select delivery; the kiosk sends no date.
 */
export function flowSteps(
  kind: OrderKind,
  source: OrderSource,
  ordering: Pick<OrderingSettings, "deliveryEnabled">
): StepId[] {
  if (kind === "live") return ["menu", "contact", "payment", "review"];
  if (kind === "preorder") return ["menu", "contact", "review"];
  if (source === "kiosk" && !ordering.deliveryEnabled) return ["menu", "contact", "review"];
  return ["menu", "details", "contact", "review"];
}

/** "Step 2 of 4: Menu" */
export function stepLabel(steps: StepId[], index: number): string {
  return `Step ${index + 1} of ${steps.length}: ${STEP_NAMES[steps[index]]}`;
}

/** An open-interest pre-order and a batch request wait for the owner. The others are accepted at once. */
export function needsApproval(kind: OrderKind, event?: Pick<EventRecord, "preorderMode">): boolean {
  if (kind === "batch") return true;
  return kind === "preorder" && event?.preorderMode !== "fixed";
}

export function submitLabel(kind: OrderKind, event?: Pick<EventRecord, "preorderMode">): string {
  return needsApproval(kind, event) ? "Send Request" : "Place Order";
}

/** True when the cart must stay inside the fixed allotment of the event. */
export function usesStock(kind: OrderKind, event?: Pick<EventRecord, "preorderMode">): boolean {
  return kind === "preorder" && event?.preorderMode === "fixed";
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

/** The parts of a menu item that the flow reads. `MenuProduct` in src/lib/types.ts fits it. */
export interface FlowMenuItem {
  id: string;
  name: string;
  status: string;
  singlePriceCents: number;
  bulkMenuEnabled: boolean;
  showWhenSoldOut: boolean;
  sortOrder: number;
  variants: Array<{
    id: string;
    label: string;
    unitQuantity: number;
    priceCents: number;
    minimumQuantity: number;
    active: boolean;
    sortOrder: number;
  }>;
}

/** One thing the customer can add: single tamales, or a variant of the item. */
export interface MenuOption {
  itemId: string;
  variantId: string;
  label: string;
  /** Tamales in 1 unit. */
  unitTamales: number;
  priceCents: number;
  /** The smallest quantity above 0. */
  minimum: number;
}

export interface MenuEntry<T extends FlowMenuItem = FlowMenuItem> {
  item: T;
  options: MenuOption[];
  soldOut: boolean;
}

function optionsFor(item: FlowMenuItem, kind: OrderKind): MenuOption[] {
  const options: MenuOption[] = [];
  if (kind === "live" && Number.isInteger(item.singlePriceCents) && item.singlePriceCents > 0) {
    options.push({
      itemId: item.id,
      variantId: SINGLE_VARIANT_ID,
      label: "Single",
      unitTamales: 1,
      priceCents: item.singlePriceCents,
      minimum: 1
    });
  }
  const variants = [...(item.variants ?? [])]
    .filter((variant) => variant.active === true && Number.isInteger(variant.priceCents) && variant.priceCents >= 0)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  for (const variant of variants) {
    options.push({
      itemId: item.id,
      variantId: variant.id,
      label: variant.label,
      unitTamales: Number.isInteger(variant.unitQuantity) && variant.unitQuantity > 0 ? variant.unitQuantity : 1,
      priceCents: variant.priceCents,
      minimum: Number(variant.minimumQuantity) > 0 ? Math.floor(Number(variant.minimumQuantity)) : 1
    });
  }
  return options;
}

/**
 * The menu for the flow, in menu order.
 * live: the items of the event, with single tamales and variants.
 * preorder: the items of the event, variants only.
 * batch: each active item that is on the batch menu, variants only.
 * A sold-out item stays in the list with no way to add it.
 */
export function menuForFlow<T extends FlowMenuItem>(
  kind: OrderKind,
  menu: T[],
  event?: Pick<EventRecord, "itemIds" | "soldOutItemIds">
): MenuEntry<T>[] {
  const sorted = [...menu].sort((a, b) => a.sortOrder - b.sortOrder);
  const activeIds = sorted.filter((item) => item.status === "active").map((item) => item.id);
  const eventIds = kind !== "batch" && event ? eventItemIds(event, activeIds) : activeIds;
  const selected = kind !== "batch" && event ? (event.itemIds ?? []) : [];
  const soldOutAtEvent = kind === "live" && event ? (event.soldOutItemIds ?? []) : [];

  const entries: MenuEntry<T>[] = [];
  for (const item of sorted) {
    if (kind === "batch" && item.bulkMenuEnabled !== true) continue;
    const options = optionsFor(item, kind);
    if (options.length === 0) continue;
    if (item.status === "active") {
      if (!eventIds.includes(item.id)) continue;
      entries.push({ item, options, soldOut: soldOutAtEvent.includes(item.id) });
    } else if (item.status === "sold_out" && item.showWhenSoldOut) {
      if (selected.length > 0 && !selected.includes(item.id)) continue;
      entries.push({ item, options, soldOut: true });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------

/** Quantity for each option. The key is `cartKey(itemId, variantId)`. */
export type Cart = Record<string, number>;

export function cartKey(itemId: string, variantId: string): string {
  return `${itemId}|${variantId}`;
}

/** The lines to send: each option on the menu that has a quantity above 0. */
export function cartToLines(cart: Cart, entries: MenuEntry[]): OrderLineInput[] {
  const lines: OrderLineInput[] = [];
  for (const entry of entries) {
    if (entry.soldOut) continue;
    for (const option of entry.options) {
      const quantity = cart[cartKey(option.itemId, option.variantId)] ?? 0;
      if (Number.isInteger(quantity) && quantity > 0) {
        lines.push({ itemId: option.itemId, variantId: option.variantId, quantity });
      }
    }
  }
  return lines;
}

/** Tamales in the cart for 1 menu item. */
export function cartTamalesForItem(cart: Cart, entry: MenuEntry): number {
  if (entry.soldOut) return 0;
  return entry.options.reduce(
    (sum, option) => sum + (cart[cartKey(option.itemId, option.variantId)] ?? 0) * option.unitTamales,
    0
  );
}

/**
 * Tamales that remain for pre-order for 1 menu item.
 * With no stock document, the full allotment of the event remains.
 */
export function stockLeft(
  itemId: string,
  event: Pick<EventRecord, "allotment">,
  stock: Pick<EventStock, "remaining"> | null
): number {
  const source = stock ? stock.remaining : event.allotment;
  const left = Number(source?.[itemId] ?? 0);
  return Number.isFinite(left) && left > 0 ? Math.floor(left) : 0;
}

/**
 * The largest quantity for 1 option. `left` is the tamales that remain for the
 * item, or null when the item has no limit.
 */
export function maxQuantity(option: MenuOption, cart: Cart, entry: MenuEntry, left: number | null): number {
  if (left === null) return MAX_LINE_QUANTITY;
  const own = (cart[cartKey(option.itemId, option.variantId)] ?? 0) * option.unitTamales;
  const others = cartTamalesForItem(cart, entry) - own;
  const fit = Math.floor((left - others) / option.unitTamales);
  return Math.max(0, Math.min(MAX_LINE_QUANTITY, fit));
}

/** The next quantity for a + or - press. The first + goes to the minimum. A - at the minimum goes to 0. */
export function stepQuantity(current: number, direction: 1 | -1, minimum: number, max: number): number {
  if (direction === 1) {
    const next = current < minimum ? minimum : current + 1;
    return next > max ? current : next;
  }
  const next = current - 1;
  return next < minimum ? 0 : next;
}

/** Lowers each quantity that is above what remains. Returns the same cart if nothing changes. */
export function capCartToStock(
  cart: Cart,
  entries: MenuEntry[],
  leftFor: (itemId: string) => number | null
): Cart {
  let next = cart;
  for (const entry of entries) {
    const left = leftFor(entry.item.id);
    for (const option of entry.options) {
      const key = cartKey(option.itemId, option.variantId);
      const quantity = next[key] ?? 0;
      if (quantity === 0) continue;
      let allowed = entry.soldOut ? 0 : Math.min(quantity, maxQuantity(option, next, entry, left));
      if (allowed < option.minimum) allowed = 0;
      if (allowed !== quantity) next = { ...next, [key]: allowed };
    }
  }
  return next;
}

export interface Estimate {
  lines: OrderLine[];
  totals: OrderTotals;
  tamales: number;
}

/**
 * The lines and totals to show. It uses the same functions as the Worker.
 * A line that the menu does not accept is left out.
 */
export function estimateOrder(
  inputs: OrderLineInput[],
  menu: FlowMenuItem[],
  options: { deliveryFeeCents: number; taxRateBps: number; deliveryFeeTaxable: boolean }
): Estimate {
  const lines: OrderLine[] = [];
  for (const input of inputs) {
    try {
      lines.push(...buildOrderLines([input], menu));
    } catch {
      // The Worker gives the reason when the customer sends the order.
    }
  }
  const totals = computeTotals({ lines, ...options });
  const tamales = lines.reduce((sum, line) => sum + line.unitTamales * line.quantity, 0);
  return { lines, totals, tamales };
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** The first date a batch request can ask for. Both values are YYYY-MM-DD in the business time zone. */
export function minRequestDate(todayKey: string, minNoticeDays: number): string {
  const days = Number.isInteger(minNoticeDays) && minNoticeDays > 0 ? minNoticeDays : 0;
  return addDaysToDateKey(todayKey, days);
}

/** "2026-11-14" -> "Sat, Nov 14" */
export function formatDateKey(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(date);
}

// ---------------------------------------------------------------------------
// Validation. Each function returns 1 instruction for each problem.
// ---------------------------------------------------------------------------

export function validateMenu(
  kind: OrderKind,
  tamales: number,
  ordering: Pick<OrderingSettings, "minBatchTamales">
): string[] {
  if (tamales < 1) return ["Select 1 menu item or more."];
  if (kind === "batch" && tamales < ordering.minBatchTamales) {
    return [`Select ${quantityLabel(ordering.minBatchTamales)} or more for a batch request.`];
  }
  return [];
}

/** The pickup and delivery choices that the owner offers for batch requests. */
export function fulfillmentChoices(
  ordering: Pick<OrderingSettings, "pickupEnabled" | "deliveryEnabled">
): Array<"pickup" | "delivery"> {
  const choices: Array<"pickup" | "delivery"> = [];
  if (ordering.pickupEnabled) choices.push("pickup");
  if (ordering.deliveryEnabled) choices.push("delivery");
  return choices;
}

export type QuoteState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "error"; message: string }
  | ({ address: string } & DeliveryQuoteResult);

export const OUTSIDE_AREA_MESSAGE = "This address is outside our delivery area.";
export const ADDRESS_NOT_FOUND_MESSAGE =
  "We could not find this address. We will set the delivery fee when we approve your order.";

export interface DetailsFields {
  fulfillment: "" | "pickup" | "delivery";
  address: string;
  /** YYYY-MM-DD, or empty. */
  date: string;
  timeRange: string;
}

export function validateDetails(
  fields: DetailsFields,
  context: {
    source: OrderSource;
    ordering: Pick<OrderingSettings, "pickupEnabled" | "deliveryEnabled" | "minNoticeDays">;
    todayKey: string;
    quote: QuoteState;
  }
): string[] {
  const errors: string[] = [];
  const choices = fulfillmentChoices(context.ordering);
  if (fields.fulfillment === "" || !choices.includes(fields.fulfillment)) {
    errors.push(choices.length > 1 ? "Select pickup or delivery." : "Select how you get your order.");
  }
  if (fields.fulfillment === "delivery") {
    const address = fields.address.trim();
    if (!address) errors.push("Enter the delivery address.");
    else if (address.length > ADDRESS_MAX) errors.push(`Make the delivery address ${ADDRESS_MAX} characters or shorter.`);
    else if ("address" in context.quote && context.quote.address === address && context.quote.status === "outside") {
      errors.push(OUTSIDE_AREA_MESSAGE);
    }
  }
  // The kiosk has no date field. The owner sets the date at approval.
  if (context.source !== "kiosk") {
    const earliest = minRequestDate(context.todayKey, context.ordering.minNoticeDays);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.date)) errors.push("Select a date.");
    else if (fields.date < earliest) errors.push(`Select ${formatDateKey(earliest)} or a later date.`);
    if (fields.timeRange.trim().length > TIME_RANGE_MAX) {
      errors.push(`Make the time range ${TIME_RANGE_MAX} characters or shorter.`);
    }
  }
  return errors;
}

export interface ContactFields {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  note: string;
}

export function validateOrderContact(fields: ContactFields): string[] {
  const errors: string[] = [];
  if (!fields.firstName.trim()) errors.push("Enter your first name.");
  if (!fields.lastName.trim()) errors.push("Enter your last name.");
  if (!fields.email.trim()) errors.push("Enter your email address.");
  else if (!isEmail(fields.email)) errors.push("Enter a complete email address.");
  const phone = fields.phone.trim();
  if (phone) {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15 || !/^[0-9+().\-\s]+$/.test(phone)) {
      errors.push("Enter a phone number with 10 digits, or leave the phone field empty.");
    }
  }
  if (fields.note.trim().length > NOTE_MAX) errors.push(`Make your note ${NOTE_MAX} characters or shorter.`);
  return errors;
}

export type LivePaymentMethod = "venmo" | "cashapp" | "cash";

/** The payment rows for a live order. A row with no account name is left out. */
export function paymentChoices(handles: { venmoHandle: string; cashAppCashtag: string }): Array<{
  method: LivePaymentMethod;
  label: string;
}> {
  const choices: Array<{ method: LivePaymentMethod; label: string }> = [];
  if (handles.venmoHandle.trim()) choices.push({ method: "venmo", label: "Venmo" });
  if (handles.cashAppCashtag.trim()) choices.push({ method: "cashapp", label: "Cash App" });
  choices.push({ method: "cash", label: "Cash at the booth" });
  return choices;
}

export function validatePayment(method: string, allowed: LivePaymentMethod[]): string[] {
  return allowed.includes(method as LivePaymentMethod) ? [] : ["Select a payment method."];
}

// ---------------------------------------------------------------------------
// Request body
// ---------------------------------------------------------------------------

export interface OrderDraft {
  kind: OrderKind;
  source: OrderSource;
  eventId: string;
  kioskToken: string;
  lines: OrderLineInput[];
  contact: ContactFields;
  marketingOptIn: boolean;
  details: DetailsFields;
  paymentMethod: PaymentMethod;
}

/** The body for POST /api/v1/orders, without the Turnstile token and the honeypot. */
export function buildCreateOrderInput(draft: OrderDraft): CreateOrderInput {
  const isBatch = draft.kind === "batch";
  const customer: OrderCustomer = {
    firstName: draft.contact.firstName.trim(),
    lastName: draft.contact.lastName.trim(),
    email: draft.contact.email.trim(),
    phone: draft.contact.phone.trim(),
    marketingOptIn: draft.marketingOptIn
  };
  let fulfillment: Fulfillment = "event_pickup";
  if (isBatch) fulfillment = draft.details.fulfillment === "delivery" ? "delivery" : "pickup";
  const sendsDate = isBatch && draft.source !== "kiosk";
  return {
    kind: draft.kind,
    source: draft.source,
    // A batch request has no event. A kiosk batch request names the event of the kiosk.
    eventId: !isBatch || draft.source === "kiosk" ? draft.eventId : "",
    kioskToken: draft.source === "kiosk" ? draft.kioskToken : "",
    items: draft.lines,
    customer,
    fulfillment,
    deliveryAddress: fulfillment === "delivery" ? draft.details.address.trim() : "",
    requested: sendsDate ? { date: draft.details.date, timeRange: draft.details.timeRange.trim() } : null,
    paymentMethod: draft.kind === "live" ? draft.paymentMethod : "unset",
    customerNote: draft.contact.note.trim()
  };
}

// ---------------------------------------------------------------------------
// Small rules for the screens
// ---------------------------------------------------------------------------

/** True when the owner takes batch requests: pickup or delivery is on. */
export function batchRequestsEnabled(ordering: Pick<OrderingSettings, "pickupEnabled" | "deliveryEnabled">): boolean {
  return fulfillmentChoices(ordering).length > 0;
}

/** The fulfillment to use. With only 1 choice, that choice. A choice the owner turned off becomes empty. */
export function effectiveFulfillment(
  selected: DetailsFields["fulfillment"],
  ordering: Pick<OrderingSettings, "pickupEnabled" | "deliveryEnabled">
): DetailsFields["fulfillment"] {
  const choices = fulfillmentChoices(ordering);
  if (choices.length === 1) return choices[0];
  return selected !== "" && choices.includes(selected) ? selected : "";
}

/** True when the quote is the result for this address. */
export function quoteMatches(quote: QuoteState, address: string): quote is { address: string } & DeliveryQuoteResult {
  return "address" in quote && quote.address === address.trim();
}

/** True when the Details step must check the delivery address before it continues. */
export function detailsNeedQuote(fields: DetailsFields, quote: QuoteState): boolean {
  const address = fields.address.trim();
  return fields.fulfillment === "delivery" && address.length > 0 && address.length <= ADDRESS_MAX && !quoteMatches(quote, address);
}

/** What the Delivery fee line shows. */
export type DeliveryLine = "none" | "fee" | "to_be_set";

export function deliveryLine(kind: OrderKind, fields: DetailsFields, quote: QuoteState): DeliveryLine {
  if (kind !== "batch" || fields.fulfillment !== "delivery") return "none";
  return quoteMatches(quote, fields.address) && quote.status === "ok" ? "fee" : "to_be_set";
}

/** The delivery fee for the estimate, in cents. 0 until the address has a fee. */
export function deliveryFeeCents(kind: OrderKind, fields: DetailsFields, quote: QuoteState): number {
  return deliveryLine(kind, fields, quote) === "fee" && "feeCents" in quote ? quote.feeCents : 0;
}

export type PolicyKey = "orderPolicy" | "paymentPolicy" | "refundPolicy";

/**
 * The site content policies for the Review step.
 * A live order has none: the customer pays at the event.
 */
export function policyKeys(kind: OrderKind, event?: Pick<EventRecord, "preorderMode">): PolicyKey[] {
  if (kind === "live") return [];
  if (kind === "batch") return ["paymentPolicy"];
  return needsApproval(kind, event) ? ["paymentPolicy", "refundPolicy"] : ["refundPolicy"];
}

/**
 * Tamales that remain for pre-order across the items of the event.
 * `activeItemIds` are the active menu items, in any order.
 */
export function totalStockLeft(
  event: Pick<EventRecord, "allotment" | "itemIds">,
  stock: Pick<EventStock, "remaining"> | null,
  activeItemIds: string[]
): number {
  return eventItemIds(event, activeItemIds).reduce((sum, itemId) => sum + stockLeft(itemId, event, stock), 0);
}

/** "18 (1 dozen) left" style text, or "Sold out" at 0. */
export function stockText(left: number): string {
  return left > 0 ? `${quantityLabel(left)} left` : "Sold out";
}

// ---------------------------------------------------------------------------
// Retry key. 1 key for each order attempt; a retry of the same order sends it again.
// ---------------------------------------------------------------------------

export interface AttemptKey {
  fingerprint: string;
  key: string;
}

/** Keeps the key while the order body stays the same. A changed order gets a new key. */
export function attemptKeyFor(previous: AttemptKey | null, input: CreateOrderInput, makeKey: () => string): AttemptKey {
  const { idempotencyKey: _ignored, ...body } = input;
  void _ignored;
  const fingerprint = JSON.stringify(body);
  if (previous && previous.fingerprint === fingerprint) return previous;
  return { fingerprint, key: makeKey() };
}

/** A key that the Worker accepts: letters, digits, "-" and "_", 64 characters or fewer. */
export function newAttemptKey(): string {
  const cryptoApi = typeof globalThis.crypto !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") cryptoApi.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The message when the Worker does not return an order. */
export const SEND_FAILED_MESSAGE = "We could not send your order. Check your connection, then try again.";
