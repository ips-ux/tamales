// Bangin Bustos Tamales API. The HTTP contract is in src/lib/api.ts of the site.
//   200 { ok: true, ...data }
//   4xx/5xx { ok: false, error: "<message that is safe to show>" }

import { corsHeaders, isAllowedOrigin } from "./cors";
import { upsertCustomer } from "./customers";
import { sendEmail, sendEmailSafely, type Mailer } from "./email";
import { readConfig, type Config, type Env } from "./env";
import { censusGeocode, quoteDelivery, validateQuote } from "./delivery";
import { expireUnpaidOrders } from "./expiry";
import { ContentionError, Firestore } from "./firestore";
import { getAccessToken, parseServiceAccount } from "./googleAuth";
import { isHoneypotFilled, verifyTurnstile } from "./guard";
import { HttpError, json, readJsonBody } from "./http";
import { requireAdmin, type IdTokenClaims } from "./idToken";
import { buildContactEmail, buildReceiptEmail } from "./messages";
import { runOrderAction } from "./orderAction";
import { createOrderV1 } from "./orderCreate";
import { capturePayment, createPayment, PAYMENT_OFF_MESSAGE, type PaymentDeps } from "./payments";
import { readPayPalConfig } from "./paypal";
import { refundOrder } from "./refund";
import type { Actor } from "./sale";
import { sha256Hex } from "./base64";
import { validateContact, validateReceipt, validateSignup } from "./validate";
import { joinWaitlist } from "./waitlist";
import { OrderError } from "../../shared/errors";

interface Context {
  request: Request;
  env: Env;
  cfg: Config;
  mailer: Mailer;
  defer: (work: Promise<unknown>) => void;
}

function database(ctx: Context): Firestore {
  if (!ctx.env.FIREBASE_SERVICE_ACCOUNT) {
    console.error("FIREBASE_SERVICE_ACCOUNT is not set.");
    throw new HttpError(503, "This form is not available now. Try again later.");
  }
  const account = parseServiceAccount(ctx.env.FIREBASE_SERVICE_ACCOUNT);
  return new Firestore(ctx.cfg.projectId, () => getAccessToken(account));
}

async function businessTimeZone(db: Firestore): Promise<string> {
  const settings = await db.get("settings/business");
  return typeof settings?.timezone === "string" && settings.timezone ? settings.timezone : "America/Denver";
}

/**
 * Reads the body of a public form and runs the abuse checks.
 * Returns null if the honeypot is filled. The caller then answers ok and saves nothing.
 */
async function readPublicForm(ctx: Context): Promise<Record<string, unknown> | null> {
  const body = await readJsonBody(ctx.request);
  if (isHoneypotFilled(body)) {
    console.warn("Honeypot filled. Request dropped.");
    return null;
  }
  await verifyTurnstile(
    body.turnstileToken,
    ctx.env.TURNSTILE_SECRET_KEY,
    ctx.request.headers.get("CF-Connecting-IP")
  );
  return body;
}

async function handleContact(ctx: Context): Promise<unknown> {
  const body = await readPublicForm(ctx);
  if (!body) return {};
  const input = validateContact(body);
  const db = database(ctx);
  const createdAtUtc = new Date().toISOString();
  await db.set(`contactMessages/${crypto.randomUUID()}`, { ...input, createdAtUtc, read: false });
  ctx.defer(
    businessTimeZone(db)
      .catch(() => "America/Denver")
      .then((timeZone) => sendEmailSafely(ctx.mailer, buildContactEmail(input, createdAtUtc, timeZone, ctx.cfg)))
  );
  return {};
}

async function handleSignup(ctx: Context): Promise<unknown> {
  const body = await readPublicForm(ctx);
  if (!body) return {};
  const input = validateSignup(body);
  const db = database(ctx);
  // The document id comes from the email address, so 1 address makes 1 signup.
  const path = `marketingSignups/${await sha256Hex(input.email)}`;
  if (!(await db.get(path))) {
    await db.set(path, { email: input.email, source: input.source, createdAtUtc: new Date().toISOString() });
  }
  await upsertCustomer(db, { email: input.email, marketingOptIn: true });
  return {};
}

async function handleReceipt(ctx: Context): Promise<unknown> {
  await requireAdmin(ctx.request.headers.get("Authorization"), ctx.cfg.projectId);
  const input = validateReceipt(await readJsonBody(ctx.request));
  const db = database(ctx);
  const ticket = await db.get(`posTickets/${input.ticketId}`);
  if (!ticket) throw new HttpError(404, "We could not find this sale.");
  const timeZone = await businessTimeZone(db);
  try {
    await sendEmail(
      ctx.mailer,
      buildReceiptEmail(ticket, { toEmail: input.toEmail, includeSignupLink: input.includeSignupLink, timeZone }, ctx.cfg)
    );
  } catch (error) {
    console.error("Receipt email failed", error);
    throw new HttpError(502, "We could not send the receipt. Try again.");
  }
  return {};
}

// Build piece 2. The contract is in shared/model.ts.

async function handleOrderV1(ctx: Context): Promise<unknown> {
  const body = await readPublicForm(ctx);
  if (!body) return {};
  return createOrderV1(body, {
    db: database(ctx),
    mailer: ctx.mailer,
    cfg: ctx.cfg,
    defer: ctx.defer,
    geocode: censusGeocode
  });
}

