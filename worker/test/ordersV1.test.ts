import { describe, expect, it } from "vitest";
import { censusGeocode, quoteDelivery, validateQuote, type Geocoder } from "../src/delivery";
import { readConfig } from "../src/env";
import { ContentionError } from "../src/firestore";
import { handleRequest } from "../src/index";
import { runOrderAction, validateOrderAction } from "../src/orderAction";
import { createOrderV1, returnStock, takeStock, validateCreateOrder } from "../src/orderCreate";
import { newTrackerToken, readOrdering, toTracker } from "../src/orderData";
import { joinWaitlist } from "../src/waitlist";
import type { OrderRecord } from "../../shared/model";
import { fakeDefer, fakeFirestore, fakeMailer } from "./fakeFirestore";

const cfg = readConfig({});
const LIVE_TIME = new Date("2026-11-15T01:00:00.000Z"); // 6:00 PM on Nov 14 in Denver, during ev1
const EARLY = new Date("2026-11-12T18:00:00.000Z"); // before the pre-order cutoff
const TODAY = new Date("2026-11-13T18:00:00.000Z");

const event = {
  name: "Winter Market",
  areaName: "Westminster",
  startsAtUtc: "2026-11-15T00:00:00.000Z",
  endsAtUtc: "2026-11-15T03:00:00.000Z",
  active: true,
  itemIds: [],
  soldOutItemIds: ["green"],
  preorderMode: "open",
  preorderCutoffUtc: "2026-11-13T00:00:00.000Z",
  allotment: {},
  liveOrdersEnabled: true,
  liveOrdersPaused: false,
  kioskToken: "kiosk-secret",
  kioskTarget: "today",
  waitlistEnabled: true,
  exitPinHash: ""
};

const seed = {
  "menuItems/red": {
    name: "Red Tamales",
    status: "active",
    singlePriceCents: 400,
    variants: [
      { id: "red-half", label: "Half dozen", unitQuantity: 6, priceCents: 1800, minimumQuantity: 1, active: true },
      { id: "red-dozen", label: "Dozen", unitQuantity: 12, priceCents: 3400, minimumQuantity: 1, active: true }
    ]
  },
  "menuItems/green": {
    name: "Green Tamales",
    status: "active",
    singlePriceCents: 400,
    variants: [
      { id: "green-half", label: "Half dozen", unitQuantity: 6, priceCents: 1800, minimumQuantity: 1, active: true }
    ]
  },
  "settings/business": { timezone: "America/Denver", taxRateBps: 870 },
  "settings/ordering": {
    pickupEnabled: true,
    deliveryEnabled: true,
    pickupAreaName: "Westminster",
    minBatchTamales: 12,
    minNoticeDays: 3,
    deliveryRings: [
      { miles: 5, feeCents: 500 },
      { miles: 10, feeCents: 1000 }
    ],
    deliveryFeeTaxable: false,
    paymentWindowHours: 72,
    // A fee share of 0 keeps the online ordering fee out of these tests. money.test.ts tests the fee.
    feeSharePct: 0
  },
  "settings/orderingPrivate": {
    startAddress: "1 Start St",
    startLat: null,
    startLng: null,
    pickupAddress: "9 Secret Rd, Westminster",
    pickupInstructions: "Ring the bell."
  },
  "events/ev1": event,
  "events/evFixed": { ...event, preorderMode: "fixed", allotment: { red: 24, green: 6 }, itemIds: ["red", "green"] },
  "events/evRedOnly": { ...event, itemIds: ["red"] },
  "eventPrivate/ev1": { address: "500 Market St, Westminster", instructions: "Booth 4." },
  "eventPrivate/evFixed": { address: "500 Market St, Westminster", instructions: "Booth 4." }
};

const points: Record<string, { lat: number; lng: number }> = {
  "1 Start St": { lat: 39, lng: -105 },
  "near address": { lat: 39.05, lng: -105 }, // about 3.5 miles
  "ring 2 address": { lat: 39.1, lng: -105 }, // about 6.9 miles
  "far address": { lat: 40, lng: -105 } // about 69 miles
};

function setup(extra: Record<string, Record<string, unknown>> = {}) {
  const store = fakeFirestore({ ...seed, ...extra });
  const mail = fakeMailer();
  const deferred = fakeDefer();
  const geocodeCalls: string[] = [];
  const geocode: Geocoder = async (address) => {
    geocodeCalls.push(address);
    return points[address] ?? null;
  };
  const deps = { db: store.db, mailer: mail.mailer, cfg, defer: deferred.defer, geocode };
  return { ...store, ...mail, deps, done: deferred.done, geocodeCalls };
}

const customer = { firstName: "Jane", lastName: "Doe", email: "Jane@Example.com", phone: "", marketingOptIn: false };

function liveBody(over: Record<string, unknown> = {}) {
  return {
    kind: "live",
    source: "mobile",
    eventId: "ev1",
    kioskToken: "",
    items: [{ itemId: "red", variantId: "single", quantity: 3, unitPriceCents: 1 }],
    customer,
    fulfillment: "event_pickup",
    deliveryAddress: "",
    requested: null,
    paymentMethod: "venmo",
    customerNote: "",
    ...over
  };
}

function preorderBody(over: Record<string, unknown> = {}) {
  return liveBody({
    kind: "preorder",
    source: "web",
    paymentMethod: "unset",
    items: [{ itemId: "red", variantId: "red-dozen", quantity: 1 }],
    ...over
  });
}

function batchBody(over: Record<string, unknown> = {}) {
  return liveBody({
    kind: "batch",
    source: "web",
    eventId: "",
    fulfillment: "pickup",
    paymentMethod: "unset",
    requested: { date: "2026-11-20", timeRange: "5 PM to 7 PM" },
    items: [{ itemId: "red", variantId: "red-dozen", quantity: 2 }],
    ...over
  });
}

function orderOf(store: ReturnType<typeof setup>, orderNumber: string): OrderRecord {
  return store.all("orders").find((doc) => doc.orderNumber === orderNumber) as unknown as OrderRecord;
}

