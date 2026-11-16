import { describe, expect, it } from "vitest";
import { haversineMiles, ringFee } from "../../shared/delivery";
import { OrderError } from "../../shared/errors";
import { eventIsLive, eventItemIds, preorderIsOpen } from "../../shared/eventRules";
import type { EventRecord, OrderAction, OrderKind, OrderRecord, OrderState, PaymentState } from "../../shared/model";
import {
  addDaysToDateKey,
  dateKeyInZone,
  liveCounterId,
  liveOrderNumber,
  paymentDescription,
  runningOrderNumber
} from "../../shared/orderNumber";
import { applyAction, canRunAction, handOverNeedsPayment, holdsEventStock, isFinalState } from "../../shared/orderState";
import {
  buildOrderLines,
  computeTotals,
  onlineFeeCents,
  tamaleCount,
  tamalesByItem,
  type PricedMenuItem
} from "../../shared/pricing";
import { quantityLabel } from "../../shared/quantity";

const menu: PricedMenuItem[] = [
  {
    id: "red",
    name: "Red Tamales",
    status: "active",
    singlePriceCents: 400,
    variants: [
      { id: "red-half", label: "Half dozen", unitQuantity: 6, priceCents: 1800, minimumQuantity: 1, active: true },
      { id: "red-dozen", label: "Dozen", unitQuantity: 12, priceCents: 3400, minimumQuantity: 1, active: true },
      { id: "red-tray", label: "Party tray", unitQuantity: 48, priceCents: 12000, minimumQuantity: 2, active: true },
      { id: "red-old", label: "Old", unitQuantity: 3, priceCents: 900, minimumQuantity: 1, active: false }
    ]
  },
  { id: "green", name: "Green Tamales", status: "active", singlePriceCents: 0, variants: [] },
  { id: "sweet", name: "Sweet Tamales", status: "sold_out", singlePriceCents: 400, variants: [] },
  { id: "hidden", name: "Hidden", status: "inactive", singlePriceCents: 400, variants: [] }
];

describe("pricing", () => {
  it("builds a single line from the single price", () => {
    expect(buildOrderLines([{ itemId: "red", variantId: "single", quantity: 5 }], menu)).toEqual([
      {
        itemId: "red",
        variantId: "single",
        itemName: "Red Tamales",
        variantLabel: "Single",
        unitTamales: 1,
        unitPriceCents: 400,
        quantity: 5,
        lineTotalCents: 2000
      }
    ]);
  });

  it("builds a variant line from the variant", () => {
    const [line] = buildOrderLines([{ itemId: "red", variantId: "red-dozen", quantity: 2 }], menu);
    expect(line).toMatchObject({ variantLabel: "Dozen", unitTamales: 12, unitPriceCents: 3400, lineTotalCents: 6800 });
  });

  it("rejects an unknown, inactive or sold out item, and an unknown or inactive variant", () => {
    const tries = [
      { itemId: "missing", variantId: "single", quantity: 1 },
      { itemId: "hidden", variantId: "single", quantity: 1 },
      { itemId: "red", variantId: "missing", quantity: 1 },
      { itemId: "red", variantId: "red-old", quantity: 1 },
      { itemId: "green", variantId: "single", quantity: 1 } // no single price
    ];
    for (const line of tries) {
      expect(() => buildOrderLines([line], menu)).toThrow("is not available");
    }
    expect(() => buildOrderLines([{ itemId: "sweet", variantId: "single", quantity: 1 }], menu)).toThrow(
      "Sweet Tamales is sold out."
    );
    expect(() => buildOrderLines([tries[0]], menu)).toThrow(OrderError);
  });

  it("rejects a bad quantity, a quantity below the minimum, and too many lines", () => {
    for (const quantity of [0, -1, 1.5, 201]) {
      expect(() => buildOrderLines([{ itemId: "red", variantId: "single", quantity }], menu)).toThrow(
        "Enter a valid quantity."
      );
    }
    expect(buildOrderLines([{ itemId: "red", variantId: "single", quantity: 200 }], menu)).toHaveLength(1);
    expect(() => buildOrderLines([{ itemId: "red", variantId: "red-tray", quantity: 1 }], menu)).toThrow(
      "Red Tamales, Party tray has a minimum quantity of 2."
    );
    expect(() => buildOrderLines([], menu)).toThrow("Select 1 menu item or more.");
    const many = Array.from({ length: 41 }, () => ({ itemId: "red", variantId: "single", quantity: 1 }));
    expect(() => buildOrderLines(many, menu)).toThrow("too many lines");
    expect(buildOrderLines(many.slice(0, 40), menu)).toHaveLength(40);
  });

  it("counts tamales", () => {
    const lines = buildOrderLines(
      [
        { itemId: "red", variantId: "red-dozen", quantity: 2 },
        { itemId: "red", variantId: "single", quantity: 3 }
      ],
      menu
    );
    expect(tamaleCount(lines)).toBe(27);
    expect(tamalesByItem(lines)).toEqual({ red: 27 });
  });

  it("computes the totals with the tax rounded to the cent", () => {
    const lines = [{ lineTotalCents: 3400 }, { lineTotalCents: 1800 }];
    expect(computeTotals({ lines, deliveryFeeCents: 0, taxRateBps: 870, deliveryFeeTaxable: false })).toEqual({
      subtotalCents: 5200,
      deliveryFeeCents: 0,
      onlineFeeCents: 0,
      taxCents: 452,
      totalCents: 5652
    });
    expect(computeTotals({ lines: [{ lineTotalCents: 1005 }], deliveryFeeCents: 0, taxRateBps: 870, deliveryFeeTaxable: true }).taxCents).toBe(87);
  });

  it("taxes the delivery fee only when the switch is on", () => {
    const lines = [{ lineTotalCents: 10000 }];
    const plain = computeTotals({ lines, deliveryFeeCents: 1000, taxRateBps: 870, deliveryFeeTaxable: false });
    expect(plain).toMatchObject({ deliveryFeeCents: 1000, taxCents: 870, totalCents: 11870 });
    const taxed = computeTotals({ lines, deliveryFeeCents: 1000, taxRateBps: 870, deliveryFeeTaxable: true });
    expect(taxed).toMatchObject({ taxCents: 957, totalCents: 11957 });
  });
});

