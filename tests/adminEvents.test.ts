import { describe, expect, it } from "vitest";
import type { EventRecord, OrderRecord } from "../shared/model";
import { utcToZonedInput, zonedInputToUtc } from "../src/components/admin/businessDateTime";
import { waitlistCsv } from "../src/components/admin/contactLinks";
import { buildRings, ringsToRows } from "../src/components/admin/deliveryRings";
import {
  buildEventFields,
  currentEvent,
  emptyEventForm,
  eventToFormValues,
  hashExitPin,
  isValidExitPin,
  newKioskToken,
  nextRemaining,
  splitEvents,
  toggleId
} from "../src/components/admin/eventRules";
import { buildPickupList, buildPrepSheet, pickupListCsv, prepSheetCsv } from "../src/components/admin/eventSheets";

const ZONE = "America/Denver";

function makeEvent(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: "ev1",
    name: "Winter Market",
    areaName: "Westminster",
    startsAtUtc: "2026-11-14T22:00:00.000Z",
    endsAtUtc: "2026-11-15T01:00:00.000Z",
    active: true,
    itemIds: [],
    soldOutItemIds: [],
    preorderMode: "off",
    preorderCutoffUtc: "",
    allotment: {},
    liveOrdersEnabled: true,
    liveOrdersPaused: false,
    kioskToken: "token",
    kioskTarget: "today",
    waitlistEnabled: true,
    exitPinHash: "",
    ...overrides
  };
}

function makeOrder(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: "o1",
    kind: "preorder",
    source: "web",
    state: "received",
    paymentState: "paid",
    paymentMethod: "paypal",
    orderNumber: "BBT-1001",
    sequence: 1001,
    paymentDescription: "",
    eventId: "ev1",
    eventName: "Winter Market",
    fulfillment: "event_pickup",
    customer: { firstName: "Jane", lastName: "Doe", email: "jane@example.com", phone: "", marketingOptIn: false },
    customerId: "c1",
    items: [
      {
        itemId: "red",
        variantId: "dozen",
        itemName: "Red Chile Pork",
        variantLabel: "Dozen",
        unitTamales: 12,
        unitPriceCents: 3000,
        quantity: 1,
        lineTotalCents: 3000
      }
    ],
    tamaleCount: 12,
    totals: { subtotalCents: 3000, deliveryFeeCents: 0, onlineFeeCents: 0, taxCents: 261, totalCents: 3261 },
    delivery: null,
    requested: null,
    scheduledAtUtc: "",
    customerNote: "",
    ownerNote: "",
    reason: "",
    trackerToken: "t1",
    createdAtUtc: "2026-11-10T18:00:00.000Z",
    updatedAtUtc: "2026-11-10T18:00:00.000Z",
    approvedAtUtc: "",
    payByUtc: "",
    ...overrides
  };
}

describe("business time zone inputs", () => {
  it("converts a winter time in Denver (UTC-7)", () => {
    expect(zonedInputToUtc("2026-11-14T15:00", ZONE)).toBe("2026-11-14T22:00:00.000Z");
    expect(utcToZonedInput("2026-11-14T22:00:00.000Z", ZONE)).toBe("2026-11-14T15:00");
  });

  it("converts a summer time in Denver (UTC-6)", () => {
    expect(zonedInputToUtc("2026-07-04T17:30", ZONE)).toBe("2026-07-04T23:30:00.000Z");
    expect(utcToZonedInput("2026-07-04T23:30:00.000Z", ZONE)).toBe("2026-07-04T17:30");
  });

  it("gives midnight as 00, not 24", () => {
    expect(utcToZonedInput("2026-11-14T07:00:00.000Z", ZONE)).toBe("2026-11-14T00:00");
  });

  it("returns an empty string for a value that is not a date", () => {
    expect(zonedInputToUtc("", ZONE)).toBe("");
    expect(zonedInputToUtc("tomorrow", ZONE)).toBe("");
    expect(utcToZonedInput("", ZONE)).toBe("");
    expect(utcToZonedInput("nope", ZONE)).toBe("");
  });
});

