// Owner access to events, ordering settings and the waitlist (build piece 2).
// The owner reads and writes these documents directly; the Firestore rules
// allow it. Types are in shared/model.ts.
//
//   events/{id}              public read, owner write
//   eventStock/{id}          public read, owner and Worker write
//   eventPrivate/{id}        owner only (the Worker reads it)
//   settings/ordering        public read, owner write
//   settings/orderingPrivate owner only (the Worker reads it)
//   waitlist/{id}            owner read and delete (the Worker creates it)

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  updateDoc,
  where,
  writeBatch
} from "firebase/firestore";
import { useEffect, useState } from "react";
import {
  orderingDefaults,
  type DeliveryRing,
  type EventPrivate,
  type EventRecord,
  type EventStock,
  type KioskTarget,
  type OrderingPrivateSettings,
  type OrderingSettings,
  type PreorderMode,
  type WaitlistEntry
} from "../../shared/model";
import { nextRemaining } from "../components/admin/eventRules";
import { firebaseConfigured } from "./firebaseClient";
import { db } from "./firestoreClient";

const EVENTS = "events";
const EVENT_STOCK = "eventStock";
const EVENT_PRIVATE = "eventPrivate";
const SETTINGS = "settings";
const ORDERING_DOC = "ordering";
const ORDERING_PRIVATE_DOC = "orderingPrivate";
const WAITLIST = "waitlist";

const NOT_CONFIGURED = "Firebase is not configured.";

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function wholeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberMap(value: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (typeof entry === "number" && Number.isFinite(entry)) result[key] = entry;
    }
  }
  return result;
}

