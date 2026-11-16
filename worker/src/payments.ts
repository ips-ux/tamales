// POST /api/v1/payments/create and /api/v1/payments/capture: PayPal Checkout for 1 order.
// The contract is in shared/moneyModel.ts. The tracker token is the key to the order.
// The Worker marks an order paid only after PayPal reports a completed capture
// in USD for the exact order total.

import { sha256Hex } from "./base64";
import { sendEmailSafely, type Mailer } from "./email";
import type { Config } from "./env";
import type { Firestore } from "./firestore";
import { formatMoney } from "./format";
import { HttpError } from "./http";
import { buildOrderPaidEmail, buildPaymentAlertEmail } from "./messages";
import { pickupPlace } from "./orderAction";
import { readOrder, timeZoneFrom, toTracker } from "./orderData";
import {
  capturePayPalOrder,
  createPayPalOrder,
  PayPalError,
  type PayPalCapture,
  type PayPalConfig
} from "./paypal";
import type { OrderRecord } from "../../shared/model";
import type {
  CapturePaymentInput,
  CapturePaymentResult,
  CreatePaymentInput,
  CreatePaymentResult
} from "../../shared/moneyModel";
import { isFinalState } from "../../shared/orderState";

export const PAYMENT_OFF_MESSAGE = "Online payment is not available now.";

const TRACKER_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
const PAYPAL_ORDER_ID = /^[A-Za-z0-9-]{1,64}$/;
const invalid = () => new HttpError(400, "The request is not valid.");

export interface PaymentDeps {
  db: Firestore;
  mailer: Mailer;
  cfg: Config;
  defer: (work: Promise<unknown>) => void;
  /** Null when the PayPal client id or secret is not set. */
  paypal: PayPalConfig | null;
}

export function validateCreatePayment(body: Record<string, unknown>): CreatePaymentInput {
  if (typeof body.trackerToken !== "string" || !TRACKER_TOKEN.test(body.trackerToken)) throw invalid();
  return { trackerToken: body.trackerToken };
}

export function validateCapturePayment(body: Record<string, unknown>): CapturePaymentInput {
  const { trackerToken } = validateCreatePayment(body);
  if (typeof body.paypalOrderId !== "string" || !PAYPAL_ORDER_ID.test(body.paypalOrderId)) throw invalid();
  return { trackerToken, paypalOrderId: body.paypalOrderId };
}

/** Finds the order of a tracker token. Returns null if there is none. */
export async function findOrderByTracker(db: Firestore, trackerToken: string): Promise<OrderRecord | null> {
  const [doc] = await db.runQuery("orders", "trackerToken", trackerToken, 1);
  return doc ? readOrder(doc.id, doc.data) : null;
}

function requirePayPal(deps: PaymentDeps): PayPalConfig {
  if (!deps.paypal) throw new HttpError(503, PAYMENT_OFF_MESSAGE);
  return deps.paypal;
}

/** Throws a 409 with the reason if the customer cannot start a payment for this order now. */
export function checkPayable(order: OrderRecord, now: Date): void {
  if (order.paymentMethod !== "paypal") throw new HttpError(409, "This order does not use PayPal Checkout.");
  if (order.paymentState === "paid" || order.paymentState === "refunded") {
    throw new HttpError(409, "This order is already paid.");
  }
  if (order.state === "expired") throw new HttpError(409, "The time to pay ended. Send a new order.");
  const liveAndOpen = order.kind === "live" && !isFinalState(order.state);
  if (order.paymentState !== "unpaid" || (order.state !== "approved" && !liveAndOpen)) {
    throw new HttpError(409, "This order cannot be paid now.");
  }
  if (order.state === "approved" && order.payByUtc && new Date(order.payByUtc).getTime() <= now.getTime()) {
    throw new HttpError(409, "The time to pay ended. Send a new order.");
  }
  if (!(order.totals.totalCents > 0)) throw new HttpError(409, "This order cannot be paid now.");
}

/** The same id for the same order and total. PayPal then returns the first PayPal order on a retry. */
export async function payPalRequestId(order: Pick<OrderRecord, "id" | "totals">): Promise<string> {
  return (await sha256Hex(`paypal-order:${order.id}:${order.totals.totalCents}`)).slice(0, 36);
}

export async function createPayment(
  body: Record<string, unknown>,
  deps: PaymentDeps,
  now = new Date()
): Promise<CreatePaymentResult> {
  const input = validateCreatePayment(body);
  const paypal = requirePayPal(deps);
  const order = await findOrderByTracker(deps.db, input.trackerToken);
  if (!order) throw new HttpError(404, "We could not find this order.");
  checkPayable(order, now);

  let paypalOrderId: string;
  try {
    paypalOrderId = await createPayPalOrder(paypal, {
      totalCents: order.totals.totalCents,
      // PayPal can refuse a second payment with the same invoice id, and a live
      // order number can repeat in a later year. The order id part makes it unique.
      invoiceId: `${order.orderNumber} [${order.id.slice(0, 8)}]`,
      customId: order.id,
      description: `${order.orderNumber} ${order.customer.firstName} ${order.customer.lastName}`,
      requestId: await payPalRequestId(order)
    });
  } catch (error) {
    if (!(error instanceof PayPalError)) throw error;
    console.error(`PayPal create failed for order ${order.orderNumber}`, error);
    throw new HttpError(502, "We could not start the payment. Try again.");
  }
  if (paypalOrderId !== order.paypalOrderId) await deps.db.update(`orders/${order.id}`, { paypalOrderId });
  return { paypalOrderId };
}

