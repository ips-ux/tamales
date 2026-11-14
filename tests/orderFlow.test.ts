import { describe, expect, it } from "vitest";
import type { CreateOrderInput, EventRecord, OrderingSettings } from "../shared/model";
import { orderingDefaults } from "../shared/model";
import {
  ADDRESS_NOT_FOUND_MESSAGE,
  OUTSIDE_AREA_MESSAGE,
  attemptKeyFor,
  batchRequestsEnabled,
  buildCreateOrderInput,
  capCartToStock,
  cartKey,
  cartToLines,
  deliveryFeeCents,
  deliveryLine,
  detailsNeedQuote,
  effectiveFulfillment,
  estimateOrder,
  flowSteps,
  formatDateKey,
  maxQuantity,
  menuForFlow,
  minRequestDate,
  needsApproval,
  newAttemptKey,
  paymentChoices,
  policyKeys,
  stepLabel,
  stepQuantity,
  stockLeft,
  stockText,
  submitLabel,
  totalStockLeft,
  usesStock,
  validateDetails,
  validateMenu,
  validateOrderContact,
  validatePayment,
  type DetailsFields,
  type FlowMenuItem,
  type OrderDraft
} from "../src/components/order/orderFlowLogic";

function variant(id: string, unitQuantity: number, priceCents: number, extra: Partial<FlowMenuItem["variants"][number]> = {}) {
  return { id, label: id, unitQuantity, priceCents, minimumQuantity: 1, active: true, sortOrder: unitQuantity, ...extra };
}

const red: FlowMenuItem = {
  id: "red",
  name: "Red",
  status: "active",
  singlePriceCents: 350,
  bulkMenuEnabled: true,
  showWhenSoldOut: true,
  sortOrder: 1,
  variants: [variant("red-dozen", 12, 3400), variant("red-half", 6, 1800)]
};
const green: FlowMenuItem = {
  id: "green",
  name: "Green",
  status: "active",
  singlePriceCents: 0,
  bulkMenuEnabled: false,
  showWhenSoldOut: true,
  sortOrder: 2,
  variants: [variant("green-half", 6, 1800), variant("green-old", 12, 3400, { active: false })]
};
const pork: FlowMenuItem = {
  id: "pork",
  name: "Pork",
  status: "sold_out",
  singlePriceCents: 400,
  bulkMenuEnabled: true,
  showWhenSoldOut: true,
  sortOrder: 3,
  variants: [variant("pork-dozen", 12, 3600)]
};
const hidden: FlowMenuItem = { ...pork, id: "hidden", status: "inactive", sortOrder: 4 };
const menu = [green, hidden, pork, red];

function makeEvent(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: "evt1",
    name: "Saturday Pop-Up",
    areaName: "Westminster",
    startsAtUtc: "2026-11-21T00:00:00.000Z",
    endsAtUtc: "2026-11-21T03:00:00.000Z",
    active: true,
    itemIds: [],
    soldOutItemIds: [],
    preorderMode: "fixed",
    preorderCutoffUtc: "2026-11-20T00:00:00.000Z",
    allotment: { red: 24, green: 12 },
    liveOrdersEnabled: true,
    liveOrdersPaused: false,
    kioskToken: "kiosk-token",
    kioskTarget: "today",
    waitlistEnabled: true,
    exitPinHash: "",
    ...overrides
  };
}

const ordering: OrderingSettings = { ...orderingDefaults, pickupEnabled: true, deliveryEnabled: true };
const emptyDetails: DetailsFields = { fulfillment: "", address: "", date: "", timeRange: "" };

describe("flow steps and labels", () => {
  it("gives each kind its steps", () => {
    expect(flowSteps("live", "mobile", ordering)).toEqual(["menu", "contact", "payment", "review"]);
    expect(flowSteps("preorder", "web", ordering)).toEqual(["menu", "contact", "review"]);
    expect(flowSteps("batch", "web", ordering)).toEqual(["menu", "details", "contact", "review"]);
    expect(flowSteps("batch", "kiosk", ordering)).toEqual(["menu", "details", "contact", "review"]);
    expect(flowSteps("batch", "kiosk", { deliveryEnabled: false })).toEqual(["menu", "contact", "review"]);
  });

  it("writes the step label", () => {
    expect(stepLabel(["menu", "details", "contact", "review"], 1)).toBe("Step 2 of 4: Details");
  });

  it("names the final button by approval", () => {
    expect(submitLabel("live")).toBe("Place Order");
    expect(submitLabel("preorder", { preorderMode: "fixed" })).toBe("Place Order");
    expect(submitLabel("preorder", { preorderMode: "open" })).toBe("Send Request");
    expect(submitLabel("batch")).toBe("Send Request");
    expect(needsApproval("preorder", { preorderMode: "open" })).toBe(true);
    expect(usesStock("preorder", { preorderMode: "fixed" })).toBe(true);
    expect(usesStock("live", { preorderMode: "fixed" })).toBe(false);
  });

  it("selects the policies for the Review step", () => {
    expect(policyKeys("live")).toEqual([]);
    expect(policyKeys("batch")).toEqual(["paymentPolicy"]);
    expect(policyKeys("preorder", { preorderMode: "fixed" })).toEqual(["refundPolicy"]);
    expect(policyKeys("preorder", { preorderMode: "open" })).toEqual(["paymentPolicy", "refundPolicy"]);
  });
});

