// POST /api/orders. The current pre-order form, in 1 module.
// Build piece 2 replaces this order model. Keep this module simple and separate.
//
// The Worker does not trust the order record from the browser. It takes only the
// event id, the customer text and the selected quantities. It reads prices, the
// event and the tax rate from Firestore and computes all money again.

import { bytesToHex } from "./base64";
import { splitName, upsertCustomer } from "./customers";
import { sendEmailSafely, type Mailer, type OutgoingEmail } from "./email";
import type { EmailContent, EmailRow } from "./emailHtml";
import type { Config } from "./env";
import type { Firestore, StoredDoc } from "./firestore";
import { dateKey, formatDateTime, formatMoney, formatRange } from "./format";
import { HttpError } from "./http";
import { docId, email, object, phone, text } from "./validate";

/** The site uses this rate when `settings/business` has no `taxRateBps`. Keep the 2 values the same. */
export const DEFAULT_TAX_RATE_BPS = 870;
const MAX_LINES = 40;
const MAX_QUANTITY = 500;
const MAX_SUBTOTAL_CENTS = 500_000;

export interface OrderLine {
  productId: string;
  variantId: string;
  productName: string;
  variantLabel: string;
  unitQuantity: number;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
}

export interface OrderTotals {
  subtotalCents: number;
  taxCents: number;
  feeCents: number;
  totalCents: number;
}

export interface OrderCustomer {
  name: string;
  mobile: string;
  email: string;
  preferredContact: "text" | "phone" | "email";
  notes: string;
}

export interface OrderBulk {
  enabled: boolean;
  occasion: string;
  guestCount: string;
  desiredReadyTime: string;
  packagingRequest: string;
  additionalInstructions: string;
}

export interface OrderSelection {
  productId: string;
  variantId: string;
  quantity: number;
}

export interface OrderRequest {
  availabilityWindowId: string;
  customer: OrderCustomer;
  bulk: OrderBulk;
  items: OrderSelection[];
}

/** The saved order. It has the same shape as `OrderRecord` in src/lib/types.ts. */
export interface SavedOrder {
  id: string;
  orderNumber: string;
  publicToken: string;
  status: "new";
  paymentStatus: "unpaid";
  fulfillmentType: string;
  availabilityWindowId: string;
  customer: OrderCustomer;
  bulk: OrderBulk;
  items: OrderLine[];
  totals: OrderTotals;
  createdAtUtc: string;
  updatedAtUtc: string;
  privateNotes: "";
  vendorSessionId: string;
}

/** Reads the fields that the Worker accepts from the browser. It ignores all other fields. */
export function validateOrderRequest(value: unknown): OrderRequest {
  const order = object(value);
  const customer = object(order.customer);
  const bulk = order.bulk === undefined || order.bulk === null ? {} : object(order.bulk);

  const preferredContact = customer.preferredContact;
  if (preferredContact !== "text" && preferredContact !== "phone" && preferredContact !== "email") {
    throw new HttpError(400, "Select how we contact you.");
  }

  if (!Array.isArray(order.items)) throw new HttpError(400, "The request is not valid.");
  const items: OrderSelection[] = order.items
    .map((entry) => {
      const item = object(entry);
      const quantity = item.quantity;
      if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 0 || quantity > MAX_QUANTITY) {
        throw new HttpError(400, "Enter a valid quantity.");
      }
      return { productId: docId(item.productId), variantId: docId(item.variantId), quantity };
    })
    .filter((item) => item.quantity > 0);
  if (items.length === 0) throw new HttpError(400, "Select 1 menu item or more.");
  if (items.length > MAX_LINES) throw new HttpError(400, "The order has too many lines.");

  return {
    availabilityWindowId: docId(order.availabilityWindowId),
    customer: {
      name: text(customer.name, { label: "name", max: 120, required: true }),
      mobile: phone(customer.mobile, true),
      email: email(customer.email),
      preferredContact,
      notes: text(customer.notes, { label: "notes", max: 1000, multiline: true })
    },
    bulk: {
      enabled: bulk.enabled === true,
      occasion: text(bulk.occasion, { label: "occasion", max: 200 }),
      guestCount: text(bulk.guestCount, { label: "number of people", max: 40 }),
      desiredReadyTime: text(bulk.desiredReadyTime, { label: "ready time", max: 200 }),
      packagingRequest: text(bulk.packagingRequest, { label: "packaging request", max: 500, multiline: true }),
      additionalInstructions: text(bulk.additionalInstructions, { label: "instructions", max: 1000, multiline: true })
    },
    items
  };
}

/**
 * Throws if the event cannot take a pre-order now.
 * Same rule as `isWindowSelectable` in src/lib/time.ts.
 */
