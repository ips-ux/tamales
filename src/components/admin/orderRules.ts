// Pure helpers for the owner's order screens (Pre-Orders queue, Live POS
// Orders queue). No React and no Firestore, so tests can import this file.

import type {
  OrderAction,
  OrderKind,
  OrderLine,
  OrderRecord,
  OrderState,
  PaymentMethod,
  PaymentState
} from "../../../shared/model";
import type { RefundOrderInput } from "../../../shared/moneyModel";
import { canRunAction, handOverNeedsPayment, isFinalState, PAY_FIRST_MESSAGE } from "../../../shared/orderState";
import { quantityLabel } from "../../../shared/quantity";
import { formatMoney } from "../../lib/money";

/** The owner's short label for each order state. */
export const stateLabels: Record<OrderState, string> = {
  requested: "Waiting for approval",
  approved: "Approved",
  declined: "Declined",
  received: "Received",
  preparing: "Being prepared",
  ready: "Ready",
  handed_over: "Handed over",
  canceled: "Canceled",
  expired: "Expired"
};

/** Badge classes from global.css. The word is the first signal; color is the second. */
export const stateBadgeClass: Record<OrderState, string> = {
  requested: "status-preparing",
  approved: "status-preparing",
  declined: "status-canceled",
  received: "status-new",
  preparing: "status-preparing",
  ready: "status-ready",
  handed_over: "status-ready",
  canceled: "status-canceled",
  expired: "status-canceled"
};

export const kindLabels: Record<OrderKind, string> = {
  live: "Order",
  preorder: "Pre-order",
  batch: "Batch request"
};

export const paymentStateLabels: Record<PaymentState, string> = {
  unpaid: "Not paid",
  check_payment: "Check payment",
  paid: "Paid",
  refunded: "Refunded"
};

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  unset: "Not selected",
  paypal: "PayPal",
  venmo: "Venmo",
  cashapp: "Cash App",
  cash: "Cash"
};

export const actionLabels: Record<OrderAction, string> = {
  approve: "Approve",
  decline: "Decline",
  mark_paid: "Mark as Paid",
  mark_unpaid: "Mark as Unpaid",
  prepare: "Start",
  ready: "Mark Ready",
  hand_over: "Hand Over",
  cancel: "Cancel Order",
  save_note: "Save Note"
};

/** The label a button shows while its action runs. */
export const actionBusyLabels: Record<OrderAction, string> = {
  approve: "Approving...",
  decline: "Declining...",
  mark_paid: "Saving...",
  mark_unpaid: "Saving...",
  prepare: "Starting...",
  ready: "Saving...",
  hand_over: "Saving...",
  cancel: "Canceling...",
  save_note: "Saving..."
};

const actionOrder: OrderAction[] = [
  "approve",
  "decline",
  "mark_paid",
  "mark_unpaid",
  "prepare",
  "ready",
  "hand_over",
  "cancel"
];

/** The state actions that the owner can run on this order now, in button order. "save_note" has its own button. */
export function availableActions(order: OrderRecord): OrderAction[] {
  return actionOrder.filter((action) => canRunAction(order, action));
}

/** The hint below the buttons when "Hand Over" waits for the payment. Empty if it does not. */
export function handOverHint(order: OrderRecord): string {
  return canRunAction(order, "hand_over") && handOverNeedsPayment(order) ? PAY_FIRST_MESSAGE : "";
}

/** True when the button of this action shows but cannot run now. */
export function actionBlocked(order: OrderRecord, action: OrderAction): boolean {
  return action === "hand_over" && handOverNeedsPayment(order);
}

// ---------------------------------------------------------------------------
// Payment facts and refunds
// ---------------------------------------------------------------------------

type PaymentFields = Pick<
  OrderRecord,
  "state" | "paymentState" | "paymentMethod" | "paidAtUtc" | "paypalFeeCents" | "refundedCents" | "payByUtc"
>;

/** "PayPal, Paid" or "Not paid". The method shows only after the customer or the owner set it. */
export function paymentSummary(order: Pick<OrderRecord, "paymentState" | "paymentMethod">): string {
  const state = paymentStateLabels[order.paymentState];
  return order.paymentMethod === "unset" ? state : `${paymentMethodLabels[order.paymentMethod]}, ${state}`;
}

export interface PaymentFact {
  label: string;
  value: string;
}

/**
 * The payment facts of an order: when it was paid, the PayPal fee, the refunded
 * amount, and the pay-by time of an approved order. A fact with no value is left out.
 * `formatDateTime` gives "Sat, Nov 14, 5:02 PM" in the business time zone.
 */
