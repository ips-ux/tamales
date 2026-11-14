// The order state table. See docs/V1_FUNDAMENTALS.md section 5.
// The Worker runs these rules for each owner action. Admin can use `canRunAction` to show the right buttons.

import { OrderError } from "./errors";
import type { OrderAction, OrderActionInput, OrderRecord, OrderState, OrderingSettings } from "./model";
import { computeTotals } from "./pricing";

/** An order in a final state does not change again. */
export const FINAL_STATES: OrderState[] = ["handed_over", "declined", "canceled", "expired"];

export function isFinalState(state: OrderState): boolean {
  return FINAL_STATES.includes(state);
}

type StateFields = Pick<OrderRecord, "kind" | "state" | "paymentState">;

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
    default:
      return false;
  }
}

/**
 * True for an order that took tamales from `eventStock` (a fixed-allotment pre-order).
 * A fixed-allotment pre-order is accepted with no approval. An open-interest pre-order
 * is "requested" first and has an approval time after that.
 */
export function holdsEventStock(order: Pick<OrderRecord, "kind" | "state" | "approvedAtUtc" | "eventId">): boolean {
  return order.kind === "preorder" && Boolean(order.eventId) && order.state !== "requested" && !order.approvedAtUtc;
}

export type ActionSettings = Pick<OrderingSettings, "paymentWindowHours" | "deliveryFeeTaxable"> & {
  /** Tax rate from `settings/business`, in basis points. */
  taxRateBps: number;
};

export type OrderChanges = Partial<
  Pick<
    OrderRecord,
    | "state"
    | "paymentState"
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
        if (!same) {
          changes.delivery = { ...order.delivery, feeStatus: "owner_set" };
          changes.totals = {
            ...computeTotals({
              lines: order.items,
              deliveryFeeCents: feeCents,
              taxRateBps: settings.taxRateBps,
              deliveryFeeTaxable: settings.deliveryFeeTaxable
            }),
            onlineFeeCents: order.totals.onlineFeeCents
          };
          changes.totals.totalCents += order.totals.onlineFeeCents;
        }
      }
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
      // A paid approved order is accepted.
      if (order.state === "approved") changes.state = "received";
      break;
    case "mark_unpaid":
      changes.paymentState = "unpaid";
      break;
    case "prepare":
      changes.state = "preparing";
      break;
    case "ready":
      changes.state = "ready";
      break;
    case "hand_over":
      changes.state = "handed_over";
      break;
  }
  return changes;
}