describe("Firestore transaction client", () => {
  it("begins, reads in the transaction, and commits the writes together", async () => {
    const { db, calls, docs, base, root } = fakeFirestore({ "counters/orders": { next: 1005 } });
    const result = await db.runTransaction(async (tx) => {
      const counter = await tx.get("counters/orders");
      expect(await tx.get("counters/none")).toBeNull();
      tx.set("counters/orders", { next: Number(counter?.next) + 1 }, ["next"]);
      tx.set("orders/a", { orderNumber: "BBT-1005" });
      tx.delete("orders/old");
      return counter?.next;
    });
    expect(result).toBe(1005);
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `POST ${base}:beginTransaction`,
      `GET ${base}/counters/orders?transaction=tx-1`,
      `GET ${base}/counters/none?transaction=tx-1`,
      `POST ${base}:commit`
    ]);
    expect(calls[0].body).toEqual({ options: { readWrite: {} } });
    expect(calls[3].body).toEqual({
      transaction: "tx-1",
      writes: [
        {
          update: { name: `${root}/counters/orders`, fields: { next: { integerValue: "1006" } } },
          updateMask: { fieldPaths: ["next"] }
        },
        { update: { name: `${root}/orders/a`, fields: { orderNumber: { stringValue: "BBT-1005" } } } },
        { delete: `${root}/orders/old` }
      ]
    });
    expect(docs.get("counters/orders")).toEqual({ next: 1006 });
  });

  it("runs the work again when Firestore aborts the commit", async () => {
    const { db, calls, state, docs } = fakeFirestore();
    state.abortCommits = 2;
    let runs = 0;
    await db.runTransaction(async (tx) => {
      runs += 1;
      tx.set("orders/a", { runs });
    });
    expect(runs).toBe(3);
    expect(docs.get("orders/a")).toEqual({ runs: 3 });
    const begins = calls.filter((call) => call.url.endsWith(":beginTransaction"));
    expect(begins.map((call) => call.body)).toEqual([
      { options: { readWrite: {} } },
      { options: { readWrite: { retryTransaction: "tx-1" } } },
      { options: { readWrite: { retryTransaction: "tx-2" } } }
    ]);
  });

  it("stops after 5 attempts", async () => {
    const { db, state, docs } = fakeFirestore();
    state.abortCommits = 99;
    let runs = 0;
    await expect(
      db.runTransaction(async (tx) => {
        runs += 1;
        tx.set("orders/a", {});
      })
    ).rejects.toThrow(ContentionError);
    expect(runs).toBe(5);
    expect(docs.has("orders/a")).toBe(false);
  });

  it("rolls back and writes nothing when the work throws", async () => {
    const { db, calls, docs } = fakeFirestore();
    await expect(
      db.runTransaction(async (tx) => {
        tx.set("orders/a", {});
        throw new Error("stop");
      })
    ).rejects.toThrow("stop");
    expect(calls.at(-1)?.url).toMatch(/:rollback$/);
    expect(calls.at(-1)?.body).toEqual({ transaction: "tx-1" });
    expect(docs.size).toBe(0);
  });

  it("updates fields of a document that exists, and deletes", async () => {
    const { db, calls, docs, base } = fakeFirestore({ "settings/orderingPrivate": { startAddress: "1 Start St" } });
    await db.update("settings/orderingPrivate", { startLat: 39.5, startLng: -105 });
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].url).toBe(
      `${base}/settings/orderingPrivate?currentDocument.exists=true&updateMask.fieldPaths=startLat&updateMask.fieldPaths=startLng`
    );
    expect(docs.get("settings/orderingPrivate")).toEqual({ startAddress: "1 Start St", startLat: 39.5, startLng: -105 });
    await expect(db.update("settings/none", { a: 1 })).rejects.toThrow("404");
    await db.delete("settings/orderingPrivate");
    expect(calls.at(-1)?.method).toBe("DELETE");
    expect(docs.has("settings/orderingPrivate")).toBe(false);
  });
});

describe("order validation", () => {
  it("keeps only the fields that the Worker accepts", () => {
    const input = validateCreateOrder(liveBody({ state: "handed_over", totals: { totalCents: 1 } }));
    expect(Object.keys(input).sort()).toEqual(
      [
        "kind",
        "source",
        "eventId",
        "kioskToken",
        "items",
        "customer",
        "fulfillment",
        "deliveryAddress",
        "requested",
        "paymentMethod",
        "customerNote"
      ].sort()
    );
    expect(input.items).toEqual([{ itemId: "red", variantId: "single", quantity: 3 }]);
    expect(input.customer.email).toBe("jane@example.com");
  });

  it("requires first name, last name and email. The phone is optional.", () => {
    expect(() => validateCreateOrder(liveBody({ customer: { ...customer, firstName: " " } }))).toThrow(
      "Enter your first name."
    );
    expect(() => validateCreateOrder(liveBody({ customer: { ...customer, lastName: "" } }))).toThrow(
      "Enter your last name."
    );
    expect(() => validateCreateOrder(liveBody({ customer: { ...customer, email: "jane" } }))).toThrow(
      "Enter a valid email address."
    );
    expect(() => validateCreateOrder(liveBody({ customer: { ...customer, phone: "12" } }))).toThrow(
      "Enter a valid phone number."
    );
    expect(validateCreateOrder(liveBody({ customer: { ...customer, phone: "720-360-8688" } })).customer.phone).toBe(
      "720-360-8688"
    );
  });

  it("checks the kind, the source and the items", () => {
    expect(() => validateCreateOrder(liveBody({ kind: "pos" }))).toThrow("not valid");
    expect(() => validateCreateOrder(liveBody({ source: "web" }))).toThrow("not valid");
    expect(() => validateCreateOrder(batchBody({ source: "mobile" }))).toThrow("not valid");
    expect(() => validateCreateOrder(liveBody({ eventId: "a/b" }))).toThrow("not valid");
    expect(() => validateCreateOrder(liveBody({ items: [] }))).toThrow("Select 1 menu item or more.");
    expect(() => validateCreateOrder(liveBody({ items: [{ itemId: "red", variantId: "single", quantity: 0 }] }))).toThrow(
      "Select 1 menu item or more."
    );
    expect(() => validateCreateOrder(liveBody({ items: [{ itemId: "red", variantId: "single", quantity: 1.5 }] }))).toThrow(
      "Enter a valid quantity."
    );
    expect(() => validateCreateOrder(liveBody({ customerNote: "x".repeat(501) }))).toThrow("500");
  });

  it("live: requires a payment method of paypal, venmo, cashapp or cash", () => {
    for (const paymentMethod of ["paypal", "venmo", "cashapp", "cash"]) {
      expect(validateCreateOrder(liveBody({ paymentMethod })).paymentMethod).toBe(paymentMethod);
    }
    for (const paymentMethod of ["zelle", "unset", "", undefined]) {
      expect(() => validateCreateOrder(liveBody({ paymentMethod }))).toThrow("Select a payment method.");
    }
    expect(validateCreateOrder(liveBody({ fulfillment: "delivery" })).fulfillment).toBe("event_pickup");
  });

  it("kiosk: requires the event and the kiosk token", () => {
    expect(() => validateCreateOrder(liveBody({ source: "kiosk" }))).toThrow("Enter your kiosk link.");
    expect(validateCreateOrder(liveBody({ source: "kiosk", kioskToken: "kiosk-secret" })).kioskToken).toBe("kiosk-secret");
    expect(() => validateCreateOrder(batchBody({ source: "kiosk", kioskToken: "k" }))).toThrow("not valid"); // no event id
  });

  it("pre-order: sets the payment method to unset and the fulfillment to event pickup", () => {
    const input = validateCreateOrder(preorderBody({ paymentMethod: "cash", fulfillment: "delivery", requested: { date: "x" } }));
    expect(input).toMatchObject({ paymentMethod: "unset", fulfillment: "event_pickup", requested: null, eventId: "ev1" });
  });

  it("batch: requires pickup or delivery, a date, and an address for delivery", () => {
    expect(validateCreateOrder(batchBody())).toMatchObject({
      eventId: "",
      fulfillment: "pickup",
      requested: { date: "2026-11-20", timeRange: "5 PM to 7 PM" }
    });
    expect(() => validateCreateOrder(batchBody({ fulfillment: "event_pickup" }))).toThrow("Select pickup or delivery.");
    expect(() => validateCreateOrder(batchBody({ requested: null }))).toThrow("Select a date.");
    expect(() => validateCreateOrder(batchBody({ requested: { date: "Nov 20", timeRange: "" } }))).toThrow("Select a date.");
    expect(() => validateCreateOrder(batchBody({ fulfillment: "delivery" }))).toThrow("Enter your delivery address.");
    expect(() =>
      validateCreateOrder(batchBody({ fulfillment: "delivery", deliveryAddress: "x".repeat(201) }))
    ).toThrow("200");
  });
});