export function paymentFacts(order: PaymentFields, formatDateTime: (iso: string) => string): PaymentFact[] {
  const facts: PaymentFact[] = [];
  if (order.paidAtUtc && (order.paymentState === "paid" || order.paymentState === "refunded")) {
    facts.push({ label: "Paid", value: formatDateTime(order.paidAtUtc) });
  }
  if (order.paypalFeeCents > 0) facts.push({ label: "PayPal fee", value: formatMoney(order.paypalFeeCents) });
  if (order.refundedCents > 0) facts.push({ label: "Refunded", value: formatMoney(order.refundedCents) });
  if (order.state === "approved" && order.payByUtc) {
    facts.push({ label: "Pay by", value: formatDateTime(order.payByUtc) });
  }
  return facts;
}

type RefundFields = Pick<OrderRecord, "id" | "state" | "paymentState" | "totals" | "refundedCents">;

/** The part of the total that the owner did not refund. */
export function refundRemainingCents(order: Pick<OrderRecord, "totals" | "refundedCents">): number {
  return Math.max(0, order.totals.totalCents - Math.max(0, order.refundedCents));
}

/** True when the owner can record a refund: the order is paid and money remains. */
export function canRefund(order: Pick<OrderRecord, "paymentState" | "totals" | "refundedCents">): boolean {
  return order.paymentState === "paid" && refundRemainingCents(order) > 0;
}

/** True when the Refund dialog offers "Cancel this order": the customer does not have the order yet. */
export function canCancelWithRefund(order: Pick<OrderRecord, "state">): boolean {
  return !isFinalState(order.state);
}

export const REFUND_REASON_MAX = 500;

export interface RefundForm {
  /** Dollars, as typed. */
  amount: string;
  reason: string;
  cancelOrder: boolean;
}

/** The Refund dialog starts with the full amount that remains. */
export function refundFormFor(order: Pick<OrderRecord, "totals" | "refundedCents">): RefundForm {
  return { amount: (refundRemainingCents(order) / 100).toFixed(2), reason: "", cancelOrder: false };
}

export interface RefundCheck {
  errors: string[];
  /** Null when a field has an error. */
  input: RefundOrderInput | null;
}

/** Checks the Refund dialog and builds the body for the Worker. */
export function checkRefund(order: RefundFields, form: RefundForm): RefundCheck {
  const errors: string[] = [];
  const remaining = refundRemainingCents(order);
  const amountCents = parseDollarsToCents(form.amount);
  if (amountCents === null) errors.push("Enter the refund as an amount, for example 12.00.");
  else if (amountCents < 1) errors.push("Enter a refund above $0.00.");
  else if (amountCents > remaining) errors.push(`Enter a refund of ${formatMoney(remaining)} or less.`);
  const reason = form.reason.trim();
  if (!reason) errors.push("Enter the reason.");
  else if (reason.length > REFUND_REASON_MAX) errors.push(`Make the reason ${REFUND_REASON_MAX} characters or shorter.`);
  if (errors.length > 0 || amountCents === null) return { errors, input: null };
  return {
    errors,
    input: {
      orderId: order.id,
      amountCents,
      reason,
      cancelOrder: form.cancelOrder && canCancelWithRefund(order)
    }
  };
}

// ---------------------------------------------------------------------------
// Pre-Orders queue
// ---------------------------------------------------------------------------

export type QueueTab = "requested" | "approved" | "in_work" | "done";

export const queueTabs: { id: QueueTab; label: string }[] = [
  { id: "requested", label: "Waiting for approval" },
  { id: "approved", label: "Approved, not paid" },
  { id: "in_work", label: "In work" },
  { id: "done", label: "Done" }
];

export function queueTabFor(state: OrderState): QueueTab {
  if (state === "requested") return "requested";
  if (state === "approved") return "approved";
  if (state === "received" || state === "preparing" || state === "ready") return "in_work";
  return "done";
}

/** Pre-orders and batch requests for 1 tab. Open tabs show the oldest first; Done shows the newest first. */
export function queueOrders(orders: OrderRecord[], tab: QueueTab): OrderRecord[] {
  const list = orders.filter(
    (order) => (order.kind === "preorder" || order.kind === "batch") && queueTabFor(order.state) === tab
  );
  const direction = tab === "done" ? -1 : 1;
  return list.sort((a, b) => direction * a.createdAtUtc.localeCompare(b.createdAtUtc));
}

