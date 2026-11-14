// Order numbers. See docs/V1_FUNDAMENTALS.md section 7 and docs/V1_DESIGN.md section 5.

import type { OrderKind } from "./model";

export const DEFAULT_TIME_ZONE = "America/Denver";
/** The first `BBT-####` number. */
export const FIRST_RUNNING_SEQUENCE = 1001;

function safeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/** "2026-11-14": the calendar date of a moment in the given time zone. */
export function dateKeyInZone(date: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: safeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(date));
}

/** "2026-11-14" plus 3 days -> "2026-11-17". */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The id of the day counter for the live orders of 1 event: `counters/{this id}`. */
export function liveCounterId(eventId: string, dateKey: string): string {
  return `live-${eventId}-${dateKey}`;
}

function fullName(firstName: string, lastName: string): string {
  return `${firstName ?? ""} ${lastName ?? ""}`.replace(/\s+/g, " ").trim();
}

/**
 * "#12 - Nov 14 - Jane Doe". The date shows in the business time zone.
 * `dateIso` is a moment in ISO text. A plain "YYYY-MM-DD" is used as that calendar date.
 * With no name, the result is "#12 - Nov 14".
 */
export function liveOrderNumber(
  seq: number,
  dateIso: string,
  timeZone: string,
  firstName: string,
  lastName: string
): string {
  const plainDate = /^\d{4}-\d{2}-\d{2}$/.test(dateIso);
  const date = new Date(plainDate ? `${dateIso}T12:00:00Z` : dateIso);
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: plainDate ? "UTC" : safeZone(timeZone),
    month: "short",
    day: "numeric"
  }).format(date);
  return [`#${seq}`, day, fullName(firstName, lastName)].filter(Boolean).join(" - ");
}

/** "BBT-1042". The sequence starts at 1001. */
export function runningOrderNumber(seq: number): string {
  return `BBT-${String(seq).padStart(4, "0")}`;
}

/**
 * The text that the customer puts in a Venmo or Cash App payment.
 * Live order: "#12 - Nov 14 - Jane Doe". Other orders: "BBT-1042 Jane Doe".
 */
export function paymentDescription(order: {
  kind: OrderKind;
  orderNumber: string;
  customer: { firstName: string; lastName: string };
}): string {
  if (order.kind === "live") return order.orderNumber;
  return [order.orderNumber, fullName(order.customer.firstName, order.customer.lastName)].filter(Boolean).join(" ");
}
