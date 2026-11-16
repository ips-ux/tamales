// POST /api/v1/delivery-quote, and the same quote for a batch request with delivery.
// See docs/V1_FUNDAMENTALS.md section 10.

import type { Firestore } from "./firestore";
import { HttpError } from "./http";
import { readOrdering, readOrderingPrivate } from "./orderData";
import { text } from "./validate";
import { haversineMiles, ringFee, type LatLng } from "../../shared/delivery";
import type { DeliveryQuoteResult, OrderingSettings } from "../../shared/model";

/** Finds an address. Returns null if the address has no match. Throws if the service fails. */
export type Geocoder = (address: string) => Promise<LatLng | null>;

export const MAX_ADDRESS_LENGTH = 200;
const CENSUS_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";

/** The US Census geocoder. It is free and needs no key. */
export async function censusGeocode(address: string, fetchFn: typeof fetch = fetch): Promise<LatLng | null> {
  const query = new URLSearchParams({ address, benchmark: "Public_AR_Current", format: "json" });
  const response = await fetchFn(`${CENSUS_URL}?${query}`);
  if (!response.ok) throw new Error(`Census geocoder failed (${response.status}): ${await response.text()}`);
  const body = (await response.json()) as {
    result?: { addressMatches?: Array<{ coordinates?: { x?: unknown; y?: unknown } }> };
  };
  const point = body.result?.addressMatches?.[0]?.coordinates;
  if (!point || typeof point.x !== "number" || typeof point.y !== "number") return null;
  return { lat: point.y, lng: point.x };
}

export function validateQuote(body: Record<string, unknown>): string {
  return text(body.address, { label: "delivery address", max: MAX_ADDRESS_LENGTH, required: true });
}

export interface QuoteDeps {
  db: Firestore;
  geocode: Geocoder;
}

const NOT_AVAILABLE = "Delivery is not available now.";

/** The start point of all deliveries. The Worker finds it 1 time, then keeps it in `settings/orderingPrivate`. */
async function startPoint(deps: QuoteDeps): Promise<LatLng> {
  const settings = readOrderingPrivate(await deps.db.get("settings/orderingPrivate"));
  if (settings.startLat !== null && settings.startLng !== null) {
    return { lat: settings.startLat, lng: settings.startLng };
  }
  if (!settings.startAddress) throw new HttpError(400, NOT_AVAILABLE);
  let point: LatLng | null = null;
  try {
    point = await deps.geocode(settings.startAddress);
  } catch (error) {
    console.error("Geocoder failed for the start address", error);
  }
  if (!point) {
    console.error("The geocoder did not find the delivery start address.");
    throw new HttpError(400, NOT_AVAILABLE);
  }
  try {
    await deps.db.update("settings/orderingPrivate", { startLat: point.lat, startLng: point.lng });
  } catch (error) {
    console.error("Could not save the start point", error);
  }
  return point;
}

/**
 * Finds the address and returns the delivery fee from the rings.
 * Throws 400 if delivery is off, or has no rings or no start address.
 */
export async function quoteDelivery(
  address: string,
  deps: QuoteDeps,
  ordering?: OrderingSettings
): Promise<DeliveryQuoteResult> {
  const settings = ordering ?? readOrdering(await deps.db.get("settings/ordering"));
  if (!settings.deliveryEnabled || settings.deliveryRings.length === 0) throw new HttpError(400, NOT_AVAILABLE);
  const start = await startPoint(deps);

  let point: LatLng | null = null;
  try {
    point = await deps.geocode(address);
  } catch (error) {
    // The owner sets the fee by hand if the geocoder is down.
    console.error("Geocoder failed for a customer address", error);
  }
  if (!point) return { status: "not_found", feeCents: 0, distanceMiles: null };

  const miles = haversineMiles(start, point);
  const distanceMiles = Math.round(miles * 100) / 100;
  const ring = ringFee(miles, settings.deliveryRings);
  if (ring.status === "outside") return { status: "outside", feeCents: 0, distanceMiles };
  return { status: "ok", feeCents: ring.feeCents, distanceMiles };
}