describe("live order", () => {
  it("saves the order as received with check payment, a day number and a tracker", async () => {
    const store = setup();
    const result = await createOrderV1(liveBody(), store.deps, LIVE_TIME);
    expect(result).toEqual({
      trackerToken: expect.stringMatching(/^[0-9a-f]{48}$/),
      orderNumber: "#1 - Nov 14 - Jane Doe",
      state: "received"
    });
    const order = orderOf(store, result.orderNumber);
    expect(order).toMatchObject({
      kind: "live",
      source: "mobile",
      state: "received",
      paymentState: "check_payment",
      paymentMethod: "venmo",
      sequence: 1,
      paymentDescription: "#1 - Nov 14 - Jane Doe",
      eventId: "ev1",
      eventName: "Winter Market",
      fulfillment: "event_pickup",
      tamaleCount: 3,
      totals: { subtotalCents: 1200, deliveryFeeCents: 0, onlineFeeCents: 0, taxCents: 104, totalCents: 1304 },
      delivery: null,
      requested: null
    });
    expect(order.items[0].unitPriceCents).toBe(400); // not the price from the browser
    expect(store.docs.get(`orders/${order.id}`)).toBeDefined();
    // The counter uses the date in the business time zone, not the UTC date.
    expect(store.docs.get("counters/live-ev1-2026-11-14")).toMatchObject({ next: 2 });
    expect(store.docs.get(`trackers/${result.trackerToken}`)).toMatchObject({ state: "received", firstName: "Jane" });
    expect(store.docs.has("counters/orders")).toBe(false);

    const second = await createOrderV1(liveBody({ paymentMethod: "cash" }), store.deps, LIVE_TIME);
    expect(second.orderNumber).toBe("#2 - Nov 14 - Jane Doe");

    await store.done();
    expect(store.sent).toHaveLength(2); // 1 customer email for each order, no owner alert
    expect(store.sent[0].to).toEqual(["jane@example.com"]);
    expect(store.sent[0].subject).toBe("We received your order: #1 - Nov 14 - Jane Doe");
    expect(store.sent[0].html).toContain(`href="https://bustostamales.com/t/${result.trackerToken}"`);
    expect(store.sent[0].html).not.toContain("500 Market St");
  });

  it("refuses an order outside event hours, a paused event, and an event that is not found", async () => {
    const store = setup({ "events/paused": { ...event, liveOrdersPaused: true } });
    await expect(createOrderV1(liveBody(), store.deps, TODAY)).rejects.toThrow("does not take orders now");
    await expect(createOrderV1(liveBody({ eventId: "paused" }), store.deps, LIVE_TIME)).rejects.toThrow(
      "does not take orders now"
    );
    await expect(createOrderV1(liveBody({ eventId: "none" }), store.deps, LIVE_TIME)).rejects.toThrow(
      "does not take orders now"
    );
    expect(store.all("orders")).toHaveLength(0);
  });

  it("refuses a sold out item and an item that the event does not sell", async () => {
    const store = setup();
    const green = [{ itemId: "green", variantId: "single", quantity: 1 }];
    await expect(createOrderV1(liveBody({ items: green }), store.deps, LIVE_TIME)).rejects.toThrow(
      "Green Tamales is sold out."
    );
    await expect(createOrderV1(liveBody({ eventId: "evRedOnly", items: green }), store.deps, LIVE_TIME)).rejects.toThrow(
      "Green Tamales is not for sale at this event."
    );
  });

  it("checks the kiosk token", async () => {
    const store = setup({ "events/noToken": { ...event, kioskToken: "" } });
    const kiosk = (over: Record<string, unknown>) => liveBody({ source: "kiosk", ...over });
    await expect(createOrderV1(kiosk({ kioskToken: "wrong" }), store.deps, LIVE_TIME)).rejects.toMatchObject({
      status: 403,
      message: "The kiosk link is not valid."
    });
    await expect(
      createOrderV1(kiosk({ eventId: "noToken", kioskToken: "x" }), store.deps, LIVE_TIME)
    ).rejects.toMatchObject({ status: 403 });
    expect(store.all("orders")).toHaveLength(0);
    const result = await createOrderV1(kiosk({ kioskToken: "kiosk-secret" }), store.deps, LIVE_TIME);
    expect(orderOf(store, result.orderNumber)).toMatchObject({ source: "kiosk", kind: "live", state: "received" });
  });
});

