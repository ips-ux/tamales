// Pure check for the delivery rings editor (Settings > Ordering and delivery).

import type { DeliveryRing } from "../../../shared/model";

export interface RingRow {
  /** Text typed for the outer radius in miles. */
  miles: string;
  /** Text typed for the fee in dollars. */
  fee: string;
}

export interface RingsResult {
  error: string;
  rings: DeliveryRing[];
}

export function ringsToRows(rings: DeliveryRing[]): RingRow[] {
  return rings.map((ring) => ({ miles: String(ring.miles), fee: (ring.feeCents / 100).toFixed(2) }));
}

/**
 * Checks the rows and sorts the rings by miles, smallest first.
 * A row with no miles and no fee is ignored. Two rings cannot have the same miles.
 */
export function buildRings(rows: RingRow[]): RingsResult {
  const rings: DeliveryRing[] = [];
  for (const row of rows) {
    const milesText = row.miles.trim();
    const feeText = row.fee.trim().replace(/^\$/, "");
    if (milesText === "" && feeText === "") continue;
    const miles = Number(milesText);
    if (milesText === "" || !Number.isFinite(miles) || miles <= 0) {
      return { error: "Enter the miles of each ring as a number above 0.", rings: [] };
    }
    if (!/^\d+(\.\d{1,2})?$/.test(feeText)) {
      return { error: "Enter the fee of each ring as an amount, for example 5.00.", rings: [] };
    }
    rings.push({ miles, feeCents: Math.round(Number(feeText) * 100) });
  }
  rings.sort((a, b) => a.miles - b.miles);
  for (let index = 1; index < rings.length; index += 1) {
    if (rings[index].miles === rings[index - 1].miles) {
      return { error: "Use each distance for 1 ring only.", rings: [] };
    }
  }
  return { error: "", rings };
}