export function assertWindowOpen(window: Record<string, unknown> | null, now: Date, timeZone: string): void {
  const closed = new HttpError(400, "This event does not take pre-orders now. Select a different event.");
  if (!window) throw closed;
  if (window.active !== true || window.preordersEnabled === false) throw closed;
  const start = new Date(String(window.startsAtUtc ?? ""));
  if (Number.isNaN(start.getTime()) || start.getTime() <= now.getTime()) throw closed;
  // The day of the event is for in-person orders only.
  if (dateKey(start, timeZone) === dateKey(now, timeZone)) throw closed;
  const cutoff = new Date(String(window.cutoffAtUtc ?? ""));
  if (!Number.isNaN(cutoff.getTime()) && cutoff.getTime() <= now.getTime()) throw closed;
  const capacity = Number(window.capacity ?? 0);
  const committed = Number(window.committedOrders ?? 0);
  if (!(committed < capacity)) throw closed;
}

export function calculateTax(subtotalCents: number, taxRateBps: number): number {
  return Math.round((subtotalCents * taxRateBps) / 10_000);
}

/**
 * Computes each line and the totals from the menu in Firestore.
 * Same math as `buildOrderLines` and `calculateTotals` in src/lib/order.ts.
 */
export function priceOrder(
  selections: OrderSelection[],
  menu: StoredDoc[],
  taxRateBps: number
): { lines: OrderLine[]; totals: OrderTotals } {
  const unavailable = new HttpError(
    400,
    "A menu item in your order is not available. Refresh the page, then try again."
  );
  const lines = selections.map((selection) => {
    const product = menu.find((item) => item.id === selection.productId);
    if (!product || product.data.status !== "active" || product.data.bulkMenuEnabled !== true) throw unavailable;
    const variants = Array.isArray(product.data.variants) ? (product.data.variants as Record<string, unknown>[]) : [];
    const variant = variants.find((item) => item && item.id === selection.variantId);
    if (!variant || variant.active !== true) throw unavailable;
    const priceCents = variant.priceCents;
    if (typeof priceCents !== "number" || !Number.isInteger(priceCents) || priceCents < 0) throw unavailable;
    const label = String(variant.label ?? "");
    const minimum = Number(variant.minimumQuantity ?? 1);
    if (selection.quantity < minimum) {
      throw new HttpError(400, `${label} has a minimum quantity of ${minimum}.`);
    }
    return {
      productId: product.id,
      variantId: selection.variantId,
      productName: String(product.data.name ?? ""),
      variantLabel: label,
      unitQuantity: Number(variant.unitQuantity ?? 1),
      unitPriceCents: priceCents,
      quantity: selection.quantity,
      lineTotalCents: priceCents * selection.quantity
    };
  });
  const subtotalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  if (subtotalCents > MAX_SUBTOTAL_CENTS) {
    throw new HttpError(400, "This order is too large for the website. Contact us to place it.");
  }
  const taxCents = calculateTax(subtotalCents, taxRateBps);
  return { lines, totals: { subtotalCents, taxCents, feeCents: 0, totalCents: subtotalCents + taxCents } };
}

/** 192 random bits as hex. The token is the document id and the key to the confirmation page. */
export function newPublicToken(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(24)));
}

const ORDER_NUMBER_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** "BBT-2026-K7M2Q". Build piece 2 replaces this with the running `BBT-####` counter. */
export function newOrderNumber(now: Date): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  const suffix = Array.from(bytes, (byte) => ORDER_NUMBER_ALPHABET[byte % ORDER_NUMBER_ALPHABET.length]).join("");
  return `BBT-${now.getUTCFullYear()}-${suffix}`;
}

export function taxRateFrom(settings: Record<string, unknown> | null): number {
  const rate = settings?.taxRateBps;
  return typeof rate === "number" && rate >= 0 ? rate : DEFAULT_TAX_RATE_BPS;
}

function orderRows(order: SavedOrder, window: Record<string, unknown>, timeZone: string): EmailRow[] {
  const range = formatRange(String(window.startsAtUtc ?? ""), String(window.endsAtUtc ?? ""), timeZone);
  const label = String(window.label ?? "");
  return [
    { label: "Order number", value: order.orderNumber },
    { label: "Order time", value: formatDateTime(order.createdAtUtc, timeZone) },
    { label: "Pickup", value: [label, range].filter(Boolean).join(", ") }
  ];
}

function orderMoney(order: SavedOrder): Pick<EmailContent, "items" | "totals"> {
  return {
    items: order.items.map((line) => ({
      name: `${line.productName}, ${line.variantLabel}`,
      detail: `Quantity ${line.quantity} x ${formatMoney(line.unitPriceCents)}`,
      total: formatMoney(line.lineTotalCents)
    })),
    totals: [
      { label: "Subtotal", value: formatMoney(order.totals.subtotalCents) },
      { label: "Tax", value: formatMoney(order.totals.taxCents) },
      { label: "Total", value: formatMoney(order.totals.totalCents), strong: true }
    ]
  };
}

