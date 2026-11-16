import { describe, expect, it } from "vitest";
import type { OrderRecord, OrderState } from "../shared/model";
import { findNewIds } from "../src/components/admin/liveAlert";
import {
  availableActions,
  checkApproval,
  customerName,
  formatDayKey,
  lineLabel,
  liveGroupFor,
  liveNumber,
  liveOrdersForDay,
  moneyLines,
  parseDollarsToCents,
  queueCounts,
  queueOrders,
  queueTabFor,
  stateLabels
} from "../src/components/admin/orderRules";
import {
  isPosPaymentMethod,
  posPaymentLabel,
  posPaymentMethods,
  posPaymentUrl
} from "../src/components/admin/paymentLabels";

function makeOrder(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: "o1",
    kind: "batch",
    source: "web",
    state: "requested",
    paymentState: "unpaid",
    paymentMethod: "unset",
    orderNumber: "BBT-1001",
    sequence: 1001,
    paymentDescription: "",
    eventId: "",
    eventName: "",
    fulfillment: "pickup",
    customer: { firstName: "Jane", lastName: "Doe", email: "jane@example.com", phone: "", marketingOptIn: false },
    customerId: "c1",
    items: [],
    tamaleCount: 0,
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
    stockHeld: false,
    paypalOrderId: "",
    paypalCaptureId: "",
    paypalFeeCents: 0,
    paidAtUtc: "",
    refundedCents: 0,
    saleId: "",
    ...overrides
  };
}

describe("order labels", () => {
  it("has the owner label for each state", () => {
    expect(stateLabels).toEqual({
      requested: "Waiting for approval",
      approved: "Approved",
      declined: "Declined",
      received: "Received",
      preparing: "Being prepared",
      ready: "Ready",
      handed_over: "Handed over",
      canceled: "Canceled",
      expired: "Expired"
    });
  });

  it("shows the customer name, or a fallback", () => {
    expect(customerName(makeOrder())).toBe("Jane Doe");
    expect(
      customerName(makeOrder({ customer: { firstName: " ", lastName: "", email: "", phone: "", marketingOptIn: false } }))
    ).toBe("No name");
  });

  it("shows a line as tamales with the quantity term", () => {
    expect(lineLabel({ itemName: "Red Chile Pork", unitTamales: 6, quantity: 2 })).toBe("Red Chile Pork: 12 (1 dozen)");
    expect(lineLabel({ itemName: "Red Chile Pork", unitTamales: 1, quantity: 5 })).toBe("Red Chile Pork: 5 tamales");
    expect(lineLabel({ itemName: "Red Chile Pork", unitTamales: 6, quantity: 1 })).toBe("Red Chile Pork: 6 (half dozen)");
  });

  it("formats a requested date", () => {
    expect(formatDayKey("2026-11-14")).toBe("Sat, Nov 14");
    expect(formatDayKey("soon")).toBe("soon");
  });
});

describe("actions for an order", () => {
  it("offers approve and decline for an order that waits for approval", () => {
    const actions = availableActions(makeOrder());
    expect(actions).toContain("approve");
    expect(actions).toContain("decline");
    expect(actions).not.toContain("prepare");
    expect(actions).not.toContain("hand_over");
  });

  it("offers start and mark ready for a received order", () => {
    const actions = availableActions(makeOrder({ state: "received", paymentState: "paid" }));
    expect(actions).toContain("prepare");
    expect(actions).toContain("ready");
    expect(actions).not.toContain("approve");
    expect(actions).not.toContain("mark_paid");
  });

  it("offers hand over for a ready order", () => {
    expect(availableActions(makeOrder({ state: "ready", paymentState: "paid" }))).toContain("hand_over");
  });

  it("offers no action for an order in a final state", () => {
    for (const state of ["handed_over", "declined", "canceled", "expired"] as OrderState[]) {
      expect(availableActions(makeOrder({ state }))).toEqual([]);
    }
  });
});