describe("menu for each kind", () => {
  it("offers single tamales and variants for a live order, in menu order", () => {
    const entries = menuForFlow("live", menu, makeEvent());
    expect(entries.map((entry) => entry.item.id)).toEqual(["red", "green", "pork"]);
    expect(entries[0].options.map((option) => option.variantId)).toEqual(["single", "red-half", "red-dozen"]);
    // Green has no single price and 1 inactive variant.
    expect(entries[1].options.map((option) => option.variantId)).toEqual(["green-half"]);
    expect(entries[2].soldOut).toBe(true);
  });

  it("marks an item that is sold out at the event", () => {
    const entries = menuForFlow("live", menu, makeEvent({ soldOutItemIds: ["green"] }));
    expect(entries.find((entry) => entry.item.id === "green")?.soldOut).toBe(true);
  });

  it("offers variants only for a pre-order and keeps the event items", () => {
    const entries = menuForFlow("preorder", menu, makeEvent({ itemIds: ["red"] }));
    expect(entries.map((entry) => entry.item.id)).toEqual(["red"]);
    expect(entries[0].options.every((option) => option.variantId !== "single")).toBe(true);
  });

  it("offers the batch menu items for a batch request", () => {
    const entries = menuForFlow("batch", menu);
    expect(entries.map((entry) => entry.item.id)).toEqual(["red", "pork"]);
  });
});

describe("cart and stock", () => {
  const event = makeEvent();
  const entries = menuForFlow("preorder", menu, event);
  const redEntry = entries.find((entry) => entry.item.id === "red")!;
  const dozen = redEntry.options.find((option) => option.variantId === "red-dozen")!;
  const half = redEntry.options.find((option) => option.variantId === "red-half")!;

  it("sends only the lines above 0", () => {
    const cart = { [cartKey("red", "red-dozen")]: 2, [cartKey("red", "red-half")]: 0 };
    expect(cartToLines(cart, entries)).toEqual([{ itemId: "red", variantId: "red-dozen", quantity: 2 }]);
  });

  it("drops a sold-out item from the lines", () => {
    const liveEntries = menuForFlow("live", menu, makeEvent({ soldOutItemIds: ["red"] }));
    expect(cartToLines({ [cartKey("red", "single")]: 3 }, liveEntries)).toEqual([]);
  });

  it("reads the stock, or the allotment when no stock document exists", () => {
    expect(stockLeft("red", event, null)).toBe(24);
    expect(stockLeft("red", event, { remaining: { red: 7 } })).toBe(7);
    expect(stockLeft("pork", event, { remaining: {} })).toBe(0);
    expect(stockLeft("red", event, { remaining: { red: -3 } })).toBe(0);
    expect(totalStockLeft(event, { remaining: { red: 7, green: 5, pork: 99 } }, ["red", "green"])).toBe(12);
    expect(stockText(12)).toBe("12 (1 dozen) left");
    expect(stockText(0)).toBe("Sold out");
  });

  it("caps each stepper to the tamales that remain", () => {
    const cart = { [cartKey("red", "red-half")]: 1 };
    expect(maxQuantity(dozen, cart, redEntry, 24)).toBe(1);
    expect(maxQuantity(half, cart, redEntry, 24)).toBe(4);
    expect(maxQuantity(half, {}, redEntry, 5)).toBe(0);
    expect(maxQuantity(half, {}, redEntry, null)).toBe(200);
  });

  it("steps to the minimum, then by 1, and back to 0", () => {
    expect(stepQuantity(0, 1, 3, 10)).toBe(3);
    expect(stepQuantity(3, 1, 3, 10)).toBe(4);
    expect(stepQuantity(10, 1, 3, 10)).toBe(10);
    expect(stepQuantity(3, -1, 3, 10)).toBe(0);
    expect(stepQuantity(0, 1, 3, 2)).toBe(0);
  });

  it("lowers the cart when the stock drops", () => {
    const cart = { [cartKey("red", "red-dozen")]: 2 };
    const capped = capCartToStock(cart, entries, () => 13);
    expect(capped[cartKey("red", "red-dozen")]).toBe(1);
    expect(capCartToStock(cart, entries, () => 24)).toBe(cart);
    expect(capCartToStock(cart, entries, () => 5)[cartKey("red", "red-dozen")]).toBe(0);
  });

  it("estimates the order with the same rules as the Worker", () => {
    const estimate = estimateOrder(
      [
        { itemId: "red", variantId: "red-dozen", quantity: 1 },
        { itemId: "pork", variantId: "pork-dozen", quantity: 1 }
      ],
      menu,
      { deliveryFeeCents: 500, taxRateBps: 870, deliveryFeeTaxable: false }
    );
    expect(estimate.lines).toHaveLength(1);
    expect(estimate.tamales).toBe(12);
    expect(estimate.totals).toEqual({
      subtotalCents: 3400,
      deliveryFeeCents: 500,
      onlineFeeCents: 0,
      taxCents: 296,
      totalCents: 4196
    });
  });
});

