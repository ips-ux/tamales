// Live POS > Orders > POS sales: the list of sales, with Edit and Void.
// A real sale is never deleted. A void and an edit each write a ledger entry.
// A sale from an order is read-only here. See saleRules.ts.

import { ArrowLeft, Ban, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { useBusinessSettings } from "../../lib/businessSettings";
import {
  deletePosTicket,
  restoreTestPosTicket,
  updatePosTicket,
  voidPosTicket,
  type PosTicketRecord
} from "../../lib/firestoreClient";
import { formatMoney } from "../../lib/money";
import { formatBusinessDateTime } from "../../lib/time";
import type { MenuProduct, PosTicketItem } from "../../lib/types";
import { isPosPaymentMethod, posPaymentLabel, posPaymentLabels, posPaymentMethods } from "./paymentLabels";
import { reasonError, saleActions, saleChanged, SALE_REASON_MAX } from "./saleRules";

const SAVE_FAILED = "We could not save the change. Check your connection, then try again.";

interface PosSalesListProps {
  tickets: PosTicketRecord[];
  loading: boolean;
  /** True when the sales did not load. */
  failed: boolean;
  products: MenuProduct[];
  onBack: () => void;
}

export function PosSalesList({ tickets, loading, failed, products, onBack }: PosSalesListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const paid = tickets.filter((ticket) => ticket.status === "paid");
  const voidCount = tickets.length - paid.length;
  const paidTotalCents = paid.reduce((sum, ticket) => sum + ticket.totalCents, 0);
  const voiding = voidingId ? tickets.find((ticket) => ticket.id === voidingId) ?? null : null;

  async function run(action: () => Promise<void>): Promise<boolean> {
    setActionError("");
    setBusy(true);
    try {
      await action();
      return true;
    } catch {
      setActionError(SAVE_FAILED);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function startVoid(ticket: PosTicketRecord) {
    setActionError("");
    // A test sale needs no reason and gets no ledger entry.
    if (ticket.isTest) void run(() => voidPosTicket(ticket, ""));
    else setVoidingId(ticket.id);
  }

  function removeTestSale(ticket: PosTicketRecord) {
    if (!window.confirm(`Delete test sale ${ticket.ticketNumber}? You cannot undo this.`)) return;
    void run(() => deletePosTicket(ticket));
  }

  return (
    <section className="admin-card">
      <div className="toolbar">
        <button className="button button-small" type="button" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          All Orders
        </button>
      </div>
      <h2>Mobile POS Sales</h2>
      {loading ? (
        <p className="muted">Loading sales.</p>
      ) : failed ? (
        <p className="form-notice form-notice-error" role="alert">
          We could not load the sales. Check your connection, then reload the page.
        </p>
      ) : tickets.length === 0 ? (
        <p className="muted">No sales are recorded.</p>
      ) : (
        <>
          <div className="admin-row">
            <span>
              {paid.length} paid{voidCount > 0 ? `, ${voidCount} void` : ""}
            </span>
            <strong>{formatMoney(paidTotalCents)}</strong>
          </div>
          {actionError && !voiding && (
            <p className="form-notice form-notice-error" role="alert">
              {actionError}
            </p>
          )}
          {tickets.map((ticket) =>
            editingId === ticket.id ? (
              <SaleEditor key={ticket.id} ticket={ticket} products={products} onClose={() => setEditingId(null)} />
            ) : (
              <SaleCard
                key={ticket.id}
                ticket={ticket}
                busy={busy}
                onEdit={() => setEditingId(ticket.id)}
                onVoid={() => startVoid(ticket)}
                onRestore={() => void run(() => restoreTestPosTicket(ticket))}
                onRemove={() => removeTestSale(ticket)}
              />
            )
          )}
        </>
      )}

      {voiding && (
        <VoidSaleDialog
          ticket={voiding}
          busy={busy}
          error={actionError}
          onClose={() => {
            setVoidingId(null);
            setActionError("");
          }}
          onConfirm={(reason) =>
            void run(() => voidPosTicket(voiding, reason)).then((done) => {
              if (done) setVoidingId(null);
            })
          }
        />
      )}
    </section>
  );
}

interface SaleCardProps {
  ticket: PosTicketRecord;
  busy: boolean;
  onEdit: () => void;
  onVoid: () => void;
  onRestore: () => void;
  onRemove: () => void;
}

function SaleCard({ ticket, busy, onEdit, onVoid, onRestore, onRemove }: SaleCardProps) {
  const can = saleActions(ticket);
  const hasActions = can.edit || can.void || can.restore || can.remove;
  return (
    <article className={`receipt-card${ticket.status === "void" ? " receipt-void" : ""}`}>
      <div className="receipt-head">
        <div>
          <strong>
            {ticket.customerName ? `${ticket.customerName} · ` : ""}
            {ticket.ticketNumber}
          </strong>
          <span className="muted">{formatBusinessDateTime(ticket.createdAtUtc)}</span>
        </div>
        <span className="price-chip">
          <span>{posPaymentLabel(ticket.paymentMethod)}</span>
        </span>
        {can.readOnly && <span className="status-badge status-canceled">From an order</span>}
        {ticket.status === "void" && <span className="status-badge product-status-inactive">Void</span>}
      </div>
      <div className="receipt-lines">
        {ticket.items.map((item, index) => (
          <div className="receipt-line" key={`${ticket.id}-${item.productId}-${index}`}>
            <span>
              {item.quantity} × {item.productName}
            </span>
            <span className="muted">@ {formatMoney(item.unitPriceCents)}</span>
            <strong>{formatMoney(item.quantity * item.unitPriceCents)}</strong>
          </div>
        ))}
      </div>
      <div className="receipt-totals">
        <div>
          <span>Subtotal</span>
          <strong>{formatMoney(ticket.subtotalCents)}</strong>
        </div>
        {ticket.deliveryFeeCents > 0 && (
          <div>
            <span>Delivery fee</span>
            <strong>{formatMoney(ticket.deliveryFeeCents)}</strong>
          </div>
        )}
        {ticket.onlineFeeCents > 0 && (
          <div>
            <span>Online ordering fee</span>
            <strong>{formatMoney(ticket.onlineFeeCents)}</strong>
          </div>
        )}
        <div>
          <span>Tax</span>
          <strong>{formatMoney(ticket.taxCents)}</strong>
        </div>
        <div className="receipt-grand">
          <span>Total</span>
          <strong>{formatMoney(ticket.totalCents)}</strong>
        </div>
      </div>
      {hasActions && (
        <div className="button-row">
          {can.edit && (
            <button className="button button-small" type="button" disabled={busy} onClick={onEdit}>
              <Pencil size={16} aria-hidden="true" />
              Edit
            </button>
          )}
          {can.void && (
            <button className="button button-small" type="button" disabled={busy} onClick={onVoid}>
              <Ban size={16} aria-hidden="true" />
              Void
            </button>
          )}
          {can.restore && (
            <button className="button button-small" type="button" disabled={busy} onClick={onRestore}>
              <RotateCcw size={16} aria-hidden="true" />
              Restore
            </button>
          )}
          {can.remove && (
            <button className="button button-small" type="button" disabled={busy} onClick={onRemove}>
              <Trash2 size={16} aria-hidden="true" />
              Delete Test Sale
            </button>
          )}
        </div>
      )}
    </article>
  );
}

interface VoidSaleDialogProps {
  ticket: PosTicketRecord;
  busy: boolean;
  error: string;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

/** Void: the sale stays in the list, and the reason goes in the ledger entry. */
function VoidSaleDialog({ ticket, busy, error, onConfirm, onClose }: VoidSaleDialogProps) {
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const message = reasonError(reason, ticket.isTest);
    setProblem(message);
    if (!message) onConfirm(reason.trim());
  }

  const message = problem || error;

  return (
    <div className="modal-overlay">
      <form
        className="admin-card modal-card order-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Void ${ticket.ticketNumber}`}
        onSubmit={submit}
      >
        <h2>Void {ticket.ticketNumber}</h2>
        <p className="order-dialog-lead">The sale of {formatMoney(ticket.totalCents)} stays in the list as void.</p>
        {message && (
          <p className="form-notice form-notice-error" role="alert">
            {message}
          </p>
        )}
        <label>
          Reason
          <textarea
            rows={3}
            maxLength={SALE_REASON_MAX}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <div className="button-row">
          <button className="button button-ghost" type="button" onClick={onClose} disabled={busy}>
            Go Back
          </button>
          <button className="button button-primary" type="submit" disabled={busy}>
            {busy ? "Saving..." : "Void Sale"}
          </button>
        </div>
      </form>
    </div>
  );
}

interface SaleEditorProps {
  ticket: PosTicketRecord;
  products: MenuProduct[];
  onClose: () => void;
}

/** Edit: the owner changes the items, the payment method or the name, and gives the reason. */
function SaleEditor({ ticket, products, onClose }: SaleEditorProps) {
  const business = useBusinessSettings();
  const [items, setItems] = useState<PosTicketItem[]>(() => ticket.items.map((item) => ({ ...item })));
  const [method, setMethod] = useState<string>(ticket.paymentMethod);
  const [customerName, setCustomerName] = useState(ticket.customerName);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const subtotalCents = items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
  const taxCents = Math.round((subtotalCents * business.taxRateBps) / 10000);
  const totalCents = subtotalCents + taxCents;
  const addable = products.filter(
    (product) =>
      product.status === "active" &&
      product.singlePriceCents > 0 &&
      !items.some((item) => item.productId === product.id)
  );

  function updateQuantity(productId: string, quantity: number) {
    setItems((current) =>
      quantity <= 0
        ? current.filter((item) => item.productId !== productId)
        : current.map((item) => (item.productId === productId ? { ...item, quantity } : item))
    );
  }

  function addItem(productId: string) {
    const product = products.find((item) => item.id === productId);
    if (!product) return;
    setItems((current) => [
      ...current,
      { productId: product.id, productName: product.name, quantity: 1, unitPriceCents: product.singlePriceCents }
    ]);
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    const change = { items, subtotalCents, taxCents, totalCents, paymentMethod: method, customerName: customerName.trim() };
    if (items.length === 0) {
      setError("Keep 1 item or more. To cancel the sale, void it.");
      return;
    }
    if (!saleChanged(ticket, change)) {
      setError("Change the sale, then save.");
      return;
    }
    const reasonProblem = reasonError(reason, ticket.isTest);
    if (reasonProblem) {
      setError(reasonProblem);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await updatePosTicket(ticket, change, reason.trim());
      onClose();
    } catch {
      setError(SAVE_FAILED);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="receipt-card" onSubmit={handleSave} noValidate>
      <div className="receipt-head">
        <div>
          <strong>Edit {ticket.ticketNumber}</strong>
          <span className="muted">{formatBusinessDateTime(ticket.createdAtUtc)}</span>
        </div>
      </div>
      <div className="receipt-lines">
        {items.map((item) => (
          <div className="ticket-edit-line" key={item.productId}>
            <div>
              <strong>{item.productName}</strong>
              <span className="muted"> @ {formatMoney(item.unitPriceCents)}</span>
            </div>
            <div className="pos-qty">
              <button
                type="button"
                aria-label={`Remove 1 ${item.productName}`}
                onClick={() => updateQuantity(item.productId, item.quantity - 1)}
              >
                -
              </button>
              <output>{item.quantity}</output>
              <button
                type="button"
                aria-label={`Add 1 ${item.productName}`}
                onClick={() => updateQuantity(item.productId, item.quantity + 1)}
              >
                +
              </button>
            </div>
            <strong>{formatMoney(item.quantity * item.unitPriceCents)}</strong>
          </div>
        ))}
      </div>
      {addable.length > 0 && (
        <label className="ticket-edit-add">
          Add a menu item
          <select
            value=""
            onChange={(event) => {
              if (event.target.value) addItem(event.target.value);
            }}
          >
            <option value="">Select a menu item</option>
            {addable.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} ({formatMoney(product.singlePriceCents)})
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="ticket-edit-add">
        Payment method
        <select value={method} onChange={(event) => setMethod(event.target.value)}>
          {!isPosPaymentMethod(method) && <option value={method}>{posPaymentLabel(method)}</option>}
          {posPaymentMethods.map((key) => (
            <option key={key} value={key}>
              {posPaymentLabels[key]}
            </option>
          ))}
        </select>
      </label>
      <label className="ticket-edit-add">
        Name for the order
        <input
          type="text"
          value={customerName}
          autoComplete="off"
          onChange={(event) => setCustomerName(event.target.value)}
        />
      </label>
      {!ticket.isTest && (
        <label className="ticket-edit-add">
          Reason
          <textarea
            rows={2}
            maxLength={SALE_REASON_MAX}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <span className="field-help">The report shows the change and this reason.</span>
        </label>
      )}
      <div className="receipt-totals">
        <div>
          <span>Subtotal</span>
          <strong>{formatMoney(subtotalCents)}</strong>
        </div>
        <div>
          <span>Tax</span>
          <strong>{formatMoney(taxCents)}</strong>
        </div>
        <div className="receipt-grand">
          <span>Total</span>
          <strong>{formatMoney(totalCents)}</strong>
        </div>
      </div>
      {error && (
        <p className="form-notice form-notice-error" role="alert">
          {error}
        </p>
      )}
      <div className="button-row">
        <button className="button button-ghost" type="button" onClick={onClose} disabled={busy}>
          Go Back
        </button>
        <button className="button button-primary" type="submit" disabled={busy}>
          {busy ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </form>
  );
}