describe("online ordering fee", () => {
  const fee = { paypalFeeBps: 349, paypalFeeFixedCents: 49, feeSharePct: 50 };

  it("is the customer share of the PayPal fee, rounded to the cent", () => {
    // 3.49% of 5652 = 197.25. Plus 49 = 246.25. 50% = 123.13.
    expect(onlineFeeCents(5652, fee)).toBe(123);
    expect(onlineFeeCents(5652, { ...fee, feeSharePct: 100 })).toBe(246);
    expect(onlineFeeCents(5652, { ...fee, feeSharePct: 0 })).toBe(0);
    // 3.49% of 100 = 3.49. Plus 49 = 52.49. 50% = 26.245.
    expect(onlineFeeCents(100, fee)).toBe(26);
    // 50% of 49 with no rate = 24.5, and Math.round gives 25.
    expect(onlineFeeCents(1000, { paypalFeeBps: 0, paypalFeeFixedCents: 49, feeSharePct: 50 })).toBe(25);
  });

  it("is 0 when the pre-fee total is 0", () => {
    expect(onlineFeeCents(0, fee)).toBe(0);
    expect(onlineFeeCents(-5, fee)).toBe(0);
  });

  it("goes on the total only with PayPal Checkout, and is not taxed", () => {
    const input = { lines: [{ lineTotalCents: 3400 }, { lineTotalCents: 1800 }], deliveryFeeCents: 0, taxRateBps: 870, deliveryFeeTaxable: false };
    expect(computeTotals({ ...input, usesPayPal: true, feeSettings: fee })).toEqual({
      subtotalCents: 5200,
      deliveryFeeCents: 0,
      onlineFeeCents: 123,
      taxCents: 452,
      totalCents: 5775
    });
    expect(computeTotals({ ...input, usesPayPal: false, feeSettings: fee })).toMatchObject({
      onlineFeeCents: 0,
      taxCents: 452,
      totalCents: 5652
    });
    expect(computeTotals(input).onlineFeeCents).toBe(0);
  });

  it("uses the delivery fee and the tax in the pre-fee total", () => {
    const totals = computeTotals({
      lines: [{ lineTotalCents: 10000 }],
      deliveryFeeCents: 1000,
      taxRateBps: 870,
      deliveryFeeTaxable: true,
      usesPayPal: true,
      feeSettings: fee
    });
    // Pre-fee total 11957: round(50% of (417.30 + 49)) = 233.
    expect(totals).toEqual({ subtotalCents: 10000, deliveryFeeCents: 1000, onlineFeeCents: 233, taxCents: 957, totalCents: 12190 });
  });
});

