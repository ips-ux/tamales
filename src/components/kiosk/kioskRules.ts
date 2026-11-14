// Rules for the kiosk at /kiosk/{kioskToken}. No React and no Firebase here.
// See docs/V1_DESIGN.md section 9 "Kiosk" and docs/V1_FUNDAMENTALS.md section 8.

import { eventIsLive } from "../../../shared/eventRules";
import type { EventRecord, OrderKind } from "../../../shared/model";
import { hashExitPin } from "../admin/eventRules";

// ---------------------------------------------------------------------------
// Screens and the idle timer
// ---------------------------------------------------------------------------

export type KioskScreen = "home" | "order" | "order_thanks" | "scan" | "waitlist" | "waitlist_thanks" | "story";

/** A screen with no touch for this time returns to the home screen. */
export const KIOSK_IDLE_MS = 120_000;
/** The thank-you screen after an order. The customer can scan the tracker QR code in this time. */
export const ORDER_THANKS_MS = 20_000;
/** The thank-you screen after "Join the Next Batch". */
export const WAITLIST_THANKS_MS = 5_000;

export interface IdleState {
  screen: KioskScreen;
  /** Milliseconds since 1970 when the screen opened. */
  enteredAt: number;
  /** Milliseconds since 1970 of the last touch or key. */
  lastInputAt: number;
}

export type IdleAction =
  | { type: "go"; screen: KioskScreen; now: number }
  | { type: "input"; now: number }
  | { type: "tick"; now: number };

export function initialIdleState(now: number): IdleState {
  return { screen: "home", enteredAt: now, lastInputAt: now };
}

/** When the screen returns home, in milliseconds since 1970. Null for the home screen. */
export function screenDeadline(state: IdleState): number | null {
  switch (state.screen) {
    case "home":
      return null;
    case "order_thanks":
      return state.enteredAt + ORDER_THANKS_MS;
    case "waitlist_thanks":
      return state.enteredAt + WAITLIST_THANKS_MS;
    default:
      return state.lastInputAt + KIOSK_IDLE_MS;
  }
}

/** The idle timer. A thank-you screen returns home at a fixed time; a touch does not extend it. */
export function idleReducer(state: IdleState, action: IdleAction): IdleState {
  switch (action.type) {
    case "go":
      return { screen: action.screen, enteredAt: action.now, lastInputAt: action.now };
    case "input":
      return state.screen === "home" ? state : { ...state, lastInputAt: action.now };
    case "tick": {
      const deadline = screenDeadline(state);
      return deadline !== null && action.now >= deadline ? initialIdleState(action.now) : state;
    }
  }
}

// ---------------------------------------------------------------------------
// The kiosk and its tiles
// ---------------------------------------------------------------------------

/** True when the kiosk link opens a kiosk: the event exists and is active. */
export function kioskIsActive(event: Pick<EventRecord, "active" | "kioskToken"> | null): boolean {
  return Boolean(event && event.active && event.kioskToken);
}

export const KIOSK_PAUSED_TEXT = "We are not taking orders at the kiosk now.";

export interface OrderTile {
  /** The `kind` for the order flow. */
  kind: OrderKind;
  enabled: boolean;
  /** Why the tile is off. Empty when it is on. */
  reason: string;
}

/**
 * The "Order Here" tile. With "today's orders" it is on only while the event is live.
 * With "next batch" it is on while the kiosk is active.
 */
export function orderTile(
  event: Pick<
    EventRecord,
    "active" | "kioskTarget" | "liveOrdersEnabled" | "liveOrdersPaused" | "startsAtUtc" | "endsAtUtc"
  >,
  now: Date | number,
  hoursText: string
): OrderTile {
  if (event.kioskTarget === "next_batch") return { kind: "batch", enabled: event.active, reason: "" };
  if (eventIsLive(event, now)) return { kind: "live", enabled: true, reason: "" };
  if (!event.liveOrdersEnabled || event.liveOrdersPaused) {
    return { kind: "live", enabled: false, reason: KIOSK_PAUSED_TEXT };
  }
  return { kind: "live", enabled: false, reason: hoursText ? `Order hours: ${hoursText}` : KIOSK_PAUSED_TEXT };
}