describe("stock for a fixed allotment", () => {
  it("sets remaining to the allotment on the first save", () => {
    expect(nextRemaining(null, { red: 48, green: 24 })).toEqual({ red: 48, green: 24 });
  });

  it("changes remaining by the same amount as the allotment", () => {
    const previous = { allotment: { red: 48 }, remaining: { red: 30 } };
    expect(nextRemaining(previous, { red: 60 })).toEqual({ red: 42 });
    expect(nextRemaining(previous, { red: 40 })).toEqual({ red: 22 });
  });

  it("does not go below 0", () => {
    const previous = { allotment: { red: 48 }, remaining: { red: 5 } };
    expect(nextRemaining(previous, { red: 12 })).toEqual({ red: 0 });
  });

  it("starts a new menu item full and drops a removed menu item", () => {
    const previous = { allotment: { red: 48 }, remaining: { red: 30, green: 7 } };
    expect(nextRemaining(previous, { green: 24 })).toEqual({ green: 24 });
  });

  it("uses the old allotment when the stock has no count for the menu item", () => {
    const previous = { allotment: { red: 48 }, remaining: {} };
    expect(nextRemaining(previous, { red: 50 })).toEqual({ red: 50 });
  });
});

describe("event form", () => {
  const menu = ["red", "green"];
  const valid = {
    ...emptyEventForm(),
    name: " Winter Market ",
    areaName: "Westminster",
    starts: "2026-11-14T15:00",
    ends: "2026-11-14T18:00"
  };

  it("builds the event fields in UTC", () => {
    const result = buildEventFields(valid, menu, ZONE);
    expect(result.errors).toEqual([]);
    expect(result.fields).toMatchObject({
      name: "Winter Market",
      startsAtUtc: "2026-11-14T22:00:00.000Z",
      endsAtUtc: "2026-11-15T01:00:00.000Z",
      preorderMode: "off",
      preorderCutoffUtc: "",
      allotment: {},
      itemIds: []
    });
  });

  it("gives 1 instruction for each missing field", () => {
    const result = buildEventFields(emptyEventForm(), menu, ZONE);
    expect(result.fields).toBeNull();
    expect(result.errors).toEqual([
      "Enter the event name.",
      "Enter the area name.",
      "Enter the start date and time.",
      "Enter the end date and time."
    ]);
  });

  it("rejects an end time that is not after the start time", () => {
    const result = buildEventFields({ ...valid, ends: valid.starts }, menu, ZONE);
    expect(result.errors).toEqual(["Set the end time after the start time."]);
  });

  it("requires a cutoff when pre-orders are on", () => {
    const result = buildEventFields({ ...valid, preorderMode: "open" }, menu, ZONE);
    expect(result.errors).toEqual(["Enter the pre-order cutoff."]);
  });

  it("keeps the allotment of offered menu items only", () => {
    const result = buildEventFields(
      {
        ...valid,
        preorderMode: "fixed",
        cutoff: "2026-11-13T12:00",
        itemIds: ["red", "gone"],
        allotment: { red: "48", green: "24" }
      },
      menu,
      ZONE
    );
    expect(result.errors).toEqual([]);
    expect(result.fields?.itemIds).toEqual(["red"]);
    expect(result.fields?.allotment).toEqual({ red: 48 });
  });

  it("requires an allotment in whole tamales for a fixed allotment", () => {
    const base = { ...valid, preorderMode: "fixed" as const, cutoff: "2026-11-13T12:00" };
    expect(buildEventFields(base, menu, ZONE).errors).toEqual(["Enter an allotment for 1 menu item or more."]);
    expect(buildEventFields({ ...base, allotment: { red: "4.5" } }, menu, ZONE).errors).toEqual([
      "Enter each allotment as a whole number of tamales."
    ]);
  });

  it("fills the form from a stored event", () => {
    const values = eventToFormValues(
      makeEvent({ preorderMode: "fixed", preorderCutoffUtc: "2026-11-13T19:00:00.000Z", allotment: { red: 48 } }),
      ZONE
    );
    expect(values.starts).toBe("2026-11-14T15:00");
    expect(values.cutoff).toBe("2026-11-13T12:00");
    expect(values.allotment).toEqual({ red: "48" });
  });
});

