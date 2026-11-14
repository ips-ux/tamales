// Reads Firestore documents into the types of shared/model.ts, and builds the tracker.
// A document can have missing or wrong fields, so each reader sets a safe default.

import { bytesToHex } from "./base64";
import type { StoredDoc } from "./firestore";
import {
  orderingDefaults,
  type DeliveryRing,
  type EventRecord,
  type OrderRecord,
  type OrderingPrivateSettings,
  type OrderingSettings,
  type TrackerRecord
} from "../../shared/model";
import { DEFAULT_TIME_ZONE } from "../../shared/orderNumber";
import { DEFAULT_TAX_RATE_BPS, type PricedMenuItem, type PricedVariant } from "../../shared/pricing";

type Data = Record<string, unknown>;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/** Keeps the keys that have a count of 0 or more. */
export function counts(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, count] of Object.entries(value as Data)) {
    if (typeof count === "number" && Number.isFinite(count)) out[key] = Math.max(0, Math.floor(count));
  }
  return out;
}

export function readEvent(id: string, data: Data): EventRecord {
  const mode = data.preorderMode;
  return {
    id,
    name: str(data.name),
    areaName: str(data.areaName),
    startsAtUtc: str(data.startsAtUtc),
    endsAtUtc: str(data.endsAtUtc),
    active: data.active === true,
    itemIds: strings(data.itemIds),
    soldOutItemIds: strings(data.soldOutItemIds),
    preorderMode: mode === "fixed" || mode === "open" ? mode : "off",
    preorderCutoffUtc: str(data.preorderCutoffUtc),
    allotment: counts(data.allotment),
    liveOrdersEnabled: data.liveOrdersEnabled === true,
    liveOrdersPaused: data.liveOrdersPaused === true,
    kioskToken: str(data.kioskToken),
    kioskTarget: data.kioskTarget === "next_batch" ? "next_batch" : "today",
    waitlistEnabled: data.waitlistEnabled === true,
    exitPinHash: str(data.exitPinHash)
  };
}

/** `settings/ordering` with the defaults for each field that is missing. */
export function readOrdering(data: Data | null): OrderingSettings {
  const source = data ?? {};
  const rings: DeliveryRing[] = (Array.isArray(source.deliveryRings) ? source.deliveryRings : [])
    .map((ring) => ring as Data)
    .filter((ring) => ring && typeof ring.miles === "number" && ring.miles > 0 && typeof ring.feeCents === "number")
    .map((ring) => ({ miles: ring.miles as number, feeCents: Math.max(0, Math.round(ring.feeCents as number)) }))
    .sort((a, b) => a.miles - b.miles);
  return {
    pickupEnabled: typeof source.pickupEnabled === "boolean" ? source.pickupEnabled : orderingDefaults.pickupEnabled,
    deliveryEnabled:
      typeof source.deliveryEnabled === "boolean" ? source.deliveryEnabled : orderingDefaults.deliveryEnabled,
    pickupAreaName: str(source.pickupAreaName),
    minBatchTamales: Math.max(1, Math.floor(num(source.minBatchTamales, orderingDefaults.minBatchTamales))),
    minNoticeDays: Math.max(0, Math.floor(num(source.minNoticeDays, orderingDefaults.minNoticeDays))),
    deliveryRings: rings,
    deliveryFeeTaxable: source.deliveryFeeTaxable === true,
    paymentWindowHours: Math.max(1, num(source.paymentWindowHours, orderingDefaults.paymentWindowHours))
  };
}

export function readOrderingPrivate(data: Data | null): OrderingPrivateSettings {
  const source = data ?? {};
  const coordinate = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  return {
    startAddress: str(source.startAddress).trim(),
    startLat: coordinate(source.startLat),
    startLng: coordinate(source.startLng),
    pickupAddress: str(source.pickupAddress).trim(),
    pickupInstructions: str(source.pickupInstructions).trim()
  };
}

/** The `menuItems` documents as the menu that shared/pricing.ts reads. */
export function menuFromDocs(docs: StoredDoc[]): PricedMenuItem[] {
  return docs.map((doc) => ({
    id: doc.id,
    name: str(doc.data.name),
    status: str(doc.data.status),
    singlePriceCents: num(doc.data.singlePriceCents, 0),
    variants: (Array.isArray(doc.data.variants) ? doc.data.variants : [])
      .filter((variant) => variant && typeof variant === "object")
      .map((variant): PricedVariant => {
        const entry = variant as Data;
        return {
          id: str(entry.id),
          label: str(entry.label),
          unitQuantity: num(entry.unitQuantity, 1),
          priceCents: num(entry.priceCents, -1),
          minimumQuantity: num(entry.minimumQuantity, 1),
          active: entry.active === true
        };
      })
  }));
}

export function taxRateFrom(settings: Data | null): number {
  const rate = settings?.taxRateBps;
  return typeof rate === "number" && rate >= 0 ? rate : DEFAULT_TAX_RATE_BPS;
}

export function timeZoneFrom(settings: Data | null): string {
  return typeof settings?.timezone === "string" && settings.timezone ? settings.timezone : DEFAULT_TIME_ZONE;
}

const KINDS = ["live", "preorder", "batch"];
const STATES = [
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

/** Reads an `orders` document. Returns null for a document that does not have the V1 shape. */
export function readOrder(id: string, data: Data): OrderRecord | null {
  if (!KINDS.includes(str(data.kind)) || !STATES.includes(str(data.state))) return null;
  if (!Array.isArray(data.items) || !data.totals || !data.customer || !str(data.trackerToken)) return null;
  return { ...(data as unknown as OrderRecord), id };
}

/** 192 random bits as hex. The token is the key to the order tracker. */
export function newTrackerToken(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(24)));
}

/**
 * The public tracker document of an order.
 * It holds no email address, no phone number and no street address.
 * The order number of a live order contains the customer name.
 */
export function toTracker(order: OrderRecord): TrackerRecord {
  return {
    orderNumber: order.orderNumber,
    kind: order.kind,
    state: order.state,
    paymentState: order.paymentState,
    paymentMethod: order.paymentMethod,
    paymentDescription: order.paymentDescription,
    firstName: order.customer.firstName,
    eventName: order.eventName,
    fulfillment: order.fulfillment,
    items: order.items.map((line) => ({ label: `${line.itemName}, ${line.variantLabel}`, quantity: line.quantity })),
    totals: { ...order.totals },
    reason: order.reason,
    scheduledAtUtc: order.scheduledAtUtc,
    updatedAtUtc: order.updatedAtUtc
  };
}