describe("quantity label", () => {
  it("uses the dozen term only for 6 and for full dozens", () => {
    expect(quantityLabel(6)).toBe("6 (half dozen)");
    expect(quantityLabel(12)).toBe("12 (1 dozen)");
    expect(quantityLabel(24)).toBe("24 (2 dozen)");
    expect(quantityLabel(120)).toBe("120 (10 dozen)");
    expect(quantityLabel(5)).toBe("5 tamales");
    expect(quantityLabel(18)).toBe("18 tamales");
    expect(quantityLabel(1)).toBe("1 tamale");
    expect(quantityLabel(0)).toBe("0 tamales");
  });
});

describe("order numbers", () => {
  it("makes the live number with the date in the business time zone", () => {
    // 01:00 UTC on Nov 15 is 6:00 PM on Nov 14 in Denver.
    expect(liveOrderNumber(12, "2026-11-15T01:00:00.000Z", "America/Denver", "Jane", "Doe")).toBe(
      "#12 - Nov 14 - Jane Doe"
    );
    expect(liveOrderNumber(12, "2026-11-15T01:00:00.000Z", "UTC", "Jane", "Doe")).toBe("#12 - Nov 15 - Jane Doe");
    expect(liveOrderNumber(1, "2026-11-14", "America/Denver", "Jane", "Doe")).toBe("#1 - Nov 14 - Jane Doe");
    expect(liveOrderNumber(3, "2026-11-15T01:00:00.000Z", "America/Denver", "", "")).toBe("#3 - Nov 14");
    expect(liveOrderNumber(3, "2026-11-15T01:00:00.000Z", "Not/AZone", "Jane", "Doe")).toBe("#3 - Nov 14 - Jane Doe");
  });

  it("makes the running number", () => {
    expect(runningOrderNumber(1001)).toBe("BBT-1001");
    expect(runningOrderNumber(1042)).toBe("BBT-1042");
    expect(runningOrderNumber(12345)).toBe("BBT-12345");
  });

  it("makes the payment description", () => {
    const customer = { firstName: "Jane", lastName: "Doe" };
    expect(paymentDescription({ kind: "live", orderNumber: "#12 - Nov 14 - Jane Doe", customer })).toBe(
      "#12 - Nov 14 - Jane Doe"
    );
    expect(paymentDescription({ kind: "preorder", orderNumber: "BBT-1042", customer })).toBe("BBT-1042 Jane Doe");
    expect(paymentDescription({ kind: "batch", orderNumber: "BBT-1042", customer })).toBe("BBT-1042 Jane Doe");
  });

  it("makes date keys and counter ids", () => {
    expect(dateKeyInZone("2026-11-15T01:00:00.000Z", "America/Denver")).toBe("2026-11-14");
    expect(dateKeyInZone(new Date("2026-11-15T08:00:00.000Z"), "America/Denver")).toBe("2026-11-15");
    expect(addDaysToDateKey("2026-11-29", 3)).toBe("2026-12-02");
    expect(liveCounterId("ev1", "2026-11-14")).toBe("live-ev1-2026-11-14");
  });
});

describe("delivery distance and rings", () => {
  const denver = { lat: 39.7392, lng: -104.9903 };
  const boulder = { lat: 40.015, lng: -105.2705 };

  it("measures the straight-line distance in miles", () => {
    expect(haversineMiles(denver, denver)).toBe(0);
    expect(haversineMiles(denver, boulder)).toBeGreaterThan(23);
    expect(haversineMiles(denver, boulder)).toBeLessThan(25);
    expect(haversineMiles(boulder, denver)).toBeCloseTo(haversineMiles(denver, boulder), 9);
    // 1 degree of latitude is about 69.1 miles.
    expect(haversineMiles({ lat: 39, lng: -105 }, { lat: 40, lng: -105 })).toBeCloseTo(69.1, 0);
  });

  it("gives the fee of the smallest ring that contains the distance", () => {
    const rings = [
      { miles: 10, feeCents: 1000 },
      { miles: 5, feeCents: 500 },
      { miles: 20, feeCents: 2000 }
    ];
    expect(ringFee(0, rings)).toEqual({ status: "ok", feeCents: 500 });
    expect(ringFee(5, rings)).toEqual({ status: "ok", feeCents: 500 });
    expect(ringFee(5.01, rings)).toEqual({ status: "ok", feeCents: 1000 });
    expect(ringFee(20, rings)).toEqual({ status: "ok", feeCents: 2000 });
    expect(ringFee(20.01, rings)).toEqual({ status: "outside" });
    expect(ringFee(1, [])).toEqual({ status: "outside" });
  });
});

