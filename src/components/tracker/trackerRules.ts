// Rules for the order tracker at /t/{trackerToken}. No React and no Firebase here.
// See docs/V1_DESIGN.md sections 4, 9 and 12 and docs/V1_FUNDAMENTALS.md section 9.

import type {
  Fulfillment,
  OrderKind,
  OrderState,
  OrderTotals,
  PaymentMethod,
  PaymentState,
  TrackerRecord
} from "../../../shared/model";

const KINDS: OrderKind[] = ["live", "preorder", "batch"];
const STATES: OrderState[] = [
  "requested",
  "approved",
  "declined",
  "received",
  "preparing",
  "ready",
  "handed_over",
  "canceled",
  "expired"
];
const PAYMENT_STATES: PaymentState[] = ["unpaid", "check_payment", "paid", "refunded"];
const PAYMENT_METHODS: PaymentMethod[] = ["unset", "paypal", "venmo", "cashapp", "cash"];
const FULFILLMENTS: Fulfillment[] = ["event_pickup", "pickup", "delivery"];

/** A tracker token from the link: letters, digits, "-" and "_". The Worker makes 48 hex characters. */
export function isTrackerToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,200}$/.test(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function cents(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function oneOf<T extends string>(value: unknown, options: T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

/** Builds a tracker with a safe value for each field. Returns null for a document with no valid state. */
export function mapTrackerDoc(data: Record<string, unknown> | undefined): TrackerRecord | null {
  if (!data || !STATES.includes(data.state as OrderState)) return null;
  const totals = (data.totals && typeof data.totals === "object" ? data.totals : {}) as Record<string, unknown>;
  const items = Array.isArray(data.items) ? data.items : [];
  return {
    orderNumber: text(data.orderNumber),
    kind: oneOf(data.kind, KINDS, "live"),
    state: data.state as OrderState,
    paymentState: oneOf(data.paymentState, PAYMENT_STATES, "unpaid"),
    paymentMethod: oneOf(data.paymentMethod, PAYMENT_METHODS, "unset"),
    paymentDescription: text(data.paymentDescription),
    firstName: text(data.firstName),
    eventName: text(data.eventName),
    fulfillment: oneOf(data.fulfillment, FULFILLMENTS, "event_pickup"),
    items: items
      .filter((item) => item && typeof item === "object")
      .map((item) => {
        const line = item as Record<string, unknown>;
        return { label: text(line.label), quantity: cents(line.quantity) };
      }),
    totals: {
      subtotalCents: cents(totals.subtotalCents),
      deliveryFeeCents: cents(totals.deliveryFeeCents),
      onlineFeeCents: cents(totals.onlineFeeCents),
      taxCents: cents(totals.taxCents),
      totalCents: cents(totals.totalCents)
    },
    reason: text(data.reason),
    scheduledAtUtc: text(data.scheduledAtUtc),
    updatedAtUtc: text(data.updatedAtUtc)
  };
}

/** The 3 steps of the tracker, in sequence. */
export const TRACKER_STEPS = ["Received", "Being prepared", "Ready"] as const;

/** The index of the current step in `TRACKER_STEPS`, or -1 for a state that is not a step. */
export function stepIndex(state: OrderState): number {
  if (state === "received") return 0;
  if (state === "preparing") return 1;
  if (state === "ready") return 2;
  return -1;
}

/** The word next to a step: "Done", "Now" or "Next". Color is not the only signal. */
export function stepWord(index: number, current: number): "Done" | "Now" | "Next" {
  if (index < current) return "Done";
  return index === current ? "Now" : "Next";
}

export type TrackerView =
  /** The 3 steps, with the current one marked. */
  | { type: "steps"; current: number; ready: boolean }
  /** A request before the steps, or an order that stopped. */
  | { type: "message"; tone: "wait" | "stopped" | "done"; label: string; detail: string };

/** What the tracker shows for the state of the order. */
export function trackerView(
  record: Pick<TrackerRecord, "state" | "reason" | "firstName">
): TrackerView {
  const reason = record.reason.trim();
  switch (record.state) {
    case "requested":
      return { type: "message", tone: "wait", label: "Waiting for approval", detail: "" };
    case "approved":
      return {
        type: "message",
        tone: "wait",
        label: "Approved. Pay to confirm.",
        detail: "We will send you a payment link."
      };
    case "declined":
      return { type: "message", tone: "stopped", label: "Declined", detail: reason };
    case "canceled":
      return { type: "message", tone: "stopped", label: "Canceled", detail: reason };
    case "expired":
      return {
        type: "message",
        tone: "stopped",
        label: "Canceled",
        detail: reason || "We did not receive the payment in time."
      };
    case "handed_over": {
      const name = record.firstName.trim();
      return {
        type: "message",
        tone: "done",
        label: name ? `Thanks, ${name}!` : "Thanks!",
        detail: "You have your order. Enjoy your tamales."
      };
    }
    default:
      return { type: "steps", current: stepIndex(record.state), ready: record.state === "ready" };
  }
}

/** The headline of the tracker for the state of the order. */
export function trackerHeadline(view: TrackerView): string {
  if (view.type === "message") return view.label;
  return view.ready ? "Your order is ready!" : TRACKER_STEPS[view.current];
}

/** "Red Tamales, Half dozen × 2". */
export function itemText(item: { label: string; quantity: number }): string {
  return `${item.label} × ${item.quantity}`;
}

/** True while the order can still become ready: the page shows "Turn On Alerts" and "Keep this page open." */
export function waitsForReady(state: OrderState): boolean {
  return !isFinalTrackerState(state) && state !== "ready";
}

/** What the phone does with its saved tracker for this state. */
export function resumeAction(state: OrderState): "save" | "clear" {
  return isFinalTrackerState(state) ? "clear" : "save";
}

/** The text for the live region. A screen reader says it when the status changes. */
export function statusAnnouncement(record: Pick<TrackerRecord, "state" | "reason" | "firstName">): string {
  const view = trackerView(record);
  if (view.type === "message") return [view.label, view.detail].filter(Boolean).join(" ");
  if (view.ready) return "Your order is ready!";
  return `Status: ${TRACKER_STEPS[view.current]}`;
}

/** The support line below "Your order is ready!". Empty when there is none. */
export function readyDetail(record: Pick<TrackerRecord, "fulfillment">): string {
  return record.fulfillment === "event_pickup" ? "Come to the booth and show this page." : "";
}

export interface MoneyLine {
  label: string;
  cents: number;
  total: boolean;
}

/** Subtotal, Delivery fee, Online ordering fee, Tax, Total. A fee of 0 has no line. */
export function moneyLines(totals: OrderTotals): MoneyLine[] {
  const lines: MoneyLine[] = [{ label: "Subtotal", cents: totals.subtotalCents, total: false }];
  if (totals.deliveryFeeCents > 0) {
    lines.push({ label: "Delivery fee", cents: totals.deliveryFeeCents, total: false });
  }
  if (totals.onlineFeeCents > 0) {
    lines.push({ label: "Online ordering fee", cents: totals.onlineFeeCents, total: false });
  }
  lines.push({ label: "Tax", cents: totals.taxCents, total: false });
  lines.push({ label: "Total", cents: totals.totalCents, total: true });
  return lines;
}

/** "Pickup" or "Delivery", for the line with the final date and time. */
export function scheduledLabel(fulfillment: Fulfillment): string {
  return fulfillment === "delivery" ? "Delivery" : "Pickup";
}

/** The public payment account names from `settings/payments`. */
export interface PaymentHandles {
  venmoHandle: string;
  cashAppCashtag: string;
}

/** "@Jane-Doe " -> "Jane-Doe". Returns an empty string for a name with other characters. */
export function cleanHandle(value: string): string {
  const clean = value.trim().replace(/^[@$]+/, "");
  return /^[A-Za-z0-9_-]{1,60}$/.test(clean) ? clean : "";
}

function amountText(totalCents: number): string {
  return (Math.max(0, Math.round(totalCents)) / 100).toFixed(2);
}

/**
 * The payment link for a live order. Empty for cash, for other methods, and with no account name.
 * Cash App cannot take a note, so the customer copies the payment description.
 */
export function paymentLink(
  method: PaymentMethod,
  handles: PaymentHandles,
  totalCents: number,
  description: string
): string {
  const amount = amountText(totalCents);
  if (method === "venmo") {
    const handle = cleanHandle(handles.venmoHandle);
    if (!handle) return "";
    return `https://venmo.com/${handle}?txn=pay&amount=${amount}&note=${encodeURIComponent(description)}`;
  }
  if (method === "cashapp") {
    const tag = cleanHandle(handles.cashAppCashtag);
    return tag ? `https://cash.app/$${tag}/${amount}` : "";
  }
  return "";
}

export type PaymentHelp =
  | { type: "none" }
  | { type: "text"; text: string }
  /** A payment link method: the copy button, and the link when the account name exists. */
  | { type: "link"; buttonLabel: string; url: string; description: string };

/** The payment block of the tracker. */
export function paymentHelp(
  record: Pick<TrackerRecord, "state" | "paymentState" | "paymentMethod" | "paymentDescription" | "totals">,
  handles: PaymentHandles
): PaymentHelp {
  if (isFinalTrackerState(record.state)) return { type: "none" };
  if (record.paymentState === "paid") return { type: "text", text: "Payment received." };
  if (record.paymentState !== "check_payment") return { type: "none" };
  if (record.paymentMethod === "cash") return { type: "text", text: "Pay at the booth." };
  if (record.paymentMethod === "venmo" || record.paymentMethod === "cashapp") {
    return {
      type: "link",
      buttonLabel: record.paymentMethod === "venmo" ? "Pay with Venmo" : "Pay with Cash App",
      url: paymentLink(record.paymentMethod, handles, record.totals.totalCents, record.paymentDescription),
      description: record.paymentDescription
    };
  }
  return { type: "none" };
}

/** An order in a final state does not change again. The phone forgets its tracker. */
export function isFinalTrackerState(state: OrderState): boolean {
  return state === "handed_over" || state === "declined" || state === "canceled" || state === "expired";
}

/**
 * True when the page alerts: the state changes to ready while the page is open.
 * `previous` is null on the first load, so an order that is ready then does not alert.
 */
export function shouldAlert(previous: OrderState | null, next: OrderState): boolean {
  return previous !== null && previous !== "ready" && next === "ready";
}

/** The number of chimes and the vibration pattern for the ready alert. */
export const READY_CHIMES = 3;
export const READY_VIBRATION = [400, 200, 400, 200, 800];

export interface FlashPlan {
  /** Time between 2 color changes, in milliseconds. 500 or more: 2 changes each second at most. */
  intervalMs: number;
  /** The number of color changes. An even number, so the page ends on the ready color. */
  changes: number;
}

/** The slow flash of the ready alert. With reduced motion, the page shows a solid color. */
export function flashPlan(reducedMotion: boolean): FlashPlan {
  return reducedMotion ? { intervalMs: 0, changes: 0 } : { intervalMs: 600, changes: 10 };
}

/** True when the page shows the second flash color after `changesDone` color changes. */
export function flashIsAlternate(changesDone: number, plan: FlashPlan): boolean {
  return changesDone < plan.changes && changesDone % 2 === 1;
}
