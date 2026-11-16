import { useEffect, useState } from "react";
import type { EventRecord, OrderAction, OrderRecord } from "../../../shared/model";
import { updateEventLiveControls, useEvents } from "../../lib/eventsStore";
import { formatMoney } from "../../lib/money";
import { useLiveOrders } from "../../lib/ordersStore";
import { businessDateKey, businessTodayKey, formatTimeRange } from "../../lib/time";
import type { MenuProduct } from "../../lib/types";
import { currentEvent, toggleId } from "./eventRules";
import { ReasonDialog } from "./OrderDialogs";
import {
  actionBusyLabels,
  actionLabels,
  availableActions,
  customerName,
  lineLabel,
  liveGroupFor,
  liveGroups,
  liveNumber,
  liveOrdersForDay,
  paymentMethodLabels,
  paymentStateLabels,
  stateBadgeClass,
  stateLabels,
  type LiveGroup
} from "./orderRules";
import { useOrderActions } from "./useOrderActions";

/** The current time, read again every 30 seconds, so an event starts and ends on screen. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** Live POS > Orders: the switches for the event that is live now. */
export function LiveEventControls({ products }: { products: MenuProduct[] }) {
  const { events, loading, failed } = useEvents();
  const now = useNow();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const event = currentEvent(events, now);

  async function change(target: EventRecord, changes: Parameters<typeof updateEventLiveControls>[1]) {
    setSaving(true);
    setError("");
    try {
      await updateEventLiveControls(target.id, changes);
    } catch {
      setError("We could not save the change. Check your connection, then try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <article className="admin-card">
        <p className="muted">Loading events.</p>
      </article>
    );
  }
  if (failed) {
    return (
      <article className="admin-card">
        <p className="form-notice form-notice-error" role="alert">
          We could not load the events. Check your connection, then reload the page.
        </p>
      </article>
    );
  }
  if (!event) {
    return (
      <article className="admin-card">
        <p className="muted">No event is live now.</p>
      </article>
    );
  }

  const offered = products.filter(
    (product) =>
      product.status !== "inactive" && (event.itemIds.length === 0 || event.itemIds.includes(product.id))
  );

  return (
    <article className="admin-card live-controls">
      <div className="receipt-head">
        <div>
          <h2>{event.name}</h2>
          <span className="muted">{formatTimeRange(event)}</span>
        </div>
        {event.liveOrdersEnabled ? (
          <span className={`status-badge ${event.liveOrdersPaused ? "status-canceled" : "status-ready"}`}>
            {event.liveOrdersPaused ? "Mobile orders paused" : "Mobile orders on"}
          </span>
        ) : (
          <span className="status-badge status-canceled">Mobile orders off</span>
        )}
      </div>
      {error && (
        <p className="form-notice form-notice-error" role="alert">
          {error}
        </p>
      )}
      {event.liveOrdersEnabled && (
        <label className="toggle-row live-control-row">
          <input
            type="checkbox"
            checked={event.liveOrdersPaused}
            disabled={saving}
            onChange={(input) => void change(event, { liveOrdersPaused: input.target.checked })}
          />
          <span>Pause mobile orders</span>
        </label>
      )}
      {offered.length > 0 && (
        <fieldset className="live-control-items">
          <legend>Sold out</legend>
          {offered.map((product) => (
            <label className="toggle-row live-control-row" key={product.id}>
              <input
                type="checkbox"
                checked={event.soldOutItemIds.includes(product.id)}
                disabled={saving}
                onChange={(input) =>
                  void change(event, {
                    soldOutItemIds: toggleId(event.soldOutItemIds, product.id, input.target.checked)
                  })
                }
              />
              <span>{product.name}</span>
            </label>
          ))}
        </fieldset>
      )}
    </article>
  );
}

/** Live POS > Orders: the live orders of today, newest first, in 3 groups. */
export function LiveOrdersQueue() {
  const { orders, loading, failed } = useLiveOrders();
  const actions = useOrderActions();
  const [canceling, setCanceling] = useState<OrderRecord | null>(null);
  const today = liveOrdersForDay(orders, businessTodayKey(), businessDateKey);

  async function runAction(order: OrderRecord, action: OrderAction, reason?: string) {
    const done = await actions.run(order, action, reason ? { reason } : {});
    if (done) setCanceling(null);
  }

  function start(order: OrderRecord, action: OrderAction) {
    actions.clearError();
    if (action === "cancel") {
      setCanceling(order);
      return;
    }
    void runAction(order, action);
  }

  function renderOrder(order: OrderRecord) {
    const busy = actions.isBusy(order.id);
    const error = canceling ? "" : actions.errorFor(order.id);
    const orderActions = availableActions(order);
    return (
      <article className="receipt-card live-order" key={order.id}>
        <div className="receipt-head">
          <div className="live-order-title">
            <strong className="live-order-number">{liveNumber(order)}</strong>
            <span>{customerName(order)}</span>
          </div>
          <span className={`status-badge ${stateBadgeClass[order.state]}`}>{stateLabels[order.state]}</span>
        </div>
        <ul className="live-order-items">
          {order.items.map((line, index) => (
            <li key={`${order.id}-${index}`}>{lineLabel(line)}</li>
          ))}
        </ul>
        <div className="live-order-pay">
          <strong>{formatMoney(order.totals.totalCents)}</strong>
          <span>{paymentMethodLabels[order.paymentMethod]}</span>
          {order.paymentState === "check_payment" ? (
            <span className="status-badge status-new">Check payment</span>
          ) : (
            <span className="muted">{paymentStateLabels[order.paymentState]}</span>
          )}
        </div>
        {order.customerNote && <p className="live-order-note">{order.customerNote}</p>}
        {error && (
          <p className="form-notice form-notice-error" role="alert">
            {error}
          </p>
        )}
        {orderActions.length > 0 && (
          <div className="button-row live-order-actions">
            {orderActions.map((action) => (
              <button
                key={action}
                className="button button-small"
                type="button"
                disabled={busy || actions.running !== null}
                onClick={() => start(order, action)}
              >
                {busy && actions.running?.action === action ? actionBusyLabels[action] : actionLabels[action]}
              </button>
            ))}
          </div>
        )}
      </article>
    );
  }

  const byGroup = (group: LiveGroup) => today.filter((order) => liveGroupFor(order.state) === group);

  return (
    <article className="admin-card">
      <h2>Live orders</h2>
      {loading && <p className="muted">Loading orders.</p>}
      {failed && (
        <p className="form-notice form-notice-error" role="alert">
          We could not load the orders. Check your connection, then reload the page.
        </p>
      )}
      {!loading && !failed && today.length === 0 && <p className="muted">No live orders today.</p>}
      {today.length > 0 &&
        liveGroups.map((group) => {
          const list = byGroup(group.id);
          if (group.id === "done") {
            return (
              list.length > 0 && (
                <details className="live-order-group" key={group.id}>
                  <summary>
                    {group.label} ({list.length})
                  </summary>
                  {list.map(renderOrder)}
                </details>
              )
            );
          }
          return (
            <section className="live-order-group" key={group.id} aria-label={group.label}>
              <h3>
                {group.label} ({list.length})
              </h3>
              {list.map(renderOrder)}
            </section>
          );
        })}

      {canceling && (
        <ReasonDialog
          title={`Cancel ${liveNumber(canceling)}`}
          confirmLabel="Cancel Order"
          busyLabel={actionBusyLabels.cancel}
          required={false}
          busy={actions.isBusy(canceling.id)}
          error={actions.errorFor(canceling.id)}
          onClose={() => setCanceling(null)}
          onConfirm={(reason) => void runAction(canceling, "cancel", reason)}
        />
      )}
    </article>
  );
}
