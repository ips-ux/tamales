// Build piece 3: the online ordering fee, PayPal Checkout, the expiry run, the sale at handover, refunds.
// No test calls the network. PayPal is a stub that records each request.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readConfig } from "../src/env";
import { EXPIRED_REASON, EXPIRY_CAP, expireUnpaidOrders, isOverdue, selectOverdue } from "../src/expiry";
import worker, { handleRequest, handleScheduled } from "../src/index";
import { runOrderAction } from "../src/orderAction";
import { createOrderV1 } from "../src/orderCreate";
import { readOrder, readOrdering, toTracker } from "../src/orderData";
import {
  captureMatches,
  capturePayment,
  checkPayable,
  createPayment,
  findOrderByTracker,
  payPalRequestId,
  validateCapturePayment,
  validateCreatePayment
} from "../src/payments";
import {
  centsToValue,
  clearPayPalTokenCache,
  payPalAccessToken,
  payPalBase,
  readCapture,
  readPayPalConfig,
  valueToCents,
  type PayPalConfig
} from "../src/paypal";
import { refundOrder, refundTaxCents, validateRefund } from "../src/refund";
import { saleItems } from "../src/sale";
import type { OrderRecord } from "../../shared/model";
import { fakeDefer, fakeFirestore, fakeMailer } from "./fakeFirestore";
import expirySource from "../src/expiry.ts?raw";
import paymentsSource from "../src/payments.ts?raw";
import paypalSource from "../src/paypal.ts?raw";
import refundSource from "../src/refund.ts?raw";
import saleSource from "../src/sale.ts?raw";

const cfg = readConfig({});
const EARLY = new Date("2026-11-12T18:00:00.000Z"); // before the pre-order cutoff
const LIVE_TIME = new Date("2026-11-15T01:00:00.000Z"); // during the event
const actor = { email: "owner@example.com", uid: "owner-uid" };

const event = {
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
  // No fee fields: the defaults apply (3.49% + $0.49, 50% share, 15 minutes, 72 hours).
  "settings/ordering": { pickupEnabled: true, deliveryEnabled: false, minBatchTamales: 12, minNoticeDays: 3 },
  "settings/orderingPrivate": { pickupAddress: "9 Secret Rd, Westminster", pickupInstructions: "Ring the bell." },
  "events/ev1": event,
  "events/evFixed": { ...event, preorderMode: "fixed", allotment: { red: 24, green: 6 }, itemIds: ["red", "green"] },
  "eventPrivate/ev1": { address: "500 Market St, Westminster", instructions: "Booth 4." },
  "eventPrivate/evFixed": { address: "500 Market St, Westminster", instructions: "Booth 4." },
  "inventory/red": { productId: "red", productName: "Red Tamales", stockCount: 100, updatedAtUtc: "" }
};

interface PayPalCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** 1 completed capture, as the capture call and the read call of PayPal return it. */
function captureBody(value = "37.85", capture: Record<string, unknown> = {}, status = "COMPLETED") {
  return {
    id: "PP-1",
    status,
    purchase_units: [
      {
        payments: {
          captures: [
            {
              id: "CAP-1",
              status: "COMPLETED",
              amount: { currency_code: "USD", value },
              seller_receivable_breakdown: { paypal_fee: { currency_code: "USD", value: "1.81" } },
              ...capture
            }
          ]
        }
      }
    ]
  };
}

function fakePayPal() {
  const calls: PayPalCall[] = [];
  const state = {
    create: () => Response.json({ id: "PP-1", status: "CREATED" }, { status: 201 }),
    capture: () => Response.json(captureBody(), { status: 201 }),
    read: () => Response.json(captureBody()),
    /** Runs when PayPal takes the money, before the answer comes back. */
    onCapture: undefined as (() => void) | undefined
  };
  const fetchFn = async (url: string, init: RequestInit = {}) => {
    calls.push({
      method: init.method ?? "GET",
      url,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === "string" ? init.body : ""
    });
    if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "tok", expires_in: 32400 });
    if (url.endsWith("/v2/checkout/orders")) return state.create();
    if (url.endsWith("/capture")) {
      state.onCapture?.();
      return state.capture();
    }
    return state.read();
  };
  const config: PayPalConfig = { env: "sandbox", clientId: "client", clientSecret: "secret", fetchFn };
  return { config, calls, state, apiCalls: () => calls.filter((call) => !call.url.endsWith("/token")) };
}

function setup(extra: Record<string, Record<string, unknown>> = {}) {
  const store = fakeFirestore({ ...seed, ...extra });
  const mail = fakeMailer();
  const deferred = fakeDefer();
  const paypal = fakePayPal();
  const base = { db: store.db, mailer: mail.mailer, cfg, defer: deferred.defer };
  return {
    ...store,
    ...mail,
    done: deferred.done,
    paypal,
    deps: { ...base, geocode: async () => null, actor },
    pay: { ...base, paypal: paypal.config as PayPalConfig | null }
  };
}

type Store = ReturnType<typeof setup>;

const customer = { firstName: "Jane", lastName: "Doe", email: "jane@example.com", phone: "", marketingOptIn: false };

function body(over: Record<string, unknown> = {}) {
  return {
    kind: "preorder",
    source: "web",
    eventId: "evFixed",
    kioskToken: "",
    items: [{ itemId: "red", variantId: "red-dozen", quantity: 1 }],
    customer,
    fulfillment: "event_pickup",
    deliveryAddress: "",
    requested: null,
    paymentMethod: "unset",
    customerNote: "",
    ...over
  };
}

const liveBody = (paymentMethod: string) =>
  body({ kind: "live", source: "mobile", eventId: "ev1", paymentMethod, items: [{ itemId: "red", variantId: "single", quantity: 3 }] });

function orderOf(store: Store, trackerToken: string): OrderRecord {
  const [id, data] = [...store.docs.entries()].find(
    ([key, doc]) => key.startsWith("orders/") && doc.trackerToken === trackerToken
  ) as [string, Record<string, unknown>];
  return readOrder(id.slice("orders/".length), data) as OrderRecord;
}

/** A fixed-allotment pre-order for 1 dozen: $34.00 + $2.96 tax + $0.89 fee = $37.85. */
async function fixedOrder(store: Store, now = EARLY) {
  const created = await createOrderV1(body(), store.deps, now);
  await store.done();
  store.sent.length = 0;
  return { token: created.trackerToken, order: orderOf(store, created.trackerToken) };
}

/** A fixed-allotment pre-order with a saved PayPal order id. */
async function startedOrder(store: Store) {
  const made = await fixedOrder(store);
  await createPayment({ trackerToken: made.token }, store.pay, EARLY);
  store.paypal.calls.length = 0;
  return made;
}

beforeEach(() => clearPayPalTokenCache());