function mapEventDoc(id: string, data: Record<string, unknown>): EventRecord {
  const mode = data.preorderMode;
  return {
    id,
    name: text(data.name),
    areaName: text(data.areaName),
    startsAtUtc: text(data.startsAtUtc),
    endsAtUtc: text(data.endsAtUtc),
    active: Boolean(data.active),
    itemIds: stringList(data.itemIds),
    soldOutItemIds: stringList(data.soldOutItemIds),
    preorderMode: mode === "fixed" || mode === "open" ? (mode as PreorderMode) : "off",
    preorderCutoffUtc: text(data.preorderCutoffUtc),
    allotment: numberMap(data.allotment),
    liveOrdersEnabled: Boolean(data.liveOrdersEnabled),
    liveOrdersPaused: Boolean(data.liveOrdersPaused),
    kioskToken: text(data.kioskToken),
    kioskTarget: data.kioskTarget === "next_batch" ? ("next_batch" as KioskTarget) : "today",
    waitlistEnabled: Boolean(data.waitlistEnabled),
    exitPinHash: text(data.exitPinHash)
  };
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export function watchEvents(
  onData: (events: EventRecord[]) => void,
  onError: (error: Error) => void
): () => void {
  if (!firebaseConfigured()) {
    onError(new Error(NOT_CONFIGURED));
    return () => undefined;
  }
  return onSnapshot(
    query(collection(db(), EVENTS), orderBy("startsAtUtc")),
    (snapshot) => onData(snapshot.docs.map((item) => mapEventDoc(item.id, item.data()))),
    (error) => onError(error)
  );
}

/**
 * The event of a kiosk link, live. `onData` receives null when no event has the token.
 * The kiosk reads only this event, never the full list.
 */
export function watchEventByKioskToken(
  kioskToken: string,
  onData: (event: EventRecord | null) => void,
  onError: (error: Error) => void
): () => void {
  if (!firebaseConfigured()) {
    onError(new Error(NOT_CONFIGURED));
    return () => undefined;
  }
  return onSnapshot(
    query(collection(db(), EVENTS), where("kioskToken", "==", kioskToken)),
    { includeMetadataChanges: true },
    (snapshot) => {
      const match = snapshot.docs[0];
      // With no connection, Firestore answers from its cache first. Wait for the server.
      if (!match && snapshot.metadata.fromCache) return;
      onData(match ? mapEventDoc(match.id, match.data()) : null);
    },
    (error) => onError(error)
  );
}

export interface EventsState {
  events: EventRecord[];
  loading: boolean;
  failed: boolean;
}

export function useEvents(): EventsState {
  const [state, setState] = useState<EventsState>({ events: [], loading: true, failed: false });
  useEffect(
    () =>
      watchEvents(
        (events) => setState({ events, loading: false, failed: false }),
        () => setState((current) => ({ ...current, loading: false, failed: true }))
      ),
    []
  );
  return state;
}

/** A new id for an event that is not saved yet. */
export function newEventId(): string {
  return doc(collection(db(), EVENTS)).id;
}

export async function fetchEventPrivate(eventId: string): Promise<EventPrivate> {
  const snapshot = await getDoc(doc(db(), EVENT_PRIVATE, eventId));
  const data = snapshot.data() ?? {};
  return { address: text(data.address), instructions: text(data.instructions) };
}

export function watchEventStock(
  eventId: string,
  onData: (stock: EventStock | null) => void,
  onError: (error: Error) => void
): () => void {
  if (!firebaseConfigured()) {
    onError(new Error(NOT_CONFIGURED));
    return () => undefined;
  }
  return onSnapshot(
    doc(db(), EVENT_STOCK, eventId),
    (snapshot) => {
      const data = snapshot.data();
      onData(data ? { remaining: numberMap(data.remaining), updatedAtUtc: text(data.updatedAtUtc) } : null);
    },
    (error) => onError(error)
  );
}

/**
 * Saves the event, its private address, and (for a fixed allotment) its stock.
 * One transaction reads the stored event and stock, so the stock change uses
 * the current count. The live controls (`liveOrdersPaused`, `soldOutItemIds`)
 * and the kiosk token keep their stored values.
 */
export async function saveEvent(event: EventRecord, privateData: EventPrivate): Promise<void> {
  if (!firebaseConfigured()) throw new Error(NOT_CONFIGURED);
  const database = db();
  const eventRef = doc(database, EVENTS, event.id);
  const stockRef = doc(database, EVENT_STOCK, event.id);
  const privateRef = doc(database, EVENT_PRIVATE, event.id);
  await runTransaction(database, async (transaction) => {
    const storedEventSnapshot = await transaction.get(eventRef);
    const storedStockSnapshot = await transaction.get(stockRef);
    const stored = storedEventSnapshot.exists()
      ? mapEventDoc(event.id, storedEventSnapshot.data())
      : null;

    const { id: _id, ...data } = event;
    void _id;
    if (stored) {
      data.liveOrdersPaused = stored.liveOrdersPaused;
      data.soldOutItemIds = stored.soldOutItemIds;
      if (stored.kioskToken) data.kioskToken = stored.kioskToken;
    }
    transaction.set(eventRef, data);
    transaction.set(privateRef, privateData);

    if (event.preorderMode === "fixed") {
      const previous =
        stored && stored.preorderMode === "fixed" && storedStockSnapshot.exists()
          ? {
              allotment: stored.allotment,
              remaining: numberMap(storedStockSnapshot.data().remaining)
            }
          : null;
      const stock: EventStock = {
        remaining: nextRemaining(previous, event.allotment),
        updatedAtUtc: new Date().toISOString()
      };
      transaction.set(stockRef, stock);
    }
  });
}

/** The Live POS controls: "Pause mobile orders" and the sold-out list. */
export async function updateEventLiveControls(
  eventId: string,
  changes: Partial<Pick<EventRecord, "liveOrdersPaused" | "soldOutItemIds">>
): Promise<void> {
  await updateDoc(doc(db(), EVENTS, eventId), changes);
}

/** Deletes an event with its stock and its private address. Use only for an event with no orders. */
export async function deleteEvent(eventId: string): Promise<void> {
  const database = db();
  const batch = writeBatch(database);
  batch.delete(doc(database, EVENTS, eventId));
  batch.delete(doc(database, EVENT_STOCK, eventId));
  batch.delete(doc(database, EVENT_PRIVATE, eventId));
  await batch.commit();
}

// ---------------------------------------------------------------------------
// Ordering settings
// ---------------------------------------------------------------------------

function mapRings(value: unknown): DeliveryRing[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => item as Record<string, unknown>)
    .filter((item) => item && typeof item.miles === "number" && typeof item.feeCents === "number")
    .map((item) => ({ miles: item.miles as number, feeCents: item.feeCents as number }))
    .sort((a, b) => a.miles - b.miles);
}

