// The sale that the Worker writes to `posTickets` when the owner hands over an order.
// `posTickets` is the 1 sales ledger. The shape is the shape that the Live POS writes
// (see `savePosTicket` in src/lib/firestoreClient.ts), plus `OrderSaleFields`.

import type { OrderLine, OrderRecord } from "../../shared/model";
import type { OrderSaleFields } from "../../shared/moneyModel";

export interface SaleItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
}

export interface OrderSale extends OrderSaleFields {
  items: SaleItem[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paymentMethod: string;
  customerName: string;
  isTest: false;
  status: "paid";
  createdAtUtc: string;
  soldByEmail: string;
  soldByUid: string;
}

/**
 * 1 sale item for each order line. The quantity is tamales and the price is for 1 tamale,
 * when the line total divides into whole cents. If it does not (a dozen for $34.00),
 * the item keeps the units and the price of the variant, and the name gives the variant.
 * In each case, quantity x unitPriceCents is the line total.
 */
export function saleItems(lines: OrderLine[]): SaleItem[] {
  return lines.map((line) => {
    const tamales = line.unitTamales * line.quantity;
    if (tamales > 0 && line.lineTotalCents % tamales === 0) {
      return {
        productId: line.itemId,
        productName: line.itemName,
        quantity: tamales,
        unitPriceCents: line.lineTotalCents / tamales
      };
    }
    return {
      productId: line.itemId,
      productName: `${line.itemName}, ${line.variantLabel}`,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents
    };
  });
}

/** The person who made the change, from the Firebase ID token. */
export interface Actor {
  email: string;
  uid: string;
}

export function buildOrderSale(order: OrderRecord, handedOverAtUtc: string, actor: Actor): OrderSale {
  return {
    items: saleItems(order.items),
    subtotalCents: order.totals.subtotalCents,
    taxCents: order.totals.taxCents,
    totalCents: order.totals.totalCents,
    paymentMethod: order.paymentMethod,
    customerName: `${order.customer.firstName} ${order.customer.lastName}`.trim(),
    isTest: false,
    status: "paid",
    createdAtUtc: handedOverAtUtc,
    soldByEmail: actor.email,
    soldByUid: actor.uid,
    source: "order",
    orderId: order.id,
    orderKind: order.kind,
    ticketNumber: order.orderNumber,
    deliveryFeeCents: order.totals.deliveryFeeCents,
    onlineFeeCents: order.totals.onlineFeeCents,
    paypalFeeCents: order.paypalFeeCents
  };
}
