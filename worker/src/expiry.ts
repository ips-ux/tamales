// The scheduled run. It expires approved orders that were not paid before `payByUtc`
// and returns held tamales to `eventStock`. wrangler.toml starts it each 5 minutes.

import { sendEmailSafely, type Mailer } from "./email";
import type { Config } from "./env";
import type { Firestore } from "./firestore";
import { buildOrderExpiredEmail } from "./messages";
import { returnStock } from "./orderCreate";
import { counts, readOrder, timeZoneFrom, toTracker } from "./orderData";
import type { OrderRecord } from "../../shared/model";
import { holdsEventStock } from "../../shared/orderState";

/**
 * Orders for each run. The Workers free plan permits 50 subrequests for each run.
 * 1 order uses 5 at most (begin, 2 reads, commit, email), and the run itself uses 3.
 */
export const EXPIRY_CAP = 8;
export const EXPIRED_REASON = "We did not receive the payment in time.";
const QUERY_LIMIT = 300;

type ExpiryFields = Pick<OrderRecord, "state" | "paymentState" | "payByUtc">;

/** True for an approved, unpaid order with a pay-by time in the past. An order with no pay-by time stays. */
export function isOverdue(order: ExpiryFields, now: Date): boolean {
  if (order.state !== "approved" || order.paymentState !== "unpaid" || !order.payByUtc) return false;
  const payBy = new Date(order.payByUtc).getTime();
  return Number.isFinite(payBy) && payBy < now.getTime();
}

/** The orders to expire in this run: the oldest pay-by time first, `cap` orders at most. */
export function selectOverdue<T extends ExpiryFields>(orders: T[], now: Date, cap = EXPIRY_CAP): T[] {
  return orders
    .filter((order) => isOverdue(order, now))
    .sort((a, b) => a.payByUtc.localeCompare(b.payByUtc))
    .slice(0, Math.max(0, cap));
}

export interface ExpiryDeps {
  db: Firestore;
  mailer: Mailer;
  cfg: Config;
}

/** Expires the overdue orders. Returns the order numbers that it expired. */
export async function expireUnpaidOrders(deps: ExpiryDeps, now = new Date(), cap = EXPIRY_CAP): Promise<string[]> {
  const { db } = deps;
  const approved = (await db.runQuery("orders", "state", "approved", QUERY_LIMIT))
    .map((doc) => readOrder(doc.id, doc.data))
    .filter((order): order is OrderRecord => order !== null);
  const overdue = selectOverdue(approved, now, cap);
  if (overdue.length === 0) return [];

  const timeZone = timeZoneFrom(await db.get("settings/business"));
  const nowIso = now.toISOString();
  const expired: string[] = [];
  for (const candidate of overdue) {
    const orderPath = `orders/${candidate.id}`;
    try {
      const order = await db.runTransaction(async (tx) => {
        const data = await tx.get(orderPath);
        const current = data ? readOrder(candidate.id, data) : null;
        // The customer paid, or the owner changed the order, after the query.
        if (!current || !isOverdue(current, now)) return null;
        const stockPath = `eventStock/${current.eventId}`;
        const stock = holdsEventStock(current) ? await tx.get(stockPath) : null;

        const changes = { state: "expired" as const, reason: EXPIRED_REASON, updatedAtUtc: nowIso };
        const updated: OrderRecord = { ...current, ...changes };
        if (stock) {
          const remaining = returnStock(counts(stock.remaining), current.items);
          tx.set(stockPath, { remaining, updatedAtUtc: nowIso }, ["remaining", "updatedAtUtc"]);
        }
        tx.set(orderPath, changes, Object.keys(changes));
        tx.set(`trackers/${updated.trackerToken}`, toTracker(updated) as unknown as Record<string, unknown>);
        return updated;
      });
      if (!order) continue;
      expired.push(order.orderNumber);
      await sendEmailSafely(deps.mailer, buildOrderExpiredEmail(order, timeZone, deps.cfg));
    } catch (error) {
      console.error(`Could not expire order ${candidate.orderNumber}`, error);
    }
  }
  return expired;
}
