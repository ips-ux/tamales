import { Mail, Phone } from "lucide-react";
import { useState } from "react";
import type { OrderAction, OrderRecord } from "../../../shared/model";
import { useEvents } from "../../lib/eventsStore";
import { useQueueOrders } from "../../lib/ordersStore";
import { formatBusinessDateTime } from "../../lib/time";
import { contactPhoneHref } from "./contactLinks";
import { ApproveDialog, ReasonDialog, RefundDialog } from "./OrderDialogs";
import {
  actionBlocked,
  actionBusyLabels,
  actionLabels,
  availableActions,
  canRefund,
  customerName,
  formatDayKey,
  handOverHint,
  kindLabels,
  lineLabel,
  moneyLines,
  paymentFacts,
  paymentSummary,
  queueCounts,
  queueOrders,
  queueTabs,
  stateBadgeClass,
  stateLabels,
  type QueueTab
} from "./orderRules";
import { formatMoney } from "../../lib/money";
import { useOrderActions } from "./useOrderActions";

const emptyText: Record<QueueTab, string> = {
  requested: "No orders wait for approval.",
  approved: "No approved orders wait for payment.",
  in_work: "No orders are in work.",
  done: "No orders are done."
};

type Dialog = { order: OrderRecord; action: "approve" | "decline" | "cancel" | "refund" } | null;