describe("validation", () => {
  it("needs 1 item, and the batch minimum for a batch request", () => {
    expect(validateMenu("live", 0, ordering)).toEqual(["Select 1 menu item or more."]);
    expect(validateMenu("batch", 6, { minBatchTamales: 12 })).toEqual([
      "Select 12 (1 dozen) or more for a batch request."
    ]);
    expect(validateMenu("batch", 12, { minBatchTamales: 12 })).toEqual([]);
    expect(validateMenu("preorder", 6, { minBatchTamales: 12 })).toEqual([]);
  });

  it("sets the first date for a batch request", () => {
    expect(minRequestDate("2026-11-14", 3)).toBe("2026-11-17");
    expect(minRequestDate("2026-12-30", 3)).toBe("2027-01-02");
    expect(minRequestDate("2026-11-14", -1)).toBe("2026-11-14");
    expect(formatDateKey("2026-11-14")).toBe("Sat, Nov 14");
  });

  it("checks the Details step", () => {
    const context = { source: "web" as const, ordering, todayKey: "2026-11-14", quote: { status: "idle" as const } };
    expect(validateDetails(emptyDetails, context)).toEqual(["Select pickup or delivery.", "Select a date."]);
    expect(validateDetails({ ...emptyDetails, fulfillment: "pickup", date: "2026-11-15" }, context)).toEqual([
      "Select Tue, Nov 17 or a later date."
    ]);
    expect(validateDetails({ ...emptyDetails, fulfillment: "pickup", date: "2026-11-17" }, context)).toEqual([]);
    expect(validateDetails({ ...emptyDetails, fulfillment: "delivery", date: "2026-11-20" }, context)).toEqual([
      "Enter the delivery address."
    ]);
  });

  it("blocks an address outside the delivery area and accepts an address it cannot find", () => {
    const fields: DetailsFields = { fulfillment: "delivery", address: "1 Main St", date: "2026-11-20", timeRange: "" };
    const base = { source: "web" as const, ordering, todayKey: "2026-11-14" };
    const outside = { address: "1 Main St", status: "outside" as const, feeCents: 0, distanceMiles: 40 };
    const notFound = { address: "1 Main St", status: "not_found" as const, feeCents: 0, distanceMiles: null };
    expect(validateDetails(fields, { ...base, quote: outside })).toEqual([OUTSIDE_AREA_MESSAGE]);
    expect(validateDetails(fields, { ...base, quote: notFound })).toEqual([]);
    expect(ADDRESS_NOT_FOUND_MESSAGE).toContain("We will set the delivery fee");
  });

  it("asks a kiosk for no date", () => {
    const context = { source: "kiosk" as const, ordering, todayKey: "2026-11-14", quote: { status: "idle" as const } };
    expect(validateDetails({ ...emptyDetails, fulfillment: "pickup" }, context)).toEqual([]);
  });

  it("checks the contact fields", () => {
    expect(validateOrderContact({ firstName: "", lastName: "", email: "", phone: "", note: "" })).toEqual([
      "Enter your first name.",
      "Enter your last name.",
      "Enter your email address."
    ]);
    expect(
      validateOrderContact({ firstName: "Jane", lastName: "Doe", email: "jane@", phone: "12", note: "x".repeat(501) })
    ).toEqual([
      "Enter a complete email address.",
      "Enter a phone number with 10 digits, or leave the phone field empty.",
      "Make your note 500 characters or shorter."
    ]);
    expect(
      validateOrderContact({ firstName: "Jane", lastName: "Doe", email: "jane@example.com", phone: "720-360-8688", note: "" })
    ).toEqual([]);
  });

  it("offers the payment rows that have an account name", () => {
    expect(paymentChoices({ venmoHandle: "", cashAppCashtag: "" }).map((row) => row.method)).toEqual(["cash"]);
    expect(paymentChoices({ venmoHandle: "bbt", cashAppCashtag: "bbt" }).map((row) => row.label)).toEqual([
      "Venmo",
      "Cash App",
      "Cash at the booth"
    ]);
    expect(validatePayment("unset", ["cash"])).toEqual(["Select a payment method."]);
    expect(validatePayment("cash", ["cash"])).toEqual([]);
  });
});

