import { describe, expect, it } from "vitest";
import type { StoredDoc } from "../src/firestore";
import {
  DEFAULT_TAX_RATE_BPS,
  assertWindowOpen,
  buildOrderEmails,
  calculateTax,
  newOrderNumber,
  newPublicToken,
  priceOrder,
  taxRateFrom,
  validateOrderRequest,
  type SavedOrder
} from "../src/orders";
import { buildEmailHtml } from "../src/emailHtml";

const menu: StoredDoc[] = [
  {
    id: "red-tamales",
    data: {
      name: "Red Tamales",
      status: "active",
      bulkMenuEnabled: true,
      variants: [
        { id: "red-half-dozen", label: "Half Dozen", unitQuantity: 6, priceCents: 1800, minimumQuantity: 1, active: true },
        { id: "red-dozen", label: "Dozen", unitQuantity: 12, priceCents: 3400, minimumQuantity: 1, active: true },
        { id: "red-party", label: "Party Tray", unitQuantity: 48, priceCents: 12000, minimumQuantity: 2, active: true },
        { id: "red-old", label: "Old", unitQuantity: 3, priceCents: 900, minimumQuantity: 1, active: false }
      ]
    }
  },
  {
    id: "green-tamales",
    data: {
      name: "Green Tamales",
      status: "active",
      bulkMenuEnabled: true,
      variants: [
        { id: "green-half-dozen", label: "Half Dozen", unitQuantity: 6, priceCents: 1800, minimumQuantity: 1, active: true }
      ]
    }
  },
  { id: "sold-out", data: { name: "Sweet", status: "sold_out", bulkMenuEnabled: true, variants: [{ id: "v", priceCents: 100, active: true }] } },
  { id: "pos-only", data: { name: "Single", status: "active", bulkMenuEnabled: false, variants: [{ id: "v", priceCents: 100, active: true }] } }
];

const browserOrder = {
  id: "local-1",
  orderNumber: "BBT-FAKE",
  publicToken: "pub_guessable",
  status: "completed",
  paymentStatus: "paid",
  privateNotes: "free order",
  availabilityWindowId: "window-1",
  customer: { name: "Jane Doe", mobile: "720-360-8688", email: "Jane@Example.com", preferredContact: "text", notes: "" },
  bulk: { enabled: false, occasion: "", guestCount: "", desiredReadyTime: "", packagingRequest: "", additionalInstructions: "" },
  items: [
    { productId: "red-tamales", variantId: "red-dozen", quantity: 1, unitPriceCents: 1, lineTotalCents: 1 },
    { productId: "green-tamales", variantId: "green-half-dozen", quantity: 1, unitPriceCents: 1, lineTotalCents: 1 }
  ],
  totals: { subtotalCents: 2, taxCents: 0, feeCents: 0, totalCents: 2 }
};

describe("order request validation", () => {
  it("keeps only the fields that the Worker accepts", () => {
    const request = validateOrderRequest(browserOrder);
    expect(Object.keys(request).sort()).toEqual(["availabilityWindowId", "bulk", "customer", "items"]);
    expect(request.customer.email).toBe("jane@example.com");
    expect(request.items).toEqual([
      { productId: "red-tamales", variantId: "red-dozen", quantity: 1 },
      { productId: "green-tamales", variantId: "green-half-dozen", quantity: 1 }
    ]);
  });

  it("drops lines with quantity 0 and rejects an empty order", () => {
    const zero = { ...browserOrder, items: [{ productId: "red-tamales", variantId: "red-dozen", quantity: 0 }] };
    expect(() => validateOrderRequest(zero)).toThrow("Select 1 menu item or more.");
  });

  it("rejects a bad quantity, a missing name and a bad contact method", () => {
    for (const quantity of [-1, 1.5, "2", 501]) {
      const bad = { ...browserOrder, items: [{ productId: "red-tamales", variantId: "red-dozen", quantity }] };
      expect(() => validateOrderRequest(bad)).toThrow("Enter a valid quantity.");
    }
    expect(() => validateOrderRequest({ ...browserOrder, customer: { ...browserOrder.customer, name: "" } })).toThrow(
      "Enter your name."
    );
    expect(() =>
      validateOrderRequest({ ...browserOrder, customer: { ...browserOrder.customer, preferredContact: "fax" } })
    ).toThrow("Select how we contact you.");
    expect(() => validateOrderRequest({ ...browserOrder, availabilityWindowId: "a/b" })).toThrow();
    expect(() => validateOrderRequest(null)).toThrow();
  });
});

