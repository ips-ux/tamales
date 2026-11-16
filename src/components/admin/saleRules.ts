// Pure rules for the POS sales list: what the owner can do with a sale, and
// the ledger entry for a void or an edit. No React and no Firestore.
// A real sale is never deleted and never changed without an entry.
// See docs/V1_FUNDAMENTALS.md section 12 and shared/moneyModel.ts.

import type { LedgerEntry } from "../../../shared/moneyModel";
import { formatMoney } from "../../lib/money";
import { posPaymentLabel } from "./paymentLabels";

/** The entry fields that the rules set. The store adds the id, the email, the test flag and the time. */
export type NewLedgerEntry = Omit<LedgerEntry, "id" | "byEmail" | "isTest" | "createdAtUtc">;

export interface SaleItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
}

/** The parts of a sale that these rules read. `PosTicketRecord` fits it. */
export interface SaleFields {
  id: string;
  ticketNumber: string;
  items: SaleItem[];
  taxCents: number;
  totalCents: number;
  paymentMethod: string;
  customerName: string;
  isTest: boolean;
  status: "paid" | "void";
  source: "pos" | "order";
}

/** The new values of an edited sale. `PosTicketUpdate` fits it. */
export interface SaleChange {
  items: SaleItem[];
  taxCents: number;
  totalCents: number;
  paymentMethod: string;
  customerName: string;
}

export interface SaleActions {
  /** A sale from an order is read-only here. Refunds go through the order screens. */
  readOnly: boolean;
  edit: boolean;
  void: boolean;
  /** Test sales only. */
  restore: boolean;
  /** Test sales only. */
  remove: boolean;
}

/** What the POS sales list offers for a sale. */
export function saleActions(sale: Pick<SaleFields, "isTest" | "status" | "source">): SaleActions {
  if (sale.source === "order") return { readOnly: true, edit: false, void: false, restore: false, remove: false };
  const paid = sale.status === "paid";
  return {
    readOnly: false,
    edit: paid,
    void: paid,
    restore: sale.isTest && !paid,
    remove: sale.isTest
  };
}

export const SALE_REASON_MAX = 300;

/** Returns 1 instruction when the reason is not valid, or an empty string. A test sale needs no reason. */
export function reasonError(reason: string, isTest: boolean): string {
  const text = reason.trim();
  if (!text) return isTest ? "" : "Enter the reason.";
  return text.length > SALE_REASON_MAX ? `Make the reason ${SALE_REASON_MAX} characters or shorter.` : "";
}

/** The void entry: the amount is the sale total, and the tax part is the sale tax. */
export function voidLedgerFields(
  sale: Pick<SaleFields, "id" | "ticketNumber" | "totalCents" | "taxCents">,
  reason: string
): NewLedgerEntry {
  return {
    type: "void",
    saleId: sale.id,
    orderId: "",
    reference: sale.ticketNumber,
    amountCents: sale.totalCents,
    taxCents: sale.taxCents,
    reason: reason.trim(),
    detail: ""
  };
}

/** "2 × Red Chile Pork, 1 × Green Chile Chicken", or "No items". */
export function itemsText(items: SaleItem[]): string {
  const parts = items.filter((item) => item.quantity > 0).map((item) => `${item.quantity} × ${item.productName}`);
  return parts.length > 0 ? parts.join(", ") : "No items";
}

/** The short before and after text of an edit. Empty when nothing changed. */
export function editDetail(
  sale: Pick<SaleFields, "items" | "totalCents" | "paymentMethod" | "customerName">,
  change: SaleChange
): string {
  const parts: string[] = [];
  if (change.totalCents !== sale.totalCents) {
    parts.push(`Total ${formatMoney(sale.totalCents)} to ${formatMoney(change.totalCents)}.`);
  }
  const before = itemsText(sale.items);
  const after = itemsText(change.items);
  if (before !== after) parts.push(`Items: ${before} to ${after}.`);
  if (change.paymentMethod !== sale.paymentMethod) {
    parts.push(`Payment: ${posPaymentLabel(sale.paymentMethod)} to ${posPaymentLabel(change.paymentMethod)}.`);
  }
  if (change.customerName.trim() !== sale.customerName.trim()) {
    parts.push(`Name: ${sale.customerName.trim() || "none"} to ${change.customerName.trim() || "none"}.`);
  }
  return parts.join(" ");
}

/** True when the edit changes the sale. */
export function saleChanged(
  sale: Pick<SaleFields, "items" | "totalCents" | "paymentMethod" | "customerName">,
  change: SaleChange
): boolean {
  return editDetail(sale, change) !== "";
}

/** The edit entry: the amount is the new total minus the old total, and the tax part is the tax change. */
export function editLedgerFields(
  sale: Pick<
    SaleFields,
    "id" | "ticketNumber" | "items" | "totalCents" | "taxCents" | "paymentMethod" | "customerName"
  >,
  change: SaleChange,
  reason: string
): NewLedgerEntry {
  return {
    type: "edit",
    saleId: sale.id,
    orderId: "",
    reference: sale.ticketNumber,
    amountCents: change.totalCents - sale.totalCents,
    taxCents: change.taxCents - sale.taxCents,
    reason: reason.trim(),
    detail: editDetail(sale, change)
  };
}
