// Client for the Cloudflare Worker in worker/. The Worker is the only door for
// public writes (orders, contact messages, waitlist, email list signups) and it sends all
// email. See docs/V1_FUNDAMENTALS.md section 3.
//
// Contract: every route is POST with a JSON body and returns JSON.
//   200 { ok: true, ...data }
//   4xx/5xx { ok: false, error: "<message that is safe to show>" }
// Public routes take `turnstileToken` and the honeypot field `website`.
// Owner routes take a Firebase ID token in the Authorization header.

import { authHeader } from "./firebaseClient";
import type {
  CreateOrderInput,
  CreateOrderResult,
  DeliveryQuoteInput,
  DeliveryQuoteResult,
  OrderActionInput,
  OrderActionResult,
  WaitlistInput
} from "../../shared/model";

const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, "");

export function apiConfigured(): boolean {
  return Boolean(baseUrl);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function post<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  if (!baseUrl) {
    throw new ApiError("This form is not available now. Try again later.", 503);
  }
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body)
    });
  } catch {
    throw new ApiError("We could not connect. Check your connection, then try again.", 0);
  }
  const data = (await response.json().catch(() => null)) as ({ ok?: boolean; error?: string } & T) | null;
  if (!response.ok || !data || data.ok === false) {
    throw new ApiError(data?.error ?? "Something went wrong. Try again.", response.status);
  }
  return data;
}

/** Fields that every public form sends for abuse protection. */
export interface PublicFormGuard {
  /** Cloudflare Turnstile token. Empty when no site key is configured (local development). */
  turnstileToken: string;
  /** Honeypot. A real customer never fills this field. */
  website: string;
}

export interface ContactMessageInput extends PublicFormGuard {
  firstName: string;
  lastName: string;
  email: string;
  /** Optional. */
  phone: string;
  message: string;
}

/** POST /api/contact — saves the message and alerts the owner by email. */
export function sendContactMessage(input: ContactMessageInput): Promise<{ ok: true }> {
  return post("/api/contact", input);
}

export interface SignupInput extends PublicFormGuard {
  email: string;
  /** Where the signup came from, e.g. "landing", "footer", "kiosk". */
  source: string;
}

/** POST /api/signup — adds the email address to the email list. */
export function sendSignup(input: SignupInput): Promise<{ ok: true }> {
  return post("/api/signup", input);
}

export interface PosReceiptInput {
  /** Firestore id of the POS sale (posTickets document). */
  ticketId: string;
  toEmail: string;
  /** True adds the second-chance email list button to the receipt. */
  includeSignupLink: boolean;
}

/** POST /api/receipts — owner only. The Worker reads the sale and emails the receipt. */
export async function sendPosReceipt(input: PosReceiptInput): Promise<{ ok: true }> {
  const auth = await authHeader();
  return post("/api/receipts", input, auth.Authorization ? { Authorization: auth.Authorization } : {});
}

// ---------------------------------------------------------------------------
// Build piece 2: events and ordering. Types are in shared/model.ts.
// ---------------------------------------------------------------------------

async function ownerHeaders(): Promise<Record<string, string>> {
  const auth = await authHeader();
  return auth.Authorization ? { Authorization: auth.Authorization } : {};
}

/** POST /api/v1/orders — a live order, a pre-order, or a batch request. */
export function createOrder(input: CreateOrderInput & PublicFormGuard): Promise<{ ok: true } & Partial<CreateOrderResult>> {
  return post("/api/v1/orders", input);
}

/** POST /api/v1/delivery-quote — the delivery fee for an address. Writes nothing. */
export function quoteDelivery(input: DeliveryQuoteInput): Promise<{ ok: true } & DeliveryQuoteResult> {
  return post("/api/v1/delivery-quote", input);
}

/** POST /api/v1/waitlist — "Join the Next Batch". */
export function joinWaitlist(input: WaitlistInput & PublicFormGuard): Promise<{ ok: true }> {
  return post("/api/v1/waitlist", input);
}

/** POST /api/admin/orders/action — owner only. Moves an order to its next state and sends the email. */
export async function runOrderAction(input: OrderActionInput): Promise<{ ok: true } & OrderActionResult> {
  return post("/api/admin/orders/action", input, await ownerHeaders());
}