export function watchOrderingSettings(
  onData: (settings: OrderingSettings) => void,
  onError: (error: Error) => void
): () => void {
  if (!firebaseConfigured()) {
    onError(new Error(NOT_CONFIGURED));
    return () => undefined;
  }
  return onSnapshot(
    doc(db(), SETTINGS, ORDERING_DOC),
    (snapshot) => {
      const data = snapshot.data() ?? {};
      const flag = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
      onData({
        pickupEnabled: flag(data.pickupEnabled, orderingDefaults.pickupEnabled),
        deliveryEnabled: flag(data.deliveryEnabled, orderingDefaults.deliveryEnabled),
        pickupAreaName: text(data.pickupAreaName),
        minBatchTamales: wholeNumber(data.minBatchTamales, orderingDefaults.minBatchTamales),
        minNoticeDays: wholeNumber(data.minNoticeDays, orderingDefaults.minNoticeDays),
        deliveryRings: mapRings(data.deliveryRings),
        deliveryFeeTaxable: flag(data.deliveryFeeTaxable, orderingDefaults.deliveryFeeTaxable),
        paymentWindowHours: wholeNumber(data.paymentWindowHours, orderingDefaults.paymentWindowHours),
        holdMinutes: wholeNumber(data.holdMinutes, orderingDefaults.holdMinutes),
        paypalFeeBps: wholeNumber(data.paypalFeeBps, orderingDefaults.paypalFeeBps),
        paypalFeeFixedCents: wholeNumber(data.paypalFeeFixedCents, orderingDefaults.paypalFeeFixedCents),
        feeSharePct: Math.min(100, wholeNumber(data.feeSharePct, orderingDefaults.feeSharePct))
      });
    },
    (error) => onError(error)
  );
}

export const orderingPrivateDefaults: OrderingPrivateSettings = {
  startAddress: "",
  startLat: null,
  startLng: null,
  pickupAddress: "",
  pickupInstructions: ""
};

export async function fetchOrderingPrivate(): Promise<OrderingPrivateSettings> {
  const snapshot = await getDoc(doc(db(), SETTINGS, ORDERING_PRIVATE_DOC));
  const data = snapshot.data() ?? {};
  const coordinate = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  return {
    startAddress: text(data.startAddress),
    startLat: coordinate(data.startLat),
    startLng: coordinate(data.startLng),
    pickupAddress: text(data.pickupAddress),
    pickupInstructions: text(data.pickupInstructions)
  };
}

/**
 * Saves both ordering documents in 1 batch. When the delivery start address
 * changed, the saved coordinates become null, so the Worker finds the address again.
 */
export async function saveOrderingSettings(
  settings: OrderingSettings,
  privateSettings: Pick<OrderingPrivateSettings, "startAddress" | "pickupAddress" | "pickupInstructions">,
  startAddressChanged: boolean
): Promise<void> {
  if (!firebaseConfigured()) throw new Error(NOT_CONFIGURED);
  const database = db();
  const batch = writeBatch(database);
  batch.set(doc(database, SETTINGS, ORDERING_DOC), settings, { merge: true });
  batch.set(
    doc(database, SETTINGS, ORDERING_PRIVATE_DOC),
    startAddressChanged ? { ...privateSettings, startLat: null, startLng: null } : privateSettings,
    { merge: true }
  );
  await batch.commit();
}

// ---------------------------------------------------------------------------
// Waitlist
// ---------------------------------------------------------------------------

export function watchWaitlist(
  onData: (entries: WaitlistEntry[]) => void,
  onError: (error: Error) => void
): () => void {
  if (!firebaseConfigured()) {
    onError(new Error(NOT_CONFIGURED));
    return () => undefined;
  }
  return onSnapshot(
    query(collection(db(), WAITLIST), orderBy("createdAtUtc", "desc")),
    (snapshot) =>
      onData(
        snapshot.docs.map((item) => {
          const data = item.data();
          return {
            id: item.id,
            firstName: text(data.firstName),
            lastName: text(data.lastName),
            email: text(data.email),
            interest: text(data.interest),
            eventId: text(data.eventId),
            eventName: text(data.eventName),
            createdAtUtc: text(data.createdAtUtc)
          } satisfies WaitlistEntry;
        })
      ),
    (error) => onError(error)
  );
}

export async function deleteWaitlistEntry(id: string): Promise<void> {
  await deleteDoc(doc(db(), WAITLIST, id));
}
