// POST /api/admin/orders/action: the owner moves an order to its next state.
// The contract is `OrderActionInput` and `OrderActionResult` in shared/model.ts.
// The state table is in shared/orderState.ts.

import { sendEmailSafely, type Mailer, type OutgoingEmail } from "./email";
import type { Config } from "./env";
import type { Firestore } from "./firestore";
import { formatRange } from "./format";
import { HttpError } from "./http";
import {
  buildOrderApprovedEmail,
  buildOrderPaidEmail,
  buildOrderReadyEmail,
  buildOrderStoppedEmail,
  type PickupPlace
} from "./messages";
import { returnStock } from "./orderCreate";
import { counts, readOrder, readOrdering, readOrderingPrivate, taxRateFrom, timeZoneFrom, toTracker } from "./orderData";
import { buildOrderSale, type Actor } from "./sale";
import { docId, text } from "./validate";
import type { OrderAction, OrderActionInput, OrderActionResult, OrderRecord } from "../../shared/model";
import { applyAction, canRunAction, holdsEventStock } from "../../shared/orderState";
import { tamalesByItem } from "../../shared/pricing";

const ACTIONS: OrderAction[] = [
  "approve",
  "decline",
  "mark_paid",
  "mark_unpaid",
  "prepare",
  "ready",
  "hand_over",
  "cancel",
  "save_note"
];
const MAX_DELIVERY_FEE_CENTS = 100_000;

export function validateOrderAction(body: Record<string, unknown>): OrderActionInput {
  const action = body.action as OrderAction;
  if (!ACTIONS.includes(action)) throw new HttpError(400, "The request is not valid.");
  const input: OrderActionInput = { orderId: docId(body.orderId), action };

  if (body.deliveryFeeCents !== undefined && body.deliveryFeeCents !== null) {
    const fee = body.deliveryFeeCents;
    if (typeof fee !== "number" || !Number.isInteger(fee) || fee < 0 || fee > MAX_DELIVERY_FEE_CENTS) {
      throw new HttpError(400, "Enter a valid delivery fee.");
    }
    input.deliveryFeeCents = fee;
  }
  if (body.scheduledAtUtc !== undefined && body.scheduledAtUtc !== null && body.scheduledAtUtc !== "") {
    const time = typeof body.scheduledAtUtc === "string" ? new Date(body.scheduledAtUtc) : new Date(NaN);
    if (Number.isNaN(time.getTime())) throw new HttpError(400, "Enter a valid date and time.");
    input.scheduledAtUtc = time.toISOString();
  }
  if (body.reason !== undefined && body.reason !== null) {
    input.reason = text(body.reason, { label: "reason", max: 500, multiline: true });
  }
  if (body.ownerNote !== undefined && body.ownerNote !== null) {
    input.ownerNote = text(body.ownerNote, { label: "note", max: 1000, multiline: true });
  }
  return input;
}

export interface ActionDeps {
  db: Firestore;
  mailer: Mailer;
  cfg: Config;
  defer: (work: Promise<unknown>) => void;
  /** The owner, from the ID token. The sale of a handover records it. */
  actor?: Actor;
}

/** Reads the exact pickup place for the payment receipt. Returns null for a delivery. */
export async function pickupPlace(db: Firestore, order: OrderRecord, timeZone: string): Promise<PickupPlace | null> {
  if (order.eventId) {
    const [place, event] = await Promise.all([db.get(`eventPrivate/${order.eventId}`), db.get(`events/${order.eventId}`)]);
    return {
      address: typeof place?.address === "string" ? place.address.trim() : "",
      instructions: typeof place?.instructions === "string" ? place.instructions.trim() : "",
      time: event ? formatRange(String(event.startsAtUtc ?? ""), String(event.endsAtUtc ?? ""), timeZone) : ""
    };
  }
  if (order.fulfillment === "pickup") {
    const settings = readOrderingPrivate(await db.get("settings/orderingPrivate"));
    return { address: settings.pickupAddress, instructions: settings.pickupInstructions, time: "" };
  }
  return null;
}