describe("pre-order", () => {
  it("open interest: saves a requested order with a running number and alerts the owner", async () => {
    const store = setup();
    const result = await createOrderV1(preorderBody(), store.deps, EARLY);
    expect(result).toMatchObject({ orderNumber: "BBT-1001", state: "requested" });
    expect(orderOf(store, "BBT-1001")).toMatchObject({
      kind: "preorder",
      state: "requested",
      paymentState: "unpaid",
      paymentMethod: "paypal",
      sequence: 1001,
      paymentDescription: "BBT-1001 Jane Doe",
      tamaleCount: 12,
      totals: { subtotalCents: 3400, taxCents: 296, totalCents: 3696 }
    });
    expect(store.docs.get("counters/orders")).toMatchObject({ next: 1002 });
    expect(store.docs.has("eventStock/ev1")).toBe(false);
    expect((await createOrderV1(preorderBody(), store.deps, EARLY)).orderNumber).toBe("BBT-1002");

    await store.done();
    const subjects = store.sent.map((message) => message.subject);
    expect(subjects).toContain("We received your order: BBT-1001");
    expect(subjects).toContain("New order to approve: BBT-1001");
    const alert = store.sent.find((message) => message.subject === "New order to approve: BBT-1001");
    expect(alert?.to).toEqual([cfg.ownerEmail]);
    expect(alert?.reply_to).toBe("jane@example.com");
    expect(alert?.html).toContain('href="https://bustostamales.com/admin/preorders"');
    const received = store.sent.find((message) => message.subject === "We received your order: BBT-1001");
    expect(received?.html).toContain("Quantity: 12 (1 dozen)");
    expect(received?.html).toContain("Subtotal");
    expect(received?.html).not.toContain("Online ordering fee");
    expect(received?.html).not.toContain("Delivery fee");
  });

  it("refuses a pre-order at the cutoff and for an event with pre-orders off", async () => {
    const store = setup({ "events/off": { ...event, preorderMode: "off" } });
    await expect(
      createOrderV1(preorderBody(), store.deps, new Date("2026-11-13T00:00:00.000Z"))
    ).rejects.toThrow("does not take pre-orders now");
    await expect(createOrderV1(preorderBody({ eventId: "off" }), store.deps, EARLY)).rejects.toThrow(
      "does not take pre-orders now"
    );
  });

  describe("fixed allotment", () => {
    const fixed = (itemId: string, variantId: string, quantity: number) =>
      preorderBody({ eventId: "evFixed", items: [{ itemId, variantId, quantity }] });

    it("accepts the order when enough tamales remain, and decreases the stock", async () => {
      const store = setup();
      const result = await createOrderV1(fixed("red", "red-dozen", 1), store.deps, EARLY);
      // The order waits for the payment. money.test.ts tests the hold.
      expect(result).toMatchObject({ orderNumber: "BBT-1001", state: "approved" });
      expect(orderOf(store, "BBT-1001")).toMatchObject({ state: "approved", paymentState: "unpaid" });
      expect(store.docs.get("eventStock/evFixed")).toMatchObject({ remaining: { red: 12, green: 6 } });
      await store.done();
      expect(store.sent.map((message) => message.subject)).toEqual(["We received your order: BBT-1001"]);
    });

    it("writes the counter, the stock, the order and the tracker in 1 commit", async () => {
      const store = setup();
      await createOrderV1(fixed("red", "red-dozen", 1), store.deps, EARLY);
      const commits = store.calls.filter((call) => call.url.endsWith(":commit"));
      expect(commits).toHaveLength(1);
      const names = (commits[0].body as { writes: Array<{ update: { name: string } }> }).writes.map((write) =>
        write.update.name.slice(store.root.length + 1).split("/")[0]
      );
      expect(names.sort()).toEqual(["counters", "eventStock", "orders", "trackers"]);
      const reads = store.calls.filter((call) => call.url.includes("transaction=tx-1")).map((call) => call.url);
      expect(reads).toEqual([
        `${store.base}/counters/orders?transaction=tx-1`,
        `${store.base}/eventStock/evFixed?transaction=tx-1`
      ]);
    });

    it("accepts an order for exactly the tamales that remain", async () => {
      const store = setup();
      await createOrderV1(fixed("red", "red-dozen", 2), store.deps, EARLY);
      expect(store.docs.get("eventStock/evFixed")).toMatchObject({ remaining: { red: 0, green: 6 } });
    });

    it("refuses an order for more tamales than remain, and saves nothing", async () => {
      const store = setup();
      await expect(createOrderV1(fixed("red", "red-dozen", 3), store.deps, EARLY)).rejects.toMatchObject({
        status: 409,
        message: "Red Tamales: only 24 (2 dozen) left. Decrease the quantity."
      });
      expect(store.all("orders")).toHaveLength(0);
      expect(store.all("trackers")).toHaveLength(0);
      expect(store.docs.has("counters/orders")).toBe(false);
      expect(store.docs.has("eventStock/evFixed")).toBe(false);
    });

    it("gives the last tamales to the first of 2 orders in sequence", async () => {
      const store = setup({ "eventStock/evFixed": { remaining: { red: 18, green: 6 }, updatedAtUtc: "" } });
      const first = await createOrderV1(fixed("red", "red-dozen", 1), store.deps, EARLY);
      expect(first.orderNumber).toBe("BBT-1001");
      await expect(createOrderV1(fixed("red", "red-dozen", 1), store.deps, EARLY)).rejects.toThrow(
        "Red Tamales: only 6 (half dozen) left."
      );
      const third = await createOrderV1(fixed("red", "red-half", 1), store.deps, EARLY);
      expect(third.orderNumber).toBe("BBT-1002"); // the refused order took no number
      await expect(createOrderV1(fixed("red", "single", 1), store.deps, EARLY)).rejects.toMatchObject({
        status: 409,
        message: "Red Tamales is sold out."
      });
      expect(store.docs.get("eventStock/evFixed")).toMatchObject({ remaining: { red: 0, green: 6 } });
      expect(store.all("orders")).toHaveLength(2);
    });

    it("still decreases the stock 1 time when Firestore aborts the first commit", async () => {
      const store = setup();
      store.state.abortCommits = 1;
      await createOrderV1(fixed("red", "red-dozen", 1), store.deps, EARLY);
      expect(store.docs.get("eventStock/evFixed")).toMatchObject({ remaining: { red: 12, green: 6 } });
      expect(store.all("orders")).toHaveLength(1);
    });

    it("counts stock in tamales for each item", () => {
      const lines = [
        { itemId: "red", itemName: "Red Tamales", unitTamales: 6, quantity: 2 },
        { itemId: "red", itemName: "Red Tamales", unitTamales: 1, quantity: 3 }
      ] as OrderRecord["items"];
      expect(takeStock({ red: 15, green: 2 }, lines)).toEqual({ red: 0, green: 2 });
      expect(() => takeStock({ red: 14 }, lines)).toThrow("only 14 tamales left");
      expect(() => takeStock({ green: 50 }, lines)).toThrow("Red Tamales is sold out.");
      expect(returnStock({ red: 0 }, lines)).toEqual({ red: 15 });
    });
  });
});