/** "Sat, Nov 14, 5:00 PM - 8:00 PM" in the business time zone. Empty for a bad date. */
export function formatEventHours(startsAtUtc: string, endsAtUtc: string, timeZone: string): string {
  const start = new Date(startsAtUtc);
  const end = new Date(endsAtUtc);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";
  const zone = timeZone || "America/Denver";
  const day = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", month: "short", day: "numeric" });
  const time = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" });
  return `${day.format(start)}, ${time.format(start)} - ${time.format(end)}`;
}

/** The URL of the mobile order page for the event. */
export function mobileOrderUrl(origin: string, eventId: string): string {
  return `${origin}/e/${encodeURIComponent(eventId)}`;
}

/** The URL of the order tracker. */
export function trackerUrl(origin: string, trackerToken: string): string {
  return `${origin}/t/${encodeURIComponent(trackerToken)}`;
}

// ---------------------------------------------------------------------------
// Exit PIN
// ---------------------------------------------------------------------------

/** The time the exit control must be held to open the number pad. */
export const EXIT_HOLD_MS = 2_000;
export const MAX_PIN_TRIES = 3;
export const PIN_LOCK_MS = 30_000;
export const MAX_PIN_DIGITS = 6;

export interface PinLockState {
  /** Wrong tries since the last lock. */
  failures: number;
  /** Milliseconds since 1970. 0 when the pad is not locked. */
  lockedUntil: number;
}

export const unlockedPin: PinLockState = { failures: 0, lockedUntil: 0 };

export function pinLocked(state: PinLockState, now: number): boolean {
  return state.lockedUntil > now;
}

/** Whole seconds until the pad opens again. 0 when it is open. */
export function pinLockSeconds(state: PinLockState, now: number): number {
  return pinLocked(state, now) ? Math.ceil((state.lockedUntil - now) / 1000) : 0;
}

/** Counts a wrong PIN. The third wrong PIN locks the pad for 30 seconds. */
export function pinWrong(state: PinLockState, now: number): PinLockState {
  if (pinLocked(state, now)) return state;
  const failures = state.failures + 1;
  if (failures >= MAX_PIN_TRIES) return { failures: 0, lockedUntil: now + PIN_LOCK_MS };
  return { failures, lockedUntil: 0 };
}

/** Tries that remain before the lock. */
export function pinTriesLeft(state: PinLockState): number {
  return Math.max(0, MAX_PIN_TRIES - state.failures);
}

/** Adds a digit. A PIN has 6 digits at most. */
export function addPinDigit(pin: string, digit: string): string {
  if (!/^\d$/.test(digit) || pin.length >= MAX_PIN_DIGITS) return pin;
  return pin + digit;
}

/** True for an event with no exit PIN: the pad asks for a second confirm only. */
export function exitNeedsPin(event: Pick<EventRecord, "exitPinHash">): boolean {
  return event.exitPinHash.trim() !== "";
}

/** Compares the SHA-256 hex of `${eventId}:${pin}` to the saved hash. */
export async function exitPinMatches(event: Pick<EventRecord, "id" | "exitPinHash">, pin: string): Promise<boolean> {
  if (!/^\d{1,6}$/.test(pin)) return false;
  const hash = await hashExitPin(event.id, pin);
  return hash === event.exitPinHash.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Waitlist form
// ---------------------------------------------------------------------------

export interface WaitlistFields {
  firstName: string;
  lastName: string;
  email: string;
  interest: string;
}

/** The Worker takes 300 characters at most. */
export const WAITLIST_INTEREST_MAX = 300;

/** Returns 1 instruction for each problem. An empty list means the form is correct. */
export function validateWaitlist(fields: WaitlistFields): string[] {
  const errors: string[] = [];
  if (!fields.firstName.trim()) errors.push("Enter your first name.");
  if (!fields.lastName.trim()) errors.push("Enter your last name.");
  const email = fields.email.trim();
  if (!email) errors.push("Enter your email address.");
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.push("Enter a complete email address.");
  if (fields.interest.trim().length > WAITLIST_INTEREST_MAX) errors.push("Make your answer 300 characters or shorter.");
  return errors;
}
