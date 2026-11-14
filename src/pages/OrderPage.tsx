import { ArrowRight, CalendarClock, MapPin, Package } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { navigate } from "../App";
import type { EventRecord } from "../../shared/model";
import { preorderIsOpen } from "../../shared/eventRules";
import { quantityLabel } from "../../shared/quantity";
import { OrderFlow } from "../components/order/OrderFlow";
import { openTracker } from "../components/order/openTracker";
import { batchRequestsEnabled, stockText, totalStockLeft } from "../components/order/orderFlowLogic";
import { SiteLink } from "../components/SiteFooter";
import { useEvents } from "../lib/eventsStore";
import { useMenuProducts } from "../lib/menuStore";
import { openPreorderEvents, useEventStock, useNow, useOrderingSettings } from "../lib/publicData";
import { formatBusinessDateTime, formatWindow } from "../lib/time";

/** The query string. It updates on in-app navigation and on the browser Back button. */
function useLocationSearch(): string {
  const [search, setSearch] = useState(window.location.search);
  useEffect(() => {
    const update = () => setSearch(window.location.search);
    window.addEventListener("popstate", update);
    document.addEventListener("bbt:navigation", update);
    return () => {
      window.removeEventListener("popstate", update);
      document.removeEventListener("bbt:navigation", update);
    };
  }, []);
  return search;
}

function EventChoiceCard({ event, onSelect }: { event: EventRecord; onSelect: () => void }) {
  const fixed = event.preorderMode === "fixed";
  const { stock, loading } = useEventStock(fixed ? event.id : "");
  const menu = useMenuProducts();
  const activeIds = menu.filter((item) => item.status === "active").map((item) => item.id);
  const left = fixed && !loading ? totalStockLeft(event, stock, activeIds) : null;
  const soldOut = left === 0;

  return (
    <article className="order-choice-card">
      <h2>{event.name}</h2>
      <ul className="order-choice-facts">
        <li>
          <MapPin size={17} aria-hidden="true" />
          {event.areaName}
        </li>
        <li>
          <CalendarClock size={17} aria-hidden="true" />
          {formatWindow(event)}
        </li>
      </ul>
      <p className="muted">Pre-orders close {formatBusinessDateTime(event.preorderCutoffUtc || event.startsAtUtc)}.</p>
      {fixed ? (
        left !== null && (
          <p className={soldOut ? "status-badge product-status-sold_out" : "order-choice-mode"}>{stockText(left)}</p>
        )
      ) : (
        <p className="order-choice-mode">We approve each order.</p>
      )}
      <button className="button button-ghost" type="button" onClick={onSelect} disabled={soldOut}>
        Start a Pre-order
        <ArrowRight size={18} aria-hidden="true" />
      </button>
    </article>
  );
}

export function OrderPage() {
  const { events, loading, failed } = useEvents();
  const { ordering, loading: orderingLoading } = useOrderingSettings();
  const now = useNow();
  const search = useLocationSearch();
  const params = new URLSearchParams(search);
  const eventParam = params.get("event") ?? "";
  const batchParam = params.get("batch") === "1";

  // Once a flow starts, it stays open when the cutoff passes. The Worker gives the reason then.
  const startedFor = useRef("");

  const openEvents = openPreorderEvents(events, now);
  const batchOn = batchRequestsEnabled(ordering);
  const selected = eventParam ? events.find((event) => event.id === eventParam) : undefined;
  const selectedOpen = Boolean(selected && (preorderIsOpen(selected, now) || startedFor.current === selected.id));

  if (selected && selectedOpen) {
    startedFor.current = selected.id;
    return (
      <main className="page-shell narrow order-page">
        <header className="order-heading">
          <h1>{selected.name}</h1>
          <p className="large-copy">
            {selected.areaName}. {formatWindow(selected)}
          </p>
        </header>
        <OrderFlow
          key={selected.id}
          kind="preorder"
          source="web"
          event={selected}
          onDone={openTracker}
          onCancel={() => navigate("/order")}
        />
      </main>
    );
  }
  startedFor.current = "";

  if (batchParam && batchOn) {
    return (
      <main className="page-shell narrow order-page">
        <header className="order-heading">
          <h1>Request a Batch</h1>
          <p className="large-copy">Select your tamales and a date. We approve or decline each batch request.</p>
        </header>
        <OrderFlow kind="batch" source="web" onDone={openTracker} onCancel={() => navigate("/order")} />
      </main>
    );
  }

  const waiting = loading || orderingLoading;
  let deepLinkNotice = "";
  if (!waiting && eventParam && !selectedOpen) deepLinkNotice = "This event does not take pre-orders now.";
  if (!waiting && batchParam && !batchOn) deepLinkNotice = "We do not take batch requests now.";

  return (
    <main className="page-shell order-page">
      <header className="order-heading">
        <h1>Order ahead.</h1>
        <p className="large-copy">Select an event for a pre-order, or request a batch for pickup or delivery.</p>
      </header>

      {deepLinkNotice && <p className="form-notice form-notice-error order-page-notice" role="alert">{deepLinkNotice}</p>}

      {waiting ? (
        <p className="empty-state" aria-live="polite">
          Loading the events.
        </p>
      ) : failed && openEvents.length === 0 ? (
        <section className="empty-state" role="alert">
          <p>We could not load the events. Check your connection, then reload the page.</p>
          {batchOn && (
            <SiteLink className="button button-primary" href="/order?batch=1">
              Request a Batch
            </SiteLink>
          )}
        </section>
      ) : openEvents.length === 0 ? (
        <section className="empty-state order-empty">
          <p>No pre-orders are open now.</p>
          <div className="order-actions card-actions">
            <SiteLink className="button button-ghost" href="/updates">
              Join the Email List
            </SiteLink>
            {batchOn && (
              <SiteLink className="button button-primary" href="/order?batch=1">
                Request a Batch
              </SiteLink>
            )}
          </div>
        </section>
      ) : (
        <div className="order-choice-grid">
          {openEvents.map((event) => (
            <EventChoiceCard
              key={event.id}
              event={event}
              onSelect={() => navigate(`/order?event=${encodeURIComponent(event.id)}`)}
            />
          ))}
          {batchOn && (
            <article className="order-choice-card">
              <h2>Request a Batch</h2>
              <ul className="order-choice-facts">
                <li>
                  <Package size={17} aria-hidden="true" />
                  {ordering.pickupEnabled && ordering.deliveryEnabled
                    ? "Pickup or delivery"
                    : ordering.pickupEnabled
                      ? "Pickup"
                      : "Delivery"}
                </li>
              </ul>
              <p className="muted">The smallest batch request is {quantityLabel(ordering.minBatchTamales)}.</p>
              <p className="order-choice-mode">We approve each batch request.</p>
              <button className="button button-ghost" type="button" onClick={() => navigate("/order?batch=1")}>
                Request a Batch
                <ArrowRight size={18} aria-hidden="true" />
              </button>
            </article>
          )}
        </div>
      )}
    </main>
  );
}