/** The "request received" email to the customer and the alert to the owner. */
export function buildOrderEmails(
  order: SavedOrder,
  window: Record<string, unknown>,
  timeZone: string,
  cfg: Pick<Config, "ownerEmail" | "siteOrigin">
): { customer: OutgoingEmail; owner: OutgoingEmail } {
  const { firstName } = splitName(order.customer.name);
  const base = orderRows(order, window, timeZone);
  const money = orderMoney(order);
  const contactLabels = { text: "Text", phone: "Phone call", email: "Email" } as const;

  const ownerRows: EmailRow[] = [
    ...base,
    { label: "Customer", value: order.customer.name },
    { label: "Email", value: order.customer.email },
    { label: "Phone", value: order.customer.mobile },
    { label: "Contact by", value: contactLabels[order.customer.preferredContact] }
  ];
  if (order.bulk.enabled) {
    if (order.bulk.occasion) ownerRows.push({ label: "Occasion", value: order.bulk.occasion });
    if (order.bulk.guestCount) ownerRows.push({ label: "Number of people", value: order.bulk.guestCount });
    if (order.bulk.desiredReadyTime) ownerRows.push({ label: "Ready time", value: order.bulk.desiredReadyTime });
    if (order.bulk.packagingRequest) ownerRows.push({ label: "Packaging", value: order.bulk.packagingRequest });
  }
  const notes = [order.customer.notes, order.bulk.enabled ? order.bulk.additionalInstructions : ""]
    .filter(Boolean)
    .join("\n\n");

  return {
    customer: {
      to: order.customer.email,
      subject: `We received your order: ${order.orderNumber}`,
      content: {
        heading: "Order",
        lines: [
          `Thanks, ${firstName}! We have your order.`,
          "We confirm each order before it is final. Wait for our message."
        ],
        details: base,
        ...money,
        contactEmail: cfg.ownerEmail
      }
    },
    owner: {
      to: cfg.ownerEmail,
      replyTo: order.customer.email,
      subject: `New order: ${order.orderNumber}`,
      content: {
        heading: "New order",
        lines: [`${order.customer.name} sent an order.`, "Open Admin to confirm or cancel it."],
        details: ownerRows,
        note: notes ? { label: "Customer notes", text: notes } : undefined,
        ...money,
        button: { label: "Open Admin", url: `${cfg.siteOrigin}/admin` },
        contactEmail: cfg.ownerEmail
      }
    }
  };
}

export interface OrderDeps {
  db: Firestore;
  mailer: Mailer;
  cfg: Config;
  /** Runs work after the response, for example `ctx.waitUntil`. */
  defer: (work: Promise<unknown>) => void;
}

/** Validates, prices and saves the order. Returns the saved record. */
export async function createOrder(input: unknown, deps: OrderDeps, now = new Date()): Promise<SavedOrder> {
  const request = validateOrderRequest(input);
  const { db, cfg } = deps;

  const [menu, window, settings] = await Promise.all([
    db.list("menuItems"),
    db.get(`availabilityWindows/${request.availabilityWindowId}`),
    db.get("settings/business")
  ]);
  const timeZone = typeof settings?.timezone === "string" && settings.timezone ? settings.timezone : "America/Denver";
  assertWindowOpen(window, now, timeZone);
  const openWindow = window as Record<string, unknown>;
  const { lines, totals } = priceOrder(request.items, menu, taxRateFrom(settings));

  const publicToken = newPublicToken();
  const nowIso = now.toISOString();
  const order: SavedOrder = {
    id: publicToken,
    orderNumber: newOrderNumber(now),
    publicToken,
    status: "new",
    paymentStatus: "unpaid",
    fulfillmentType: String(openWindow.fulfillmentType ?? "scheduled_pickup"),
    availabilityWindowId: request.availabilityWindowId,
    customer: request.customer,
    bulk: request.bulk,
    items: lines,
    totals,
    createdAtUtc: nowIso,
    updatedAtUtc: nowIso,
    privateNotes: "",
    vendorSessionId: String(openWindow.vendorSessionId ?? "")
  };

  const customerId = await upsertCustomer(db, { email: request.customer.email, ...splitName(request.customer.name) });
  const { id: _id, ...stored } = order;
  await db.set(`orders/${publicToken}`, { ...stored, customerId });

  const emails = buildOrderEmails(order, openWindow, timeZone, cfg);
  deps.defer(sendEmailSafely(deps.mailer, emails.customer));
  deps.defer(sendEmailSafely(deps.mailer, emails.owner));
  return order;
}