describe("event rules", () => {
  const event: EventRecord = {
    id: "ev1",
    name: "Winter Market",
    areaName: "Westminster",
    startsAtUtc: "2026-11-15T00:00:00.000Z",
    endsAtUtc: "2026-11-15T03:00:00.000Z",
    active: true,
    itemIds: [],
    soldOutItemIds: [],
    preorderMode: "open",
    preorderCutoffUtc: "2026-11-13T00:00:00.000Z",
    allotment: {},
    liveOrdersEnabled: true,
    liveOrdersPaused: false,
    kioskToken: "k",
    kioskTarget: "today",
    waitlistEnabled: true,
    exitPinHash: ""
  };

  it("is live from the start time up to the end time", () => {
    expect(eventIsLive(event, new Date("2026-11-14T23:59:59.999Z"))).toBe(false);
    expect(eventIsLive(event, new Date("2026-11-15T00:00:00.000Z"))).toBe(true);
    expect(eventIsLive(event, "2026-11-15T02:59:59.999Z")).toBe(true);
    expect(eventIsLive(event, new Date("2026-11-15T03:00:00.000Z"))).toBe(false);
  });

  it("is not live when inactive, off or paused", () => {
    const during = new Date("2026-11-15T01:00:00.000Z");
    expect(eventIsLive({ ...event, active: false }, during)).toBe(false);
    expect(eventIsLive({ ...event, liveOrdersEnabled: false }, during)).toBe(false);
    expect(eventIsLive({ ...event, liveOrdersPaused: true }, during)).toBe(false);
    expect(eventIsLive({ ...event, endsAtUtc: "" }, during)).toBe(false);
  });

  it("takes pre-orders before the cutoff and before the start", () => {
    expect(preorderIsOpen(event, new Date("2026-11-12T23:59:59.999Z"))).toBe(true);
    expect(preorderIsOpen(event, new Date("2026-11-13T00:00:00.000Z"))).toBe(false);
    expect(preorderIsOpen({ ...event, preorderMode: "fixed" }, new Date("2026-11-12T00:00:00.000Z"))).toBe(true);
    expect(preorderIsOpen({ ...event, preorderMode: "off" }, new Date("2026-11-12T00:00:00.000Z"))).toBe(false);
    expect(preorderIsOpen({ ...event, active: false }, new Date("2026-11-12T00:00:00.000Z"))).toBe(false);
    // A cutoff after the start: the start time closes pre-orders.
    const late = { ...event, preorderCutoffUtc: "2026-11-16T00:00:00.000Z" };
    expect(preorderIsOpen(late, new Date("2026-11-14T23:59:59.999Z"))).toBe(true);
    expect(preorderIsOpen(late, new Date("2026-11-15T00:00:00.000Z"))).toBe(false);
    // No cutoff: open until the start.
    expect(preorderIsOpen({ ...event, preorderCutoffUtc: "" }, new Date("2026-11-14T23:00:00.000Z"))).toBe(true);
  });

  it("lists the items of the event", () => {
    expect(eventItemIds(event, ["red", "green"])).toEqual(["red", "green"]);
    expect(eventItemIds({ itemIds: ["green", "gone"] }, ["red", "green"])).toEqual(["green"]);
  });
});