describe("pre-orders queue", () => {
  it("puts each state in 1 tab", () => {
    expect(queueTabFor("requested")).toBe("requested");
    expect(queueTabFor("approved")).toBe("approved");
    for (const state of ["received", "preparing", "ready"] as OrderState[]) expect(queueTabFor(state)).toBe("in_work");
    for (const state of ["handed_over", "declined", "canceled", "expired"] as OrderState[]) {
      expect(queueTabFor(state)).toBe("done");
    }
  });

  const orders = [
    makeOrder({ id: "a", createdAtUtc: "2026-11-10T18:00:00.000Z" }),
    makeOrder({ id: "b", kind: "preorder", createdAtUtc: "2026-11-09T18:00:00.000Z" }),
    makeOrder({ id: "c", kind: "live" }),
    makeOrder({ id: "d", state: "handed_over", createdAtUtc: "2026-11-01T18:00:00.000Z" }),
    makeOrder({ id: "e", state: "canceled", createdAtUtc: "2026-11-02T18:00:00.000Z" }),
    makeOrder({ id: "f", state: "preparing" })
  ];

  it("shows the oldest first in an open tab and leaves out live orders", () => {
    expect(queueOrders(orders, "requested").map((order) => order.id)).toEqual(["b", "a"]);
  });

  it("shows the newest first in Done", () => {
    expect(queueOrders(orders, "done").map((order) => order.id)).toEqual(["e", "d"]);
  });

  it("counts the orders of each tab", () => {
    expect(queueCounts(orders)).toEqual({ requested: 2, approved: 0, in_work: 1, done: 2 });
  });
});

describe("live orders queue", () => {
  const dayKeyOf = (iso: string) => iso.slice(0, 10);
  const orders = [
    makeOrder({ id: "a", kind: "live", state: "received", createdAtUtc: "2026-11-14T20:00:00.000Z" }),
    makeOrder({ id: "b", kind: "live", state: "ready", createdAtUtc: "2026-11-14T21:00:00.000Z" }),
    makeOrder({ id: "c", kind: "live", createdAtUtc: "2026-11-13T21:00:00.000Z" }),
    makeOrder({ id: "d", kind: "preorder", createdAtUtc: "2026-11-14T21:30:00.000Z" }),
    makeOrder({ id: "e", kind: "live", createdAtUtc: "" })
  ];

  it("keeps the live orders of the day, newest first", () => {
    expect(liveOrdersForDay(orders, "2026-11-14", dayKeyOf).map((order) => order.id)).toEqual(["b", "a"]);
  });

  it("groups by state", () => {
    expect(liveGroupFor("received")).toBe("todo");
    expect(liveGroupFor("preparing")).toBe("todo");
    expect(liveGroupFor("ready")).toBe("ready");
    expect(liveGroupFor("handed_over")).toBe("done");
    expect(liveGroupFor("canceled")).toBe("done");
  });

  it("reads the short number from the order number", () => {
    expect(liveNumber({ orderNumber: "#12 - Nov 14 - Jane Doe", sequence: 12 })).toBe("#12");
    expect(liveNumber({ orderNumber: "", sequence: 7 })).toBe("#7");
    expect(liveNumber({ orderNumber: "BBT-1001", sequence: 0 })).toBe("BBT-1001");
  });
});

describe("live order alert", () => {
  it("treats the orders of the first load as known", () => {
    const first = findNewIds(null, ["a", "b"]);
    expect(first.fresh).toEqual([]);
    expect([...first.known]).toEqual(["a", "b"]);
  });

  it("reports an order that arrives later, 1 time", () => {
    const first = findNewIds(null, ["a"]);
    const second = findNewIds(first.known, ["a", "b"]);
    expect(second.fresh).toEqual(["b"]);
    expect(findNewIds(second.known, ["b", "a"]).fresh).toEqual([]);
  });

  it("reports the first order after an empty first load", () => {
    const first = findNewIds(null, []);
    expect(findNewIds(first.known, ["a"]).fresh).toEqual(["a"]);
  });

  it("does not report an order again after it leaves and returns", () => {
    const first = findNewIds(null, ["a"]);
    const second = findNewIds(first.known, []);
    expect(findNewIds(second.known, ["a"]).fresh).toEqual([]);
  });
});

describe("money lines", () => {
  it("shows Subtotal, Tax, Total for a pickup order with no online fee", () => {
    expect(moneyLines(makeOrder()).map((line) => [line.label, line.value])).toEqual([
      ["Subtotal", "$30.00"],
      ["Tax", "$2.61"],
      ["Total", "$32.61"]
    ]);
  });

  it("uses the agreed sequence with a delivery fee and an online ordering fee", () => {
    const order = makeOrder({
      fulfillment: "delivery",
      delivery: { address: "1 Main St", distanceMiles: 3, feeStatus: "computed" },
      totals: { subtotalCents: 3000, deliveryFeeCents: 500, onlineFeeCents: 60, taxCents: 261, totalCents: 3821 }
    });
    expect(moneyLines(order).map((line) => line.label)).toEqual([
      "Subtotal",
      "Delivery fee",
      "Online ordering fee",
      "Tax",
      "Total"
    ]);
    expect(moneyLines(order).filter((line) => line.total).map((line) => line.label)).toEqual(["Total"]);
  });

  it("says when the delivery fee is not set", () => {
    const order = makeOrder({
      fulfillment: "delivery",
      delivery: { address: "1 Main St", distanceMiles: null, feeStatus: "to_be_set" }
    });
    expect(moneyLines(order)[1]).toEqual({ label: "Delivery fee", value: "Not set", total: false });
  });
});

