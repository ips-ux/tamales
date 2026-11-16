// POST /api/v1/orders: a live order, a pre-order, or a batch request.
// The contract is `CreateOrderInput` and `CreateOrderResult` in shared/model.ts.
//
// The Worker takes only the selection and the customer text from the browser.
// It reads prices, the event, the settings and the tax rate from Firestore.
// The order number and the fixed-allotment stock change in 1 Firestore transaction.

import { sha256Hex } from "./base64";
import { addToEmailList, upsertCustomer } from "./customers";
import { quoteDelivery, MAX_ADDRESS_LENGTH, type Geocoder } from "./delivery";
import { sendEmailSafely, type Mailer } from "./email";
import type { Config } from "./env";
import type { Firestore } from "./firestore";
import { HttpError } from "./http";
import { buildOrderAlertEmail, buildOrderHoldEmail, buildOrderReceivedEmail } from "./messages";
import {
  counts,
  menuFromDocs,
  newTrackerToken,
  readEvent,
  readOrder,
  readOrdering,
  taxRateFrom,
  timeZoneFrom,
  toTracker
} from "./orderData";
import { docId, email, object, phone, text } from "./validate";
import { eventIsLive, eventItemIds, preorderIsOpen } from "../../shared/eventRules";
import type {
  CreateOrderInput,
  CreateOrderResult,
  EventRecord,
  Fulfillment,
  OrderDelivery,
  OrderKind,
  OrderLine,
  OrderLineInput,
  OrderRecord,
  OrderRequestedTime,
  OrderSource,
  PaymentMethod
} from "../../shared/model";
import {
  addDaysToDateKey,
  dateKeyInZone,
  FIRST_RUNNING_SEQUENCE,
  liveCounterId,
  liveOrderNumber,
  paymentDescription,
  runningOrderNumber
} from "../../shared/orderNumber";
import { buildOrderLines, computeTotals, MAX_ORDER_LINES, tamaleCount, tamalesByItem } from "../../shared/pricing";
import { quantityLabel } from "../../shared/quantity";

const KINDS: OrderKind[] = ["live", "preorder", "batch"];
const SOURCES: OrderSource[] = ["web", "mobile", "kiosk"];
const LIVE_METHODS: PaymentMethod[] = ["paypal", "venmo", "cashapp", "cash"];
const invalid = () => new HttpError(400, "The request is not valid.");
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{1,64}$/;

/** Reads the optional retry key. Returns undefined when the browser sent none. */
function idempotencyKey(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !IDEMPOTENCY_KEY.test(value)) throw invalid();
  return value;
}

/**
 * The order document id for a retry key. The email address is part of the hash,
 * so a key alone does not find the order of a different customer.
 */
export async function orderIdForKey(key: string, customerEmail: string): Promise<string> {
  return sha256Hex(`order:${customerEmail}:${key}`);
}

function requestedTime(value: unknown): OrderRequestedTime | null {
  if (value === undefined || value === null) return null;
  const source = object(value);
  const date = typeof source.date === "string" ? source.date.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) {
    throw new HttpError(400, "Select a date.");
  }
  return { date, timeRange: text(source.timeRange, { label: "time", max: 100 }) };
}

