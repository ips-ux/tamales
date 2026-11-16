// Delivery distance and ring fee. See docs/V1_FUNDAMENTALS.md section 10.

import type { DeliveryRing } from "./model";

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_MILES = 3958.8;

/** Straight-line distance between 2 points, in miles. */
export function haversineMiles(a: LatLng, b: LatLng): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type RingFeeResult = { status: "ok"; feeCents: number } | { status: "outside" };

/**
 * The fee of the smallest ring that contains the distance.
 * The outer radius of a ring is inside the ring. No rings means all distances are outside.
 */
export function ringFee(distanceMiles: number, rings: DeliveryRing[]): RingFeeResult {
  const sorted = [...rings].sort((a, b) => a.miles - b.miles);
  for (const ring of sorted) {
    if (distanceMiles <= ring.miles) return { status: "ok", feeCents: ring.feeCents };
  }
  return { status: "outside" };
}
