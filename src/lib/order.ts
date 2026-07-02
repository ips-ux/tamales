import { menuProducts } from "../data/fixtures";
import { getBusinessSettings } from "./businessSettings";
import { calculateTax } from "./money";
import type {
  CartSelection,
  BusinessSettings,
  MenuProduct,
  OrderDraft,
  OrderLineSnapshot,
  OrderRecord,
  OrderStatus,
  OrderTotals
} from "./types";

export const allowedStatusTransitions: Record<OrderStatus, OrderStatus[]> = {
  new: ["confirmed", "canceled"],
  confirmed: ["preparing", "ready", "canceled"],
  preparing: ["ready", "canceled"],
  ready: ["completed", "canceled"],
  completed: [],
  canceled: []
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return allowedStatusTransitions[from].includes(to);
}

export function getActiveProduct(productId: string, products = menuProducts): MenuProduct {
  const product = products.find((item) => item.id === productId);
  if (!product) throw new Error("Product not found.");
  if (product.status !== "active") throw new Error(`${product.name} is not orderable.`);
  return product;
}

export function buildOrderLines(
  selections: CartSelection[],
  products = menuProducts
): OrderLineSnapshot[] {
  return selections
    .filter((selection) => selection.quantity > 0)
    .map((selection) => {
      const product = getActiveProduct(selection.productId, products);
      const variant = product.variants.find((item) => item.id === selection.variantId);
      if (!variant || !variant.active) {
        throw new Error(`${product.name} package is unavailable.`);
      }
      if (selection.quantity < variant.minimumQuantity) {
        throw new Error(`${variant.label} requires at least ${variant.minimumQuantity}.`);
      }
      return {
        productId: product.id,
        variantId: variant.id,
        productName: product.name,
        variantLabel: variant.label,
        unitQuantity: variant.unitQuantity,
        unitPriceCents: variant.priceCents,
        quantity: selection.quantity,
        lineTotalCents: variant.priceCents * selection.quantity
      };
    });
}

export function calculateTotals(
  lines: OrderLineSnapshot[],
  taxRateBps = getBusinessSettings().taxRateBps
): OrderTotals {
  const subtotalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const taxCents = calculateTax(subtotalCents, taxRateBps);
  return {
    subtotalCents,
    taxCents,
    feeCents: 0,
    totalCents: subtotalCents + taxCents
  };
}

export function orderItemCount(selections: CartSelection[]): number {
  return selections.reduce((sum, item) => sum + item.quantity, 0);
}

export function createLocalOrderRecord(
  draft: OrderDraft,
  products: MenuProduct[] = menuProducts,
  settings: Pick<BusinessSettings, "taxRateBps"> = getBusinessSettings()
): OrderRecord {
  const lines = buildOrderLines(draft.items, products);
  const now = new Date().toISOString();
  const suffix = draft.idempotencyKey.slice(-5).toUpperCase();
  return {
    id: `local-${draft.idempotencyKey}`,
    orderNumber: `BBT-${new Date().getFullYear()}-${suffix}`,
    publicToken: `pub_${draft.idempotencyKey.replaceAll("-", "")}`,
    status: "new",
    paymentStatus: "unpaid",
    fulfillmentType: draft.fulfillmentType,
    availabilityWindowId: draft.availabilityWindowId,
    customer: draft.customer,
    bulk: draft.bulk,
    items: lines,
    totals: calculateTotals(lines, settings.taxRateBps),
    createdAtUtc: now,
    updatedAtUtc: now,
    privateNotes: "",
    vendorSessionId: draft.vendorSessionToken
  };
}

export function generateIdempotencyKey(): string {
  if ("crypto" in window && "randomUUID" in window.crypto) {
    return window.crypto.randomUUID();
  }
  return `fallback-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
