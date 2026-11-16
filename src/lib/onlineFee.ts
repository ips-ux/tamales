// The PayPal fee for the example line in Settings.
// The online ordering fee itself is `onlineFeeCents` in shared/pricing.ts.

import type { FeeSettings } from "../../shared/pricing";

/** What PayPal keeps for a payment of this amount, in cents: the rate plus the fixed fee. */
export function paypalFeeCents(amountCents: number, settings: Pick<FeeSettings, "paypalFeeBps" | "paypalFeeFixedCents">): number {
  if (!(amountCents > 0)) return 0;
  const rateBps = Math.max(0, settings.paypalFeeBps || 0);
  const fixedCents = Math.max(0, settings.paypalFeeFixedCents || 0);
  return Math.round((amountCents * rateBps) / 10_000 + fixedCents);
}