/** No Turnstile: the route writes no customer data. It reads the settings and calls the geocoder. */
async function handleDeliveryQuote(ctx: Context): Promise<unknown> {
  const address = validateQuote(await readJsonBody(ctx.request));
  return quoteDelivery(address, { db: database(ctx), geocode: censusGeocode });
}

async function handleWaitlist(ctx: Context): Promise<unknown> {
  const body = await readPublicForm(ctx);
  if (!body) return {};
  await joinWaitlist(body, database(ctx));
  return {};
}

function actorOf(claims: IdTokenClaims): Actor {
  return { email: typeof claims.email === "string" ? claims.email : "", uid: claims.sub };
}

async function handleOrderAction(ctx: Context): Promise<unknown> {
  const claims = await requireAdmin(ctx.request.headers.get("Authorization"), ctx.cfg.projectId);
  const body = await readJsonBody(ctx.request);
  return runOrderAction(body, {
    db: database(ctx),
    mailer: ctx.mailer,
    cfg: ctx.cfg,
    defer: ctx.defer,
    actor: actorOf(claims)
  });
}

// Build piece 3. The contract is in shared/moneyModel.ts.

/** No Turnstile on the 2 payment routes: the tracker token is the key, and PayPal verifies the payer. */
function paymentDeps(ctx: Context): PaymentDeps {
  const paypal = readPayPalConfig(ctx.env);
  // With no PayPal account, the route answers 503 before it reads Firestore.
  if (!paypal) throw new HttpError(503, PAYMENT_OFF_MESSAGE);
  return { db: database(ctx), mailer: ctx.mailer, cfg: ctx.cfg, defer: ctx.defer, paypal };
}

async function handlePaymentCreate(ctx: Context): Promise<unknown> {
  return createPayment(await readJsonBody(ctx.request), paymentDeps(ctx));
}

async function handlePaymentCapture(ctx: Context): Promise<unknown> {
  return capturePayment(await readJsonBody(ctx.request), paymentDeps(ctx));
}

async function handleRefund(ctx: Context): Promise<unknown> {
  const claims = await requireAdmin(ctx.request.headers.get("Authorization"), ctx.cfg.projectId);
  const body = await readJsonBody(ctx.request);
  return refundOrder(body, {
    db: database(ctx),
    mailer: ctx.mailer,
    cfg: ctx.cfg,
    defer: ctx.defer,
    actor: actorOf(claims)
  });
}

/** The scheduled run: expire the approved orders that were not paid in time. */
export async function handleScheduled(env: Env): Promise<void> {
  if (!env.FIREBASE_SERVICE_ACCOUNT) {
    console.error("FIREBASE_SERVICE_ACCOUNT is not set. The scheduled run did nothing.");
    return;
  }
  const cfg = readConfig(env);
  const account = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
  const db = new Firestore(cfg.projectId, () => getAccessToken(account));
  const mailer: Mailer = { apiKey: env.RESEND_API_KEY, from: cfg.emailFrom };
  try {
    const expired = await expireUnpaidOrders({ db, mailer, cfg });
    if (expired.length) console.log(`Expired ${expired.length} orders: ${expired.join(", ")}`);
  } catch (error) {
    console.error("The scheduled run failed", error);
  }
}

const POST_ROUTES: Record<string, (ctx: Context) => Promise<unknown>> = {
  "/api/contact": handleContact,
  "/api/signup": handleSignup,
  "/api/receipts": handleReceipt,
  "/api/v1/orders": handleOrderV1,
  "/api/v1/delivery-quote": handleDeliveryQuote,
  "/api/v1/waitlist": handleWaitlist,
  "/api/admin/orders/action": handleOrderAction,
  "/api/v1/payments/create": handlePaymentCreate,
  "/api/v1/payments/capture": handlePaymentCapture,
  "/api/admin/orders/refund": handleRefund
};

export async function handleRequest(request: Request, env: Env, defer: Context["defer"]): Promise<Response> {
  const cfg = readConfig(env);
  const origin = request.headers.get("Origin");
  const cors = corsHeaders(origin, cfg.allowedOrigins);
  const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";

  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method === "GET" && path === "/api/health") return json({ ok: true }, 200, cors);

    const route = POST_ROUTES[path];
    if (!route) throw new HttpError(404, "Not found.");
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed.");
    // A browser always sends Origin on a cross-site POST. Reject a site that is not in the list.
    if (origin && !isAllowedOrigin(origin, cfg.allowedOrigins)) throw new HttpError(403, "Origin not allowed.");

    const mailer: Mailer = { apiKey: env.RESEND_API_KEY, from: cfg.emailFrom };
    const data = (await route({ request, env, cfg, mailer, defer })) as Record<string, unknown>;
    return json({ ok: true, ...data }, 200, cors);
  } catch (error) {
    if (error instanceof HttpError) return json({ ok: false, error: error.message }, error.status, cors);
    // The rules in shared/ throw OrderError with a message that is safe to show.
    if (error instanceof OrderError) return json({ ok: false, error: error.message }, 400, cors);
    if (error instanceof ContentionError) {
      console.error("Transaction did not complete", error);
      return json({ ok: false, error: "We are busy now. Try again." }, 503, cors);
    }
    console.error("Unhandled error", error);
    return json({ ok: false, error: "Something went wrong. Try again." }, 500, cors);
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env, (work) => ctx.waitUntil(work));
  },
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(handleScheduled(env));
  }
};
