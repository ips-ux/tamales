// Prices and totals. The Worker uses these functions for each order.
// The site can use them to show the same numbers before the customer sends the order.

import { OrderError } from "./errors";
import type { OrderLine, OrderLineInput, OrderTotals } from "./model";

/** The variant id for single tamales. The price is `singlePriceCents` of the menu item. */
export const SINGLE_VARIANT_ID = "single";
export const MAX_ORDER_LINES = 40;
export const MAX_LINE_QUANTITY = 200;
/** The tax rate when `settings/business` has no `taxRateBps`. */
export const DEFAULT_TAX_RATE_BPS = 870;

/** The part of a menu variant that pricing reads. `MenuVariant` in src/lib/types.ts fits it. */
export interface PricedVariant {
  id: string;
  label: string;
  unitQuantity: number;
  priceCents: number;
  minimumQuantity: number;
  active: boolean;
}

/** The part of a menu item that pricing reads. `MenuProduct` in src/lib/types.ts fits it. */
export interface PricedMenuItem {
  id: string;
  name: string;
  /** Only "active" can be ordered. */
  status: string;
  /** Price of 1 tamale. 0 means the item has no single price. */
  singlePriceCents: number;
  variants: PricedVariant[];
}

function isPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Builds the saved lines from the lines that the browser asks for.
 * Throws an `OrderError` if a line is not valid.
 */
export function buildOrderLines(inputs: OrderLineInput[], menu: PricedMenuItem[]): OrderLine[] {
  if (inputs.length === 0) throw new OrderError("Select 1 menu item or more.");
  if (inputs.length > MAX_ORDER_LINES) throw new OrderError("The order has too many lines.");
  const unavailable = new OrderError("A menu item in your order is not available. Refresh the page, then try again.");

  return inputs.map((input) => {
    const quantity = input.quantity;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_LINE_QUANTITY) {
      throw new OrderError("Enter a valid quantity.");
    }
    const item = menu.find((entry) => entry.id === input.itemId);
    if (!item) throw unavailable;
    if (item.status === "sold_out") throw new OrderError(`${item.name} is sold out.`);
    if (item.status !== "active") throw unavailable;

    if (input.variantId === SINGLE_VARIANT_ID) {
      if (!isPrice(item.singlePriceCents) || item.singlePriceCents < 1) throw unavailable;
      return {
        itemId: item.id,
        variantId: SINGLE_VARIANT_ID,
        itemName: item.name,
        variantLabel: "Single",
        unitTamales: 1,
        unitPriceCents: item.singlePriceCents,
        quantity,
        lineTotalCents: item.singlePriceCents * quantity
      };
    }

    const variant = (item.variants ?? []).find((entry) => entry && entry.id === input.variantId);
    if (!variant || variant.active !== true || !isPrice(variant.priceCents)) throw unavailable;
    const minimum = Number(variant.minimumQuantity) > 0 ? Number(variant.minimumQuantity) : 1;
    if (quantity < minimum) {
      throw new OrderError(`${item.name}, ${variant.label} has a minimum quantity of ${minimum}.`);
    }
    const unitTamales = Number.isInteger(variant.unitQuantity) && variant.unitQuantity > 0 ? variant.unitQuantity : 1;
    return {
      itemId: item.id,
      variantId: variant.id,
      itemName: item.name,
      variantLabel: variant.label,
      unitTamales,
      unitPriceCents: variant.priceCents,
      quantity,
      lineTotalCents: variant.priceCents * quantity
    };
  });
}

/** Total tamales in the order. */
export function tamaleCount(lines: Array<Pick<OrderLine, "unitTamales" | "quantity">>): number {
  return lines.reduce((sum, line) => sum + line.unitTamales * line.quantity, 0);
}

/** Tamales for each menu item id. */
export function tamalesByItem(
  lines: Array<Pick<OrderLine, "itemId" | "unitTamales" | "quantity">>
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const line of lines) counts[line.itemId] = (counts[line.itemId] ?? 0) + line.unitTamales * line.quantity;
  return counts;
}

export interface TotalsInput {
  lines: Array<Pick<OrderLine, "lineTotalCents">>;
  deliveryFeeCents: number;
  taxRateBps: number;
  deliveryFeeTaxable: boolean;
}

/** Tax = round(taxable x rate / 10000). The online ordering fee is 0 until build piece 3. */
export function computeTotals(input: TotalsInput): OrderTotals {
  const subtotalCents = input.lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const deliveryFeeCents = Math.max(0, Math.round(input.deliveryFeeCents || 0));
  const taxableCents = subtotalCents + (input.deliveryFeeTaxable ? deliveryFeeCents : 0);
  const taxCents = Math.round((taxableCents * input.taxRateBps) / 10_000);
  const onlineFeeCents = 0;
  return {
    subtotalCents,
    deliveryFeeCents,
    onlineFeeCents,
    taxCents,
    totalCents: subtotalCents + deliveryFeeCents + onlineFeeCents + taxCents
  };
}
