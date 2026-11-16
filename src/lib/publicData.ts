// Public read hooks for the customer pages: event stock, order settings,
// payment account names, and the clock. Firestore rules allow each read.
// Events come from `useEvents` in eventsStore.ts.

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { eventIsLive, preorderIsOpen } from "../../shared/eventRules";
import { orderingDefaults, type EventRecord, type EventStock, type OrderingSettings } from "../../shared/model";
import { watchEventStock, watchOrderingSettings } from "./eventsStore";
import { firebaseConfigured } from "./firebaseClient";
import { db } from "./firestoreClient";

/** The current time. It updates on an interval, so a page sees an event start, end, or reach its cutoff. */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export interface EventStockState {
  /** Null when the event has no stock document. The full allotment remains then. */
  stock: EventStock | null;
  loading: boolean;
}

/** `eventStock/{eventId}`, live. Pass an empty id to read nothing. */
export function useEventStock(eventId: string): EventStockState {
  const [state, setState] = useState<EventStockState>({ stock: null, loading: Boolean(eventId) });
  useEffect(() => {
    if (!eventId) {
      setState({ stock: null, loading: false });
      return;
    }
    setState({ stock: null, loading: true });
    return watchEventStock(
      eventId,
      (stock) => setState({ stock, loading: false }),
      () => setState({ stock: null, loading: false })
    );
  }, [eventId]);
  return state;
}

export interface OrderingState {
  ordering: OrderingSettings;
  loading: boolean;
}

/** `settings/ordering`, live. The defaults apply if the document is unreadable. */
export function useOrderingSettings(): OrderingState {
  const [state, setState] = useState<OrderingState>({ ordering: orderingDefaults, loading: true });
  useEffect(
    () =>
      watchOrderingSettings(
        (ordering) => setState({ ordering, loading: false }),
        () => setState({ ordering: orderingDefaults, loading: false })
      ),
    []
  );
  return state;
}

export interface PaymentHandles {
  venmoHandle: string;
  cashAppCashtag: string;
  loading: boolean;
}

/** `settings/payments`: the account names for the payment links. Empty means the method is not offered. */
export function usePaymentHandles(): PaymentHandles {
  const [state, setState] = useState<PaymentHandles>({ venmoHandle: "", cashAppCashtag: "", loading: true });
  useEffect(() => {
    if (!firebaseConfigured()) {
      setState({ venmoHandle: "", cashAppCashtag: "", loading: false });
      return;
    }
    return onSnapshot(
      doc(db(), "settings", "payments"),
      (snapshot) => {
        const data = snapshot.data() ?? {};
        setState({
          venmoHandle: typeof data.venmoHandle === "string" ? data.venmoHandle.trim() : "",
          cashAppCashtag: typeof data.cashAppCashtag === "string" ? data.cashAppCashtag.trim() : "",
          loading: false
        });
      },
      () => setState({ venmoHandle: "", cashAppCashtag: "", loading: false })
    );
  }, []);
  return state;
}

// ---------------------------------------------------------------------------
// Event selection. Pure, so tests can import these.
// ---------------------------------------------------------------------------

type Moment = Date | string | number;

function ms(value: Moment): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function byStart(a: EventRecord, b: EventRecord): number {
  return ms(a.startsAtUtc) - ms(b.startsAtUtc);
}

/** Active events that take pre-orders now, soonest first. */
export function openPreorderEvents(events: EventRecord[], now: Moment): EventRecord[] {
  return events.filter((event) => preorderIsOpen(event, now)).sort(byStart);
}

/** The soonest active event that did not end. */
export function nextEvent(events: EventRecord[], now: Moment): EventRecord | undefined {
  const at = ms(now);
  return events.filter((event) => event.active && ms(event.endsAtUtc) > at).sort(byStart)[0];
}

/** True during the hours of an active event, also when mobile orders are paused. */
export function eventIsOpenNow(event: EventRecord, now: Moment): boolean {
  const at = ms(now);
  return event.active && at >= ms(event.startsAtUtc) && at < ms(event.endsAtUtc);
}

export type EventPhase = "live" | "booth_only" | "before" | "ended";

/** Where an event is for the mobile order page. */
export function eventPhase(event: EventRecord, now: Moment): EventPhase {
  if (eventIsLive(event, now)) return "live";
  const at = ms(now);
  if (at < ms(event.startsAtUtc)) return "before";
  if (at < ms(event.endsAtUtc)) return "booth_only";
  return "ended";
}