/** Admin > Pre-Orders: pre-orders and batch requests, by step. */
export function PreordersQueue() {
  const { orders, loading, failed } = useQueueOrders();
  const { events } = useEvents();
  const actions = useOrderActions();
  const [tab, setTab] = useState<QueueTab>("requested");
  const [dialog, setDialog] = useState<Dialog>(null);
  // Owner notes that the owner changed and did not save. Key: order id.
  const [notes, setNotes] = useState<Record<string, string>>({});

  const counts = queueCounts(orders);
  const visible = queueOrders(orders, tab);
  // The dialog shows the current order, not the copy from when it opened.
  const dialogOrder = dialog ? orders.find((order) => order.id === dialog.order.id) ?? dialog.order : null;

  function noteChange(order: OrderRecord): { ownerNote?: string } {
    const draft = notes[order.id];
    return draft !== undefined && draft.trim() !== order.ownerNote ? { ownerNote: draft.trim() } : {};
  }

  async function runAction(order: OrderRecord, action: OrderAction, extra: Record<string, unknown> = {}) {
    const done = await actions.run(order, action, { ...extra, ...noteChange(order) });
    if (done) {
      setNotes((current) => {
        const { [order.id]: _saved, ...rest } = current;
        void _saved;
        return rest;
      });
      setDialog(null);
    }
  }

  function saveNote(order: OrderRecord) {
    actions.clearError();
    const change = noteChange(order);
    if (change.ownerNote === undefined) return;
    void runAction(order, "save_note", { ownerNote: change.ownerNote });
  }

  function start(order: OrderRecord, action: OrderAction) {
    actions.clearError();
    if (action === "approve" || action === "decline" || action === "cancel") {
      setDialog({ order, action });
      return;
    }
    void runAction(order, action);
  }

  return (
    <section className="admin-card">
      <div className="report-tabs" role="group" aria-label="Order steps">
        {queueTabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`button button-small report-tab${tab === item.id ? " active" : ""}`}
            aria-pressed={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label} ({counts[item.id]})
          </button>
        ))}
      </div>

      {loading && <p className="muted">Loading orders.</p>}
      {failed && (
        <p className="form-notice form-notice-error" role="alert">
          We could not load the orders. Check your connection, then reload the page.
        </p>
      )}
      {!loading && !failed && visible.length === 0 && <p className="muted">{emptyText[tab]}</p>}

      {visible.map((order) => {
        const busy = actions.isBusy(order.id);
        const error = dialog ? "" : actions.errorFor(order.id);
        const phoneHref = contactPhoneHref(order.customer.phone);
        const orderActions = availableActions(order);
        const refundable = canRefund(order);
        const hint = handOverHint(order);
        const noteValue = notes[order.id] ?? order.ownerNote;
        return (
          <article className="receipt-card" key={order.id}>
            <div className="receipt-head">
              <div>
                <strong>{order.orderNumber}</strong>
                <span className="muted">
                  {order.kind === "batch" ? kindLabels.batch : `${kindLabels[order.kind]} · ${order.eventName}`}
                </span>
              </div>
              <span className={`status-badge ${stateBadgeClass[order.state]}`}>{stateLabels[order.state]}</span>
            </div>

            <div className="order-card-contact">
              <strong>{customerName(order)}</strong>
              <a href={`mailto:${order.customer.email}`}>
                <Mail size={16} aria-hidden="true" />
                {order.customer.email}
              </a>
              {phoneHref && (
                <a href={phoneHref}>
                  <Phone size={16} aria-hidden="true" />
                  {order.customer.phone}
                </a>
              )}
            </div>

            <dl className="order-card-facts">
              <div>
                <dt>Placed</dt>
                <dd>{order.createdAtUtc ? formatBusinessDateTime(order.createdAtUtc) : "Not recorded"}</dd>
              </div>
              <div>
                <dt>Payment</dt>
                <dd>{paymentSummary(order)}</dd>
              </div>
              {paymentFacts(order, formatBusinessDateTime).map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
              {order.kind === "batch" && (
                <div>
                  <dt>{order.fulfillment === "delivery" ? "Delivery" : "Pickup"}</dt>
                  <dd>
                    {order.requested
                      ? [formatDayKey(order.requested.date), order.requested.timeRange].filter(Boolean).join(", ")
                      : "No date"}
                  </dd>
                </div>
              )}
              {order.delivery && (
                <div>
                  <dt>Delivery address</dt>
                  <dd>
                    {order.delivery.address}
                    {order.delivery.distanceMiles !== null &&
                      ` (${order.delivery.distanceMiles.toFixed(1)} miles)`}
                  </dd>
                </div>
              )}
              {order.scheduledAtUtc && (
                <div>
                  <dt>Final date and time</dt>
                  <dd>{formatBusinessDateTime(order.scheduledAtUtc)}</dd>
                </div>
              )}
              {order.customerNote && (
                <div>
                  <dt>Customer note</dt>
                  <dd>{order.customerNote}</dd>
                </div>
              )}
              {order.reason && (
                <div>
                  <dt>Reason</dt>
                  <dd>{order.reason}</dd>
                </div>
              )}
            </dl>

            <div className="receipt-lines">
              {order.items.map((line, index) => (
                <div className="receipt-line order-card-line" key={`${order.id}-${index}`}>
                  <span>{lineLabel(line)}</span>
                  <strong>{formatMoney(line.lineTotalCents)}</strong>
                </div>
              ))}
            </div>

            <div className="receipt-totals">
              {moneyLines(order).map((line) => (
                <div className={line.total ? "receipt-grand" : undefined} key={line.label}>
                  <span>{line.label}</span>
                  <strong>{line.value}</strong>
                </div>
              ))}
            </div>

            <div className="order-card-note">
              <label htmlFor={`owner-note-${order.id}`}>Owner note</label>
              <textarea
                id={`owner-note-${order.id}`}
                rows={2}
                maxLength={500}
                value={noteValue}
                disabled={busy}
                aria-describedby={`owner-note-help-${order.id}`}
                onChange={(event) => setNotes((current) => ({ ...current, [order.id]: event.target.value }))}
              />
              <span className="field-help" id={`owner-note-help-${order.id}`}>
                Customers do not see this note.
              </span>
              <div className="button-row">
                <button
                  className="button button-small"
                  type="button"
                  disabled={busy || actions.running !== null || noteChange(order).ownerNote === undefined}
                  onClick={() => saveNote(order)}
                >
                  {busy && actions.running?.action === "save_note" ? actionBusyLabels.save_note : actionLabels.save_note}
                </button>
              </div>
            </div>

            {error && (
              <p className="form-notice form-notice-error" role="alert">
                {error}
              </p>
            )}

            {(orderActions.length > 0 || refundable) && (
              <div className="button-row order-card-actions">
                {orderActions.map((action) => (
                  <button
                    key={action}
                    className="button button-small"
                    type="button"
                    disabled={busy || actions.running !== null || actionBlocked(order, action)}
                    aria-describedby={action === "hand_over" && hint ? `pay-first-${order.id}` : undefined}
                    onClick={() => start(order, action)}
                  >
                    {busy && actions.running?.action === action ? actionBusyLabels[action] : actionLabels[action]}
                  </button>
                ))}
                {refundable && (
                  <button
                    className="button button-small"
                    type="button"
                    disabled={busy || actions.running !== null}
                    onClick={() => {
                      actions.clearError();
                      setDialog({ order, action: "refund" });
                    }}
                  >
                    Refund
                  </button>
                )}
              </div>
            )}
            {hint && (
              <p className="field-help order-card-hint" id={`pay-first-${order.id}`}>
                {hint}
              </p>
            )}
          </article>
        );
      })}

      {dialog && dialogOrder && dialog.action === "approve" && (
        <ApproveDialog
          order={dialogOrder}
          suggestedAtUtc={events.find((event) => event.id === dialogOrder.eventId)?.startsAtUtc ?? ""}
          busy={actions.isBusy(dialogOrder.id)}
          error={actions.errorFor(dialogOrder.id)}
          onClose={() => setDialog(null)}
          onConfirm={(result) =>
            void runAction(dialogOrder, "approve", {
              scheduledAtUtc: result.scheduledAtUtc,
              ...(result.deliveryFeeCents !== undefined ? { deliveryFeeCents: result.deliveryFeeCents } : {})
            })
          }
        />
      )}
      {dialog && dialogOrder && dialog.action === "refund" && (
        <RefundDialog
          order={dialogOrder}
          title={dialogOrder.orderNumber}
          busy={actions.isBusy(dialogOrder.id)}
          error={actions.errorFor(dialogOrder.id)}
          onClose={() => setDialog(null)}
          onConfirm={(input) =>
            void actions.refund(input).then((done) => {
              if (done) setDialog(null);
            })
          }
        />
      )}
      {dialog && dialogOrder && (dialog.action === "decline" || dialog.action === "cancel") && (
        <ReasonDialog
          title={`${dialog.action === "decline" ? "Decline" : "Cancel"} ${dialogOrder.orderNumber}`}
          confirmLabel={dialog.action === "decline" ? "Decline" : "Cancel Order"}
          busyLabel={actionBusyLabels[dialog.action]}
          required
          busy={actions.isBusy(dialogOrder.id)}
          error={actions.errorFor(dialogOrder.id)}
          onClose={() => setDialog(null)}
          onConfirm={(reason) => void runAction(dialogOrder, dialog.action as OrderAction, { reason })}
        />
      )}
    </section>
  );
}
