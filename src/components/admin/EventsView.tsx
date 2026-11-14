import { ChevronRight, Plus } from "lucide-react";
import { useState } from "react";
import type { EventRecord } from "../../../shared/model";
import { useEvents } from "../../lib/eventsStore";
import { formatWindow } from "../../lib/time";
import type { MenuProduct } from "../../lib/types";
import { EventDetail } from "./EventDetail";
import { EventForm } from "./EventForm";
import { preorderModeLabels, splitEvents } from "./eventRules";

type Screen =
  | { name: "list" }
  | { name: "add" }
  | { name: "edit"; eventId: string }
  | { name: "detail"; eventId: string };

/** Admin > Events: the list of events, the event form, and the page of 1 event. */
export function EventsView({ products }: { products: MenuProduct[] }) {
  const { events, loading, failed } = useEvents();
  const [screen, setScreen] = useState<Screen>({ name: "list" });

  if (screen.name === "add") {
    return (
      <EventForm
        products={products}
        onCancel={() => setScreen({ name: "list" })}
        onSaved={(eventId) => setScreen({ name: "detail", eventId })}
      />
    );
  }

  if (screen.name === "edit" || screen.name === "detail") {
    const event = events.find((item) => item.id === screen.eventId);
    if (event && screen.name === "edit") {
      return (
        <EventForm
          key={event.id}
          event={event}
          products={products}
          onCancel={() => setScreen({ name: "detail", eventId: event.id })}
          onSaved={(eventId) => setScreen({ name: "detail", eventId })}
        />
      );
    }
    if (event) {
      return (
        <EventDetail
          key={event.id}
          event={event}
          products={products}
          onBack={() => setScreen({ name: "list" })}
          onEdit={() => setScreen({ name: "edit", eventId: event.id })}
        />
      );
    }
    if (loading) {
      return (
        <article className="admin-card">
          <p className="muted">Loading the event.</p>
        </article>
      );
    }
  }

  const { upcoming, past } = splitEvents(events, new Date());

  function renderEvent(event: EventRecord) {
    return (
      <button
        className="admin-card event-card"
        type="button"
        key={event.id}
        onClick={() => setScreen({ name: "detail", eventId: event.id })}
      >
        <span className="event-card-main">
          <strong>{event.name}</strong>
          <span>{formatWindow(event)}</span>
          <span className="muted">{event.areaName}</span>
        </span>
        <span className="event-card-badges">
          <span className={`status-badge ${event.active ? "product-status-active" : "product-status-inactive"}`}>
            {event.active ? "On the site" : "Hidden"}
          </span>
          <span className="price-chip">Pre-orders: {preorderModeLabels[event.preorderMode]}</span>
        </span>
        <ChevronRight size={20} aria-hidden="true" />
      </button>
    );
  }

  return (
    <section className="menu-manager">
      <div className="menu-toolbar">
        <p className="muted">
          {upcoming.length} upcoming, {past.length} past
        </p>
        <button className="button button-primary" type="button" onClick={() => setScreen({ name: "add" })}>
          <Plus size={18} aria-hidden="true" />
          Add Event
        </button>
      </div>
      {loading && <p className="muted">Loading events.</p>}
      {failed && (
        <p className="form-notice form-notice-error" role="alert">
          We could not load the events. Check your connection, then reload the page.
        </p>
      )}
      {!loading && !failed && events.length === 0 && (
        <p className="empty-state">No events. Add an event to take orders.</p>
      )}
      {upcoming.length > 0 && (
        <div className="event-list" aria-label="Upcoming events">
          {upcoming.map(renderEvent)}
        </div>
      )}
      {past.length > 0 && (
        <div className="event-list">
          <h2>Past</h2>
          {past.map(renderEvent)}
        </div>
      )}
    </section>
  );
}