describe("exit PIN and kiosk token", () => {
  it("accepts 4 to 6 digits only", () => {
    expect(isValidExitPin("1234")).toBe(true);
    expect(isValidExitPin("123456")).toBe(true);
    expect(isValidExitPin("123")).toBe(false);
    expect(isValidExitPin("1234567")).toBe(false);
    expect(isValidExitPin("12a4")).toBe(false);
  });

  it("hashes the event id and the PIN with SHA-256", async () => {
    // printf 'ev1:1234' | sha256sum
    const hash = await hashExitPin("ev1", "1234");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(await hashExitPin("ev1", "1234"));
    expect(hash).not.toBe(await hashExitPin("ev2", "1234"));
    expect(hash).not.toBe(await hashExitPin("ev1", "1235"));
  });

  it("makes a 64-character token that changes each time", () => {
    const token = newKioskToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(newKioskToken()).not.toBe(token);
  });
});

describe("event lists", () => {
  const now = new Date("2026-11-14T23:00:00.000Z");
  const live = makeEvent({ id: "live" });
  const later = makeEvent({ id: "later", startsAtUtc: "2026-11-20T22:00:00.000Z", endsAtUtc: "2026-11-21T01:00:00.000Z" });
  const old = makeEvent({ id: "old", startsAtUtc: "2026-11-01T22:00:00.000Z", endsAtUtc: "2026-11-02T01:00:00.000Z" });
  const older = makeEvent({ id: "older", startsAtUtc: "2026-10-01T22:00:00.000Z", endsAtUtc: "2026-10-02T01:00:00.000Z" });

  it("puts upcoming events first, soonest first, and past events latest first", () => {
    const result = splitEvents([older, later, old, live], now);
    expect(result.upcoming.map((event) => event.id)).toEqual(["live", "later"]);
    expect(result.past.map((event) => event.id)).toEqual(["old", "older"]);
  });

  it("finds the event that is in its hours now, also when mobile orders are paused", () => {
    expect(currentEvent([later, old, makeEvent({ id: "live", liveOrdersPaused: true })], now)?.id).toBe("live");
    expect(currentEvent([later, old], now)).toBeNull();
    expect(currentEvent([makeEvent({ active: false })], now)).toBeNull();
  });

  it("picks the event that ends first when 2 events are live", () => {
    const long = makeEvent({ id: "long", endsAtUtc: "2026-11-15T05:00:00.000Z" });
    expect(currentEvent([long, live], now)?.id).toBe("live");
  });

  it("is not live at the end time", () => {
    expect(currentEvent([live], new Date(live.endsAtUtc))).toBeNull();
  });

  it("adds and removes an id", () => {
    expect(toggleId(["a"], "b", true)).toEqual(["a", "b"]);
    expect(toggleId(["a", "b"], "a", false)).toEqual(["b"]);
    expect(toggleId(["a"], "a", true)).toEqual(["a"]);
  });
});