describe("batch request", () => {
  it("saves a requested order for pickup with no event", async () => {
    const store = setup();
    const result = await createOrderV1(batchBody({ customerNote: "For a party." }), store.deps, TODAY);
    expect(result).toMatchObject({ orderNumber: "BBT-1001", state: "requested" });
    expect(orderOf(store, "BBT-1001")).toMatchObject({
      kind: "batch",
      eventId: "",
      eventName: "",
      fulfillment: "pickup",
      delivery: null,
      requested: { date: "2026-11-20", timeRange: "5 PM to 7 PM" },
      tamaleCount: 24,
      customerNote: "For a party.",
      ownerNote: ""
    });
    await store.done();
    expect(store.sent).toHaveLength(2);
    expect(store.sent.map((message) => message.html).join("")).not.toContain("9 Secret Rd");
  });

  it("enforces the settings: fulfillment switches, smallest batch, notice days", async () => {
    const off = setup({ "settings/ordering": { ...seed["settings/ordering"], pickupEnabled: false, deliveryEnabled: false } });
    await expect(createOrderV1(batchBody(), off.deps, TODAY)).rejects.toThrow("Pickup is not available now.");
    await expect(
      createOrderV1(batchBody({ fulfillment: "delivery", deliveryAddress: "near address" }), off.deps, TODAY)
    ).rejects.toThrow("Delivery is not available now.");

    const store = setup();
    const small = [{ itemId: "red", variantId: "red-half", quantity: 1 }];
    await expect(createOrderV1(batchBody({ items: small }), store.deps, TODAY)).rejects.toThrow(
      "A batch request needs 12 (1 dozen) or more."
    );
    // Today is Nov 13 in Denver. 3 days of notice makes Nov 16 the first date.
    await expect(
      createOrderV1(batchBody({ requested: { date: "2026-11-15", timeRange: "" } }), store.deps, TODAY)
    ).rejects.toThrow("Select a date that is 3 days or more from today.");
    const ok = await createOrderV1(batchBody({ requested: { date: "2026-11-16", timeRange: "" } }), store.deps, TODAY);
    expect(ok.state).toBe("requested");
  });

  it("delivery: computes the ring fee and saves the address on the order only", async () => {
    const store = setup();
    const body = batchBody({ fulfillment: "delivery", deliveryAddress: "ring 2 address" });
    const result = await createOrderV1(body, store.deps, TODAY);
    const order = orderOf(store, result.orderNumber);
    expect(order.delivery).toEqual({ address: "ring 2 address", distanceMiles: 6.91, feeStatus: "computed" });
    expect(order.totals).toEqual({
      subtotalCents: 6800,
      deliveryFeeCents: 1000,
      onlineFeeCents: 0,
      taxCents: 592,
      totalCents: 8392
    });
    expect(JSON.stringify(store.docs.get(`trackers/${result.trackerToken}`))).not.toContain("ring 2 address");
    await store.done();
    expect(store.sent[0].html).toContain("Delivery fee");
    expect(store.sent[0].html).toContain("$10.00");
  });

  it("delivery: refuses an address outside the rings", async () => {
    const store = setup();
    const body = batchBody({ fulfillment: "delivery", deliveryAddress: "far address" });
    await expect(createOrderV1(body, store.deps, TODAY)).rejects.toMatchObject({
      status: 400,
      message: "This address is outside our delivery area."
    });
    expect(store.all("orders")).toHaveLength(0);
  });

  it("delivery: saves 'fee to be set' for an address that is not found", async () => {
    const store = setup();
    const body = batchBody({ fulfillment: "delivery", deliveryAddress: "nowhere" });
    const result = await createOrderV1(body, store.deps, TODAY);
    const order = orderOf(store, result.orderNumber);
    expect(order.delivery).toEqual({ address: "nowhere", distanceMiles: null, feeStatus: "to_be_set" });
    expect(order.totals.deliveryFeeCents).toBe(0);
    await store.done();
    expect(store.sent[0].html).toContain("We set it at approval");
  });

  it("kiosk: checks the token, saves no event id, and puts the event name in the owner note", async () => {
    const store = setup();
    const kiosk = (kioskToken: string) =>
      batchBody({ source: "kiosk", eventId: "ev1", kioskToken, requested: null });
    await expect(createOrderV1(kiosk("wrong"), store.deps, TODAY)).rejects.toMatchObject({ status: 403 });
    const result = await createOrderV1(kiosk("kiosk-secret"), store.deps, TODAY);
    expect(orderOf(store, result.orderNumber)).toMatchObject({
      kind: "batch",
      source: "kiosk",
      eventId: "",
      eventName: "",
      ownerNote: "Kiosk: Winter Market",
      requested: null,
      state: "requested"
    });
  });
});

describe("customer record and email list", () => {
  it("creates the customer and links the order", async () => {
    const store = setup();
    await createOrderV1(liveBody(), store.deps, LIVE_TIME);
    const [person] = store.all("customers");
    expect(person).toMatchObject({ email: "jane@example.com", firstName: "Jane", lastName: "Doe", marketingOptIn: false });
    expect(orderOf(store, "#1 - Nov 14 - Jane Doe").customerId).toMatch(/^[0-9a-f]{64}$/);
    expect(store.all("marketingSignups")).toHaveLength(0);
  });

  it("adds the email list entry with the opt-in", async () => {
    const store = setup();
    await createOrderV1(liveBody({ customer: { ...customer, marketingOptIn: true } }), store.deps, LIVE_TIME);
    expect(store.all("customers")[0]).toMatchObject({ marketingOptIn: true });
    expect(store.all("marketingSignups")).toEqual([
      { email: "jane@example.com", source: "order", createdAtUtc: LIVE_TIME.toISOString() }
    ]);
  });
});

describe("tracker", () => {
  it("holds no email address, phone number or street address", async () => {
    const store = setup();
    const person = { ...customer, email: "private.person@example.com", phone: "720-360-8688" };
    const body = batchBody({
      customer: person,
      fulfillment: "delivery",
      deliveryAddress: "near address",
      customerNote: "Gate code 4471"
    });
    const result = await createOrderV1(body, store.deps, TODAY);
    const order = { ...orderOf(store, result.orderNumber), ownerNote: "Owner secret" };
    const tracker = toTracker(order);
    expect(Object.keys(tracker).sort()).toEqual(
      [
        "orderNumber",
        "kind",
        "state",
        "paymentState",
        "paymentMethod",
        "paymentDescription",
        "firstName",
        "eventName",
        "fulfillment",
        "items",
        "totals",
        "reason",
        "scheduledAtUtc",
        "updatedAtUtc",
        "payByUtc",
        "refundedCents"
      ].sort()
    );
    const text = JSON.stringify(tracker);
    for (const secret of ["private.person", "example.com", "720-360-8688", "near address", "Gate code", "Owner secret", order.customerId]) {
      expect(text).not.toContain(secret);
    }
    expect(tracker.items).toEqual([{ label: "Red Tamales, Dozen", quantity: 2 }]);
    expect(JSON.stringify(store.docs.get(`trackers/${result.trackerToken}`))).toBe(JSON.stringify(toTracker(orderOf(store, result.orderNumber))));
  });

  it("makes a token with 128 bits or more", () => {
    expect(newTrackerToken()).toMatch(/^[0-9a-f]{48}$/);
    expect(newTrackerToken()).not.toBe(newTrackerToken());
  });
});

