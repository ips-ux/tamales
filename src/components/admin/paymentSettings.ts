// Pure rules for the Payment group of Admin > Settings > Ordering.
// No React and no Firestore, so tests can import this file.

import type { OrderingSettings } from "../../../shared/model";
import { onlineFeeCents } from "../../../shared/pricing";
import { formatMoney } from "../../lib/money";
import { paypalFeeCents } from "../../lib/onlineFee";

export type PaymentSettings = Pick<
  OrderingSettings,
  "holdMinutes" | "paymentWindowHours" | "paypalFeeBps" | "paypalFeeFixedCents" | "feeSharePct"
>;

/** The text in each field of the Payment group. */
export interface PaymentSettingsForm {
  holdMinutes: string;
  paymentWindowHours: string;
  /** Percent, for example "3.49". */
  paypalFeePercent: string;
  /** Dollars, for example "0.49". */
  paypalFeeFixed: string;
  feeSharePct: string;
}

/** 349 to "3.49". */
export function bpsToPercentText(bps: number): string {
  return (Math.max(0, bps) / 100).toFixed(2);
}

export function paymentSettingsToForm(settings: PaymentSettings): PaymentSettingsForm {
  return {
    holdMinutes: String(settings.holdMinutes),
    paymentWindowHours: String(settings.paymentWindowHours),
    paypalFeePercent: bpsToPercentText(settings.paypalFeeBps),
    paypalFeeFixed: (Math.max(0, settings.paypalFeeFixedCents) / 100).toFixed(2),
    feeSharePct: String(settings.feeSharePct)
  };
}

function whole(text: string, minimum: number, maximum: number): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= minimum && value <= maximum ? value : null;
}

/** A number with 2 decimals or fewer, as hundredths. "3.49" to 349. */
function hundredths(text: string): number | null {
  const trimmed = text.trim().replace(/^\$/, "").replace(/%$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}

export const MAX_HOLD_MINUTES = 120;
export const MAX_PAYMENT_HOURS = 720;
export const MAX_FEE_BPS = 2000;
export const MAX_FIXED_FEE_CENTS = 500;

export interface PaymentSettingsCheck {
  errors: string[];
  /** Null when a field has an error. */
  values: PaymentSettings | null;
}

/** Checks the Payment group and converts the text to the stored values. */
export function checkPaymentSettings(form: PaymentSettingsForm): PaymentSettingsCheck {
  const errors: string[] = [];
  const holdMinutes = whole(form.holdMinutes, 1, MAX_HOLD_MINUTES);
  const paymentWindowHours = whole(form.paymentWindowHours, 1, MAX_PAYMENT_HOURS);
  const paypalFeeBps = hundredths(form.paypalFeePercent);
  const paypalFeeFixedCents = hundredths(form.paypalFeeFixed);
  const feeSharePct = whole(form.feeSharePct, 0, 100);

  if (holdMinutes === null) {
    errors.push(`Enter the hold time as a whole number of minutes, from 1 to ${MAX_HOLD_MINUTES}.`);
  }
  if (paymentWindowHours === null) {
    errors.push(`Enter the payment time limit as a whole number of hours, from 1 to ${MAX_PAYMENT_HOURS}.`);
  }
  if (paypalFeeBps === null || paypalFeeBps > MAX_FEE_BPS) {
    errors.push(`Enter the PayPal fee percent as a number from 0 to ${MAX_FEE_BPS / 100}, for example 3.49.`);
  }
  if (paypalFeeFixedCents === null || paypalFeeFixedCents > MAX_FIXED_FEE_CENTS) {
    errors.push(
      `Enter the PayPal fixed fee as an amount from 0 to ${(MAX_FIXED_FEE_CENTS / 100).toFixed(2)}, for example 0.49.`
    );
  }
  if (feeSharePct === null) errors.push("Enter the customer share as a whole number from 0 to 100.");

  if (
    errors.length > 0 ||
    holdMinutes === null ||
    paymentWindowHours === null ||
    paypalFeeBps === null ||
    paypalFeeFixedCents === null ||
    feeSharePct === null
  ) {
    return { errors, values: null };
  }
  return { errors, values: { holdMinutes, paymentWindowHours, paypalFeeBps, paypalFeeFixedCents, feeSharePct } };
}

export const FEE_EXAMPLE_CENTS = 5000;

/** "On a $50.00 order: PayPal fee $2.24. The customer pays $1.12." Empty while a fee field has an error. */
export function feeExample(form: PaymentSettingsForm): string {
  const { values } = checkPaymentSettings({ ...form, holdMinutes: "1", paymentWindowHours: "1" });
  if (!values) return "";
  const fee = paypalFeeCents(FEE_EXAMPLE_CENTS, values);
  const share = onlineFeeCents(FEE_EXAMPLE_CENTS, values);
  return `On a ${formatMoney(FEE_EXAMPLE_CENTS)} order: PayPal fee ${formatMoney(fee)}. The customer pays ${formatMoney(share)}.`;
}