/** Reads the fields that the Worker accepts from the browser. It ignores all other fields. */
export function validateCreateOrder(body: Record<string, unknown>): CreateOrderInput {
  const kind = body.kind as OrderKind;
  const source = body.source as OrderSource;
  if (!KINDS.includes(kind) || !SOURCES.includes(source)) throw invalid();
  if (kind === "live" && source === "web") throw invalid();
  if (kind === "batch" && source === "mobile") throw invalid();

  if (!Array.isArray(body.items)) throw invalid();
  const items: OrderLineInput[] = body.items
    .map((entry) => {
      const line = object(entry);
      if (typeof line.quantity !== "number" || !Number.isInteger(line.quantity) || line.quantity < 0) {
        throw new HttpError(400, "Enter a valid quantity.");
      }
      return { itemId: docId(line.itemId), variantId: docId(line.variantId), quantity: line.quantity };
    })
    .filter((line) => line.quantity > 0);
  if (items.length === 0) throw new HttpError(400, "Select 1 menu item or more.");
  if (items.length > MAX_ORDER_LINES) throw new HttpError(400, "The order has too many lines.");

  const person = object(body.customer);
  const customer = {
    firstName: text(person.firstName, { label: "first name", max: 60, required: true }),
    lastName: text(person.lastName, { label: "last name", max: 60, required: true }),
    email: email(person.email),
    phone: phone(person.phone, false),
    marketingOptIn: person.marketingOptIn === true
  };

  const needsEvent = kind !== "batch" || source === "kiosk";
  let fulfillment: Fulfillment = "event_pickup";
  let deliveryAddress = "";
  let requested: OrderRequestedTime | null = null;
  let paymentMethod: PaymentMethod = "unset";

  if (kind === "batch") {
    if (body.fulfillment !== "pickup" && body.fulfillment !== "delivery") {
      throw new HttpError(400, "Select pickup or delivery.");
    }
    fulfillment = body.fulfillment;
    if (fulfillment === "delivery") {
      deliveryAddress = text(body.deliveryAddress, { label: "delivery address", max: MAX_ADDRESS_LENGTH, required: true });
    }
    requested = requestedTime(body.requested);
    // The kiosk has no date field. The owner sets the date at approval.
    if (!requested && source !== "kiosk") throw new HttpError(400, "Select a date.");
  }
  if (kind === "live") {
    if (!LIVE_METHODS.includes(body.paymentMethod as PaymentMethod)) {
      throw new HttpError(400, "Select a payment method.");
    }
    paymentMethod = body.paymentMethod as PaymentMethod;
  }

  const key = idempotencyKey(body.idempotencyKey);
  return {
    ...(key ? { idempotencyKey: key } : {}),
    kind,
    source,
    eventId: needsEvent ? docId(body.eventId) : "",
    kioskToken: source === "kiosk" ? text(body.kioskToken, { label: "kiosk link", max: 200, required: true }) : "",
    items,
    customer,
    fulfillment,
    deliveryAddress,
    requested,
    paymentMethod,
    customerNote: text(body.customerNote, { label: "note", max: 500, multiline: true })
  };
}

/** Throws if the order takes more tamales than the event has. Returns the counts that remain after the order. */
export function takeStock(
  remaining: Record<string, number>,
  lines: OrderLine[]
): Record<string, number> {
  const next = { ...remaining };
  for (const [itemId, wanted] of Object.entries(tamalesByItem(lines))) {
    const left = next[itemId] ?? 0;
    if (wanted > left) {
      const name = lines.find((line) => line.itemId === itemId)?.itemName ?? "This menu item";
      if (left <= 0) throw new HttpError(409, `${name} is sold out.`);
      throw new HttpError(409, `${name}: only ${quantityLabel(left)} left. Decrease the quantity.`);
    }
    next[itemId] = left - wanted;
  }
  return next;
}

/** Puts the tamales of an order back. */
export function returnStock(remaining: Record<string, number>, lines: OrderLine[]): Record<string, number> {
  const next = { ...remaining };
  for (const [itemId, count] of Object.entries(tamalesByItem(lines))) next[itemId] = (next[itemId] ?? 0) + count;
  return next;
}

export interface CreateDeps {
  db: Firestore;
  mailer: Mailer;
  cfg: Config;
  /** Runs work after the response, for example `ctx.waitUntil`. */
  defer: (work: Promise<unknown>) => void;
  geocode: Geocoder;
}

function checkEvent(input: CreateOrderInput, event: EventRecord | null, now: Date): EventRecord | null {
  if (!input.eventId) return null;
  if (!event) throw new HttpError(400, "This event does not take orders now.");
  if (input.source === "kiosk" && (!event.kioskToken || event.kioskToken !== input.kioskToken)) {
    throw new HttpError(403, "The kiosk link is not valid.");
  }
  if (input.kind === "live" && !eventIsLive(event, now)) {
    throw new HttpError(400, "This event does not take orders now.");
  }
  if (input.kind === "preorder" && !preorderIsOpen(event, now)) {
    throw new HttpError(400, "This event does not take pre-orders now.");
  }
  return event;
}

