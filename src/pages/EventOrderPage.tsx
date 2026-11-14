// /e/{eventId}: the mobile order page. The QR code on the table sign opens it.
import { type ReactNode, useRef } from "react";
import { preorderIsOpen } from "../../shared/eventRules";
import { OrderFlow } from "../components/order/OrderFlow";
import { SiteLink } from "../components/SiteFooter";
import { useEvents } from "../lib/eventsStore";
import { eventPhase, useNow } from "../lib/publicData";
import { formatBusinessDateTime, formatWindow } from "../lib/time";
import { openTracker } from "../components/order/openTracker";

function EventMessage({ title, line, children }: { title: string; line: string; children?: ReactNode }) {
  return (
    <main className="page-shell narrow">
      <section className="empty-state event-message">
        <h1>{title}</h1>
        <p>{line}</p>
        <div className="order-actions card-actions">{children}</div>
      </section>
    </main>
  );
}

export function EventOrderPage({ eventId }: { eventId: string }) {
  const { events, loading, failed } = useEvents();
  const now = useNow(15_000);
  // Once the customer starts an order, the form stays open. The Worker gives the reason if the event closes.
  const started = useRef(false);

  if (loading) {
    return (
      <main className="page-shell narrow">
        <p className="empty-state" aria-live="polite">
          Loading the event.
        </p>
      </main>
    );
  }

  const event = events.find((item) => item.id === eventId && item.active);
  if (!event) {
    return (
      <EventMessage
        title={failed ? "We could not load this event." : "Event not found."}
        line={
          failed
            ? "Check your connection, then reload the page."
            : "We do not have an open event at this link."
        }
      >
        <SiteLink className="button button-primary" href="/">
          Back to Home
        </SiteLink>
      </EventMessage>
    );
  }

  const phase = eventPhase(event, now);
  if (phase === "live" || started.current) {
    started.current = true;
    return (
      <main className="page-shell narrow order-page">
        <header className="order-heading">
          <h1>{event.name}</h1>
          <p className="large-copy">
            {event.areaName}. {formatWindow(event)}
          </p>
        </header>
        <OrderFlow kind="live" source="mobile" event={event} onDone={openTracker} />
      </main>
    );
  }

  if (phase === "booth_only") {
    return (
      <EventMessage title={event.name} line="We are not taking mobile orders now. Order at the booth.">
        <SiteLink className="button button-primary" href="/">
          Back to Home
        </SiteLink>
      </EventMessage>
    );
  }

  if (phase === "before") {
    const canPreorder = preorderIsOpen(event, now);
    return (
      <EventMessage title={event.name} line={`This event starts ${formatBusinessDateTime(event.startsAtUtc)}.`}>
        {canPreorder ? (
          <SiteLink className="button button-primary" href={`/order?event=${encodeURIComponent(event.id)}`}>
            Start a Pre-order
          </SiteLink>
        ) : (
          <SiteLink className="button button-primary" href="/">
            Back to Home
          </SiteLink>
        )}
      </EventMessage>
    );
  }

  return (
    <EventMessage title={event.name} line="This event ended.">
      <SiteLink className="button button-primary" href="/">
        Back to Home
      </SiteLink>
    </EventMessage>
  );
}
