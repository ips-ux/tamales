// Build piece 3: money. Types for PayPal Checkout, the sales ledger and refunds.
// Types only. See docs/V1_FUNDAMENTALS.md sections 6 and 12.

import type { OrderRecord } from "./model";

// ---------------------------------------------------------------------------
// How payment works in V1
// ---------------------------------------------------------------------------
// - A pre-order and a batch request are paid in full with PayPal Checkout.
// - Fixed-allotment pre-order: the Worker saves it as state "approved" with
//   stockHeld true and payByUtc = now + holdMinutes. The customer pays on the
//   tracker. The capture moves it to "received".
// - Open-interest pre-order and batch request: the owner approves; payByUtc =
//   now + paymentWindowHours. The customer pays on the tracker.
// - A scheduled Worker run expires approved, unpaid orders after payByUtc and
//   returns held tamales to eventStock.
// - Live order: paymentMethod "paypal" is a fourth choice. State is "received",
//   paymentState "unpaid" until the capture.
// - The online ordering fee is on the order from the start when the method is
//   PayPal Checkout: round(feeSharePct% of (paypalFeeBps of the pre-fee total +
//   paypalFeeFixedCents)). It is not taxed.

/** POST /api/v1/payments/create — public; the tracker token is the key. */
export interface CreatePaymentInput {
  trackerToken: string;
}

export interface CreatePaymentResult {
  /** Pass this to the PayPal button's createOrder callback. */
  paypalOrderId: string;
}

/** POST /api/v1/payments/capture — public; call it from the PayPal button's onApprove. */
export interface CapturePaymentInput {
  trackerToken: string;
  paypalOrderId: string;
}

export interface CapturePaymentResult {
  /** True when the money is captured and the order is marked paid. */
  paid: boolean;
}

// ---------------------------------------------------------------------------
// Sales ledger. `posTickets/{id}` is the 1 ledger of sales. A POS sale is
// written by the browser (owner). A sale from an order is written by the
// Worker at handover, with these extra fields.
// ---------------------------------------------------------------------------

export interface OrderSaleFields {
  /** "order" for a sale the Worker wrote at handover. A POS sale has no source field or "pos". */
  source: "order";
  orderId: string;
  orderKind: OrderRecord["kind"];
  /** Same text as the order number, so lists read the same. */
  ticketNumber: string;
  deliveryFeeCents: number;
  /** The customer share of the PayPal fee. Other income. */
  onlineFeeCents: number;
  /** What PayPal kept. An expense. */
  paypalFeeCents: number;
}

/** refund = money back to the customer. void = a sale that did not occur. edit = a changed POS sale. */
export type LedgerEntryType = "refund" | "void" | "edit";

/**
 * `ledgerEntries/{id}`: owner read. Created by the Worker (refund of an order)
 * or by the owner's browser (void or edit of a POS sale). Never changed, never deleted.
 */
export interface LedgerEntry {
  id: string;
  type: LedgerEntryType;
  /** `posTickets/{saleId}` when the entry is about a sale. Empty before handover. */
  saleId: string;
  /** `orders/{orderId}` when the entry is about an order. Empty for a POS sale. */
  orderId: string;
  /** Order number or POS ticket number, for display. */
  reference: string;
  /** Refund: the amount sent back. Void: the sale total. Edit: new total minus old total. */
  amountCents: number;
  /** The tax part of amountCents, so the sales tax report stays correct. */
  taxCents: number;
  reason: string;
  /** Edit only: short text of the change, for example "Total $24.00 to $18.00". */
  detail: string;
  /** Email of the person who made the entry. */
  byEmail: string;
  /** Practice entries stay out of reports. */
  isTest: boolean;
  createdAtUtc: string;
}

/**
 * POST /api/admin/orders/refund — owner only. The owner sends the money in the
 * payment application first, then records it here. The Worker adds refundedCents,
 * sets paymentState "refunded" when the full total is refunded, writes the
 * ledger entry, updates the tracker, and emails the customer.
 */
export interface RefundOrderInput {
  orderId: string;
  amountCents: number;
  reason: string;
  /** True also returns held tamales to eventStock and cancels an order that is not handed over. */
  cancelOrder: boolean;
}

export interface RefundOrderResult {
  order: OrderRecord;
}
