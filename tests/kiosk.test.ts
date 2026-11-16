import { describe, expect, it } from "vitest";
import type { EventRecord } from "../shared/model";
import { hashExitPin } from "../src/components/admin/eventRules";
import {
  addPinDigit,
  exitNeedsPin,
  exitPinMatches,
  formatEventHours,
  idleReducer,
  initialIdleState,
  KIOSK_IDLE_MS,
  KIOSK_PAUSED_TEXT,
  kioskIsActive,
  mobileOrderUrl,
  ORDER_THANKS_MS,
  orderTile,
  PIN_LOCK_MS,
  pinLocked,
  pinLockSeconds,
  pinTriesLeft,
  pinWrong,
  screenDeadline,
  trackerUrl,
  unlockedPin,
  validateWaitlist,
  WAITLIST_THANKS_MS
} from "../src/components/kiosk/kioskRules";

function event(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: "ev1",
    name: "Winter Market",
    areaName: "Westminster",
    startsAtUtc: "2026-11-15T00:00:00.000Z",
    endsAtUtc: "2026-11-15T03:00:00.000Z",
    active: true,
    itemIds: [],
    soldOutItemIds: [],
    preorderMode: "off",
    preorderCutoffUtc: "",
    allotment: {},
    liveOrdersEnabled: true,
    liveOrdersPaused: false,
    kioskToken: "kiosk-secret-token",
    kioskTarget: "today",
    waitlistEnabled: true,
    exitPinHash: "",
    ...overrides
  };
}

const DURING = new Date("2026-11-15T01:00:00.000Z");
const BEFORE = new Date("2026-11-14T20:00:00.000Z");
const HOURS = "Sat, Nov 14, 5:00 PM - 8:00 PM";

describe("kiosk tiles", () => {
  it("opens only for an active event with a token", () => {
    expect(kioskIsActive(event())).toBe(true);
    expect(kioskIsActive(event({ active: false }))).toBe(false);
    expect(kioskIsActive(event({ kioskToken: "" }))).toBe(false);
    expect(kioskIsActive(null)).toBe(false);
  });

  it("today: takes live orders only while the event is live", () => {
    expect(orderTile(event(), DURING, HOURS)).toEqual({ kind: "live", enabled: true, reason: "" });
    expect(orderTile(event(), BEFORE, HOURS)).toEqual({
      kind: "live",
      enabled: false,
      reason: `Order hours: ${HOURS}`
    });
  });

  it("today: says the kiosk does not take orders when the owner pauses or turns off live orders", () => {
    expect(orderTile(event({ liveOrdersPaused: true }), DURING, HOURS)).toMatchObject({
      enabled: false,
      reason: KIOSK_PAUSED_TEXT
    });
    expect(orderTile(event({ liveOrdersEnabled: false }), DURING, HOURS)).toMatchObject({
      enabled: false,
      reason: KIOSK_PAUSED_TEXT
    });
  });

  it("next batch: takes batch requests at all times", () => {
    expect(orderTile(event({ kioskTarget: "next_batch" }), BEFORE, HOURS)).toEqual({
      kind: "batch",
      enabled: true,
      reason: ""
    });
    expect(orderTile(event({ kioskTarget: "next_batch", liveOrdersPaused: true }), DURING, HOURS).enabled).toBe(true);
  });

  it("formats the event hours in the business time zone", () => {
    expect(formatEventHours("2026-11-15T00:00:00.000Z", "2026-11-15T03:00:00.000Z", "America/Denver")).toBe(HOURS);
    expect(formatEventHours("", "x", "America/Denver")).toBe("");
  });

  it("builds the mobile order and tracker links", () => {
    expect(mobileOrderUrl("https://bustostamales.com", "ev1")).toBe("https://bustostamales.com/e/ev1");
    expect(trackerUrl("https://bustostamales.com", "abc")).toBe("https://bustostamales.com/t/abc");
  });
});