describe("delivery quote", () => {
  it("returns the fee of the ring and saves the start point 1 time", async () => {
    const store = setup();
    expect(await quoteDelivery("near address", store.deps)).toEqual({ status: "ok", feeCents: 500, distanceMiles: 3.45 });
    expect(store.docs.get("settings/orderingPrivate")).toMatchObject({ startLat: 39, startLng: -105, startAddress: "1 Start St" });
    expect(await quoteDelivery("ring 2 address", store.deps)).toMatchObject({ status: "ok", feeCents: 1000 });
    expect(store.geocodeCalls).toEqual(["1 Start St", "near address", "ring 2 address"]);
    expect(store.all("orders")).toHaveLength(0);
  });

  it("returns outside for an address beyond the last ring", async () => {
    const store = setup();
    expect(await quoteDelivery("far address", store.deps)).toEqual({ status: "outside", feeCents: 0, distanceMiles: 69.09 });
  });

  it("returns not_found when the geocoder has no match or fails", async () => {
    const store = setup();
    expect(await quoteDelivery("nowhere", store.deps)).toEqual({ status: "not_found", feeCents: 0, distanceMiles: null });
    const failing: Geocoder = async (address) => {
      if (address === "1 Start St") return points[address];
      throw new Error("down");
    };
    expect(await quoteDelivery("near address", { db: store.db, geocode: failing })).toMatchObject({ status: "not_found" });
  });

  it("answers 400 when delivery is off, has no rings, or has no start address", async () => {
    const ordering = seed["settings/ordering"];
    const cases: Record<string, Record<string, unknown>>[] = [
      { "settings/ordering": { ...ordering, deliveryEnabled: false } },
      { "settings/ordering": { ...ordering, deliveryRings: [] } },
      { "settings/orderingPrivate": { startAddress: "", startLat: null, startLng: null } },
      { "settings/orderingPrivate": { startAddress: "an address the geocoder cannot find", startLat: null, startLng: null } }
    ];
    for (const extra of cases) {
      const store = setup(extra);
      await expect(quoteDelivery("near address", store.deps)).rejects.toMatchObject({
        status: 400,
        message: "Delivery is not available now."
      });
    }
    const none = fakeFirestore();
    await expect(quoteDelivery("near address", { db: none.db, geocode: async () => null })).rejects.toMatchObject({ status: 400 });
    expect(readOrdering(null).deliveryEnabled).toBe(false);
  });

  it("limits the address to 200 characters", () => {
    expect(validateQuote({ address: "  1 Main St  " })).toBe("1 Main St");
    expect(() => validateQuote({ address: "x".repeat(201) })).toThrow("200");
    expect(() => validateQuote({})).toThrow("Enter your delivery address.");
  });

  it("reads the first match of the Census geocoder", async () => {
    const urls: string[] = [];
    const answer = (body: unknown) =>
      (async (url: string) => {
        urls.push(url);
        return Response.json(body);
      }) as unknown as typeof fetch;
    const match = { result: { addressMatches: [{ coordinates: { x: -105.1, y: 39.9 } }, { coordinates: { x: 1, y: 2 } }] } };
    expect(await censusGeocode("1 Main St, Denver, CO", answer(match))).toEqual({ lat: 39.9, lng: -105.1 });
    expect(urls[0]).toBe(
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=1+Main+St%2C+Denver%2C+CO&benchmark=Public_AR_Current&format=json"
    );
    expect(await censusGeocode("x", answer({ result: { addressMatches: [] } }))).toBeNull();
    const down = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    await expect(censusGeocode("x", down)).rejects.toThrow("500");
  });
});

describe("waitlist", () => {
  const body = { firstName: "Jane", lastName: "Doe", email: "Jane@Example.com", interest: "Red, 2 dozen", eventId: "ev1", marketingOptIn: false };

  it("saves the entry with the event name", async () => {
    const store = setup();
    const entry = await joinWaitlist(body, store.db, TODAY);
    expect(store.docs.get(`waitlist/${entry.id}`)).toEqual({
      id: entry.id,
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@example.com",
      interest: "Red, 2 dozen",
      eventId: "ev1",
      eventName: "Winter Market",
      createdAtUtc: TODAY.toISOString()
    });
    expect(store.all("customers")).toHaveLength(0);
    expect(store.all("marketingSignups")).toHaveLength(0);
  });

  it("adds the customer and the email list entry with the opt-in", async () => {
    const store = setup();
    const entry = await joinWaitlist({ ...body, eventId: "", marketingOptIn: true }, store.db, TODAY);
    expect(entry).toMatchObject({ eventId: "", eventName: "" });
    expect(store.all("customers")[0]).toMatchObject({ email: "jane@example.com", marketingOptIn: true });
    expect(store.all("marketingSignups")[0]).toMatchObject({ email: "jane@example.com", source: "waitlist" });
  });

  it("rejects a missing name or a bad email address", async () => {
    const store = setup();
    await expect(joinWaitlist({ ...body, firstName: "" }, store.db)).rejects.toThrow("Enter your first name.");
    await expect(joinWaitlist({ ...body, email: "x" }, store.db)).rejects.toThrow("Enter a valid email address.");
    expect(store.all("waitlist")).toHaveLength(0);
  });
});

