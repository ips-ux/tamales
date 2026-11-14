// Owner read access to the V1 orders (build piece 2). The owner does not write
// an order from the browser: every change goes through `runOrderAction` in
// api.ts. Types are in shared/model.ts.
//
// The V1 orders share the `orders` collection with the orders of the old
// model. A V1 order has a `kind` field; these queries filter on it, so an old
// document never arrives here.

import { collection, onSnapshot, query, where, type Query } from "firebase/firestore";
import { useEffect, useState } from "react";
import type {
  DeliveryFeeStatus,
  Fulfillment,
  OrderDelivery,
  OrderKind,
  OrderLine,
  OrderRecord,
  OrderRequestedTime,
  OrderSource,
  OrderState,
  PaymentMethod,
  PaymentState
} from "../../shared/model";
import { firebaseConfigured } from "./firebaseClient";
import { db } from "./firestoreClient";

const ORDERS = "orders";

const kinds: OrderKind[] = ["live", "preorder", "batch"];
const states: OrderState[] = [
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
const paymentStates: PaymentState[] = ["unpaid", "check_payment", "paid", "refunded"];
const paymentMethods: PaymentMethod[] = ["unset", "paypal", "venmo", "cashapp", "cash"];
const sources: OrderSource[] = ["web", "mobile", "kiosk"];
const fulfillments: Fulfillment[] = ["event_pickup", "pickup", "delivery"];
const feeStatuses: DeliveryFeeStatus[] = ["computed", "to_be_set", "owner_set"];

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function oneOf<T extends string>(value: unknown, options: T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function mapLine(value: unknown): OrderLine {
  const data = record(value);
  return {
    itemId: text(data.itemId),
    variantId: text(data.variantId),
    itemName: text(data.itemName),
    variantLabel: text(data.variantLabel),
    unitTamales: count(data.unitTamales),
    unitPriceCents: count(data.unitPriceCents),
    quantity: count(data.quantity),
    lineTotalCents: count(data.lineTotalCents)
  };
}

function mapDelivery(value: unknown): OrderDelivery | null {
  if (!value || typeof value !== "object") return null;
  const data = record(value);
  return {
    address: text(data.address),
    distanceMiles: typeof data.distanceMiles === "number" ? data.distanceMiles : null,
    feeStatus: oneOf(data.feeStatus, feeStatuses, "computed")
  };
}

function mapRequested(value: unknown): OrderRequestedTime | null {
  if (!value || typeof value !== "object") return null;
  const data = record(value);
  return { date: text(data.date), timeRange: text(data.timeRange) };
}

/** Builds an order with a safe value for each field, so a screen does not fail on a document with a gap. */
export function mapOrderDoc(id: string, data: Record<string, unknown>): OrderRecord {
  const customer = record(data.customer);
  const totals = record(data.totals);
  return {
    id,
    kind: oneOf(data.kind, kinds, "live"),
    source: oneOf(data.source, sources, "web"),
    state: oneOf(data.state, states, "received"),
    paymentState: oneOf(data.paymentState, paymentStates, "unpaid"),
    paymentMethod: oneOf(data.paymentMethod, paymentMethods, "unset"),
    orderNumber: text(data.orderNumber),
    sequence: count(data.sequence),
    paymentDescription: text(data.paymentDescription),
    eventId: text(data.eventId),
    eventName: text(data.eventName),
    fulfillment: oneOf(data.fulfillment, fulfillments, "event_pickup"),
    customer: {
      firstName: text(customer.firstName),
      lastName: text(customer.lastName),
      email: text(customer.email),
      phone: text(customer.phone),
      marketingOptIn: Boolean(customer.marketingOptIn)
    },
    customerId: text(data.customerId),
    items: Array.isArray(data.items) ? data.items.map(mapLine) : [],
    tamaleCount: count(data.tamaleCount),
    totals: {
      subtotalCents: count(totals.subtotalCents),
      deliveryFeeCents: count(totals.deliveryFeeCents),
      onlineFeeCents: count(totals.onlineFeeCents),
      taxCents: count(totals.taxCents),
      totalCents: count(totals.totalCents)
    },
    delivery: mapDelivery(data.delivery),
    requested: mapRequested(data.requested),
    scheduledAtUtc: text(data.scheduledAtUtc),
    customerNote: text(data.customerNote),
    ownerNote: text(data.ownerNote),
    reason: text(data.reason),
    trackerToken: text(data.trackerToken),
    createdAtUtc: text(data.createdAtUtc),
    updatedAtUtc: text(data.updatedAtUtc),
    approvedAtUtc: text(data.approvedAtUtc),
    payByUtc: text(data.payByUtc)
  };
}

function watchQuery(
  build: () => Query,
  onData: (orders: OrderRecord[]) => void,
  onError: (error: Error) => void
): () => void {
  if (!firebaseConfigured()) {
    onError(new Error("Firebase is not configured."));
    return () => undefined;
  }
  return onSnapshot(
    build(),
    (snapshot) => onData(snapshot.docs.map((item) => mapOrderDoc(item.id, item.data()))),
    (error) => onError(error)
  );
}

/** All live orders. The screen filters to the business day. */
export function watchLiveOrders(
  onData: (orders: OrderRecord[]) => void,
  onError: (error: Error) => void
): () => void {
  return watchQuery(() => query(collection(db(), ORDERS), where("kind", "==", "live")), onData, onError);
}

/** All pre-orders and batch requests. */
export function watchQueueOrders(
  onData: (orders: OrderRecord[]) => void,
  onError: (error: Error) => void
): () => void {
  return watchQuery(
    () => query(collection(db(), ORDERS), where("kind", "in", ["preorder", "batch"])),
    onData,
    onError
  );
}

/** The orders of 1 event, for the prep sheet and the pickup list. */
export function watchEventOrders(
  eventId: string,
  onData: (orders: OrderRecord[]) => void,
  onError: (error: Error) => void
): () => void {
  return watchQuery(
    () => query(collection(db(), ORDERS), where("eventId", "==", eventId)),
    onData,
    onError
  );
}

export interface OrdersState {
  orders: OrderRecord[];
  loading: boolean;
  failed: boolean;
}

type Watcher = (onData: (orders: OrderRecord[]) => void, onError: (error: Error) => void) => () => void;

function useWatchedOrders(watch: Watcher, key: string): OrdersState {
  const [state, setState] = useState<OrdersState>({ orders: [], loading: true, failed: false });
  useEffect(() => {
    setState({ orders: [], loading: true, failed: false });
    return watch(
      (orders) => setState({ orders, loading: false, failed: false }),
      () => setState((current) => ({ ...current, loading: false, failed: true }))
    );
    // `watch` is stable for a given key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

export function useLiveOrders(): OrdersState {
  return useWatchedOrders(watchLiveOrders, "live");
}

export function useQueueOrders(): OrdersState {
  return useWatchedOrders(watchQueueOrders, "queue");
}

export function useEventOrders(eventId: string): OrdersState {
  return useWatchedOrders((onData, onError) => watchEventOrders(eventId, onData, onError), `event:${eventId}`);
}