describe("kiosk idle timer", () => {
  it("returns a screen home after 120 seconds with no touch", () => {
    let state = idleReducer(initialIdleState(0), { type: "go", screen: "waitlist", now: 1000 });
    expect(screenDeadline(state)).toBe(1000 + KIOSK_IDLE_MS);
    state = idleReducer(state, { type: "tick", now: 1000 + KIOSK_IDLE_MS - 1 });
    expect(state.screen).toBe("waitlist");
    state = idleReducer(state, { type: "tick", now: 1000 + KIOSK_IDLE_MS });
    expect(state.screen).toBe("home");
  });

  it("resets the timer on a touch", () => {
    let state = idleReducer(initialIdleState(0), { type: "go", screen: "order", now: 0 });
    state = idleReducer(state, { type: "input", now: 100_000 });
    state = idleReducer(state, { type: "tick", now: KIOSK_IDLE_MS + 1 });
    expect(state.screen).toBe("order");
    state = idleReducer(state, { type: "tick", now: 100_000 + KIOSK_IDLE_MS });
    expect(state.screen).toBe("home");
  });

  it("returns a thank-you screen home at a fixed time, also with touches", () => {
    let state = idleReducer(initialIdleState(0), { type: "go", screen: "order_thanks", now: 0 });
    state = idleReducer(state, { type: "input", now: ORDER_THANKS_MS - 1 });
    state = idleReducer(state, { type: "tick", now: ORDER_THANKS_MS });
    expect(state.screen).toBe("home");

    state = idleReducer(state, { type: "go", screen: "waitlist_thanks", now: 50_000 });
    expect(screenDeadline(state)).toBe(50_000 + WAITLIST_THANKS_MS);
    state = idleReducer(state, { type: "tick", now: 50_000 + WAITLIST_THANKS_MS });
    expect(state.screen).toBe("home");
  });

  it("keeps the home screen", () => {
    const home = initialIdleState(0);
    expect(screenDeadline(home)).toBeNull();
    expect(idleReducer(home, { type: "tick", now: 10 * KIOSK_IDLE_MS })).toBe(home);
    expect(idleReducer(home, { type: "input", now: 5 })).toBe(home);
  });
});

describe("kiosk exit PIN", () => {
  it("asks for a PIN only when the event has a PIN hash", () => {
    expect(exitNeedsPin(event())).toBe(false);
    expect(exitNeedsPin(event({ exitPinHash: "abc" }))).toBe(true);
  });

  it("compares the SHA-256 of event id and PIN to the hash that the owner screen makes", async () => {
    const withPin = event({ exitPinHash: await hashExitPin("ev1", "4321") });
    expect(await exitPinMatches(withPin, "4321")).toBe(true);
    expect(await exitPinMatches(withPin, "1234")).toBe(false);
    expect(await exitPinMatches({ ...withPin, id: "ev2" }, "4321")).toBe(false);
    expect(await exitPinMatches(withPin, "")).toBe(false);
  });

  it("locks the pad for 30 seconds after 3 wrong PINs", () => {
    let lock = unlockedPin;
    lock = pinWrong(lock, 0);
    expect(pinTriesLeft(lock)).toBe(2);
    lock = pinWrong(lock, 1);
    expect(pinTriesLeft(lock)).toBe(1);
    expect(pinLocked(lock, 1)).toBe(false);
    lock = pinWrong(lock, 2);
    expect(pinLocked(lock, 2)).toBe(true);
    expect(pinLockSeconds(lock, 2)).toBe(30);
    expect(pinWrong(lock, 3)).toBe(lock); // no count while locked
    expect(pinLocked(lock, 2 + PIN_LOCK_MS)).toBe(false);
    expect(pinTriesLeft(lock)).toBe(3);
  });

  it("takes digits only, 6 at most", () => {
    expect(addPinDigit("", "1")).toBe("1");
    expect(addPinDigit("12345", "6")).toBe("123456");
    expect(addPinDigit("123456", "7")).toBe("123456");
    expect(addPinDigit("1", "x")).toBe("1");
  });
});

describe("kiosk waitlist form", () => {
  it("requires the name and a complete email address", () => {
    expect(validateWaitlist({ firstName: "", lastName: " ", email: "jane", interest: "" })).toEqual([
      "Enter your first name.",
      "Enter your last name.",
      "Enter a complete email address."
    ]);
    expect(validateWaitlist({ firstName: "Jane", lastName: "Doe", email: "", interest: "" })).toEqual([
      "Enter your email address."
    ]);
    expect(validateWaitlist({ firstName: "Jane", lastName: "Doe", email: "jane@example.com", interest: "Red, 2 dozen" })).toEqual(
      []
    );
    expect(
      validateWaitlist({ firstName: "Jane", lastName: "Doe", email: "jane@example.com", interest: "x".repeat(301) })
    ).toEqual(["Make your answer 300 characters or shorter."]);
  });
});