describe("owner order action", () => {
  const API = "https://bbt-api.example.workers.dev";
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    new Request(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://bustostamales.com", ...headers },
      body: JSON.stringify(body)
    });

  it("answers 401 with no owner token", async () => {
    const body = { orderId: "a", action: "approve" };
    const none = await handleRequest(post("/api/admin/orders/action", body), {}, () => undefined);
    expect(none.status).toBe(401);
    expect(await none.json()).toMatchObject({ ok: false });
    const bad = await handleRequest(
      post("/api/admin/orders/action", body, { Authorization: "Bearer not-a-token" }),
      {},
      () => undefined
    );
    expect(bad.status).toBe(401);
  });

  it("validates the action", () => {
    expect(validateOrderAction({ orderId: "a", action: "approve", deliveryFeeCents: 500, scheduledAtUtc: "2026-11-20T17:00:00-07:00" })).toEqual({
      orderId: "a",
      action: "approve",
      deliveryFeeCents: 500,
      scheduledAtUtc: "2026-11-21T00:00:00.000Z"
    });
    expect(() => validateOrderAction({ orderId: "a", action: "refund" })).toThrow("not valid");
    expect(() => validateOrderAction({ orderId: "a/b", action: "approve" })).toThrow("not valid");
    expect(() => validateOrderAction({ orderId: "a", action: "approve", deliveryFeeCents: -1 })).toThrow("delivery fee");
    expect(() => validateOrderAction({ orderId: "a", action: "approve", scheduledAtUtc: "soon" })).toThrow("date and time");
  });

  it("answers 404 for an order that is not found and 409 for the wrong state", async () => {
    const store = setup();
    await expect(runOrderAction({ orderId: "none", action: "approve" }, store.deps)).rejects.toMatchObject({ status: 404 });
    const created = await createOrderV1(liveBody(), store.deps, LIVE_TIME);
    const order = orderOf(store, created.orderNumber);
    for (const action of ["approve", "decline", "mark_unpaid_x"]) {
      const attempt = runOrderAction({ orderId: order.id, action }, store.deps);
      await expect(attempt).rejects.toMatchObject({ status: action === "mark_unpaid_x" ? 400 : 409 });
    }
    await runOrderAction({ orderId: order.id, action: "mark_paid" }, store.deps);
    await runOrderAction({ orderId: order.id, action: "hand_over" }, store.deps);
    await expect(runOrderAction({ orderId: order.id, action: "cancel" }, store.deps)).rejects.toMatchObject({
      status: 409,
      message: "This order cannot take this action now."
    });
    // An order of the old model has no kind.
    store.docs.set("orders/old", { status: "new", orderNumber: "BBT-2026-ABCDE" });
    await expect(runOrderAction({ orderId: "old", action: "cancel" }, store.deps)).rejects.toMatchObject({ status: 409 });
  });

  it("approves with a delivery fee, saves the order and the tracker, and sends the approved email", async () => {
    const store = setup();
    const created = await createOrderV1(
      batchBody({ fulfillment: "delivery", deliveryAddress: "nowhere" }),
      store.deps,
      TODAY
    );
    const id = orderOf(store, created.orderNumber).id;
    // The router answers 400 for an OrderError.
    await expect(runOrderAction({ orderId: id, action: "approve" }, store.deps, TODAY)).rejects.toThrow(
      "Set the delivery fee, then approve the order."
    );
    expect(store.docs.get(`orders/${id}`)).toMatchObject({ state: "requested" });
    await store.done();
    store.sent.length = 0;

    const { order } = await runOrderAction(
      { orderId: id, action: "approve", deliveryFeeCents: 1500, scheduledAtUtc: "2026-11-21T00:00:00.000Z", ownerNote: "Call first." },
      store.deps,
      TODAY
    );
    expect(order).toMatchObject({
      id,
      state: "approved",
      approvedAtUtc: TODAY.toISOString(),
      payByUtc: "2026-11-16T18:00:00.000Z",
      scheduledAtUtc: "2026-11-21T00:00:00.000Z",
      ownerNote: "Call first.",
      delivery: { address: "nowhere", distanceMiles: null, feeStatus: "owner_set" },
      totals: { subtotalCents: 6800, deliveryFeeCents: 1500, onlineFeeCents: 0, taxCents: 592, totalCents: 8892 }
    });
    expect(store.docs.get(`orders/${id}`)).toEqual(JSON.parse(JSON.stringify(order)));
    expect(store.docs.get(`trackers/${order.trackerToken}`)).toMatchObject({
      state: "approved",
      scheduledAtUtc: "2026-11-21T00:00:00.000Z",
      totals: { totalCents: 8892 }
    });
    await store.done();
    expect(store.sent).toHaveLength(1);
    const [message] = store.sent;
    expect(message.subject).toBe("We approved your order: BBT-1001");
    expect(message.text).not.toContain("We will send you a payment link.");
    expect(message.text).toContain("Pay by Mon, Nov 16, 11:00 AM MT to confirm it.");
    expect(message.html).toContain("Pay Now");
    expect(message.html).toContain(`href="https://bustostamales.com/t/${order.trackerToken}"`);
    expect(order.paymentMethod).toBe("paypal");
    expect(message.text).toContain("Total: $88.92");
    expect(message.text).toContain("Delivery fee: $15.00");
    expect(message.text).toContain("Date and time: Fri, Nov 20, 5:00 PM MT");
    expect(message.html).not.toContain("Call first.");
    expect(message.html).not.toContain("9 Secret Rd");
  });

  it("mark paid moves an approved order to received and sends the address in the receipt only", async () => {
    const store = setup();
    const created = await createOrderV1(preorderBody(), store.deps, EARLY);
    const id = orderOf(store, created.orderNumber).id;
    await runOrderAction({ orderId: id, action: "approve" }, store.deps, EARLY);
    await store.done();
    for (const message of store.sent) expect(message.html).not.toContain("500 Market St");
    store.sent.length = 0;

    const { order } = await runOrderAction({ orderId: id, action: "mark_paid" }, store.deps, EARLY);
    expect(order).toMatchObject({ state: "received", paymentState: "paid" });
    expect(store.docs.get(`trackers/${order.trackerToken}`)).toMatchObject({ state: "received", paymentState: "paid" });
    expect(JSON.stringify(store.docs.get(`trackers/${order.trackerToken}`))).not.toContain("500 Market St");
    await store.done();
    expect(store.sent).toHaveLength(1);
    expect(store.sent[0].subject).toBe("We received your payment: BBT-1001");
    expect(store.sent[0].html).toContain("500 Market St, Westminster");
    expect(store.sent[0].html).toContain("Booth 4.");
    expect(store.sent[0].text).toContain("Pickup time: Sat, Nov 14, 5:00 PM - 8:00 PM MT");
  });

  it("mark paid for a batch pickup sends the pickup address from the private settings", async () => {
    const store = setup();
    const created = await createOrderV1(batchBody(), store.deps, TODAY);
    const id = orderOf(store, created.orderNumber).id;
    await runOrderAction({ orderId: id, action: "approve" }, store.deps, TODAY);
    await store.done();
    store.sent.length = 0;
    await runOrderAction({ orderId: id, action: "mark_paid" }, store.deps, TODAY);
    await store.done();
    expect(store.sent[0].html).toContain("9 Secret Rd, Westminster");
    expect(store.sent[0].html).toContain("Ring the bell.");
  });

  it("sends the ready email with the tracker button, and no email for prepare, hand over and mark unpaid", async () => {
    const store = setup();
    const created = await createOrderV1(liveBody(), store.deps, LIVE_TIME);
    const id = orderOf(store, created.orderNumber).id;
    await store.done();
    store.sent.length = 0;
    await runOrderAction({ orderId: id, action: "prepare" }, store.deps);
    await runOrderAction({ orderId: id, action: "mark_unpaid" }, store.deps);
    await store.done();
    expect(store.sent).toHaveLength(0);
    const { order } = await runOrderAction({ orderId: id, action: "ready" }, store.deps);
    await store.done();
    expect(store.sent).toHaveLength(1);
    expect(store.sent[0].subject).toBe("Your order is ready: #1 - Nov 14 - Jane Doe");
    expect(store.sent[0].html).toContain(`href="https://bustostamales.com/t/${created.trackerToken}"`);
    expect(store.sent[0].html).toContain("Open Order Tracker");
    expect(order.paymentState).toBe("unpaid");
    await expect(runOrderAction({ orderId: id, action: "hand_over" }, store.deps)).rejects.toThrow(
      "Mark the order as paid first."
    );
    await runOrderAction({ orderId: id, action: "mark_paid" }, store.deps);
    await store.done();
    store.sent.length = 0;
    await runOrderAction({ orderId: id, action: "hand_over" }, store.deps);
    await store.done();
    expect(store.sent).toHaveLength(0);
    expect(store.docs.get(`trackers/${created.trackerToken}`)).toMatchObject({ state: "handed_over" });
  });

  it("declines with the reason", async () => {
    const store = setup();
    const created = await createOrderV1(preorderBody(), store.deps, EARLY);
    const id = orderOf(store, created.orderNumber).id;
    await store.done();
    store.sent.length = 0;
    const { order } = await runOrderAction({ orderId: id, action: "decline", reason: "We have no time on this date." }, store.deps);
    expect(order).toMatchObject({ state: "declined", reason: "We have no time on this date." });
    expect(store.docs.get(`trackers/${order.trackerToken}`)).toMatchObject({ state: "declined", reason: "We have no time on this date." });
    expect(store.docs.has("eventStock/ev1")).toBe(false); // an open-interest pre-order holds no stock
    await store.done();
    expect(store.sent[0].subject).toBe("We declined your order: BBT-1001");
    expect(store.sent[0].html).toContain("We have no time on this date.");
  });

  it("cancel returns the tamales of a fixed-allotment pre-order to the event stock", async () => {
    const store = setup();
    const body = preorderBody({ eventId: "evFixed", items: [{ itemId: "red", variantId: "red-dozen", quantity: 1 }, { itemId: "green", variantId: "single", quantity: 4 }] });
    const created = await createOrderV1(body, store.deps, EARLY);
    expect(store.docs.get("eventStock/evFixed")).toMatchObject({ remaining: { red: 12, green: 2 } });
    const id = orderOf(store, created.orderNumber).id;
    await store.done();
    store.sent.length = 0;

    const { order } = await runOrderAction({ orderId: id, action: "cancel", reason: "The event is off." }, store.deps, TODAY);
    expect(order.state).toBe("canceled");
    expect(store.docs.get("eventStock/evFixed")).toEqual({ remaining: { red: 24, green: 6 }, updatedAtUtc: TODAY.toISOString() });
    await store.done();
    expect(store.sent[0].subject).toBe("We canceled your order: BBT-1001");
    expect(store.sent[0].html).toContain("The event is off.");
    // A second cancel is refused, so the stock does not return 2 times.
    await expect(runOrderAction({ orderId: id, action: "cancel" }, store.deps)).rejects.toMatchObject({ status: 409 });
    expect(store.docs.get("eventStock/evFixed")).toMatchObject({ remaining: { red: 24, green: 6 } });
  });

  it("cancel of a live order changes no stock", async () => {
    const store = setup();
    const created = await createOrderV1(liveBody(), store.deps, LIVE_TIME);
    await runOrderAction({ orderId: orderOf(store, created.orderNumber).id, action: "cancel" }, store.deps);
    expect(store.all("eventStock")).toHaveLength(0);
  });
});