describe("price and tax", () => {
  it("uses the prices in Firestore, not the prices from the browser", () => {
    const { lines, totals } = priceOrder(validateOrderRequest(browserOrder).items, menu, 870);
    expect(lines.map((line) => [line.unitPriceCents, line.lineTotalCents])).toEqual([
      [3400, 3400],
      [1800, 1800]
    ]);
    expect(lines[0]).toMatchObject({ productName: "Red Tamales", variantLabel: "Dozen", unitQuantity: 12 });
    // Same numbers as tests/order.test.ts of the site.
    expect(totals).toEqual({ subtotalCents: 5200, taxCents: 452, feeCents: 0, totalCents: 5652 });
  });

  it("multiplies by the quantity and rounds the tax to the cent", () => {
    const { totals } = priceOrder([{ productId: "red-tamales", variantId: "red-dozen", quantity: 3 }], menu, 825);
    expect(totals).toEqual({ subtotalCents: 10200, taxCents: 842, feeCents: 0, totalCents: 11042 });
    expect(calculateTax(1005, 870)).toBe(87);
    expect(calculateTax(5000, 0)).toBe(0);
  });

  it("rejects an unknown, inactive, sold out or POS-only menu item", () => {
    const tries = [
      { productId: "missing", variantId: "v", quantity: 1 },
      { productId: "red-tamales", variantId: "missing", quantity: 1 },
      { productId: "red-tamales", variantId: "red-old", quantity: 1 },
      { productId: "sold-out", variantId: "v", quantity: 1 },
      { productId: "pos-only", variantId: "v", quantity: 1 }
    ];
    for (const selection of tries) {
      expect(() => priceOrder([selection], menu, 870)).toThrow("is not available");
    }
  });

  it("enforces the minimum quantity and the size limit", () => {
    expect(() => priceOrder([{ productId: "red-tamales", variantId: "red-party", quantity: 1 }], menu, 870)).toThrow(
      "Party Tray has a minimum quantity of 2."
    );
    expect(() => priceOrder([{ productId: "red-tamales", variantId: "red-party", quantity: 42 }], menu, 870)).toThrow(
      "too large"
    );
  });

  it("reads the tax rate from settings, with the site default", () => {
    expect(taxRateFrom({ taxRateBps: 800 })).toBe(800);
    expect(taxRateFrom({ taxRateBps: 0 })).toBe(0);
    expect(taxRateFrom({})).toBe(DEFAULT_TAX_RATE_BPS);
    expect(taxRateFrom(null)).toBe(DEFAULT_TAX_RATE_BPS);
  });
});

describe("event check", () => {
  const now = new Date("2026-11-10T18:00:00Z");
  const open = {
    active: true,
    preordersEnabled: true,
    startsAtUtc: "2026-11-14T23:00:00Z",
    endsAtUtc: "2026-11-15T02:00:00Z",
    cutoffAtUtc: "2026-11-13T00:00:00Z",
    capacity: 20,
    committedOrders: 3
  };
  const check = (window: Record<string, unknown> | null, at = now) => () => assertWindowOpen(window, at, "America/Denver");

  it("accepts an open event", () => {
    expect(check(open)).not.toThrow();
    expect(check({ ...open, preordersEnabled: undefined, cutoffAtUtc: "" })).not.toThrow();
  });

  it("rejects a missing, inactive, closed, past, full or same-day event", () => {
    expect(check(null)).toThrow("does not take pre-orders");
    expect(check({ ...open, active: false })).toThrow();
    expect(check({ ...open, preordersEnabled: false })).toThrow();
    expect(check({ ...open, committedOrders: 20 })).toThrow();
    expect(check({ ...open, startsAtUtc: "" })).toThrow();
    expect(check(open, new Date("2026-11-13T00:00:00Z"))).toThrow(); // at the cutoff
    expect(check(open, new Date("2026-11-15T00:00:00Z"))).toThrow(); // started
    // 8:00 AM in Denver on the day of the event, with no cutoff.
    expect(check({ ...open, cutoffAtUtc: "" }, new Date("2026-11-14T15:00:00Z"))).toThrow();
  });
});

describe("order identifiers", () => {
  it("makes a token with 128 bits or more", () => {
    const token = newPublicToken();
    expect(token).toMatch(/^[0-9a-f]{48}$/);
    expect(newPublicToken()).not.toBe(token);
  });

  it("makes an order number", () => {
    expect(newOrderNumber(new Date("2026-11-13T00:00:00Z"))).toMatch(/^BBT-2026-[A-Z2-9]{5}$/);
  });
});

describe("order emails", () => {
  const order: SavedOrder = {
    id: "t",
    orderNumber: "BBT-2026-ABCDE",
    publicToken: "t",
    status: "new",
    paymentStatus: "unpaid",
    fulfillmentType: "event_pickup",
    availabilityWindowId: "window-1",
    customer: { name: "Jane <b>Doe</b>", mobile: "720-360-8688", email: "jane@example.com", preferredContact: "text", notes: "<script>alert(1)</script>" },
    bulk: { enabled: false, occasion: "", guestCount: "", desiredReadyTime: "", packagingRequest: "", additionalInstructions: "" },
    items: priceOrder([{ productId: "red-tamales", variantId: "red-dozen", quantity: 2 }], menu, 870).lines,
    totals: { subtotalCents: 6800, taxCents: 592, feeCents: 0, totalCents: 7392 },
    createdAtUtc: "2026-11-10T18:00:00.000Z",
    updatedAtUtc: "2026-11-10T18:00:00.000Z",
    privateNotes: "",
    vendorSessionId: ""
  };
  const window = { label: "Winter Market", startsAtUtc: "2026-11-15T00:00:00Z", endsAtUtc: "2026-11-15T03:00:00Z" };
  const cfg = { ownerEmail: "owner@example.com", siteOrigin: "https://bustostamales.com" };
  const emails = buildOrderEmails(order, window, "America/Denver", cfg);

  it("sends the customer email with the order number in the subject", () => {
    expect(emails.customer.to).toBe("jane@example.com");
    expect(emails.customer.subject).toBe("We received your order: BBT-2026-ABCDE");
    const html = buildEmailHtml(emails.customer.content);
    expect(html).toContain("Sat, Nov 14, 5:00 PM - 8:00 PM MT");
    expect(html).toContain("Tue, Nov 10, 11:00 AM MT");
    expect(html).toContain("$68.00");
    expect(html).toContain("$73.92");
    expect(html).not.toContain("alert(1)");
  });

  it("sends the owner alert with reply-to set to the customer", () => {
    expect(emails.owner.to).toBe("owner@example.com");
    expect(emails.owner.replyTo).toBe("jane@example.com");
    const html = buildEmailHtml(emails.owner.content);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>Doe</b>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain('href="https://bustostamales.com/admin"');
  });
});