/** The email for the action. Returns null for an action that sends no email. */
async function emailFor(
  db: Firestore,
  order: OrderRecord,
  action: OrderAction,
  timeZone: string,
  cfg: Config
): Promise<OutgoingEmail | null> {
  switch (action) {
    case "approve":
      return buildOrderApprovedEmail(order, timeZone, cfg);
    case "decline":
    case "cancel":
      return buildOrderStoppedEmail(order, action, timeZone, cfg);
    case "ready":
      return buildOrderReadyEmail(order, timeZone, cfg);
    case "mark_paid":
      return buildOrderPaidEmail(order, await pickupPlace(db, order, timeZone), timeZone, cfg);
    default:
      return null;
  }
}

/** Checks the state table, saves the order and the tracker, and sends the email for the action. */
export async function runOrderAction(
  body: Record<string, unknown>,
  deps: ActionDeps,
  now = new Date()
): Promise<OrderActionResult> {
  const input = validateOrderAction(body);
  const { db, cfg } = deps;
  const [business, orderingData] = await Promise.all([db.get("settings/business"), db.get("settings/ordering")]);
  const ordering = readOrdering(orderingData);
  const timeZone = timeZoneFrom(business);
  const nowIso = now.toISOString();
  const orderPath = `orders/${input.orderId}`;

  const order = await db.runTransaction(async (tx) => {
    const data = await tx.get(orderPath);
    if (!data) throw new HttpError(404, "We could not find this order.");
    const current = readOrder(input.orderId, data);
    if (!current || !canRunAction(current, input.action)) {
      throw new HttpError(409, "This order cannot take this action now.");
    }
    // A canceled fixed-allotment pre-order gives its tamales back to the event.
    const givesBack = (input.action === "cancel" || input.action === "decline") && holdsEventStock(current);
    const stockPath = `eventStock/${current.eventId}`;
    const stock = givesBack ? await tx.get(stockPath) : null;

    // The state rules run before the other reads. An order that is not paid stops here.
    const changes: Partial<OrderRecord> & { updatedAtUtc: string } = applyAction(current, input, nowIso, {
      paymentWindowHours: ordering.paymentWindowHours,
      deliveryFeeTaxable: ordering.deliveryFeeTaxable,
      taxRateBps: taxRateFrom(business),
      paypalFeeBps: ordering.paypalFeeBps,
      paypalFeeFixedCents: ordering.paypalFeeFixedCents,
      feeSharePct: ordering.feeSharePct
    });

    // A handover is a sale: 1 `posTickets` document, and the tamales leave the inventory.
    const handsOver = input.action === "hand_over";
    const sold = handsOver ? Object.entries(tamalesByItem(current.items)) : [];
    const levels: Array<Record<string, unknown> | null> = [];
    for (const [itemId] of sold) levels.push(await tx.get(`inventory/${itemId}`));
    if (handsOver) {
      // The sale id is the order id, so 1 order makes 1 sale.
      changes.saleId = current.id;
    }
    const updated: OrderRecord = { ...current, ...changes };

    if (handsOver) {
      const sale = buildOrderSale(updated, nowIso, deps.actor ?? { email: "", uid: "" });
      tx.set(`posTickets/${updated.saleId}`, sale as unknown as Record<string, unknown>);
      sold.forEach(([itemId, tamales], index) => {
        const level = levels[index];
        // A menu item with no inventory document starts at 0, as in the Live POS.
        const stockCount = typeof level?.stockCount === "number" && Number.isFinite(level.stockCount) ? level.stockCount : 0;
        tx.set(
          `inventory/${itemId}`,
          {
            productId: itemId,
            productName: current.items.find((line) => line.itemId === itemId)?.itemName ?? "",
            stockCount: stockCount - tamales,
            updatedAtUtc: nowIso
          },
          ["productId", "productName", "stockCount", "updatedAtUtc"]
        );
      });
    }

    if (stock) {
      const remaining = returnStock(counts(stock.remaining), current.items);
      tx.set(stockPath, { remaining, updatedAtUtc: nowIso }, ["remaining", "updatedAtUtc"]);
    }
    tx.set(orderPath, changes as Record<string, unknown>, Object.keys(changes));
    // The owner note is not on the tracker, so a saved note does not write it.
    if (input.action !== "save_note") {
      tx.set(`trackers/${updated.trackerToken}`, toTracker(updated) as unknown as Record<string, unknown>);
    }
    return updated;
  });

  deps.defer(
    emailFor(db, order, input.action, timeZone, cfg)
      .then((message) => (message ? sendEmailSafely(deps.mailer, message) : undefined))
      .catch((error) => console.error(`Email for ${input.action} failed`, error))
  );
  return { order };
}