describe("order creation with the online ordering fee", () => {
  it("reads the fee settings with the defaults", () => {
    expect(readOrdering(null)).toMatchObject({ holdMinutes: 15, paypalFeeBps: 349, paypalFeeFixedCents: 49, feeSharePct: 50 });
    expect(readOrdering({ holdMinutes: 20.7, paypalFeeBps: 299, paypalFeeFixedCents: 30, feeSharePct: 140 })).toMatchObject({
      holdMinutes: 20,
      paypalFeeBps: 299,
      paypalFeeFixedCents: 30,
      feeSharePct: 100
    });
    expect(readOrdering({ feeSharePct: 0 }).feeSharePct).toBe(0);
  });

  it("saves a fixed-allotment pre-order as approved, with the tamales held for the hold time", async () => {
    const store = setup();
    const created = await createOrderV1(body(), store.deps, EARLY);
    expect(created.state).toBe("approved");
    const order = orderOf(store, created.trackerToken);
    expect(order).toMatchObject({
      state: "approved",
      paymentState: "unpaid",
      paymentMethod: "paypal",
      stockHeld: true,
      approvedAtUtc: EARLY.toISOString(),
      payByUtc: "2026-11-12T18:15:00.000Z",
      // 3.49% of 3696 = 128.99. Plus 49 = 177.99. 50% = 89.
      totals: { subtotalCents: 3400, deliveryFeeCents: 0, onlineFeeCents: 89, taxCents: 296, totalCents: 3785 },
      paypalOrderId: "",
      paypalCaptureId: "",
      paypalFeeCents: 0,
      paidAtUtc: "",
      refundedCents: 0,
      saleId: ""
    });
    expect(store.docs.get("eventStock/evFixed")).toMatchObject({ remaining: { red: 12, green: 6 } });
    expect(store.docs.get(`trackers/${created.trackerToken}`)).toMatchObject({
      state: "approved",
      payByUtc: "2026-11-12T18:15:00.000Z",
      refundedCents: 0
    });

    await store.done();
    expect(store.sent).toHaveLength(1); // no owner alert: the order needs no approval
    const [message] = store.sent;
    expect(message.subject).toBe("We received your order: BBT-1001");
    expect(message.text).toContain("We hold your tamales for 15 minutes.");
    expect(message.text).toContain("Pay by: Thu, Nov 12, 11:15 AM MT");
    expect(message.text).toContain("Online ordering fee: $0.89");
    expect(message.text).toContain("Total: $37.85");
    expect(message.html).toContain("Pay Now");
    expect(message.html).toContain(`href="https://bustostamales.com/t/${created.trackerToken}"`);
    expect(message.html).not.toContain("500 Market St");
  });

  it("uses the hold time from the settings", async () => {
    const store = setup({ "settings/ordering": { holdMinutes: 30 } });
    const created = await createOrderV1(body(), store.deps, EARLY);
    expect(orderOf(store, created.trackerToken).payByUtc).toBe("2026-11-12T18:30:00.000Z");
    await store.done();
    expect(store.sent[0].text).toContain("We hold your tamales for 30 minutes.");
  });

  it("puts the fee on an open-interest pre-order and a batch request from the start", async () => {
    const store = setup();
    const open = await createOrderV1(body({ eventId: "ev1" }), store.deps, EARLY);
    expect(orderOf(store, open.trackerToken)).toMatchObject({
      state: "requested",
      paymentMethod: "paypal",
      paymentState: "unpaid",
      payByUtc: "",
      stockHeld: false,
      totals: { onlineFeeCents: 89, totalCents: 3785 }
    });
    const batch = await createOrderV1(
      body({
        kind: "batch",
        eventId: "",
        fulfillment: "pickup",
        requested: { date: "2026-11-20", timeRange: "5 PM" },
        items: [{ itemId: "red", variantId: "red-dozen", quantity: 2 }]
      }),
      store.deps,
      EARLY
    );
    // 6800 + 592 tax = 7392. 3.49% = 257.98. Plus 49 = 306.98. 50% = 153.
    expect(orderOf(store, batch.trackerToken)).toMatchObject({
      paymentMethod: "paypal",
      totals: { subtotalCents: 6800, onlineFeeCents: 153, taxCents: 592, totalCents: 7545 }
    });
  });

  it("live: PayPal Checkout has the fee and is unpaid; the other methods have no fee", async () => {
    const store = setup();
    const paypal = await createOrderV1(liveBody("paypal"), store.deps, LIVE_TIME);
    // 1200 + 104 tax = 1304. 3.49% = 45.51. Plus 49 = 94.51. 50% = 47.
    expect(orderOf(store, paypal.trackerToken)).toMatchObject({
      state: "received",
      paymentState: "unpaid",
      paymentMethod: "paypal",
      totals: { subtotalCents: 1200, onlineFeeCents: 47, taxCents: 104, totalCents: 1351 }
    });
    for (const method of ["venmo", "cashapp", "cash"]) {
      const created = await createOrderV1(liveBody(method), store.deps, LIVE_TIME);
      expect(orderOf(store, created.trackerToken)).toMatchObject({
        state: "received",
        paymentState: "check_payment",
        paymentMethod: method,
        totals: { onlineFeeCents: 0, totalCents: 1304 }
      });
    }
    await store.done();
    expect(store.sent[0].text).toContain("Open the order tracker to pay for your order.");
    expect(store.sent[0].html).toContain("Pay Now");
    expect(store.sent[1].html).not.toContain("Pay Now");
  });

  it("approve gives the pay-by time and a Pay Now button to the tracker", async () => {
    const store = setup();
    const created = await createOrderV1(body({ eventId: "ev1" }), store.deps, EARLY);
    const id = orderOf(store, created.trackerToken).id;
    await store.done();
    store.sent.length = 0;
    const { order } = await runOrderAction({ orderId: id, action: "approve" }, store.deps, EARLY);
    expect(order).toMatchObject({
      state: "approved",
      payByUtc: "2026-11-15T18:00:00.000Z",
      totals: { onlineFeeCents: 89, totalCents: 3785 }
    });
    expect(store.docs.get(`trackers/${order.trackerToken}`)).toMatchObject({ payByUtc: "2026-11-15T18:00:00.000Z" });
    await store.done();
    const [message] = store.sent;
    expect(message.subject).toBe("We approved your order: BBT-1001");
    expect(message.text).toContain("Pay by Sun, Nov 15, 11:00 AM MT to confirm it.");
    expect(message.text).toContain("Pay by: Sun, Nov 15, 11:00 AM MT");
    expect(message.text).toContain("Online ordering fee: $0.89");
    expect(message.text).not.toContain("payment link");
    expect(message.html).toContain("Pay Now");
    expect(message.html).toContain(`href="https://bustostamales.com/t/${order.trackerToken}"`);
  });

  it("mark paid by the owner sets the payment time", async () => {
    const store = setup();
    const { order } = await fixedOrder(store);
    const result = await runOrderAction({ orderId: order.id, action: "mark_paid" }, store.deps, EARLY);
    expect(result.order).toMatchObject({ state: "received", paymentState: "paid", paidAtUtc: EARLY.toISOString() });
  });
});