describe("round 2: retry key, stock flag and owner note", () => {
  it("returns the first order for a second submit with the same retry key", async () => {
    const store = setup();
    const body = liveBody({ idempotencyKey: "4f9c2b1e-7d3a-4c55-9a10-1b2c3d4e5f60" });
    const first = await createOrderV1(body, store.deps, LIVE_TIME);
    const second = await createOrderV1(body, store.deps, LIVE_TIME);
    expect(second).toEqual(first);
    expect(store.all("orders")).toHaveLength(1);
    expect(store.docs.get("counters/live-ev1-2026-11-14")).toMatchObject({ next: 2 });
    await store.done();
    expect(store.sent).toHaveLength(1);

    const other = await createOrderV1(liveBody({ idempotencyKey: "a-second-key" }), store.deps, LIVE_TIME);
    expect(other.orderNumber).toBe("#2 - Nov 14 - Jane Doe");
    const noKey = await createOrderV1(liveBody(), store.deps, LIVE_TIME);
    expect(noKey.orderNumber).toBe("#3 - Nov 14 - Jane Doe");
    expect(store.all("orders")).toHaveLength(3);
  });

  it("does not find the order of a different customer with the same key", async () => {
    const store = setup();
    const first = await createOrderV1(liveBody({ idempotencyKey: "same-key" }), store.deps, LIVE_TIME);
    const other = await createOrderV1(
      liveBody({ idempotencyKey: "same-key", customer: { ...customer, email: "sam@example.com" } }),
      store.deps,
      LIVE_TIME
    );
    expect(other.trackerToken).not.toBe(first.trackerToken);
    expect(store.all("orders")).toHaveLength(2);
  });

  it("checks the retry key and leaves it out when absent", () => {
    expect(validateCreateOrder(liveBody({ idempotencyKey: "abc_DEF-123" })).idempotencyKey).toBe("abc_DEF-123");
    expect("idempotencyKey" in validateCreateOrder(liveBody())).toBe(false);
    expect("idempotencyKey" in validateCreateOrder(liveBody({ idempotencyKey: "" }))).toBe(false);
    for (const idempotencyKey of ["x".repeat(65), "a/b", "has space", 12]) {
      expect(() => validateCreateOrder(liveBody({ idempotencyKey }))).toThrow("not valid");
    }
  });

  it("does not take the fixed stock 2 times for a retry", async () => {
    const store = setup();
    const body = preorderBody({ eventId: "evFixed", idempotencyKey: "fixed-retry" });
    await createOrderV1(body, store.deps, EARLY);
    await createOrderV1(body, store.deps, EARLY);
    expect(store.docs.get("eventStock/evFixed")).toMatchObject({ remaining: { red: 12, green: 6 } });
  });

  it("sets stockHeld on a fixed-allotment pre-order only", async () => {
    const store = setup();
    const fixed = await createOrderV1(preorderBody({ eventId: "evFixed" }), store.deps, EARLY);
    const open = await createOrderV1(preorderBody(), store.deps, EARLY);
    const live = await createOrderV1(liveBody(), store.deps, LIVE_TIME);
    expect(orderOf(store, fixed.orderNumber).stockHeld).toBe(true);
    expect(orderOf(store, open.orderNumber).stockHeld).toBe(false);
    expect(orderOf(store, live.orderNumber).stockHeld).toBe(false);
  });

  it("an approved open-interest pre-order gives no stock back at cancel", async () => {
    const store = setup({ "eventStock/ev1": { remaining: { red: 5 }, updatedAtUtc: "" } });
    const created = await createOrderV1(preorderBody(), store.deps, EARLY);
    const id = orderOf(store, created.orderNumber).id;
    await runOrderAction({ orderId: id, action: "approve" }, store.deps, EARLY);
    await runOrderAction({ orderId: id, action: "mark_paid" }, store.deps, EARLY);
    await runOrderAction({ orderId: id, action: "cancel" }, store.deps, EARLY);
    expect(store.docs.get("eventStock/ev1")).toEqual({ remaining: { red: 5 }, updatedAtUtc: "" });
  });

  it("save note changes the owner note in a final state, writes no tracker and sends no email", async () => {
    const store = setup();
    const created = await createOrderV1(liveBody(), store.deps, LIVE_TIME);
    const id = orderOf(store, created.orderNumber).id;
    await runOrderAction({ orderId: id, action: "mark_paid" }, store.deps, LIVE_TIME);
    await runOrderAction({ orderId: id, action: "hand_over" }, store.deps, LIVE_TIME);
    await store.done();
    store.sent.length = 0;
    const trackerBefore = JSON.stringify(store.docs.get(`trackers/${created.trackerToken}`));

    const { order } = await runOrderAction({ orderId: id, action: "save_note", ownerNote: "Paid in cash." }, store.deps, TODAY);
    expect(order).toMatchObject({ state: "handed_over", ownerNote: "Paid in cash." });
    expect(store.docs.get(`orders/${id}`)).toMatchObject({ state: "handed_over", ownerNote: "Paid in cash." });
    expect(JSON.stringify(store.docs.get(`trackers/${created.trackerToken}`))).toBe(trackerBefore);
    await store.done();
    expect(store.sent).toHaveLength(0);
    expect(validateOrderAction({ orderId: "a", action: "save_note", ownerNote: "x" })).toEqual({
      orderId: "a",
      action: "save_note",
      ownerNote: "x"
    });
  });
});

describe("public routes", () => {
  const API = "https://bbt-api.example.workers.dev";
  const post = (path: string, body: unknown) =>
    handleRequest(
      new Request(`${API}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://bustostamales.com" },
        body: JSON.stringify(body)
      }),
      {},
      () => undefined
    );

  it("answers ok and saves nothing when the honeypot is filled", async () => {
    // No service account: a save attempt would give 503.
    for (const path of ["/api/v1/orders", "/api/v1/waitlist"]) {
      const response = await post(path, { website: "http://spam.example" });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    }
  });

  it("has the routes in the router", async () => {
    const quote = await post("/api/v1/delivery-quote", { address: "" });
    expect(quote.status).toBe(400);
    expect(await quote.json()).toEqual({ ok: false, error: "Enter your delivery address." });
    const order = await post("/api/v1/orders", { kind: "live" });
    expect(order.status).toBe(503); // the database opens first for this route; no service account in the test
  });
});
