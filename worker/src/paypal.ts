// PayPal Checkout through the REST API. No SDK.
//   OAuth:    POST /v1/oauth2/token
//   Create:   POST /v2/checkout/orders
//   Capture:  POST /v2/checkout/orders/{id}/capture
//   Read:     GET  /v2/checkout/orders/{id}
// https://developer.paypal.com/docs/api/orders/v2/
//
// Each function takes `fetchFn` in the config, so a test gives a stub. The default
// wraps the global fetch in an arrow function. Never store the global fetch on an
// object and call it through `this`: Workers then throw "Illegal invocation".

import type { Env } from "./env";

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const defaultFetch: FetchFn = (input, init) => fetch(input, init);

export interface PayPalConfig {
  env: "sandbox" | "live";
  clientId: string;
  clientSecret: string;
  fetchFn?: FetchFn;
}

/** Returns null when the client id or the secret is missing. */
export function readPayPalConfig(env: Env): PayPalConfig | null {
  const clientId = (env.PAYPAL_CLIENT_ID ?? "").trim();
  const clientSecret = (env.PAYPAL_CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret) return null;
  return { env: env.PAYPAL_ENV === "live" ? "live" : "sandbox", clientId, clientSecret };
}

export function payPalBase(config: Pick<PayPalConfig, "env">): string {
  return config.env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

/** PayPal did not accept a call. `issue` is the first issue code of the answer, if it has one. */
export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issue: string
  ) {
    super(message);
    this.name = "PayPalError";
  }
}

type Json = Record<string, unknown>;

function asObject(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** "12.34" from 1234. PayPal takes USD as text with 2 decimals. */
export function centsToValue(cents: number): string {
  const whole = Math.round(cents);
  return `${Math.floor(whole / 100)}.${String(whole % 100).padStart(2, "0")}`;
}

/** 1234 from "12.34". Returns null for text that is not a money value. */
export function valueToCents(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

async function readJson(response: Response): Promise<{ body: Json; raw: string }> {
  const raw = await response.text();
  try {
    return { body: asObject(JSON.parse(raw)), raw };
  } catch {
    return { body: {}, raw };
  }
}

function firstIssue(body: Json): string {
  return asText(asObject(asList(body.details)[0]).issue) || asText(body.name);
}

// The access token, kept until it is near its end. 1 Worker isolate uses 1 PayPal account.
let cachedToken: { key: string; token: string; expiresAtMs: number } | null = null;

/** For tests. */
export function clearPayPalTokenCache(): void {
  cachedToken = null;
}

export async function payPalAccessToken(config: PayPalConfig, nowMs = Date.now()): Promise<string> {
  const key = `${config.env}:${config.clientId}`;
  if (cachedToken && cachedToken.key === key && cachedToken.expiresAtMs - 60_000 > nowMs) return cachedToken.token;
  const send = config.fetchFn ?? defaultFetch;
  const response = await send(`${payPalBase(config)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: "grant_type=client_credentials"
  });
  const { body, raw } = await readJson(response);
  const token = asText(body.access_token);
  if (!response.ok || !token) {
    console.error(`PayPal token call failed (${response.status}): ${raw}`);
    throw new PayPalError("PayPal token call failed.", response.status, firstIssue(body));
  }
  const seconds = typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 300;
  cachedToken = { key, token, expiresAtMs: nowMs + seconds * 1000 };
  return token;
}

async function call(
  config: PayPalConfig,
  method: "GET" | "POST",
  path: string,
  payload: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; ok: boolean; body: Json }> {
  const token = await payPalAccessToken(config);
  const send = config.fetchFn ?? defaultFetch;
  const response = await send(`${payPalBase(config)}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...headers
    },
    ...(method === "POST" ? { body: JSON.stringify(payload ?? {}) } : {})
  });
  const { body, raw } = await readJson(response);
  if (!response.ok) console.error(`PayPal ${method} ${path} failed (${response.status}): ${raw}`);
  return { status: response.status, ok: response.ok, body };
}

export interface NewPayPalOrder {
  /** Total in cents, USD. */
  totalCents: number;
  /** Our order number. PayPal shows it as the invoice id. */
  invoiceId: string;
  /** Our order id. */
  customId: string;
  description: string;
  /** The same id for the same order and total, so a retry makes no second PayPal order. */
  requestId: string;
}

/** Creates a PayPal order with intent CAPTURE. Returns the PayPal order id. */
export async function createPayPalOrder(config: PayPalConfig, order: NewPayPalOrder): Promise<string> {
  const result = await call(
    config,
    "POST",
    "/v2/checkout/orders",
    {
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: { currency_code: "USD", value: centsToValue(order.totalCents) },
          invoice_id: order.invoiceId.slice(0, 127),
          custom_id: order.customId.slice(0, 127),
          description: order.description.slice(0, 127)
        }
      ],
      // Nothing ships: do not ask the buyer for a shipping address.
      application_context: { shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW" }
    },
    { "PayPal-Request-Id": order.requestId }
  );
  const id = asText(result.body.id);
  if (!result.ok || !id) throw new PayPalError("PayPal create order failed.", result.status, firstIssue(result.body));
  return id;
}

/** What the Worker reads from a PayPal order after a capture. */
export interface PayPalCapture {
  /** The status of the PayPal order, for example "COMPLETED". */
  orderStatus: string;
  captureId: string;
  /** The status of the capture, for example "COMPLETED" or "PENDING". */
  captureStatus: string;
  currency: string;
  /** Null when the answer has no amount that can be read. */
  amountCents: number | null;
  /** What PayPal kept. 0 when the answer does not give it. */
  feeCents: number;
}

/** Reads 1 capture from a PayPal order. A completed capture comes first if there is one. */
export function readCapture(body: Record<string, unknown>): PayPalCapture {
  const captures: Json[] = [];
  for (const unit of asList(body.purchase_units)) {
    for (const capture of asList(asObject(asObject(unit).payments).captures)) captures.push(asObject(capture));
  }
  const capture = captures.find((entry) => entry.status === "COMPLETED") ?? captures[0] ?? {};
  const amount = asObject(capture.amount);
  const fee = asObject(asObject(capture.seller_receivable_breakdown).paypal_fee);
  return {
    orderStatus: asText(body.status),
    captureId: asText(capture.id),
    captureStatus: asText(capture.status),
    currency: asText(amount.currency_code),
    amountCents: valueToCents(amount.value),
    feeCents: (asText(fee.currency_code) === "USD" ? valueToCents(fee.value) : null) ?? 0
  };
}

/**
 * Captures an approved PayPal order. If PayPal says that the order is already
 * captured, it reads the order and returns the capture that exists.
 * Throws a `PayPalError` for each other refusal.
 */
export async function capturePayPalOrder(config: PayPalConfig, paypalOrderId: string): Promise<PayPalCapture> {
  const path = `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`;
  const result = await call(
    config,
    "POST",
    `${path}/capture`,
    {},
    { "PayPal-Request-Id": `capture-${paypalOrderId}`, Prefer: "return=representation" }
  );
  if (result.ok) return readCapture(result.body);
  const issue = firstIssue(result.body);
  if (issue === "ORDER_ALREADY_CAPTURED") {
    const existing = await call(config, "GET", path, null);
    if (existing.ok) return readCapture(existing.body);
    throw new PayPalError("PayPal read order failed.", existing.status, firstIssue(existing.body));
  }
  throw new PayPalError("PayPal capture failed.", result.status, issue);
}