describe("approve dialog", () => {
  const when = "2026-11-20T23:00:00.000Z";

  it("requires the final date and time", () => {
    expect(checkApproval(makeOrder(), { scheduledAtUtc: "", deliveryFee: "" }).errors).toEqual([
      "Enter the final date and time."
    ]);
  });

  it("sends no fee for a pickup order", () => {
    const result = checkApproval(makeOrder(), { scheduledAtUtc: when, deliveryFee: "9" });
    expect(result.errors).toEqual([]);
    expect(result.deliveryFeeCents).toBeUndefined();
  });

  const delivery = makeOrder({
    fulfillment: "delivery",
    delivery: { address: "1 Main St", distanceMiles: 3, feeStatus: "computed" },
    totals: { subtotalCents: 3000, deliveryFeeCents: 500, onlineFeeCents: 0, taxCents: 261, totalCents: 3761 }
  });

  it("keeps the computed fee when the owner does not change it", () => {
    expect(checkApproval(delivery, { scheduledAtUtc: when, deliveryFee: "5.00" }).deliveryFeeCents).toBeUndefined();
    expect(checkApproval(delivery, { scheduledAtUtc: when, deliveryFee: "" }).errors).toEqual([]);
  });

  it("sends a fee that the owner changed", () => {
    expect(checkApproval(delivery, { scheduledAtUtc: when, deliveryFee: "7.5" }).deliveryFeeCents).toBe(750);
  });

  it("requires the fee when the order says it is to be set", () => {
    const order = makeOrder({
      fulfillment: "delivery",
      delivery: { address: "1 Main St", distanceMiles: null, feeStatus: "to_be_set" }
    });
    expect(checkApproval(order, { scheduledAtUtc: when, deliveryFee: " " }).errors).toEqual(["Enter the delivery fee."]);
    expect(checkApproval(order, { scheduledAtUtc: when, deliveryFee: "0" }).deliveryFeeCents).toBe(0);
  });

  it("rejects a fee that is not an amount", () => {
    expect(checkApproval(delivery, { scheduledAtUtc: when, deliveryFee: "free" }).errors).toEqual([
      "Enter the delivery fee as an amount, for example 8.00."
    ]);
  });

  it("reads dollars as cents", () => {
    expect(parseDollarsToCents("8")).toBe(800);
    expect(parseDollarsToCents("$8.05")).toBe(805);
    expect(parseDollarsToCents("8.999")).toBeNull();
    expect(parseDollarsToCents("-1")).toBeNull();
    expect(parseDollarsToCents("")).toBeNull();
  });
});

describe("POS payment methods", () => {
  it("offers cash, Venmo and Cash App only", () => {
    expect(posPaymentMethods).toEqual(["cash", "venmo", "cashapp"]);
    expect(isPosPaymentMethod("zelle")).toBe(false);
    expect(isPosPaymentMethod("paypal")).toBe(false);
  });

  it("shows the stored value for a method that is removed", () => {
    expect(posPaymentLabel("cashapp")).toBe("Cash App");
    expect(posPaymentLabel("zelle")).toBe("zelle");
    expect(posPaymentLabel("applepay")).toBe("applepay");
    expect(posPaymentLabel("")).toBe("Not recorded");
  });

  it("builds the payment link", () => {
    const accounts = { cashAppCashtag: "Bustos", venmoHandle: "bustos" };
    expect(posPaymentUrl("cash", accounts, 1250)).toBe("");
    expect(posPaymentUrl("cashapp", accounts, 1250)).toBe("https://cash.app/$Bustos/12.50");
    expect(posPaymentUrl("venmo", accounts, 1250)).toContain("recipients=bustos&amount=12.50");
    expect(posPaymentUrl("zelle", accounts, 1250)).toBe("");
  });
});