describe("fulfillment and delivery", () => {
  it("knows when batch requests are on", () => {
    expect(batchRequestsEnabled({ pickupEnabled: false, deliveryEnabled: false })).toBe(false);
    expect(batchRequestsEnabled({ pickupEnabled: false, deliveryEnabled: true })).toBe(true);
  });

  it("selects the only choice and drops a choice that is off", () => {
    expect(effectiveFulfillment("", { pickupEnabled: true, deliveryEnabled: false })).toBe("pickup");
    expect(effectiveFulfillment("delivery", { pickupEnabled: true, deliveryEnabled: false })).toBe("pickup");
    expect(effectiveFulfillment("", ordering)).toBe("");
    expect(effectiveFulfillment("delivery", ordering)).toBe("delivery");
  });

  it("checks the address 1 time for each address", () => {
    const fields: DetailsFields = { fulfillment: "delivery", address: " 1 Main St ", date: "", timeRange: "" };
    const quote = { address: "1 Main St", status: "ok" as const, feeCents: 800, distanceMiles: 4 };
    expect(detailsNeedQuote(fields, { status: "idle" })).toBe(true);
    expect(detailsNeedQuote(fields, quote)).toBe(false);
    expect(detailsNeedQuote({ ...fields, fulfillment: "pickup" }, { status: "idle" })).toBe(false);
    expect(deliveryLine("batch", fields, quote)).toBe("fee");
    expect(deliveryFeeCents("batch", fields, quote)).toBe(800);
    expect(deliveryLine("batch", fields, { ...quote, status: "not_found" })).toBe("to_be_set");
    expect(deliveryFeeCents("batch", fields, { ...quote, status: "not_found" })).toBe(0);
    expect(deliveryLine("preorder", fields, quote)).toBe("none");
  });
});

describe("request body", () => {
  const contact = { firstName: " Jane ", lastName: "Doe ", email: " jane@example.com", phone: "", note: " Extra salsa " };
  const base: OrderDraft = {
    kind: "live",
    source: "mobile",
    eventId: "evt1",
    kioskToken: "",
    lines: [{ itemId: "red", variantId: "single", quantity: 2 }],
    contact,
    marketingOptIn: false,
    details: emptyDetails,
    paymentMethod: "venmo"
  };

  it("builds a live order", () => {
    expect(buildCreateOrderInput(base)).toEqual({
      kind: "live",
      source: "mobile",
      eventId: "evt1",
      kioskToken: "",
      items: [{ itemId: "red", variantId: "single", quantity: 2 }],
      customer: { firstName: "Jane", lastName: "Doe", email: "jane@example.com", phone: "", marketingOptIn: false },
      fulfillment: "event_pickup",
      deliveryAddress: "",
      requested: null,
      paymentMethod: "venmo",
      customerNote: "Extra salsa"
    });
  });

  it("builds a web batch request with no event", () => {
    const input = buildCreateOrderInput({
      ...base,
      kind: "batch",
      source: "web",
      marketingOptIn: true,
      details: { fulfillment: "delivery", address: " 1 Main St ", date: "2026-11-20", timeRange: " 5 PM " }
    });
    expect(input.eventId).toBe("");
    expect(input.fulfillment).toBe("delivery");
    expect(input.deliveryAddress).toBe("1 Main St");
    expect(input.requested).toEqual({ date: "2026-11-20", timeRange: "5 PM" });
    expect(input.paymentMethod).toBe("unset");
    expect(input.customer.marketingOptIn).toBe(true);
  });

  it("builds a kiosk batch request with the kiosk event and no date", () => {
    const input = buildCreateOrderInput({
      ...base,
      kind: "batch",
      source: "kiosk",
      kioskToken: "kiosk-token",
      details: { fulfillment: "pickup", address: "ignored", date: "2026-11-20", timeRange: "" }
    });
    expect(input.eventId).toBe("evt1");
    expect(input.kioskToken).toBe("kiosk-token");
    expect(input.requested).toBeNull();
    expect(input.deliveryAddress).toBe("");
  });

  it("keeps the retry key for the same order and makes a new key for a changed order", () => {
    const input = buildCreateOrderInput(base);
    let count = 0;
    const make = () => `key-${(count += 1)}`;
    const first = attemptKeyFor(null, input, make);
    expect(attemptKeyFor(first, { ...input }, make)).toBe(first);
    expect(attemptKeyFor(first, { ...input, idempotencyKey: "other" } as CreateOrderInput, make)).toBe(first);
    const changed = attemptKeyFor(first, { ...input, customerNote: "No salsa" }, make);
    expect(changed.key).toBe("key-2");
  });

  it("makes a key that the Worker accepts", () => {
    expect(newAttemptKey()).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });
});
