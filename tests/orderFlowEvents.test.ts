import { describe, expect, it } from "vitest";
import type { EventRecord } from "../shared/model";
import { eventIsOpenNow, eventPhase, nextEvent, openPreorderEvents } from "../src/lib/publicData";

function makeEvent(id: string, overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id,
    name: id,
    areaName: "Westminster",
    startsAtUtc: "2026-11-21T00:00:00.000Z",
    endsAtUtc: "2026-11-21T03:00:00.000Z",
    active: true,
    itemIds: [],
    soldOutItemIds: [],
    preorderMode: "open",
    preorderCutoffUtc: "2026-11-20T00:00:00.000Z",
    allotment: {},
    liveOrdersEnabled: true,
    liveOrdersPaused: false,
    kioskToken: "",
    kioskTarget: "today",
    waitlistEnabled: false,
    exitPinHash: "",
    ...overrides
  };
}

const before = "2026-11-19T12:00:00.000Z";
const during = "2026-11-21T01:00:00.000Z";
const after = "2026-11-21T04:00:00.000Z";

describe("events on the public pages", () => {
  it("lists the events that take pre-orders, soonest first", () => {
    const later = makeEvent("later", {
      startsAtUtc: "2026-11-28T00:00:00.000Z",
      endsAtUtc: "2026-11-28T03:00:00.000Z",
      preorderCutoffUtc: ""
    });
    const off = makeEvent("off", { preorderMode: "off" });
    const hidden = makeEvent("hidden", { active: false });
    const soon = makeEvent("soon");
    expect(openPreorderEvents([later, off, hidden, soon], before).map((event) => event.id)).toEqual([
      "soon",
      "later"
    ]);
    // After the cutoff of "soon", only "later" stays open.
    expect(openPreorderEvents([later, soon], "2026-11-20T06:00:00.000Z").map((event) => event.id)).toEqual(["later"]);
  });

  it("finds the next event that did not end", () => {
    const past = makeEvent("past", { startsAtUtc: "2026-11-01T00:00:00.000Z", endsAtUtc: "2026-11-01T03:00:00.000Z" });
    const soon = makeEvent("soon");
    expect(nextEvent([soon, past], before)?.id).toBe("soon");
    expect(nextEvent([soon, past], during)?.id).toBe("soon");
    expect(nextEvent([soon, past], after)).toBeUndefined();
    expect(nextEvent([makeEvent("hidden", { active: false })], before)).toBeUndefined();
  });

  it("gives the phase of an event for the mobile order page", () => {
    const event = makeEvent("e");
    expect(eventPhase(event, before)).toBe("before");
    expect(eventPhase(event, during)).toBe("live");
    expect(eventPhase(event, after)).toBe("ended");
    expect(eventPhase({ ...event, liveOrdersPaused: true }, during)).toBe("booth_only");
    expect(eventPhase({ ...event, liveOrdersEnabled: false }, during)).toBe("booth_only");
    expect(eventIsOpenNow({ ...event, liveOrdersPaused: true }, during)).toBe(true);
    expect(eventIsOpenNow(event, after)).toBe(false);
  });
});
