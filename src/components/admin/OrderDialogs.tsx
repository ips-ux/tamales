import { FormEvent, useState } from "react";
import type { OrderRecord } from "../../../shared/model";
import { useBusinessSettings } from "../../lib/businessSettings";
import { utcToZonedInput, zonedInputToUtc } from "./businessDateTime";
import { checkApproval, type ApproveResult } from "./orderRules";

interface ReasonDialogProps {
  title: string;
  confirmLabel: string;
  busyLabel: string;
  /** True when the owner must enter a reason. */
  required: boolean;
  busy: boolean;
  error: string;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

/** Asks for the reason of a decline or a cancel. The customer sees the reason. */
export function ReasonDialog({
  title,
  confirmLabel,
  busyLabel,
  required,
  busy,
  error,
  onConfirm,
  onClose
}: ReasonDialogProps) {
  const [reason, setReason] = useState("");
  const [missing, setMissing] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = reason.trim();
    if (required && !text) {
      setMissing(true);
      return;
    }
    setMissing(false);
    onConfirm(text);
  }

  const message = missing ? "Enter the reason." : error;

  return (
    <div className="modal-overlay">
      <form className="admin-card modal-card order-dialog" role="dialog" aria-modal="true" aria-label={title} onSubmit={submit}>
        <h2>{title}</h2>
        {message && (
          <p className="form-notice form-notice-error" role="alert">
            {message}
          </p>
        )}
        <label>
          {required ? "Reason" : "Reason (optional)"}
          <textarea
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <span className="field-help">The customer sees this reason.</span>
        </label>
        <div className="button-row">
          <button className="button button-ghost" type="button" onClick={onClose} disabled={busy}>
            Go Back
          </button>
          <button className="button button-primary" type="submit" disabled={busy}>
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

interface ApproveDialogProps {
  order: OrderRecord;
  /** The start of the event, for a pre-order. Empty when it is not known. */
  suggestedAtUtc: string;
  busy: boolean;
  error: string;
  onConfirm: (result: ApproveResult) => void;
  onClose: () => void;
}

/** Approve: the owner sets the final date and time, and the delivery fee for a delivery. */
export function ApproveDialog({ order, suggestedAtUtc, busy, error, onConfirm, onClose }: ApproveDialogProps) {
  const { timezone } = useBusinessSettings();
  const isDelivery = order.fulfillment === "delivery";
  const feeMustBeSet = order.delivery?.feeStatus === "to_be_set";
  const [when, setWhen] = useState(() => utcToZonedInput(order.scheduledAtUtc || suggestedAtUtc, timezone));
  const [fee, setFee] = useState(() =>
    isDelivery && !feeMustBeSet ? (order.totals.deliveryFeeCents / 100).toFixed(2) : ""
  );
  const [errors, setErrors] = useState<string[]>([]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = checkApproval(order, {
      scheduledAtUtc: zonedInputToUtc(when, timezone),
      deliveryFee: fee
    });
    setErrors(result.errors);
    if (result.errors.length === 0) onConfirm(result);
  }

  const messages = errors.length > 0 ? errors : error ? [error] : [];

  return (
    <div className="modal-overlay">
      <form
        className="admin-card modal-card order-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Approve ${order.orderNumber}`}
        onSubmit={submit}
      >
        <h2>Approve {order.orderNumber}</h2>
        {messages.length > 0 && (
          <div className="form-notice form-notice-error" role="alert">
            {messages.map((message) => (
              <div key={message}>{message}</div>
            ))}
          </div>
        )}
        <label>
          Final date and time
          <input
            type="datetime-local"
            value={when}
            onChange={(event) => setWhen(event.target.value)}
          />
        </label>
        {isDelivery && (
          <label>
            Delivery fee ($)
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={fee}
              onChange={(event) => setFee(event.target.value)}
            />
            {feeMustBeSet && (
              <span className="field-help">We could not find the address. Set the fee.</span>
            )}
          </label>
        )}
        <div className="button-row">
          <button className="button button-ghost" type="button" onClick={onClose} disabled={busy}>
            Go Back
          </button>
          <button className="button button-primary" type="submit" disabled={busy}>
            {busy ? "Approving..." : "Approve"}
          </button>
        </div>
      </form>
    </div>
  );
}
