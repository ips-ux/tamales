// The order state table. See docs/V1_FUNDAMENTALS.md section 5.
// The Worker runs these rules for each owner action. Admin can use `canRunAction` to show the right buttons.

import { OrderError } from "./errors";
import type { OrderAction, OrderActionInput, OrderRecord, OrderState, OrderingSettings } from "./model";
import { computeTotals, type FeeSettings } from "./pricing";

/** An order in a final state does not change again. */
export const FINAL_STATES: OrderState[] = ["handed_over", "declined", "canceled", "expired"];

export function isFinalState(state: OrderState): boolean {
  return FINAL_STATES.includes(state);
}

type StateFields = Pick<OrderRecord, "kind" | "state" | "paymentState"> &
  Partial<Pick<OrderRecord, "paypalCaptureId">>;

/** The text of the refusal when the owner hands over an order that is not paid. */
export const PAY_FIRST_MESSAGE = "Mark the order as paid first.";

/**
 * True if the handover must wait for the payment. `canRunAction` permits "hand_over"
 * by the state only; `applyAction` then refuses an order that is not paid.
 */
export function handOverNeedsPayment(order: Pick<OrderRecord, "paymentState">): boolean {
  return order.paymentState !== "paid";
}

/** True if the state table permits the action for this order now. */
export function canRunAction(order: StateFields, action: OrderAction): boolean {
  const { state, paymentState } = order;
  const final = isFinalState(state);
  switch (action) {
    case "approve":
    case "decline":
      return state === "requested";
    case "mark_paid":
      return !final && (paymentState === "unpaid" || paymentState === "check_payment");
    case "mark_unpaid":
      // A PayPal capture is a fact. Only a refund entry can follow it.
      if (order.paypalCaptureId) return false;
      return !final && (paymentState === "paid" || paymentState === "check_payment");
    case "prepare":
      return state === "received";
    case "ready":
      return state === "received" || state === "preparing";
    case "hand_over":
      // A live sale can go from the queue to the customer in 1 step.
      if (state === "ready") return true;
      return order.kind === "live" && (state === "received" || state === "preparing");
    case "cancel":
      return !final;
    case "save_note":
      return true;
    default:
      return false;
  }
}

/**
 * True for an order that took tamales from `eventStock` (a fixed-allotment pre-order).
 * The Worker sets `stockHeld` when it creates the order.
 */
export function holdsEventStock(order: Pick<OrderRecord, "stockHeld" | "eventId">): boolean {
  return order.stockHeld === true && Boolean(order.eventId);
}

export type ActionSettings = Pick<OrderingSettings, "paymentWindowHours" | "deliveryFeeTaxable"> &
  FeeSettings & {
    /** Tax rate from `settings/business`, in basis points. */
    taxRateBps: number;
  };

export type OrderChanges = Partial<
  Pick<
    OrderRecord,
    | "state"
    | "paymentState"
    | "paymentMethod"
    | "paidAtUtc"
    | "approvedAtUtc"
    | "payByUtc"
    | "scheduledAtUtc"
    | "delivery"
    | "totals"
    | "reason"
    | "ownerNote"
  >
> & { updatedAtUtc: string };

type ActionFields = StateFields & Pick<OrderRecord, "items" | "totals" | "delivery">;

/**
 * Returns the fields that the action changes. It does not change `order`.
 * Throws an `OrderError` if the state table does not permit the action.
 */
export function applyAction(
  order: ActionFields,
  input: Omit<OrderActionInput, "orderId">,
  nowIso: string,
  settings: ActionSettings
): OrderChanges {
  if (!canRunAction(order, input.action)) {
    throw new OrderError("This order cannot take this action now.");
  }
  const changes: OrderChanges = { updatedAtUtc: nowIso };
  if (input.action === "save_note") {
    // Only the owner note changes. The state, the payment and the totals stay.
    changes.ownerNote = input.ownerNote ?? "";
    return changes;
  }
  if (input.ownerNote !== undefined) changes.ownerNote = input.ownerNote;

  switch (input.action) {
    case "approve": {
      const feeGiven = typeof input.deliveryFeeCents === "number";
      if (feeGiven && (!Number.isInteger(input.deliveryFeeCents) || (input.deliveryFeeCents as number) < 0)) {
        throw new OrderError("Enter a valid delivery fee.");
      }
      if (order.delivery?.feeStatus === "to_be_set" && !feeGiven) {
        throw new OrderError("Set the delivery fee, then approve the order.");
      }
      if (order.delivery && feeGiven) {
        const feeCents = input.deliveryFeeCents as number;
        const same = order.delivery.feeStatus === "computed" && feeCents === order.totals.deliveryFeeCents;
        if (!same) changes.delivery = { ...order.delivery, feeStatus: "owner_set" };
      }
      // An approved order is paid with PayPal Checkout, so the final total has the online ordering fee.
      changes.paymentMethod = "paypal";
      changes.totals = computeTotals({
        lines: order.items,
        deliveryFeeCents: order.delivery && feeGiven ? (input.deliveryFeeCents as number) : order.totals.deliveryFeeCents,
        taxRateBps: settings.taxRateBps,
        deliveryFeeTaxable: settings.deliveryFeeTaxable,
        usesPayPal: true,
        feeSettings: settings
      });
      const hours = settings.paymentWindowHours > 0 ? settings.paymentWindowHours : 72;
      changes.state = "approved";
      changes.approvedAtUtc = nowIso;
      changes.payByUtc = new Date(new Date(nowIso).getTime() + hours * 3_600_000).toISOString();
      if (input.scheduledAtUtc) changes.scheduledAtUtc = input.scheduledAtUtc;
      break;
    }
    case "decline":
      changes.state = "declined";
      changes.reason = input.reason ?? "";
      break;
    case "cancel":
      changes.state = "canceled";
      changes.reason = input.reason ?? "";
      break;
    case "mark_paid":
      changes.paymentState = "paid";
      changes.paidAtUtc = nowIso;
      // A paid approved order is accepted.
      if (order.state === "approved") changes.state = "received";
      break;
    case "mark_unpaid":
      changes.paymentState = "unpaid";
      changes.paidAtUtc = "";
      break;
    case "prepare":
      changes.state = "preparing";
      break;
    case "ready":
      changes.state = "ready";
      break;
    case "hand_over":
      if (handOverNeedsPayment(order)) throw new OrderError(PAY_FIRST_MESSAGE);
      changes.state = "handed_over";
      break;
  }
  return changes;
}
