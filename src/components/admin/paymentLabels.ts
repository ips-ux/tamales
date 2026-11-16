// Payment methods for a POS sale: cash, Venmo and Cash App.
// PayPal Checkout is for orders only. The customer pays on the order tracker.

import type { PosPaymentMethod } from "../../lib/firestoreClient";

export const posPaymentMethods: PosPaymentMethod[] = ["cash", "venmo", "cashapp"];

export const posPaymentLabels: Record<PosPaymentMethod, string> = {
  cash: "Cash",
  venmo: "Venmo",
  cashapp: "Cash App"
};

export function isPosPaymentMethod(value: string): value is PosPaymentMethod {
  return (posPaymentMethods as string[]).includes(value);
}

/**
 * The label of a stored method. A sale from an order can hold "paypal".
 * An old sale with a removed method shows the stored value.
 */
export function posPaymentLabel(value: string): string {
  if (isPosPaymentMethod(value)) return posPaymentLabels[value];
  if (value === "paypal") return "PayPal";
  return value && value !== "unset" ? value : "Not recorded";
}

/** The link in the payment QR code. Empty for cash and for a method with no link. */
export function posPaymentUrl(
  method: string,
  accounts: { cashAppCashtag: string; venmoHandle: string },
  cents: number
): string {
  const amount = (cents / 100).toFixed(2);
  if (method === "cashapp") return `https://cash.app/$${accounts.cashAppCashtag}/${amount}`;
  if (method === "venmo") {
    const note = encodeURIComponent("Bangin Bustos Tamales POS sale");
    return `venmo://paycharge?txn=pay&recipients=${accounts.venmoHandle}&amount=${amount}&note=${note}`;
  }
  return "";
}