describe("prep sheet and pickup list", () => {
  const green = {
    itemId: "green",
    variantId: "half",
    itemName: "Green Chile Chicken",
    variantLabel: "Half dozen",
    unitTamales: 6,
    unitPriceCents: 1600,
    quantity: 3,
    lineTotalCents: 4800
  };
  const orders = [
    makeOrder(),
    makeOrder({
      id: "o2",
      orderNumber: "BBT-1002",
      state: "preparing",
      customer: { firstName: "Ana", lastName: "avila", email: "a@example.com", phone: "", marketingOptIn: false },
      items: [makeOrder().items[0], green]
    }),
    makeOrder({
      id: "o3",
      orderNumber: "BBT-1003",
      state: "approved",
      paymentState: "unpaid",
      customer: { firstName: "Bo", lastName: "Chen", email: "b@example.com", phone: "", marketingOptIn: false },
      items: [green]
    }),
    makeOrder({ id: "o4", orderNumber: "BBT-1004", state: "requested" }),
    makeOrder({ id: "o5", orderNumber: "BBT-1005", state: "canceled" }),
    makeOrder({ id: "o6", orderNumber: "BBT-1006", state: "handed_over" }),
    makeOrder({ id: "o7", kind: "live", orderNumber: "#3 - Nov 14 - Jane Doe" }),
    makeOrder({ id: "o8", eventId: "other" })
  ];

  it("adds the tamales for each menu item, with approved orders apart", () => {
    expect(buildPrepSheet(orders, "ev1")).toEqual([
      { itemId: "green", itemName: "Green Chile Chicken", toMake: 18, approved: 18 },
      { itemId: "red", itemName: "Red Chile Pork", toMake: 24, approved: 0 }
    ]);
  });

  it("writes the prep sheet with quantity labels", () => {
    expect(prepSheetCsv(buildPrepSheet(orders, "ev1"))).toEqual([
      ["Menu item", "To make", "Approved, not paid"],
      ["Green Chile Chicken", "18 tamales", "18 tamales"],
      ["Red Chile Pork", "24 (2 dozen)", "0 tamales"]
    ]);
  });

  it("lists the pre-orders of the event by last name", () => {
    const rows = buildPickupList(orders, "ev1");
    expect(rows.map((row) => row.orderNumber)).toEqual(["BBT-1002", "BBT-1003", "BBT-1001", "BBT-1006"]);
    expect(rows[0].items).toEqual(["Red Chile Pork: 12 (1 dozen)", "Green Chile Chicken: 18 tamales"]);
  });

  it("writes the pickup list with words for payment and status", () => {
    const csv = pickupListCsv(buildPickupList(orders, "ev1"));
    expect(csv[0]).toEqual(["Order number", "Last name", "First name", "Items", "Payment", "Status"]);
    expect(csv[2]).toEqual(["BBT-1003", "Chen", "Bo", "Green Chile Chicken: 18 tamales", "Not paid", "Approved"]);
  });

  it("gives no rows for an event with no pre-orders", () => {
    expect(buildPrepSheet(orders, "none")).toEqual([]);
    expect(buildPickupList(orders, "none")).toEqual([]);
  });
});

describe("delivery rings", () => {
  it("sorts the rings by miles and ignores an empty row", () => {
    const result = buildRings([
      { miles: "10", fee: "8" },
      { miles: "", fee: "" },
      { miles: "2.5", fee: "$3.50" }
    ]);
    expect(result).toEqual({
      error: "",
      rings: [
        { miles: 2.5, feeCents: 350 },
        { miles: 10, feeCents: 800 }
      ]
    });
  });

  it("accepts a fee of 0 and no rings", () => {
    expect(buildRings([{ miles: "5", fee: "0" }]).rings).toEqual([{ miles: 5, feeCents: 0 }]);
    expect(buildRings([])).toEqual({ error: "", rings: [] });
  });

  it("rejects miles that are not above 0", () => {
    for (const miles of ["0", "-1", "far", ""]) {
      expect(buildRings([{ miles, fee: "5" }]).error).toBe("Enter the miles of each ring as a number above 0.");
    }
  });

  it("rejects a fee that is not an amount", () => {
    for (const fee of ["", "-1", "five", "1.234"]) {
      expect(buildRings([{ miles: "5", fee }]).error).toBe(
        "Enter the fee of each ring as an amount, for example 5.00."
      );
    }
  });

  it("rejects the same distance 2 times", () => {
    const result = buildRings([
      { miles: "5", fee: "4" },
      { miles: "5.0", fee: "6" }
    ]);
    expect(result).toEqual({ error: "Use each distance for 1 ring only.", rings: [] });
  });

  it("shows stored rings as text", () => {
    expect(ringsToRows([{ miles: 2.5, feeCents: 350 }])).toEqual([{ miles: "2.5", fee: "3.50" }]);
  });
});

describe("waitlist CSV", () => {
  it("writes 1 row for each entry", () => {
    const rows = waitlistCsv(
      [
        {
          id: "w1",
          firstName: "Jane",
          lastName: "Doe",
          email: "jane@example.com",
          interest: "Red, 2 dozen",
          eventId: "ev1",
          eventName: "Winter Market",
          createdAtUtc: "2026-11-14T22:00:00.000Z"
        }
      ],
      (iso) => `date:${iso.slice(0, 10)}`
    );
    expect(rows).toEqual([
      ["First name", "Last name", "Email", "Interest", "Event", "Date"],
      ["Jane", "Doe", "jane@example.com", "Red, 2 dozen", "Winter Market", "date:2026-11-14"]
    ]);
  });
});
