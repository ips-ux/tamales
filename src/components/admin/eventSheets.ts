// Pure aggregation for the prep sheet and the pickup list of 1 event.
// See docs/V1_FUNDAMENTALS.md section 8.

import type { OrderRecord, OrderState, PaymentState } from "../../../shared/model";
import { quantityLabel } from "../../../shared/quantity";
import { lineLabel, lineTamales, paymentStateLabels, stateLabels } from "./orderRules";

/** Pre-orders that the owner makes food for now. */
const toMakeStates: OrderState[] = ["received", "preparing", "ready"];
/** States that the pickup list shows. */
const pickupStates: OrderState[] = ["approved", "received", "preparing", "ready", "handed_over"];

function eventPreorders(orders: OrderRecord[], eventId: string): OrderRecord[] {
  return orders.filter((order) => order.kind === "preorder" && order.eventId === eventId);
}

export interface PrepRow {
  itemId: string;
  itemName: string;
  /** Tamales in pre-orders that are received, being prepared, or ready. */
  toMake: number;
  /** Tamales in pre-orders that are approved and not paid. */
  approved: number;
}

/** Total tamales for each menu item, sorted by item name. */
export function buildPrepSheet(orders: OrderRecord[], eventId: string): PrepRow[] {
  const rows = new Map<string, PrepRow>();
  for (const order of eventPreorders(orders, eventId)) {
    const column = toMakeStates.includes(order.state) ? "toMake" : order.state === "approved" ? "approved" : null;
    if (!column) continue;
    for (const line of order.items) {
      const row = rows.get(line.itemId) ?? { itemId: line.itemId, itemName: line.itemName, toMake: 0, approved: 0 };
      row[column] += lineTamales(line);
      rows.set(line.itemId, row);
    }
  }
  return [...rows.values()].sort((a, b) => a.itemName.localeCompare(b.itemName));
}

export function prepSheetCsv(rows: PrepRow[]): string[][] {
  return [
    ["Menu item", "To make", "Approved, not paid"],
    ...rows.map((row) => [row.itemName, quantityLabel(row.toMake), quantityLabel(row.approved)])
  ];
}

export interface PickupRow {
  orderId: string;
  orderNumber: string;
  firstName: string;
  lastName: string;
  /** For example "Red Chile Pork: 12 (1 dozen)". */
  items: string[];
  paymentState: PaymentState;
  state: OrderState;
}

/** 1 row for each pre-order of the event, sorted by last name, then first name, then order number. */
export function buildPickupList(orders: OrderRecord[], eventId: string): PickupRow[] {
  return eventPreorders(orders, eventId)
    .filter((order) => pickupStates.includes(order.state))
    .map((order) => ({
      orderId: order.id,
      orderNumber: order.orderNumber,
      firstName: order.customer.firstName.trim(),
      lastName: order.customer.lastName.trim(),
      items: order.items.map(lineLabel),
      paymentState: order.paymentState,
      state: order.state
    }))
    .sort(
      (a, b) =>
        a.lastName.localeCompare(b.lastName, "en", { sensitivity: "base" }) ||
        a.firstName.localeCompare(b.firstName, "en", { sensitivity: "base" }) ||
        a.orderNumber.localeCompare(b.orderNumber)
    );
}

export function pickupListCsv(rows: PickupRow[]): string[][] {
  return [
    ["Order number", "Last name", "First name", "Items", "Payment", "Status"],
    ...rows.map((row) => [
      row.orderNumber,
      row.lastName,
      row.firstName,
      row.items.join("; "),
      paymentStateLabels[row.paymentState],
      stateLabels[row.state]
    ])
  ];
}
