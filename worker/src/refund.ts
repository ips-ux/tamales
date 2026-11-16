// POST /api/admin/orders/refund: the owner records a refund that he already sent.
// The contract is `RefundOrderInput` and `RefundOrderResult` in shared/moneyModel.ts.
// The Worker moves no money. It adds a `ledgerEntries` document and never changes the sale.

import { sendEmailSafely, type Mailer } from "./email";
import type { Config } from "./env";
import type { Firestore } from "./firestore";
import { formatMoney } from "./format";
import { HttpError } from "./http";
import { buildOrderRefundEmail } from "./messages";
import { returnStock } from "./orderCreate";
import { counts, readOrder, timeZoneFrom, toTracker } from "./orderData";
import type { Actor } from "./sale";
import { docId, text } from "./validate";
import type { OrderRecord } from "../../shared/model";
import type { LedgerEntry, RefundOrderInput, RefundOrderResult } from "../../shared/moneyModel";
import { holdsEventStock, isFinalState } from "../../shared/orderState";

export function validateRefund(body: Record<string, unknown>): RefundOrderInput {
  const amountCents = body.amountCents;
  if (typeof amountCents !== "number" || !Number.isInteger(amountCents) || amountCents < 1) {
    throw new HttpError(400, "Enter a valid refund amount.");
  }
  const reason = text(body.reason, { label: "reason", max: 500, multiline: true });
  if (!reason) throw new HttpError(400, "Enter the reason for the refund.");
  return { orderId: docId(body.orderId), amountCents, reason, cancelOrder: body.cancelOrder === true };
}

/**
 * The tax part of a refund. It is the tax share of all refunds after this one,
 * minus the tax share of the refunds before it. A full refund then gives back the exact tax.
 */
export function refundTaxCents(
  totals: Pick<OrderRecord["totals"], "taxCents" | "totalCents">,
  refundedBeforeCents: number,
  amountCents: number
): number {
  if (!(totals.totalCents > 0)) return 0;
  const share = (refunded: number) => Math.round((refunded * totals.taxCents) / totals.totalCents);
  return share(refundedBeforeCents + amountCents) - share(refundedBeforeCents);
}

export interface RefundDeps {
  db: Firestore;
  mailer: Mailer;
  cfg: Config;
  defer: (work: Promise<unknown>) => void;
  /** The owner, from the ID token. */
  actor: Actor;
}

export async function refundOrder(
  body: Record<string, unknown>,
  deps: RefundDeps,
  now = new Date()
): Promise<RefundOrderResult> {
  const input = validateRefund(body);
  const { db, cfg } = deps;
  const nowIso = now.toISOString();
  const orderPath = `orders/${input.orderId}`;
  // The transaction can run again. The entry id stays the same, so 1 call makes 1 entry.
  const entryId = crypto.randomUUID();

  const result = await db.runTransaction(async (tx) => {
    const data = await tx.get(orderPath);
    if (!data) throw new HttpError(404, "We could not find this order.");
    const current = readOrder(input.orderId, data);
    if (!current) throw new HttpError(409, "This order cannot take a refund.");
    if (current.paymentState !== "paid") {
      throw new HttpError(409, current.paymentState === "refunded" ? "This order is fully refunded." : "This order is not paid.");
    }
    const left = current.totals.totalCents - current.refundedCents;
    if (input.amountCents > left) {
      throw new HttpError(400, `The largest refund for this order is ${formatMoney(Math.max(0, left))}.`);
    }
    // Cancel only an order that the customer does not have and that is not stopped.
    const cancels = input.cancelOrder && !isFinalState(current.state);
    const stockPath = `eventStock/${current.eventId}`;
    const stock = cancels && holdsEventStock(current) ? await tx.get(stockPath) : null;

    const refundedCents = current.refundedCents + input.amountCents;
    const changes: Partial<OrderRecord> = { refundedCents, updatedAtUtc: nowIso };
    if (refundedCents >= current.totals.totalCents) changes.paymentState = "refunded";
    if (cancels) {
      changes.state = "canceled";
      changes.reason = input.reason;
    }
    const updated: OrderRecord = { ...current, ...changes };

    const entry: LedgerEntry = {
      id: entryId,
      type: "refund",
      saleId: current.saleId,
      orderId: current.id,
      reference: current.orderNumber,
      amountCents: input.amountCents,
      taxCents: refundTaxCents(current.totals, current.refundedCents, input.amountCents),
      reason: input.reason,
      detail: "",
      byEmail: deps.actor.email,
      isTest: false,
      createdAtUtc: nowIso
    };

    if (stock) {
      const remaining = returnStock(counts(stock.remaining), current.items);
      tx.set(stockPath, { remaining, updatedAtUtc: nowIso }, ["remaining", "updatedAtUtc"]);
    }
    tx.set(orderPath, changes as Record<string, unknown>, Object.keys(changes));
    tx.set(`ledgerEntries/${entryId}`, entry as unknown as Record<string, unknown>);
    tx.set(`trackers/${updated.trackerToken}`, toTracker(updated) as unknown as Record<string, unknown>);
    return { order: updated, canceled: cancels };
  });

  deps.defer(
    db
      .get("settings/business")
      .then((business) =>
        sendEmailSafely(
          deps.mailer,
          buildOrderRefundEmail(
            result.order,
            { amountCents: input.amountCents, reason: input.reason, canceled: result.canceled },
            timeZoneFrom(business),
            cfg
          )
        )
      )
      .catch((error) => console.error("Refund email failed", error))
  );
  return { order: result.order };
}