/** True for a capture that proves the payment of this order. */
export function captureMatches(capture: PayPalCapture, order: Pick<OrderRecord, "totals">): boolean {
  return (
    capture.orderStatus === "COMPLETED" &&
    capture.captureStatus === "COMPLETED" &&
    Boolean(capture.captureId) &&
    capture.currency === "USD" &&
    capture.amountCents === order.totals.totalCents
  );
}

type Outcome = "paid" | "repeat" | "late" | "double";

export async function capturePayment(
  body: Record<string, unknown>,
  deps: PaymentDeps,
  now = new Date()
): Promise<CapturePaymentResult> {
  const input = validateCapturePayment(body);
  const paypal = requirePayPal(deps);
  const { db, cfg } = deps;
  const found = await findOrderByTracker(db, input.trackerToken);
  if (!found) throw new HttpError(404, "We could not find this order.");
  if (found.paymentMethod !== "paypal") throw new HttpError(409, "This order does not use PayPal Checkout.");
  if (!found.paypalOrderId || found.paypalOrderId !== input.paypalOrderId) {
    throw new HttpError(409, "This payment does not match the order. Refresh the page, then try again.");
  }
  // A second call for a payment that the Worker saved before.
  if (found.paypalCaptureId) return { paid: true };
  if (found.paymentState === "paid" || found.paymentState === "refunded") {
    throw new HttpError(409, "This order is already paid.");
  }
  // Refuse before PayPal takes the money, when the order is stopped now.
  if (found.state === "expired") throw new HttpError(409, "The time to pay ended. Send a new order.");
  if (found.paymentState !== "unpaid" || found.state === "requested" || isFinalState(found.state)) {
    throw new HttpError(409, "This order cannot be paid now.");
  }

  const timeZone = timeZoneFrom(await db.get("settings/business"));
  const alertOwner = (subject: string, lines: string[], capture: PayPalCapture, order: OrderRecord) =>
    deps.defer(
      sendEmailSafely(
        deps.mailer,
        buildPaymentAlertEmail(
          order,
          { subject, lines, captureId: capture.captureId, amountCents: capture.amountCents },
          timeZone,
          cfg
        )
      )
    );

  let capture: PayPalCapture;
  try {
    capture = await capturePayPalOrder(paypal, input.paypalOrderId);
  } catch (error) {
    if (!(error instanceof PayPalError)) throw error;
    console.error(`PayPal capture failed for order ${found.orderNumber}`, error);
    if (error.issue === "INSTRUMENT_DECLINED") {
      throw new HttpError(409, "PayPal declined the payment. Select a different payment method.");
    }
    throw new HttpError(502, "PayPal did not complete the payment. Try again.");
  }

  if (!captureMatches(capture, found)) {
    console.error(`PayPal capture does not prove payment of order ${found.orderNumber}`, JSON.stringify(capture));
    // PayPal has a capture, so money moved or can move. The owner must look at it.
    if (capture.captureId) {
      alertOwner(
        "Check a PayPal payment",
        [
          `PayPal reports the status ${capture.captureStatus || "unknown"} for a payment of this order.`,
          "The order is not marked paid. Open PayPal and check the payment."
        ],
        capture,
        found
      );
      throw new HttpError(409, "We could not confirm the payment. We will contact you.");
    }
    throw new HttpError(409, "PayPal did not complete the payment. Try again.");
  }

  const nowIso = now.toISOString();
  const orderPath = `orders/${found.id}`;
  const saved = await db.runTransaction(async (tx) => {
    const data = await tx.get(orderPath);
    const current = data ? readOrder(found.id, data) : null;
    if (!current) throw new HttpError(404, "We could not find this order.");
    if (current.paypalCaptureId === capture.captureId) return { order: current, outcome: "repeat" as Outcome };

    const alreadyPaid = current.paymentState === "paid" || current.paymentState === "refunded";
    const outcome: Outcome = alreadyPaid ? "double" : isFinalState(current.state) ? "late" : "paid";
    const changes: Partial<OrderRecord> = {
      paypalCaptureId: capture.captureId,
      paypalFeeCents: capture.feeCents,
      updatedAtUtc: nowIso
    };
    if (!alreadyPaid) {
      changes.paymentState = "paid";
      changes.paidAtUtc = nowIso;
      // A paid approved order is accepted. A stopped order stays stopped; the owner decides.
      if (current.state === "approved") changes.state = "received";
    }
    const updated: OrderRecord = { ...current, ...changes };
    tx.set(orderPath, changes as Record<string, unknown>, Object.keys(changes));
    tx.set(`trackers/${updated.trackerToken}`, toTracker(updated) as unknown as Record<string, unknown>);
    return { order: updated, outcome };
  });

  const { order, outcome } = saved;
  if (outcome === "paid") {
    deps.defer(
      pickupPlace(db, order, timeZone)
        .then((place) => sendEmailSafely(deps.mailer, buildOrderPaidEmail(order, place, timeZone, cfg)))
        .catch((error) => console.error("Payment receipt email failed", error))
    );
  }
  if (outcome === "late") {
    console.error(`Order ${order.orderNumber} was paid after it was ${order.state}. Capture ${capture.captureId}.`);
    const what = order.state === "expired" ? "it expired" : `it was ${order.state.replace("_", " ")}`;
    alertOwner(
      `Paid after ${what} — refund or fulfil`,
      [
        `The customer paid ${formatMoney(order.totals.totalCents)} after ${what}.`,
        "Refund the payment in PayPal, or fulfil the order."
      ],
      capture,
      order
    );
  }
  if (outcome === "double") {
    console.error(`Order ${order.orderNumber} was already paid. PayPal also took capture ${capture.captureId}.`);
    alertOwner(
      "Paid 2 times — refund 1 payment",
      ["The order was marked paid, and PayPal also took a payment.", "Refund 1 of the 2 payments."],
      capture,
      order
    );
  }
  return { paid: true };
}