/**
 * Validates, prices and saves the order. Sends the emails after the response.
 * With an `idempotencyKey`, a second call returns the first order and saves nothing.
 */
export async function createOrderV1(
  body: Record<string, unknown>,
  deps: CreateDeps,
  now = new Date()
): Promise<CreateOrderResult> {
  const input = validateCreateOrder(body);
  const { db, cfg } = deps;
  const isBatch = input.kind === "batch";

  // A retry of an order that the Worker saved before: return it, send no second email.
  const fixedId = input.idempotencyKey ? await orderIdForKey(input.idempotencyKey, input.customer.email) : "";
  const earlier = fixedId ? await db.get(`orders/${fixedId}`) : null;
  const earlierOrder = earlier ? readOrder(fixedId, earlier) : null;
  if (earlierOrder) return resultOf(earlierOrder);

  const [menuDocs, business, eventData, orderingData] = await Promise.all([
    db.list("menuItems"),
    db.get("settings/business"),
    input.eventId ? db.get(`events/${input.eventId}`) : Promise.resolve(null),
    db.get("settings/ordering")
  ]);
  const timeZone = timeZoneFrom(business);
  const ordering = readOrdering(orderingData);
  const event = checkEvent(input, eventData ? readEvent(input.eventId, eventData) : null, now);

  const menu = menuFromDocs(menuDocs);
  const lines = buildOrderLines(input.items, menu);
  const tamales = tamaleCount(lines);

  // A live order or a pre-order can have only the items of its event.
  if (event && !isBatch) {
    const activeIds = menu.filter((item) => item.status === "active").map((item) => item.id);
    const forSale = eventItemIds(event, activeIds);
    for (const line of lines) {
      if (!forSale.includes(line.itemId)) {
        throw new HttpError(400, `${line.itemName} is not for sale at this event.`);
      }
      if (input.kind === "live" && event.soldOutItemIds.includes(line.itemId)) {
        throw new HttpError(400, `${line.itemName} is sold out.`);
      }
    }
  }

  let delivery: OrderDelivery | null = null;
  let deliveryFeeCents = 0;
  if (isBatch) {
    if (input.fulfillment === "pickup" && !ordering.pickupEnabled) {
      throw new HttpError(400, "Pickup is not available now.");
    }
    if (input.fulfillment === "delivery" && !ordering.deliveryEnabled) {
      throw new HttpError(400, "Delivery is not available now.");
    }
    if (tamales < ordering.minBatchTamales) {
      throw new HttpError(400, `A batch request needs ${quantityLabel(ordering.minBatchTamales)} or more.`);
    }
    if (input.requested) {
      const earliest = addDaysToDateKey(dateKeyInZone(now, timeZone), ordering.minNoticeDays);
      if (input.requested.date < earliest) {
        throw new HttpError(400, `Select a date that is ${ordering.minNoticeDays} days or more from today.`);
      }
    }
    if (input.fulfillment === "delivery") {
      const quote = await quoteDelivery(input.deliveryAddress, deps, ordering);
      if (quote.status === "outside") throw new HttpError(400, "This address is outside our delivery area.");
      deliveryFeeCents = quote.status === "ok" ? quote.feeCents : 0;
      delivery = {
        address: input.deliveryAddress,
        distanceMiles: quote.distanceMiles,
        feeStatus: quote.status === "ok" ? "computed" : "to_be_set"
      };
    }
  }

  // A pre-order and a batch request always use PayPal Checkout. A live order can select it.
  const isLive = input.kind === "live";
  const paymentMethod: PaymentMethod = isLive ? input.paymentMethod : "paypal";
  const totals = computeTotals({
    lines,
    deliveryFeeCents,
    taxRateBps: taxRateFrom(business),
    deliveryFeeTaxable: ordering.deliveryFeeTaxable,
    usesPayPal: paymentMethod === "paypal",
    feeSettings: ordering
  });

  const nowIso = now.toISOString();
  const customerId = await upsertCustomer(db, {
    email: input.customer.email,
    firstName: input.customer.firstName,
    lastName: input.customer.lastName,
    marketingOptIn: input.customer.marketingOptIn
  });
  if (input.customer.marketingOptIn) await addToEmailList(db, input.customer.email, "order", nowIso);

  const isFixed = input.kind === "preorder" && event?.preorderMode === "fixed";
  // A fixed-allotment pre-order holds its tamales while the customer pays.
  const holdUntilUtc = new Date(now.getTime() + ordering.holdMinutes * 60_000).toISOString();
  const dayKey = dateKeyInZone(now, timeZone);
  const counterPath = isLive ? `counters/${liveCounterId(input.eventId, dayKey)}` : "counters/orders";
  const firstSequence = isLive ? 1 : FIRST_RUNNING_SEQUENCE;
  const stockPath = `eventStock/${input.eventId}`;

  const orderId = fixedId || crypto.randomUUID();
  let duplicate = false;
  const order = await db.runTransaction(async (tx) => {
    duplicate = false;
    // A second submit can arrive while the first one is in this transaction.
    const existing = fixedId ? await tx.get(`orders/${orderId}`) : null;
    const existingOrder = existing ? readOrder(orderId, existing) : null;
    if (existingOrder) {
      duplicate = true;
      return existingOrder;
    }
    const counter = await tx.get(counterPath);
    const stock = isFixed ? await tx.get(stockPath) : null;

    const stored = counter?.next;
    const sequence = typeof stored === "number" && stored >= firstSequence ? Math.floor(stored) : firstSequence;
    const orderNumber = isLive
      ? liveOrderNumber(sequence, nowIso, timeZone, input.customer.firstName, input.customer.lastName)
      : runningOrderNumber(sequence);

    const record: OrderRecord = {
      id: orderId,
      kind: input.kind,
      source: input.source,
      state: isLive ? "received" : isFixed ? "approved" : "requested",
      paymentState: isLive && paymentMethod !== "paypal" ? "check_payment" : "unpaid",
      paymentMethod,
      orderNumber,
      sequence,
      paymentDescription: paymentDescription({ kind: input.kind, orderNumber, customer: input.customer }),
      eventId: isBatch ? "" : input.eventId,
      eventName: isBatch ? "" : (event?.name ?? ""),
      fulfillment: input.fulfillment,
      customer: input.customer,
      customerId,
      items: lines,
      tamaleCount: tamales,
      totals,
      delivery,
      requested: input.requested,
      scheduledAtUtc: "",
      customerNote: input.customerNote,
      ownerNote: isBatch && event ? `Kiosk: ${event.name}` : "",
      reason: "",
      trackerToken: newTrackerToken(),
      createdAtUtc: nowIso,
      updatedAtUtc: nowIso,
      approvedAtUtc: isFixed ? nowIso : "",
      payByUtc: isFixed ? holdUntilUtc : "",
      stockHeld: isFixed,
      paypalOrderId: "",
      paypalCaptureId: "",
      paypalFeeCents: 0,
      paidAtUtc: "",
      refundedCents: 0,
      saleId: ""
    };

    if (isFixed && event) {
      // With no stock document, the full allotment of the event remains.
      const remaining = takeStock(stock ? counts(stock.remaining) : event.allotment, lines);
      tx.set(stockPath, { remaining, updatedAtUtc: nowIso });
    }
    tx.set(counterPath, { next: sequence + 1, updatedAtUtc: nowIso });
    tx.set(`orders/${record.id}`, record as unknown as Record<string, unknown>);
    tx.set(`trackers/${record.trackerToken}`, toTracker(record) as unknown as Record<string, unknown>);
    return record;
  });

  if (duplicate) return resultOf(order);
  const firstEmail =
    order.state === "approved"
      ? buildOrderHoldEmail(order, ordering.holdMinutes, timeZone, cfg)
      : buildOrderReceivedEmail(order, timeZone, cfg);
  deps.defer(sendEmailSafely(deps.mailer, firstEmail));
  if (order.state === "requested") {
    deps.defer(sendEmailSafely(deps.mailer, buildOrderAlertEmail(order, timeZone, cfg)));
  }
  return resultOf(order);
}

function resultOf(order: OrderRecord): CreateOrderResult {
  return { trackerToken: order.trackerToken, orderNumber: order.orderNumber, state: order.state };
}