describe("PayPal client", () => {
  it("selects the host and reads the config", () => {
    expect(payPalBase({ env: "sandbox" })).toBe("https://api-m.sandbox.paypal.com");
    expect(payPalBase({ env: "live" })).toBe("https://api-m.paypal.com");
    expect(readPayPalConfig({})).toBeNull();
    expect(readPayPalConfig({ PAYPAL_CLIENT_ID: "id" })).toBeNull();
    expect(readPayPalConfig({ PAYPAL_CLIENT_SECRET: "secret" })).toBeNull();
    expect(readPayPalConfig({ PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" })).toMatchObject({ env: "sandbox" });
    expect(readPayPalConfig({ PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "s", PAYPAL_ENV: "live" })?.env).toBe("live");
    expect(readPayPalConfig({ PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "s", PAYPAL_ENV: "other" })?.env).toBe("sandbox");
  });

  it("changes cents to PayPal money text and back", () => {
    expect(centsToValue(1234)).toBe("12.34");
    expect(centsToValue(5)).toBe("0.05");
    expect(centsToValue(120000)).toBe("1200.00");
    expect(valueToCents("12.34")).toBe(1234);
    expect(valueToCents("12.3")).toBe(1230);
    expect(valueToCents("12")).toBe(1200);
    expect(valueToCents("0.07")).toBe(7);
    for (const bad of ["12.345", "-1.00", "1,200.00", "", "abc", 12.34, null, undefined]) {
      expect(valueToCents(bad)).toBeNull();
    }
  });

  it("gets the token with Basic auth and keeps it until it is near its end", async () => {
    const { config, calls } = fakePayPal();
    expect(await payPalAccessToken(config, 0)).toBe("tok");
    expect(await payPalAccessToken(config, 32_000_000)).toBe("tok");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://api-m.sandbox.paypal.com/v1/oauth2/token",
      body: "grant_type=client_credentials"
    });
    expect(calls[0].headers.Authorization).toBe(`Basic ${btoa("client:secret")}`);
    expect(calls[0].headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    // 9 hours less 60 seconds have passed: get a new token.
    await payPalAccessToken(config, 32_400_000 - 59_000);
    expect(calls).toHaveLength(2);
    // A different account does not use the token of the first one.
    await payPalAccessToken({ ...config, env: "live" }, 0);
    expect(calls[2].url).toBe("https://api-m.paypal.com/v1/oauth2/token");
  });

  it("throws when PayPal gives no token", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchFn = async () => Response.json({ error: "invalid_client" }, { status: 401 });
    await expect(payPalAccessToken({ env: "sandbox", clientId: "a", clientSecret: "b", fetchFn })).rejects.toThrow(
      "PayPal token call failed."
    );
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it("reads the capture with defaults for each field that is missing", () => {
    expect(readCapture(captureBody())).toEqual({
      orderStatus: "COMPLETED",
      captureId: "CAP-1",
      captureStatus: "COMPLETED",
      currency: "USD",
      amountCents: 3785,
      feeCents: 181
    });
    expect(readCapture({})).toEqual({
      orderStatus: "",
      captureId: "",
      captureStatus: "",
      currency: "",
      amountCents: null,
      feeCents: 0
    });
    expect(readCapture(captureBody("37.85", { seller_receivable_breakdown: undefined })).feeCents).toBe(0);
    expect(readCapture({ status: "COMPLETED", purchase_units: "x" }).captureId).toBe("");
    // A completed capture comes before a declined one.
    const two = captureBody();
    two.purchase_units[0].payments.captures.unshift({ id: "CAP-0", status: "DECLINED" } as never);
    expect(readCapture(two).captureId).toBe("CAP-1");
  });
});

describe("create payment", () => {
  it("validates the tracker token and the PayPal order id", () => {
    expect(validateCreatePayment({ trackerToken: "a".repeat(48) })).toEqual({ trackerToken: "a".repeat(48) });
    for (const trackerToken of ["", "short", "a/b".repeat(10), "a".repeat(200), 5, null, undefined]) {
      expect(() => validateCreatePayment({ trackerToken })).toThrow("The request is not valid.");
    }
    expect(() => validateCapturePayment({ trackerToken: "a".repeat(48), paypalOrderId: "../x" })).toThrow(
      "The request is not valid."
    );
    expect(() => validateCapturePayment({ trackerToken: "a".repeat(48) })).toThrow("The request is not valid.");
  });

  it("sends the PayPal order with the total, the order number and a stable request id", async () => {
    const store = setup();
    const { token, order } = await fixedOrder(store);
    const result = await createPayment({ trackerToken: token }, store.pay, EARLY);
    expect(result).toEqual({ paypalOrderId: "PP-1" });
    expect(orderOf(store, token).paypalOrderId).toBe("PP-1");

    const [tokenCall, create] = store.paypal.calls;
    expect(tokenCall.url).toBe("https://api-m.sandbox.paypal.com/v1/oauth2/token");
    expect(create.method).toBe("POST");
    expect(create.url).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders");
    expect(create.headers.Authorization).toBe("Bearer tok");
    expect(create.headers["Content-Type"]).toBe("application/json");
    expect(create.headers["PayPal-Request-Id"]).toBe(await payPalRequestId(order));
    expect(create.headers["PayPal-Request-Id"]).toMatch(/^[0-9a-f]{36}$/);
    expect(JSON.parse(create.body)).toEqual({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: { currency_code: "USD", value: "37.85" },
          invoice_id: `BBT-1001 [${order.id.slice(0, 8)}]`,
          custom_id: order.id,
          description: "BBT-1001 Jane Doe"
        }
      ],
      application_context: { shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW" }
    });

    // A second call sends the same request id, so PayPal makes no second order. The token is reused.
    await createPayment({ trackerToken: token }, store.pay, EARLY);
    expect(store.paypal.calls).toHaveLength(3);
    expect(store.paypal.calls[2].headers["PayPal-Request-Id"]).toBe(create.headers["PayPal-Request-Id"]);
    // A different total gives a different request id.
    const changed = { ...order, totals: { ...order.totals, totalCents: 4000 } };
    expect(await payPalRequestId(changed)).not.toBe(await payPalRequestId(order));
  });

  it("limits the description to 127 characters", async () => {
    const store = setup();
    const long = { ...customer, firstName: "J".repeat(60), lastName: "D".repeat(60) };
    const created = await createOrderV1(body({ customer: long }), store.deps, EARLY);
    await createPayment({ trackerToken: created.trackerToken }, store.pay, EARLY);
    const sent = JSON.parse(store.paypal.apiCalls()[0].body);
    expect(sent.purchase_units[0].description).toHaveLength(127);
  });

  it("refuses a token that is not found, a wrong method, a paid order and a late order", async () => {
    const store = setup();
    await expect(createPayment({ trackerToken: "f".repeat(48) }, store.pay, EARLY)).rejects.toMatchObject({
      status: 404,
      message: "We could not find this order."
    });

    const venmo = await createOrderV1(liveBody("venmo"), store.deps, LIVE_TIME);
    await expect(createPayment({ trackerToken: venmo.trackerToken }, store.pay, LIVE_TIME)).rejects.toMatchObject({
      status: 409,
      message: "This order does not use PayPal Checkout."
    });

    const requested = await createOrderV1(body({ eventId: "ev1" }), store.deps, EARLY);
    await expect(createPayment({ trackerToken: requested.trackerToken }, store.pay, EARLY)).rejects.toMatchObject({
      status: 409,
      message: "This order cannot be paid now."
    });

    const { token, order } = await fixedOrder(store);
    // 15 minutes after the order: the hold ended, and the scheduled run did not expire the order yet.
    const late = new Date(EARLY.getTime() + 15 * 60_000);
    await expect(createPayment({ trackerToken: token }, store.pay, late)).rejects.toMatchObject({
      status: 409,
      message: "The time to pay ended. Send a new order."
    });
    await runOrderAction({ orderId: order.id, action: "mark_paid" }, store.deps, EARLY);
    await expect(createPayment({ trackerToken: token }, store.pay, EARLY)).rejects.toMatchObject({
      status: 409,
      message: "This order is already paid."
    });
    expect(store.paypal.calls).toHaveLength(0);
  });

  it("lets a live order pay in each state that is not final", () => {
    const base = { kind: "live", paymentMethod: "paypal", paymentState: "unpaid", payByUtc: "", totals: { totalCents: 1351 } };
    for (const state of ["received", "preparing", "ready"]) {
      expect(() => checkPayable({ ...base, state } as OrderRecord, LIVE_TIME)).not.toThrow();
    }
    for (const state of ["handed_over", "canceled", "expired", "declined"]) {
      expect(() => checkPayable({ ...base, state } as OrderRecord, LIVE_TIME)).toThrow();
    }
    expect(() => checkPayable({ ...base, state: "received", kind: "preorder" } as OrderRecord, LIVE_TIME)).toThrow();
    expect(() => checkPayable({ ...base, state: "received", totals: { totalCents: 0 } } as OrderRecord, LIVE_TIME)).toThrow();
  });

  it("answers 503 with no PayPal account, and 502 when PayPal refuses", async () => {
    const store = setup();
    const { token } = await fixedOrder(store);
    await expect(createPayment({ trackerToken: token }, { ...store.pay, paypal: null }, EARLY)).rejects.toMatchObject({
      status: 503,
      message: "Online payment is not available now."
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    store.paypal.state.create = () => Response.json({ name: "INVALID_REQUEST" }, { status: 400 });
    await expect(createPayment({ trackerToken: token }, store.pay, EARLY)).rejects.toMatchObject({
      status: 502,
      message: "We could not start the payment. Try again."
    });
    // The Worker logs the answer of PayPal.
    expect(errors.mock.calls.some((call) => String(call[0]).includes("INVALID_REQUEST"))).toBe(true);
    errors.mockRestore();
    expect(orderOf(store, token).paypalOrderId).toBe("");
  });

  it("finds an order by its tracker token with 1 query", async () => {
    const store = setup();
    const { token, order } = await fixedOrder(store);
    store.calls.length = 0;
    expect((await findOrderByTracker(store.db, token))?.id).toBe(order.id);
    expect(store.calls).toHaveLength(1);
    expect(store.calls[0]).toMatchObject({ method: "POST", url: `${store.base}:runQuery` });
    expect(store.calls[0].body).toEqual({
      structuredQuery: {
        from: [{ collectionId: "orders" }],
        where: { fieldFilter: { field: { fieldPath: "trackerToken" }, op: "EQUAL", value: { stringValue: token } } },
        limit: 1
      }
    });
    expect(await findOrderByTracker(store.db, "0".repeat(48))).toBeNull();
  });
});

describe("capture payment", () => {
  it("marks the order paid and received for a completed capture of the exact total", async () => {
    const store = setup();
    const { token, order } = await startedOrder(store);
    const result = await capturePayment({ trackerToken: token, paypalOrderId: "PP-1" }, store.pay, EARLY);
    expect(result).toEqual({ paid: true });

    const capture = store.paypal.apiCalls()[0];
    expect(capture.method).toBe("POST");
    expect(capture.url).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders/PP-1/capture");
    expect(capture.headers).toMatchObject({
      Authorization: "Bearer tok",
      "Content-Type": "application/json",
      "PayPal-Request-Id": "capture-PP-1",
      Prefer: "return=representation"
    });
    expect(capture.body).toBe("{}");

    expect(orderOf(store, token)).toMatchObject({
      state: "received",
      paymentState: "paid",
      paidAtUtc: EARLY.toISOString(),
      paypalOrderId: "PP-1",
      paypalCaptureId: "CAP-1",
      paypalFeeCents: 181
    });
    expect(store.docs.get(`trackers/${token}`)).toMatchObject({ state: "received", paymentState: "paid" });
    expect(JSON.stringify(store.docs.get(`trackers/${token}`))).not.toContain("500 Market St");

    await store.done();
    expect(store.sent).toHaveLength(1);
    expect(store.sent[0].to).toEqual(["jane@example.com"]);
    expect(store.sent[0].subject).toBe("We received your payment: BBT-1001");
    expect(store.sent[0].html).toContain("500 Market St, Westminster");
    expect(store.sent[0].text).toContain("Online ordering fee: $0.89");

    // The owner cannot mark it unpaid after the capture.
    await expect(runOrderAction({ orderId: order.id, action: "mark_unpaid" }, store.deps, EARLY)).rejects.toMatchObject({
      status: 409
    });
  });

  it("is idempotent: a second call does not call PayPal and sends no second email", async () => {
    const store = setup();
    const { token } = await startedOrder(store);
    await capturePayment({ trackerToken: token, paypalOrderId: "PP-1" }, store.pay, EARLY);
    await store.done();
    const callCount = store.paypal.calls.length;
    expect(await capturePayment({ trackerToken: token, paypalOrderId: "PP-1" }, store.pay, EARLY)).toEqual({ paid: true });
    await store.done();
    expect(store.paypal.calls).toHaveLength(callCount);
    expect(store.sent).toHaveLength(1);
  });

  it("reads the capture that exists when PayPal says the order is already captured", async () => {
    const store = setup();
    const { token } = await startedOrder(store);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    store.paypal.state.capture = () =>
      Response.json({ name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_ALREADY_CAPTURED" }] }, { status: 422 });
    expect(await capturePayment({ trackerToken: token, paypalOrderId: "PP-1" }, store.pay, EARLY)).toEqual({ paid: true });
    errors.mockRestore();
    const [capture, read] = store.paypal.apiCalls();
    expect(capture.url).toContain("/v2/checkout/orders/PP-1/capture");
    expect(read).toMatchObject({ method: "GET", url: "https://api-m.sandbox.paypal.com/v2/checkout/orders/PP-1", body: "" });
    expect(orderOf(store, token)).toMatchObject({ paymentState: "paid", state: "received", paypalCaptureId: "CAP-1" });
  });

  it("refuses a PayPal order id that is not the saved one, and does not call PayPal", async () => {
    const store = setup();
    const { token } = await startedOrder(store);
    await expect(capturePayment({ trackerToken: token, paypalOrderId: "PP-OTHER" }, store.pay, EARLY)).rejects.toMatchObject({
      status: 409,
      message: "This payment does not match the order. Refresh the page, then try again."
    });
    // An order with no create call has no saved id.
    const fresh = await createOrderV1(body({ customer: { ...customer, email: "b@example.com" } }), store.deps, EARLY);
    await expect(
      capturePayment({ trackerToken: fresh.trackerToken, paypalOrderId: "PP-1" }, store.pay, EARLY)
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      capturePayment({ trackerToken: "f".repeat(48), paypalOrderId: "PP-1" }, store.pay, EARLY)
    ).rejects.toMatchObject({ status: 404 });
    expect(store.paypal.calls).toHaveLength(0);
    expect(orderOf(store, token).paymentState).toBe("unpaid");
  });

  it("refuses a capture with the wrong amount or currency, and alerts the owner", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const wrong of [captureBody("37.84"), captureBody("3785.00"), captureBody("37.85", { amount: { currency_code: "EUR", value: "37.85" } })]) {
      clearPayPalTokenCache();
      const store = setup();
      const { token } = await startedOrder(store);
      store.paypal.state.capture = () => Response.json(wrong, { status: 201 });
      await expect(capturePayment({ trackerToken: token, paypalOrderId: "PP-1" }, store.pay, EARLY)).rejects.toMatchObject({
        status: 409,
        message: "We could not confirm the payment. We will contact you."
      });
      expect(orderOf(store, token)).toMatchObject({ state: "approved", paymentState: "unpaid", paypalCaptureId: "" });
      await store.done();
      expect(store.sent).toHaveLength(1);
      expect(store.sent[0].to).toEqual([cfg.ownerEmail]);
      expect(store.sent[0].subject).toBe("Check a PayPal payment: BBT-1001");
      expect(store.sent[0].text).toContain("PayPal transaction: CAP-1");
    }
    errors.mockRestore();
  });

  it("refuses a payment that is not completed", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const answers: Array<() => Response> = [
      // The order is not completed.
      () => Response.json({ id: "PP-1", status: "APPROVED", purchase_units: [] }, { status: 201 }),
      // The capture waits at PayPal.
      () => Response.json(captureBody("37.85", { status: "PENDING" }), { status: 201 }),
      // The order status is missing.
      () => Response.json(captureBody("37.85", {}, ""), { status: 201 }),
      // PayPal refuses.
      () => Response.json({ name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_NOT_APPROVED" }] }, { status: 422 }),
      () => Response.json({ name: "UNPROCESSABLE_ENTITY", details: [{ issue: "INSTRUMENT_DECLINED" }] }, { status: 422 }),
      () => new Response("gateway error", { status: 502 })
    ];
    for (const answer of answers) {
      clearPayPalTokenCache();
      const store = setup();
      const { token } = await startedOrder(store);
      store.paypal.state.capture = answer;
      await expect(capturePayment({ trackerToken: token, paypalOrderId: "PP-1" }, store.pay, EARLY)).rejects.toMatchObject({
        status: expect.any(Number)
      });
      expect(orderOf(store, token)).toMatchObject({ state: "approved", paymentState: "unpaid", paidAtUtc: "" });
      await store.done();
      expect(store.sent.every((message) => message.to[0] === cfg.ownerEmail)).toBe(true); // no receipt
    }
    errors.mockRestore();
    expect(captureMatches(readCapture(captureBody()), { totals: { totalCents: 3785 } } as OrderRecord)).toBe(true);
    expect(captureMatches(readCapture({}), { totals: { totalCents: 0 } } as OrderRecord)).toBe(false);
  });

  it("refuses before PayPal takes the money when the order is expired or canceled now", async () => {
    const store = setup();
    const { token, order } = await startedOrder(store);
    await runOrderAction({ orderId: order.id, action: "cancel", reason: "Closed." }, store.deps, EARLY);
    await expect(capturePayment({ trackerToken: token, paypalOrderId: "PP-1" }, store.pay, EARLY)).rejects.toMatchObject({
      status: 409,
      message: "This order cannot be paid now."
    });
    store.docs.set(`orders/${order.id}`, { ...store.docs.get(`orders/${order.id}`), state: "expired" });
    await expect(capturePayment({ trackerToken: token, paypalOrderId: "PP-1" }, store.pay, EARLY)).rejects.toMatchObject({
      status: 409,
      message: "The time to pay ended. Send a new order."
    });
    expect(store.paypal.calls).toHaveLength(0);
  });

  it("paid after it expired: marks the order paid, keeps it expired and alerts the owner", async () => {
    const store = setup();
    const { token, order } = await startedOrder(store);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // The scheduled run expires the order while PayPal takes the money.
    store.paypal.state.onCapture = () => {
      store.docs.set(`orders/${order.id}`, { ...store.docs.get(`orders/${order.id}`), state: "expired", reason: EXPIRED_REASON });
    };
    expect(await capturePayment({ trackerToken: token, paypalOrderId: "PP-1" }, store.pay, EARLY)).toEqual({ paid: true });
    expect(errors.mock.calls.some((call) => String(call[0]).includes("was paid after it was expired"))).toBe(true);
    errors.mockRestore();

    expect(orderOf(store, token)).toMatchObject({
      state: "expired",
      paymentState: "paid",
      paidAtUtc: EARLY.toISOString(),
      paypalCaptureId: "CAP-1",
      paypalFeeCents: 181
    });
    expect(store.docs.get(`trackers/${token}`)).toMatchObject({ state: "expired", paymentState: "paid" });
    await store.done();
    expect(store.sent).toHaveLength(1); // the alert only; no receipt with the pickup address
    expect(store.sent[0].to).toEqual([cfg.ownerEmail]);
    expect(store.sent[0].subject).toBe("Paid after it expired — refund or fulfil: BBT-1001");
    expect(store.sent[0].text).toContain("BBT-1001");
    expect(store.sent[0].text).toContain("PayPal took: $37.85");
    expect(store.sent[0].text).toContain("Refund the payment in PayPal, or fulfil the order.");
  });

  it("alerts the owner when the owner marked the order paid while PayPal took the money", async () => {
    const store = setup();
    const { token, order } = await startedOrder(store);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    store.paypal.state.onCapture = () => {
      store.docs.set(`orders/${order.id}`, {
        ...store.docs.get(`orders/${order.id}`),
        state: "received",
        paymentState: "paid",
        paidAtUtc: "2026-11-12T17:59:00.000Z"
      });
    };
    await capturePayment({ trackerToken: token, paypalOrderId: "PP-1" }, store.pay, EARLY);
    errors.mockRestore();
    expect(orderOf(store, token)).toMatchObject({ paidAtUtc: "2026-11-12T17:59:00.000Z", paypalCaptureId: "CAP-1" });
    await store.done();
    expect(store.sent.map((message) => message.subject)).toEqual(["Paid 2 times — refund 1 payment: BBT-1001"]);
  });

  it("pays a live order and keeps its state", async () => {
    const store = setup();
    const created = await createOrderV1(liveBody("paypal"), store.deps, LIVE_TIME);
    const id = orderOf(store, created.trackerToken).id;
    await runOrderAction({ orderId: id, action: "prepare" }, store.deps, LIVE_TIME);
    await createPayment({ trackerToken: created.trackerToken }, store.pay, LIVE_TIME);
    expect(JSON.parse(store.paypal.apiCalls()[0].body).purchase_units[0]).toMatchObject({
      amount: { currency_code: "USD", value: "13.51" },
      invoice_id: `#1 - Nov 14 - Jane Doe [${id.slice(0, 8)}]`
    });
    store.paypal.state.capture = () => Response.json(captureBody("13.51"), { status: 201 });
    await capturePayment({ trackerToken: created.trackerToken, paypalOrderId: "PP-1" }, store.pay, LIVE_TIME);
    expect(orderOf(store, created.trackerToken)).toMatchObject({ state: "preparing", paymentState: "paid" });
  });
});

describe("expiry run", () => {
  const now = new Date("2026-11-12T19:00:00.000Z");
  const row = (over: Partial<OrderRecord>) =>
    ({ state: "approved", paymentState: "unpaid", payByUtc: "2026-11-12T18:15:00.000Z", ...over }) as OrderRecord;

  it("selects approved, unpaid orders with a pay-by time in the past", () => {
    expect(isOverdue(row({}), now)).toBe(true);
    expect(isOverdue(row({ payByUtc: now.toISOString() }), now)).toBe(false);
    expect(isOverdue(row({ payByUtc: "2026-11-12T19:00:01.000Z" }), now)).toBe(false);
    expect(isOverdue(row({ payByUtc: "" }), now)).toBe(false);
    expect(isOverdue(row({ payByUtc: "not a date" }), now)).toBe(false);
    expect(isOverdue(row({ paymentState: "paid" }), now)).toBe(false);
    expect(isOverdue(row({ paymentState: "check_payment" }), now)).toBe(false);
    for (const state of ["requested", "received", "preparing", "ready", "handed_over", "canceled", "expired", "declined"]) {
      expect(isOverdue(row({ state: state as OrderRecord["state"] }), now)).toBe(false);
    }
  });

  it("takes the oldest orders first, up to the cap", () => {
    const rows = [
      row({ id: "c", payByUtc: "2026-11-12T18:30:00.000Z" }),
      row({ id: "a", payByUtc: "2026-11-12T18:00:00.000Z" }),
      row({ id: "paid", paymentState: "paid" }),
      row({ id: "b", payByUtc: "2026-11-12T18:10:00.000Z" })
    ];
    expect(selectOverdue(rows, now).map((order) => order.id)).toEqual(["a", "b", "c"]);
    expect(selectOverdue(rows, now, 2).map((order) => order.id)).toEqual(["a", "b"]);
    expect(selectOverdue(rows, now, 0)).toEqual([]);
    expect(EXPIRY_CAP).toBeLessThanOrEqual(9); // 50 subrequests on the free plan
  });

  it("expires a late fixed-allotment pre-order, returns its tamales and sends the email", async () => {
    const store = setup();
    const { token } = await fixedOrder(store);
    const paid = await createOrderV1(body({ customer: { ...customer, email: "paid@example.com" } }), store.deps, EARLY);
    await runOrderAction({ orderId: orderOf(store, paid.trackerToken).id, action: "mark_paid" }, store.deps, EARLY);
    const live = await createOrderV1(liveBody("paypal"), store.deps, LIVE_TIME);
    await store.done();
    store.sent.length = 0;
    expect(store.docs.get("eventStock/evFixed")).toMatchObject({ remaining: { red: 0, green: 6 } });

    // 1 minute before the hold ends: nothing occurs.
    expect(await expireUnpaidOrders(store.deps, new Date("2026-11-12T18:14:00.000Z"))).toEqual([]);
    expect(orderOf(store, token).state).toBe("approved");

    store.calls.length = 0;
    expect(await expireUnpaidOrders(store.deps, now)).toEqual(["BBT-1001"]);
    expect(store.calls[0].body).toMatchObject({
      structuredQuery: {
        from: [{ collectionId: "orders" }],
        where: { fieldFilter: { field: { fieldPath: "state" }, op: "EQUAL", value: { stringValue: "approved" } } }
      }
    });
    expect(orderOf(store, token)).toMatchObject({
      state: "expired",
      paymentState: "unpaid",
      reason: "We did not receive the payment in time.",
      updatedAtUtc: now.toISOString()
    });
    expect(store.docs.get(`trackers/${token}`)).toMatchObject({ state: "expired", reason: EXPIRED_REASON });
    expect(store.docs.get("eventStock/evFixed")).toMatchObject({ remaining: { red: 12, green: 6 } });
    // The paid order and the live order stay.
    expect(orderOf(store, paid.trackerToken)).toMatchObject({ state: "received", paymentState: "paid" });
    expect(orderOf(store, live.trackerToken)).toMatchObject({ state: "received", paymentState: "unpaid" });

    expect(store.sent).toHaveLength(1);
    expect(store.sent[0].to).toEqual(["jane@example.com"]);
    expect(store.sent[0].subject).toBe("Your order expired: BBT-1001");
    expect(store.sent[0].text).toContain("We did not receive the payment in time.");

    // A second run finds nothing, and the customer cannot pay.
    expect(await expireUnpaidOrders(store.deps, now)).toEqual([]);
    expect(store.docs.get("eventStock/evFixed")).toMatchObject({ remaining: { red: 12, green: 6 } });
    await expect(createPayment({ trackerToken: token }, store.pay, now)).rejects.toMatchObject({ status: 409 });
  });

  it("expires an approved order with no stock hold after the payment limit, and changes no stock", async () => {
    const store = setup();
    const created = await createOrderV1(body({ eventId: "ev1" }), store.deps, EARLY);
    const id = orderOf(store, created.trackerToken).id;
    await runOrderAction({ orderId: id, action: "approve" }, store.deps, EARLY);
    expect(await expireUnpaidOrders(store.deps, new Date("2026-11-15T17:59:00.000Z"))).toEqual([]);
    expect(await expireUnpaidOrders(store.deps, new Date("2026-11-15T18:00:01.000Z"))).toEqual(["BBT-1001"]);
    expect(orderOf(store, created.trackerToken).state).toBe("expired");
    expect(store.docs.has("eventStock/ev1")).toBe(false);
  });

  it("does not expire an order that was paid after the query", async () => {
    const store = setup();
    const { token, order } = await fixedOrder(store);
    const realGet = store.db.get.bind(store.db);
    // The capture lands between the query and the transaction read.
    store.db.get = async (path: string, transaction?: string) => {
      if (transaction && path === `orders/${order.id}`) {
        store.docs.set(path, { ...store.docs.get(path), state: "received", paymentState: "paid" });
      }
      return realGet(path, transaction);
    };
    expect(await expireUnpaidOrders(store.deps, now)).toEqual([]);
    expect(orderOf(store, token)).toMatchObject({ state: "received", paymentState: "paid" });
    expect(store.docs.get("eventStock/evFixed")).toMatchObject({ remaining: { red: 12, green: 6 } });
    expect(store.sent).toHaveLength(0);
  });

  it("stops at the cap and continues in the next run", async () => {
    const store = setup({ "events/evFixed": { ...seed["events/evFixed"], allotment: { red: 240, green: 6 } } });
    for (let index = 0; index < 5; index += 1) {
      await createOrderV1(body({ customer: { ...customer, email: `c${index}@example.com` } }), store.deps, EARLY);
    }
    expect(store.docs.get("eventStock/evFixed")).toMatchObject({ remaining: { red: 180 } });
    expect(await expireUnpaidOrders(store.deps, now, 2)).toHaveLength(2);
    expect(store.docs.get("eventStock/evFixed")).toMatchObject({ remaining: { red: 204 } });
    expect(await expireUnpaidOrders(store.deps, now, 2)).toHaveLength(2);
    expect(await expireUnpaidOrders(store.deps, now, 2)).toHaveLength(1);
    expect(await expireUnpaidOrders(store.deps, now, 2)).toHaveLength(0);
    expect(store.docs.get("eventStock/evFixed")).toMatchObject({ remaining: { red: 240 } });
  });

  it("continues with the next order when 1 order fails", async () => {
    const store = setup({ "events/evFixed": { ...seed["events/evFixed"], allotment: { red: 240, green: 6 } } });
    const first = await createOrderV1(body(), store.deps, EARLY);
    const second = await createOrderV1(body({ customer: { ...customer, email: "b@example.com" } }), store.deps, new Date(EARLY.getTime() + 1000));
    const firstId = orderOf(store, first.trackerToken).id;
    const realGet = store.db.get.bind(store.db);
    store.db.get = async (path: string, transaction?: string) => {
      if (transaction && path === `orders/${firstId}`) throw new Error("read failed");
      return realGet(path, transaction);
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await expireUnpaidOrders(store.deps, now)).toEqual(["BBT-1002"]);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
    expect(orderOf(store, second.trackerToken).state).toBe("expired");
  });

  it("the scheduled handler does nothing with no service account", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(handleScheduled({})).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
    expect(typeof worker.scheduled).toBe("function");
  });
});

describe("handover writes the sale", () => {
  const items = [
    { itemId: "red", variantId: "red-dozen", quantity: 1 },
    { itemId: "red", variantId: "red-half", quantity: 2 },
    { itemId: "green", variantId: "green-half", quantity: 1 },
    { itemId: "green", variantId: "single", quantity: 2 }
  ];

  async function paidOrder(store: Store) {
    const created = await createOrderV1(body({ eventId: "ev1", items }), store.deps, EARLY);
    const id = orderOf(store, created.trackerToken).id;
    await runOrderAction({ orderId: id, action: "approve" }, store.deps, EARLY);
    await createPayment({ trackerToken: created.trackerToken }, store.pay, EARLY);
    // 9600 + 835 tax = 10435. 3.49% = 364.18. Plus 49 = 413.18. 50% = 207. Total 10642.
    store.paypal.state.capture = () => Response.json(captureBody("106.42", { seller_receivable_breakdown: { paypal_fee: { currency_code: "USD", value: "4.20" } } }), { status: 201 });
    await capturePayment({ trackerToken: created.trackerToken, paypalOrderId: "PP-1" }, store.pay, EARLY);
    await runOrderAction({ orderId: id, action: "ready" }, store.deps, EARLY);
    return { id, token: created.trackerToken };
  }

  it("maps each line to tamales and a price for 1 tamale, when the line total divides", () => {
    const line = (unitTamales: number, unitPriceCents: number, quantity: number, variantLabel: string) => ({
      itemId: "red",
      variantId: "v",
      itemName: "Red Tamales",
      variantLabel,
      unitTamales,
      unitPriceCents,
      quantity,
      lineTotalCents: unitPriceCents * quantity
    });
    expect(saleItems([line(6, 1800, 2, "Half dozen"), line(1, 400, 3, "Single")])).toEqual([
      { productId: "red", productName: "Red Tamales", quantity: 12, unitPriceCents: 300 },
      { productId: "red", productName: "Red Tamales", quantity: 3, unitPriceCents: 400 }
    ]);
    // $34.00 for 12 does not divide into whole cents: the line keeps the units of the variant.
    expect(saleItems([line(12, 3400, 2, "Dozen")])).toEqual([
      { productId: "red", productName: "Red Tamales, Dozen", quantity: 2, unitPriceCents: 3400 }
    ]);
    // 3 dozen for $102.00: 10200 / 36 is not a whole number of cents, so it also keeps the units.
    expect(saleItems([line(12, 3400, 3, "Dozen")])[0].quantity).toBe(3);
  });

  it("writes 1 posTickets sale that sums to the order totals, and moves the inventory", async () => {
    const store = setup();
    const { id, token } = await paidOrder(store);
    const handedAt = new Date("2026-11-15T01:30:00.000Z");
    const { order } = await runOrderAction({ orderId: id, action: "hand_over" }, store.deps, handedAt);
    expect(order).toMatchObject({ state: "handed_over", saleId: id });
    expect(store.docs.get(`orders/${id}`)).toMatchObject({ state: "handed_over", saleId: id });
    expect(store.docs.get(`trackers/${token}`)).toMatchObject({ state: "handed_over" });

    const sale = store.docs.get(`posTickets/${id}`) as Record<string, number> & { items: Array<{ quantity: number; unitPriceCents: number }> };
    expect(store.all("posTickets")).toHaveLength(1);
    expect(sale).toEqual({
      items: [
        { productId: "red", productName: "Red Tamales, Dozen", quantity: 1, unitPriceCents: 3400 },
        { productId: "red", productName: "Red Tamales", quantity: 12, unitPriceCents: 300 },
        { productId: "green", productName: "Green Tamales", quantity: 6, unitPriceCents: 300 },
        { productId: "green", productName: "Green Tamales", quantity: 2, unitPriceCents: 400 }
      ],
      subtotalCents: 9600,
      taxCents: 835,
      totalCents: 10642,
      paymentMethod: "paypal",
      customerName: "Jane Doe",
      isTest: false,
      status: "paid",
      createdAtUtc: handedAt.toISOString(),
      soldByEmail: "owner@example.com",
      soldByUid: "owner-uid",
      source: "order",
      orderId: id,
      orderKind: "preorder",
      ticketNumber: "BBT-1001",
      deliveryFeeCents: 0,
      onlineFeeCents: 207,
      paypalFeeCents: 420
    });
    const itemSum = sale.items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
    expect(itemSum).toBe(sale.subtotalCents);
    expect(sale.subtotalCents + sale.taxCents + sale.deliveryFeeCents + sale.onlineFeeCents).toBe(sale.totalCents);
    expect(sale.totalCents).toBe(order.totals.totalCents);

    // Red: 12 + 12 tamales leave 100. Green had no inventory document: it starts at 0.
    expect(store.docs.get("inventory/red")).toEqual({
      productId: "red",
      productName: "Red Tamales",
      stockCount: 76,
      updatedAtUtc: handedAt.toISOString()
    });
    expect(store.docs.get("inventory/green")).toMatchObject({ productId: "green", productName: "Green Tamales", stockCount: -8 });

    // A handed-over order takes no second handover, so there is no second sale.
    await expect(runOrderAction({ orderId: id, action: "hand_over" }, store.deps, handedAt)).rejects.toMatchObject({ status: 409 });
    expect(store.docs.get("inventory/red")).toMatchObject({ stockCount: 76 });
  });

  it("writes the order, the tracker, the sale and the inventory in 1 commit", async () => {
    const store = setup();
    const { id } = await paidOrder(store);
    store.calls.length = 0;
    store.state.abortCommits = 1; // Firestore aborts the first commit; the work runs again
    await runOrderAction({ orderId: id, action: "hand_over" }, store.deps, LIVE_TIME);
    const commits = store.calls.filter((call) => call.url.endsWith(":commit"));
    expect(commits).toHaveLength(2);
    const names = ((commits[1].body as { writes: Array<{ update: { name: string } }> }).writes).map((write) =>
      write.update.name.slice(store.root.length + 1).split("/")[0]
    );
    expect(names.sort()).toEqual(["inventory", "inventory", "orders", "posTickets", "trackers"]);
    expect(store.docs.get("inventory/red")).toMatchObject({ stockCount: 76 });
    expect(store.all("posTickets")).toHaveLength(1);
  });

  it("refuses an order that is not paid, and writes no sale", async () => {
    const store = setup();
    const created = await createOrderV1(liveBody("cash"), store.deps, LIVE_TIME);
    const id = orderOf(store, created.trackerToken).id;
    await expect(runOrderAction({ orderId: id, action: "hand_over" }, store.deps, LIVE_TIME)).rejects.toThrow(
      "Mark the order as paid first."
    );
    expect(store.all("posTickets")).toHaveLength(0);
    expect(store.docs.get("inventory/red")).toMatchObject({ stockCount: 100 });
    expect(store.docs.get(`orders/${id}`)).toMatchObject({ state: "received", saleId: "" });

    // The owner takes the cash, marks the order paid, and hands it over.
    await runOrderAction({ orderId: id, action: "mark_paid" }, store.deps, LIVE_TIME);
    await runOrderAction({ orderId: id, action: "hand_over" }, store.deps, LIVE_TIME);
    expect(store.docs.get(`posTickets/${id}`)).toMatchObject({
      items: [{ productId: "red", productName: "Red Tamales", quantity: 3, unitPriceCents: 400 }],
      subtotalCents: 1200,
      taxCents: 104,
      totalCents: 1304,
      paymentMethod: "cash",
      orderKind: "live",
      ticketNumber: "#1 - Nov 14 - Jane Doe",
      onlineFeeCents: 0,
      paypalFeeCents: 0
    });
    expect(store.docs.get("inventory/red")).toMatchObject({ stockCount: 97 });
  });
});

describe("refund", () => {
  async function paidFixed(store: Store) {
    const made = await startedOrder(store);
    await capturePayment({ trackerToken: made.token, paypalOrderId: "PP-1" }, store.pay, EARLY);
    await store.done();
    store.sent.length = 0;
    return made;
  }
  const refundDeps = (store: Store) => ({ ...store.deps, actor });

  it("validates the amount and the reason", () => {
    expect(validateRefund({ orderId: "o1", amountCents: 500, reason: " Late. ", cancelOrder: "yes" })).toEqual({
      orderId: "o1",
      amountCents: 500,
      reason: "Late.",
      cancelOrder: false
    });
    for (const amountCents of [0, -1, 1.5, "5", null, undefined]) {
      expect(() => validateRefund({ orderId: "o1", amountCents, reason: "x" })).toThrow("Enter a valid refund amount.");
    }
    expect(() => validateRefund({ orderId: "o1", amountCents: 5, reason: "  " })).toThrow("Enter the reason for the refund.");
    expect(() => validateRefund({ orderId: "a/b", amountCents: 5, reason: "x" })).toThrow("The request is not valid.");
  });

  it("splits the tax so that a full refund gives back the exact tax", () => {
    const totals = { taxCents: 296, totalCents: 3785 };
    expect(refundTaxCents(totals, 0, 3785)).toBe(296);
    expect(refundTaxCents(totals, 0, 1000)).toBe(78); // 1000 x 296 / 3785 = 78.2
    expect(refundTaxCents(totals, 1000, 2785)).toBe(218);
    const parts = [1, 999, 1262, 1523].map((amount, index, all) =>
      refundTaxCents(totals, all.slice(0, index).reduce((sum, value) => sum + value, 0), amount)
    );
    expect(parts.reduce((sum, value) => sum + value, 0)).toBe(296);
    expect(refundTaxCents({ taxCents: 0, totalCents: 0 }, 0, 100)).toBe(0);
  });

  it("records a partial refund, then the full refund, and refuses more than the total", async () => {
    const store = setup();
    const { token, order } = await paidFixed(store);
    const when = new Date("2026-11-12T20:00:00.000Z");
    const first = await refundOrder({ orderId: order.id, amountCents: 1000, reason: "1 tamale was cold.", cancelOrder: false }, refundDeps(store), when);
    expect(first.order).toMatchObject({ refundedCents: 1000, paymentState: "paid", state: "received" });
    expect(store.docs.get(`orders/${order.id}`)).toMatchObject({ refundedCents: 1000, paymentState: "paid" });
    expect(store.docs.get(`trackers/${token}`)).toMatchObject({ refundedCents: 1000, paymentState: "paid" });
    const entries = () => store.all("ledgerEntries") as unknown as Array<Record<string, unknown>>;
    expect(entries()).toHaveLength(1);
    expect(entries()[0]).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      type: "refund",
      saleId: "",
      orderId: order.id,
      reference: "BBT-1001",
      amountCents: 1000,
      taxCents: 78,
      reason: "1 tamale was cold.",
      detail: "",
      byEmail: "owner@example.com",
      isTest: false,
      createdAtUtc: when.toISOString()
    });
    expect(store.docs.has(`ledgerEntries/${entries()[0].id}`)).toBe(true);

    await store.done();
    expect(store.sent).toHaveLength(1);
    expect(store.sent[0].to).toEqual(["jane@example.com"]);
    expect(store.sent[0].subject).toBe("We sent your refund: BBT-1001");
    expect(store.sent[0].text).toContain("We sent your refund of $10.00.");
    expect(store.sent[0].text).toContain("1 tamale was cold.");

    // $27.85 is left. $27.86 is over the limit.
    await expect(
      refundOrder({ orderId: order.id, amountCents: 2786, reason: "x", cancelOrder: false }, refundDeps(store), when)
    ).rejects.toMatchObject({ status: 400, message: "The largest refund for this order is $27.85." });
    expect(entries()).toHaveLength(1);

    const second = await refundOrder({ orderId: order.id, amountCents: 2785, reason: "Rest.", cancelOrder: false }, refundDeps(store), when);
    expect(second.order).toMatchObject({ refundedCents: 3785, paymentState: "refunded", state: "received" });
    expect(entries()).toHaveLength(2);
    expect(entries().reduce((sum, entry) => sum + (entry.taxCents as number), 0)).toBe(296);
    expect(store.docs.get(`trackers/${token}`)).toMatchObject({ refundedCents: 3785, paymentState: "refunded" });
    // The stock stays held: the owner did not cancel the order.
    expect(store.docs.get("eventStock/evFixed")).toMatchObject({ remaining: { red: 12 } });

    await expect(
      refundOrder({ orderId: order.id, amountCents: 1, reason: "x", cancelOrder: false }, refundDeps(store), when)
    ).rejects.toMatchObject({ status: 409, message: "This order is fully refunded." });
  });

  it("with cancel: cancels the order, returns the held tamales and tells the customer", async () => {
    const store = setup();
    const { token, order } = await paidFixed(store);
    expect(store.docs.get("eventStock/evFixed")).toMatchObject({ remaining: { red: 12 } });
    const result = await refundOrder(
      { orderId: order.id, amountCents: 3785, reason: "The event is canceled.", cancelOrder: true },
      refundDeps(store)
    );
    expect(result.order).toMatchObject({
      state: "canceled",
      paymentState: "refunded",
      refundedCents: 3785,
      reason: "The event is canceled."
    });
    expect(store.docs.get(`trackers/${token}`)).toMatchObject({ state: "canceled", reason: "The event is canceled." });
    expect(store.docs.get("eventStock/evFixed")).toMatchObject({ remaining: { red: 24, green: 6 } });
    expect(store.all("ledgerEntries")[0]).toMatchObject({ amountCents: 3785, taxCents: 296, saleId: "" });
    await store.done();
    expect(store.sent[0].text).toContain("We canceled this order and sent your refund of $37.85.");
  });

  it("after handover: links the entry to the sale, does not cancel, and changes no stock or inventory", async () => {
    const store = setup();
    const { order } = await paidFixed(store);
    await runOrderAction({ orderId: order.id, action: "ready" }, store.deps, LIVE_TIME);
    await runOrderAction({ orderId: order.id, action: "hand_over" }, store.deps, LIVE_TIME);
    const saleBefore = JSON.stringify(store.docs.get(`posTickets/${order.id}`));
    const result = await refundOrder({ orderId: order.id, amountCents: 500, reason: "Short 1.", cancelOrder: true }, refundDeps(store));
    expect(result.order).toMatchObject({ state: "handed_over", refundedCents: 500, paymentState: "paid" });
    expect(store.all("ledgerEntries")[0]).toMatchObject({ saleId: order.id, orderId: order.id, taxCents: 39 });
    expect(JSON.stringify(store.docs.get(`posTickets/${order.id}`))).toBe(saleBefore); // the sale is never changed
    expect(store.docs.get("eventStock/evFixed")).toMatchObject({ remaining: { red: 12 } });
    expect(store.docs.get("inventory/red")).toMatchObject({ stockCount: 88 });
  });

  it("refuses an order that is not paid or not found", async () => {
    const store = setup();
    const { order } = await fixedOrder(store);
    await expect(
      refundOrder({ orderId: order.id, amountCents: 100, reason: "x", cancelOrder: false }, refundDeps(store))
    ).rejects.toMatchObject({ status: 409, message: "This order is not paid." });
    await expect(
      refundOrder({ orderId: "none", amountCents: 100, reason: "x", cancelOrder: false }, refundDeps(store))
    ).rejects.toMatchObject({ status: 404 });
    expect(store.all("ledgerEntries")).toHaveLength(0);
  });

  it("makes 1 ledger entry when Firestore aborts the first commit", async () => {
    const store = setup();
    const { order } = await paidFixed(store);
    store.state.abortCommits = 1;
    await refundOrder({ orderId: order.id, amountCents: 100, reason: "x", cancelOrder: false }, refundDeps(store));
    expect(store.all("ledgerEntries")).toHaveLength(1);
    expect(store.docs.get(`orders/${order.id}`)).toMatchObject({ refundedCents: 100 });
  });
});

describe("money routes", () => {
  const API = "https://bbt-api.example.workers.dev";
  const post = (path: string, payload: unknown, env: Record<string, string> = {}) =>
    handleRequest(
      new Request(`${API}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://bustostamales.com" },
        body: JSON.stringify(payload)
      }),
      env,
      () => undefined
    );

  it("answers 503 on the payment routes when PayPal is not set", async () => {
    for (const path of ["/api/v1/payments/create", "/api/v1/payments/capture"]) {
      const response = await post(path, { trackerToken: "a".repeat(48), paypalOrderId: "PP-1" });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false, error: "Online payment is not available now." });
    }
    // The client id alone is not enough.
    const half = await post("/api/v1/payments/create", { trackerToken: "a".repeat(48) }, { PAYPAL_CLIENT_ID: "id" });
    expect(half.status).toBe(503);
  });

  it("goes past the PayPal check when the client id and the secret are set", async () => {
    const env = { PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
    const response = await post("/api/v1/payments/create", { trackerToken: "x" }, env);
    // No service account in the test: the database answers 503 with its own text.
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: string }).error).not.toBe("Online payment is not available now.");
  });

  it("requires the owner for a refund", async () => {
    const response = await post("/api/admin/orders/refund", { orderId: "o1", amountCents: 100, reason: "x", cancelOrder: false });
    expect(response.status).toBe(401);
  });
});

describe("fetch receiver in the money modules", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("calls the global fetch without a receiver", async () => {
    const strictFetch = vi.fn(function (this: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(Response.json({ access_token: "tok", expires_in: 300 }));
    });
    globalThis.fetch = strictFetch as unknown as typeof fetch;
    // No `fetchFn`: the module uses its wrapper of the global fetch.
    await expect(payPalAccessToken({ env: "sandbox", clientId: "id", clientSecret: "secret" })).resolves.toBe("tok");
    expect(strictFetch).toHaveBeenCalledTimes(1);
  });

  it("no new module calls fetch through `this` or keeps the bare global fetch", () => {
    const sources: Record<string, string> = {
      expiry: expirySource,
      payments: paymentsSource,
      paypal: paypalSource,
      refund: refundSource,
      sale: saleSource
    };
    for (const [name, source] of Object.entries(sources)) {
      const code = source
        .split("\n")
        .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*") && !line.trim().startsWith("/*"))
        .join("\n");
      expect(code, name).not.toMatch(/this\.\w*fetch\w*\s*\(/i);
      // `= fetch` or `?? fetch` passes the global itself. Only an arrow wrapper can call it.
      expect(code, name).not.toMatch(/(=|\?\?|\|\||:)\s*fetch\s*[;,)\n]/);
    }
    expect(paypalSource).toContain("(input, init) => fetch(input, init)");
    // Only paypal.ts calls fetch. The other modules use the Firestore client and the mailer.
    for (const name of ["expiry", "payments", "refund", "sale"]) {
      expect(sources[name], name).not.toMatch(/[^\w.]fetch\s*\(/);
    }
  });
});

describe("tracker of an order from build piece 2", () => {
  it("reads an order with no money fields and gives each one its empty value", () => {
    const old = {
      kind: "preorder",
      state: "approved",
      items: [],
      totals: { subtotalCents: 0, deliveryFeeCents: 0, onlineFeeCents: 0, taxCents: 0, totalCents: 0 },
      customer: { firstName: "Jane" },
      trackerToken: "t".repeat(48)
    };
    const order = readOrder("o1", old) as OrderRecord;
    expect(order).toMatchObject({
      payByUtc: "",
      paypalOrderId: "",
      paypalCaptureId: "",
      paypalFeeCents: 0,
      paidAtUtc: "",
      refundedCents: 0,
      saleId: "",
      stockHeld: false
    });
    expect(toTracker(order)).toMatchObject({ payByUtc: "", refundedCents: 0 });
    // No pay-by time: the scheduled run leaves the order.
    expect(isOverdue({ ...order, paymentState: "unpaid" }, new Date())).toBe(false);
  });
});