describe("order state table", () => {
  const now = "2026-11-13T18:00:00.000Z";
  // A fee share of 0 keeps the online ordering fee out of these tests. "online ordering fee" tests it.
  const settings = {
    paymentWindowHours: 72,
    deliveryFeeTaxable: false,
    taxRateBps: 870,
    paypalFeeBps: 349,
    paypalFeeFixedCents: 49,
    feeSharePct: 0
  };
  const baseTotals = { subtotalCents: 10000, deliveryFeeCents: 0, onlineFeeCents: 0, taxCents: 870, totalCents: 10870 };
  const states: OrderState[] = [
    "requested",
    "approved",
    "declined",
    "received",
    "preparing",
    "ready",
    "handed_over",
    "canceled",
    "expired"
  ];
  const final: OrderState[] = ["handed_over", "declined", "canceled", "expired"];

  function order(state: OrderState, paymentState: PaymentState = "unpaid", kind: OrderKind = "batch") {
    return {
      kind,
      state,
      paymentState,
      items: [{ lineTotalCents: 10000 }] as OrderRecord["items"],
      totals: { subtotalCents: 10000, deliveryFeeCents: 0, onlineFeeCents: 0, taxCents: 870, totalCents: 10870 },
      delivery: null as OrderRecord["delivery"]
    };
  }

  /** The states from which the action is allowed, for a batch order that is not paid. */
  const allowed: Record<OrderAction, OrderState[]> = {
    approve: ["requested"],
    decline: ["requested"],
    mark_paid: ["requested", "approved", "received", "preparing", "ready"],
    mark_unpaid: [],
    prepare: ["received"],
    ready: ["received", "preparing"],
    hand_over: ["ready"],
    cancel: ["requested", "approved", "received", "preparing", "ready"],
    save_note: [...states]
  };

  it("allows and refuses each action from each state", () => {
    for (const action of Object.keys(allowed) as OrderAction[]) {
      for (const state of states) {
        const expected = allowed[action].includes(state);
        expect(canRunAction(order(state), action), `${action} from ${state}`).toBe(expected);
        // A handover needs a paid order. The next test checks the unpaid order.
        const subject = action === "hand_over" ? order(state, "paid") : order(state);
        if (expected) {
          expect(() => applyAction(subject, { action }, now, settings)).not.toThrow();
        } else {
          expect(() => applyAction(subject, { action }, now, settings)).toThrow(OrderError);
        }
      }
    }
    expect(final.every(isFinalState)).toBe(true);
    expect(isFinalState("ready")).toBe(false);
  });

  it("refuses the handover of an order that is not paid", () => {
    for (const paymentState of ["unpaid", "check_payment", "refunded"] as PaymentState[]) {
      expect(() => applyAction(order("ready", paymentState), { action: "hand_over" }, now, settings)).toThrow(
        "Mark the order as paid first."
      );
      expect(handOverNeedsPayment({ paymentState })).toBe(true);
    }
    expect(handOverNeedsPayment({ paymentState: "paid" })).toBe(false);
    expect(applyAction(order("ready", "paid"), { action: "hand_over" }, now, settings).state).toBe("handed_over");
  });

  it("refuses mark unpaid after a PayPal capture", () => {
    expect(canRunAction({ ...order("received", "paid"), paypalCaptureId: "CAP1" }, "mark_unpaid")).toBe(false);
    expect(canRunAction({ ...order("received", "paid"), paypalCaptureId: "" }, "mark_unpaid")).toBe(true);
  });

  it("lets a live order go to handed over from received and preparing", () => {
    expect(canRunAction(order("received", "paid", "live"), "hand_over")).toBe(true);
    expect(canRunAction(order("preparing", "paid", "live"), "hand_over")).toBe(true);
    expect(canRunAction(order("received", "paid", "preorder"), "hand_over")).toBe(false);
    expect(applyAction(order("received", "paid", "live"), { action: "hand_over" }, now, settings).state).toBe(
      "handed_over"
    );
  });

  it("follows the payment state for mark paid and mark unpaid", () => {
    expect(canRunAction(order("received", "check_payment"), "mark_paid")).toBe(true);
    expect(canRunAction(order("received", "paid"), "mark_paid")).toBe(false);
    expect(canRunAction(order("received", "refunded"), "mark_paid")).toBe(false);
    expect(canRunAction(order("received", "paid"), "mark_unpaid")).toBe(true);
    expect(canRunAction(order("received", "check_payment"), "mark_unpaid")).toBe(true);
    expect(canRunAction(order("received", "refunded"), "mark_unpaid")).toBe(false);
    expect(canRunAction(order("handed_over", "paid"), "mark_unpaid")).toBe(false);
    expect(applyAction(order("ready", "paid"), { action: "mark_unpaid" }, now, settings)).toEqual({
      updatedAtUtc: now,
      paymentState: "unpaid",
      paidAtUtc: ""
    });
  });

  it("approves with the approval time, the pay-by time and the scheduled time", () => {
    const changes = applyAction(
      order("requested"),
      { action: "approve", scheduledAtUtc: "2026-11-20T23:00:00.000Z" },
      now,
      { ...settings, paymentWindowHours: 48 }
    );
    expect(changes).toEqual({
      updatedAtUtc: now,
      state: "approved",
      paymentMethod: "paypal",
      totals: baseTotals,
      approvedAtUtc: now,
      payByUtc: "2026-11-15T18:00:00.000Z",
      scheduledAtUtc: "2026-11-20T23:00:00.000Z"
    });
  });

  it("sets the delivery fee at approval and computes the totals again", () => {
    const delivery = { address: "1 Main St", distanceMiles: 4, feeStatus: "computed" as const };
    const base = { ...order("requested"), delivery };
    const changes = applyAction(base, { action: "approve", deliveryFeeCents: 1500 }, now, settings);
    expect(changes.delivery).toEqual({ ...delivery, feeStatus: "owner_set" });
    expect(changes.totals).toEqual({
      subtotalCents: 10000,
      deliveryFeeCents: 1500,
      onlineFeeCents: 0,
      taxCents: 870,
      totalCents: 12370
    });
    const taxed = applyAction(base, { action: "approve", deliveryFeeCents: 1000 }, now, {
      ...settings,
      deliveryFeeTaxable: true
    });
    expect(taxed.totals).toMatchObject({ taxCents: 957, totalCents: 11957 });
    // No fee in the action keeps the computed fee.
    const kept = applyAction(base, { action: "approve" }, now, settings);
    expect(kept.delivery).toBeUndefined();
    expect(kept.totals).toEqual(baseTotals);
  });

  it("does not approve a delivery with no fee", () => {
    const base = {
      ...order("requested"),
      delivery: { address: "1 Main St", distanceMiles: null, feeStatus: "to_be_set" as const }
    };
    expect(() => applyAction(base, { action: "approve" }, now, settings)).toThrow("Set the delivery fee");
    const changes = applyAction(base, { action: "approve", deliveryFeeCents: 0 }, now, settings);
    expect(changes.delivery?.feeStatus).toBe("owner_set");
    expect(changes.totals?.totalCents).toBe(10870);
  });

  it("moves a paid approved order to received", () => {
    expect(applyAction(order("approved"), { action: "mark_paid" }, now, settings)).toEqual({
      updatedAtUtc: now,
      paymentState: "paid",
      paidAtUtc: now,
      state: "received"
    });
    expect(applyAction(order("ready", "check_payment"), { action: "mark_paid" }, now, settings)).toEqual({
      updatedAtUtc: now,
      paymentState: "paid",
      paidAtUtc: now
    });
  });

  it("adds the online ordering fee to the final total at approval", () => {
    const withFee = { ...settings, feeSharePct: 50 };
    const delivery = { address: "1 Main St", distanceMiles: 4, feeStatus: "computed" as const };
    // Pre-fee total: 10000 + 1500 + 870 = 12370. Fee: round(50% of (12370 x 3.49% + 49)) = round(240.36) = 240.
    const changes = applyAction({ ...order("requested"), delivery }, { action: "approve", deliveryFeeCents: 1500 }, now, withFee);
    expect(changes.paymentMethod).toBe("paypal");
    expect(changes.totals).toEqual({
      subtotalCents: 10000,
      deliveryFeeCents: 1500,
      onlineFeeCents: 240,
      taxCents: 870,
      totalCents: 12610
    });
    // Pre-fee total 10870: round(50% of (379.36 + 49)) = 214.
    expect(applyAction(order("requested"), { action: "approve" }, now, withFee).totals).toMatchObject({
      onlineFeeCents: 214,
      totalCents: 11084
    });
  });

  it("saves the reason and the owner note", () => {
    expect(applyAction(order("requested"), { action: "decline", reason: "No time." }, now, settings)).toEqual({
      updatedAtUtc: now,
      state: "declined",
      reason: "No time."
    });
    expect(applyAction(order("ready"), { action: "cancel", ownerNote: "Called." }, now, settings)).toEqual({
      updatedAtUtc: now,
      state: "canceled",
      reason: "",
      ownerNote: "Called."
    });
    expect(applyAction(order("received"), { action: "prepare" }, now, settings).state).toBe("preparing");
    expect(applyAction(order("preparing"), { action: "ready" }, now, settings).state).toBe("ready");
  });

  it("knows which order holds event stock from the stockHeld flag", () => {
    expect(holdsEventStock({ stockHeld: true, eventId: "ev1" })).toBe(true);
    expect(holdsEventStock({ stockHeld: false, eventId: "ev1" })).toBe(false);
    expect(holdsEventStock({ stockHeld: true, eventId: "" })).toBe(false);
  });

  it("save note changes only the owner note, in every state", () => {
    for (const state of states) {
      expect(applyAction(order(state, "paid"), { action: "save_note", ownerNote: "Call first." }, now, settings)).toEqual({
        updatedAtUtc: now,
        ownerNote: "Call first."
      });
    }
    expect(applyAction(order("ready"), { action: "save_note", reason: "x" }, now, settings)).toEqual({
      updatedAtUtc: now,
      ownerNote: ""
    });
  });
});
