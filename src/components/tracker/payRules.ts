// Rules for PayPal Checkout on the order tracker. No React and no browser APIs.
// See the header of shared/moneyModel.ts for how payment works.
// The can-pay rule is `canPayOnline` in trackerRules.ts.

import type { TrackerRecord } from "../../../shared/model";
import { formatMoney } from "../../lib/money";

/** The PayPal client id from the build. Empty when online payment is not set up. */
export function paypalClientId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** The address of the PayPal JS SDK. The page loads it 1 time, when the customer can pay. */
export function paypalSdkUrl(clientId: string): string {
  return `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&enable-funding=venmo`;
}

export const COUNTDOWN_LIMIT_MS = 3_600_000;

/** "12:34" for the minutes and seconds that remain. "0:00" at the end. */
export function countdownText(remainingMs: number): string {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export interface PayDeadline {
  /** The line above the PayPal buttons. Empty when the order has no time limit. */
  text: string;
  /** True while the line counts down each second. */
  live: boolean;
}

/**
 * The time that remains to pay. Under 1 hour, a countdown. Above that, the date and time.
 * `formatDateTime` gives "Sat, Nov 14, 5:00 PM" in the business time zone.
 */
export function payDeadline(payByUtc: string, nowMs: number, formatDateTime: (iso: string) => string): PayDeadline {
  const payBy = payByUtc ? new Date(payByUtc).getTime() : Number.NaN;
  if (!Number.isFinite(payBy)) return { text: "", live: false };
  const remaining = payBy - nowMs;
  if (remaining <= 0) return { text: "Pay now to keep your tamales.", live: false };
  if (remaining < COUNTDOWN_LIMIT_MS) {
    return { text: `Pay in ${countdownText(remaining)} to keep your tamales.`, live: true };
  }
  return { text: `Pay by ${formatDateTime(payByUtc)}.`, live: false };
}

/** "We refunded $12.00." Empty when no money went back. */
export function refundText(record: Pick<TrackerRecord, "refundedCents">): string {
  return record.refundedCents > 0 ? `We refunded ${formatMoney(record.refundedCents)}.` : "";
}

export const PAY_UNAVAILABLE_MESSAGE = "Online payment is not available now.";
export const PAY_FAILED_MESSAGE = "We could not take the payment. Try again.";
export const PAY_LOAD_FAILED_MESSAGE = "We could not load the payment buttons. Check your connection, then try again.";
export const PAYING_MESSAGE = "Do not close this page.";
export const PAID_MESSAGE = "Payment received.";

/** The message for a failed payment: the reason from the Worker, or the general sentence when there is none. */
export function payErrorMessage(workerMessage: string): string {
  return workerMessage.trim() || PAY_FAILED_MESSAGE;
}