export function queueCounts(orders: OrderRecord[]): Record<QueueTab, number> {
  const counts: Record<QueueTab, number> = { requested: 0, approved: 0, in_work: 0, done: 0 };
  for (const order of orders) {
    if (order.kind === "preorder" || order.kind === "batch") counts[queueTabFor(order.state)] += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Live orders queue
// ---------------------------------------------------------------------------

export type LiveGroup = "todo" | "ready" | "done";

export const liveGroups: { id: LiveGroup; label: string }[] = [
  { id: "todo", label: "To do" },
  { id: "ready", label: "Ready" },
  { id: "done", label: "Done" }
];

export function liveGroupFor(state: OrderState): LiveGroup {
  if (state === "received" || state === "preparing") return "todo";
  if (state === "ready") return "ready";
  return "done";
}

/**
 * Live orders of 1 business day, newest first.
 * `dayKeyOf` gives the YYYY-MM-DD key of a UTC time in the business time zone.
 */
export function liveOrdersForDay(
  orders: OrderRecord[],
  dayKey: string,
  dayKeyOf: (iso: string) => string
): OrderRecord[] {
  return orders
    .filter((order) => order.kind === "live" && order.createdAtUtc && dayKeyOf(order.createdAtUtc) === dayKey)
    .sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc));
}

/** "#12" from "#12 - Nov 14 - Jane Doe". Falls back to the sequence. */
export function liveNumber(order: Pick<OrderRecord, "orderNumber" | "sequence">): string {
  const match = order.orderNumber.match(/^#\d+/);
  if (match) return match[0];
  return order.sequence > 0 ? `#${order.sequence}` : order.orderNumber;
}

// ---------------------------------------------------------------------------
// Order card text
// ---------------------------------------------------------------------------

export function customerName(order: Pick<OrderRecord, "customer">): string {
  const name = [order.customer.firstName.trim(), order.customer.lastName.trim()].filter(Boolean).join(" ");
  return name || "No name";
}

/** Tamales in 1 order line. */
export function lineTamales(line: Pick<OrderLine, "unitTamales" | "quantity">): number {
  return Math.max(0, line.unitTamales) * Math.max(0, line.quantity);
}

/** "Red Chile Pork: 12 (1 dozen)". */
export function lineLabel(line: Pick<OrderLine, "itemName" | "unitTamales" | "quantity">): string {
  return `${line.itemName}: ${quantityLabel(lineTamales(line))}`;
}

/** "2026-11-14" to "Sat, Nov 14". Returns the input when it is not a date. */
export function formatDayKey(dayKey: string): string {
  const match = dayKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dayKey;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(date);
}

export interface MoneyLine {
  label: string;
  value: string;
  total: boolean;
}

/** Money lines in the agreed sequence. The Online ordering fee line hides when it is 0. */
export function moneyLines(order: Pick<OrderRecord, "totals" | "fulfillment" | "delivery">): MoneyLine[] {
  const { totals } = order;
  const lines: MoneyLine[] = [{ label: "Subtotal", value: formatMoney(totals.subtotalCents), total: false }];
  if (order.fulfillment === "delivery") {
    lines.push({
      label: "Delivery fee",
      value: order.delivery?.feeStatus === "to_be_set" ? "Not set" : formatMoney(totals.deliveryFeeCents),
      total: false
    });
  }
  if (totals.onlineFeeCents > 0) {
    lines.push({ label: "Online ordering fee", value: formatMoney(totals.onlineFeeCents), total: false });
  }
  lines.push({ label: "Tax", value: formatMoney(totals.taxCents), total: false });
  lines.push({ label: "Total", value: formatMoney(totals.totalCents), total: true });
  return lines;
}

/** Dollars typed by the owner to cents. Returns null when the text is not an amount of 0 or more. */
export function parseDollarsToCents(text: string): number | null {
  const trimmed = text.trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}

export interface ApproveInput {
  /** UTC ISO string, or empty when the owner entered no valid date and time. */
  scheduledAtUtc: string;
  /** Text in the delivery fee field. */
  deliveryFee: string;
}

export interface ApproveResult {
  errors: string[];
  scheduledAtUtc: string;
  /** Present only when the owner sets or changes the delivery fee. */
  deliveryFeeCents?: number;
}

/** Checks the Approve dialog. The delivery fee is required when the Worker could not compute it. */
export function checkApproval(
  order: Pick<OrderRecord, "fulfillment" | "delivery" | "totals">,
  input: ApproveInput
): ApproveResult {
  const errors: string[] = [];
  const result: ApproveResult = { errors, scheduledAtUtc: input.scheduledAtUtc };
  if (!input.scheduledAtUtc) errors.push("Enter the final date and time.");
  if (order.fulfillment === "delivery") {
    const mustSet = order.delivery?.feeStatus === "to_be_set";
    const text = input.deliveryFee.trim();
    if (text === "") {
      if (mustSet) errors.push("Enter the delivery fee.");
    } else {
      const cents = parseDollarsToCents(text);
      if (cents === null) {
        errors.push("Enter the delivery fee as an amount, for example 8.00.");
      } else if (mustSet || cents !== order.totals.deliveryFeeCents) {
        result.deliveryFeeCents = cents;
      }
    }
  }
  return result;
}
