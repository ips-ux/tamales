import { ArrowLeft, Copy, Download, Pencil, Printer, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { EventRecord, EventStock } from "../../../shared/model";
import { quantityLabel } from "../../../shared/quantity";
import { downloadCsv } from "../../lib/csv";
import { deleteEvent, watchEventStock } from "../../lib/eventsStore";
import { useEventOrders } from "../../lib/ordersStore";
import { formatWindow } from "../../lib/time";
import type { MenuProduct } from "../../lib/types";
import { QRCodePanel } from "../QRCodePanel";
import { kioskPath, mobileOrderPath, preorderModeLabels } from "./eventRules";
import { buildPickupList, buildPrepSheet, pickupListCsv, prepSheetCsv } from "./eventSheets";
import { paymentStateLabels, stateLabels } from "./orderRules";
import { printElement } from "./print";

function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <button className="button button-small" type="button" onClick={() => void copy()}>
      <Copy size={16} aria-hidden="true" />
      <span aria-live="polite">{copied ? "Copied" : "Copy Link"}</span>
    </button>
  );
}

interface EventDetailProps {
  event: EventRecord;
  products: MenuProduct[];
  onBack: () => void;
  onEdit: () => void;
}

/** Admin > Events > 1 event: links, QR codes, the prep sheet and the pickup list. */
export function EventDetail({ event, products, onBack, onEdit }: EventDetailProps) {
  const { orders, loading, failed } = useEventOrders(event.id);
  const [stock, setStock] = useState<EventStock | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const prepRef = useRef<HTMLDivElement>(null);
  const pickupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (event.preorderMode !== "fixed") return;
    return watchEventStock(event.id, setStock, () => setStock(null));
  }, [event.id, event.preorderMode]);

  const origin = window.location.origin;
  const kioskUrl = `${origin}${kioskPath(event)}`;
  const mobileUrl = `${origin}${mobileOrderPath(event)}`;
  const prepRows = buildPrepSheet(orders, event.id);
  const pickupRows = buildPickupList(orders, event.id);
  const fileKey = event.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "event";
  const itemName = (id: string) => products.find((product) => product.id === id)?.name ?? id;

  async function remove() {
    setDeleting(true);
    setDeleteError("");
    try {
      await deleteEvent(event.id);
      onBack();
    } catch {
      setDeleteError("We could not delete the event. Check your connection, then try again.");
      setDeleting(false);
    }
  }

  const loadNotice = loading ? (
    <p className="muted">Loading orders.</p>
  ) : failed ? (
    <p className="form-notice form-notice-error" role="alert">
      We could not load the orders. Check your connection, then reload the page.
    </p>
  ) : null;

  return (
    <section className="menu-manager">
      <article className="admin-card event-summary">
        <div className="menu-toolbar">
          <button className="button button-small" type="button" onClick={onBack}>
            <ArrowLeft size={16} aria-hidden="true" />
            Back to Events
          </button>
          <button className="button button-small" type="button" onClick={onEdit}>
            <Pencil size={16} aria-hidden="true" />
            Edit Event
          </button>
        </div>
        <h2>{event.name}</h2>
        <p className="event-summary-line">
          {formatWindow(event)} · {event.areaName}
        </p>
        <div className="admin-row">
          <span>Pre-orders</span>
          <strong>{preorderModeLabels[event.preorderMode]}</strong>
        </div>
        {event.preorderMode === "fixed" &&
          Object.entries(event.allotment).map(([itemId, tamales]) => (
            <div className="admin-row" key={itemId}>
              <span>{itemName(itemId)}</span>
              <strong>
                {stock ? `${stock.remaining[itemId] ?? 0} of ${tamales} remain` : `${tamales} tamales`}
              </strong>
            </div>
          ))}
        {deleteError && (
          <p className="form-notice form-notice-error" role="alert">
            {deleteError}
          </p>
        )}
        {!loading && !failed && orders.length === 0 && (
          <div className="button-row">
            {confirmDelete ? (
              <>
                <strong className="message-row-confirm">Delete this event?</strong>
                <button
                  className="button button-small"
                  type="button"
                  disabled={deleting}
                  onClick={() => setConfirmDelete(false)}
                >
                  Keep Event
                </button>
                <button
                  className="button button-small message-row-delete"
                  type="button"
                  disabled={deleting}
                  onClick={() => void remove()}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  {deleting ? "Deleting..." : "Delete Event"}
                </button>
              </>
            ) : (
              <button className="button button-small" type="button" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={16} aria-hidden="true" />
                Delete
              </button>
            )}
          </div>
        )}
      </article>

      <div className="event-links">
        <div className="event-link">
          <QRCodePanel url={kioskUrl} eventName={event.name} title="Kiosk" alt={`QR code for the kiosk at ${event.name}`} printable />
          <CopyLinkButton url={kioskUrl} />
        </div>
        <div className="event-link">
          <QRCodePanel url={mobileUrl} eventName={event.name} title="Scan to Order" alt={`QR code to order at ${event.name}`} printable />
          <CopyLinkButton url={mobileUrl} />
        </div>
      </div>

      <article className="admin-card">
        <div className="menu-toolbar">
          <h2>Prep Sheet</h2>
          <div className="button-row">
            <button
              className="button button-small"
              type="button"
              disabled={prepRows.length === 0}
              onClick={() => printElement(prepRef.current)}
            >
              <Printer size={16} aria-hidden="true" />
              Print
            </button>
            <button
              className="button button-small"
              type="button"
              disabled={prepRows.length === 0}
              onClick={() => downloadCsv(`bbt-prep-sheet-${fileKey}.csv`, prepSheetCsv(prepRows))}
            >
              <Download size={16} aria-hidden="true" />
              Download CSV
            </button>
          </div>
        </div>
        {loadNotice}
        {!loadNotice && prepRows.length === 0 && <p className="muted">No pre-orders to make.</p>}
        {prepRows.length > 0 && (
          <div className="sheet" ref={prepRef}>
            <p className="sheet-title">
              Prep sheet: {event.name}, {formatWindow(event)}
            </p>
            <div className="sheet-scroll">
              <table className="sheet-table">
                <thead>
                  <tr>
                    <th scope="col">Menu item</th>
                    <th scope="col">To make</th>
                    <th scope="col">Approved, not paid</th>
                  </tr>
                </thead>
                <tbody>
                  {prepRows.map((row) => (
                    <tr key={row.itemId}>
                      <th scope="row">{row.itemName}</th>
                      <td>{quantityLabel(row.toMake)}</td>
                      <td>{quantityLabel(row.approved)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </article>

      <article className="admin-card">
        <div className="menu-toolbar">
          <h2>Pickup List</h2>
          <div className="button-row">
            <button
              className="button button-small"
              type="button"
              disabled={pickupRows.length === 0}
              onClick={() => printElement(pickupRef.current)}
            >
              <Printer size={16} aria-hidden="true" />
              Print
            </button>
            <button
              className="button button-small"
              type="button"
              disabled={pickupRows.length === 0}
              onClick={() => downloadCsv(`bbt-pickup-list-${fileKey}.csv`, pickupListCsv(pickupRows))}
            >
              <Download size={16} aria-hidden="true" />
              Download CSV
            </button>
          </div>
        </div>
        {loadNotice}
        {!loadNotice && pickupRows.length === 0 && <p className="muted">No pre-orders for pickup.</p>}
        {pickupRows.length > 0 && (
          <div className="sheet" ref={pickupRef}>
            <p className="sheet-title">
              Pickup list: {event.name}, {formatWindow(event)}
            </p>
            <div className="sheet-scroll">
              <table className="sheet-table">
                <thead>
                  <tr>
                    <th scope="col">Order number</th>
                    <th scope="col">Customer</th>
                    <th scope="col">Items</th>
                    <th scope="col">Payment</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pickupRows.map((row) => (
                    <tr key={row.orderId}>
                      <th scope="row">{row.orderNumber}</th>
                      <td>{[row.lastName, row.firstName].filter(Boolean).join(", ") || "No name"}</td>
                      <td>
                        {row.items.map((item) => (
                          <div key={item}>{item}</div>
                        ))}
                      </td>
                      <td>{paymentStateLabels[row.paymentState]}</td>
                      <td>{stateLabels[row.state]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </article>
    </section>
  );
}
