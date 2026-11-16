import { quantityLabel } from "../../shared/quantity";
import type { OrderLine, OrderTotals } from "../../shared/model";
import { formatMoney } from "../lib/money";
import type { DeliveryLine } from "./order/orderFlowLogic";

interface OrderSummaryProps {
  lines: OrderLine[];
  totals: OrderTotals;
  delivery: DeliveryLine;
  /** True for an order that the owner approves: the total can change. */
  approvalNote: boolean;
}

/** The lines and the money lines, in the order of V1_DESIGN section 9. */
export function OrderSummary({ lines, totals, delivery, approvalNote }: OrderSummaryProps) {
  return (
    <section className="order-summary-block" aria-label="Your order">
      <div className="summary-lines">
        {lines.map((line) => (
          <div key={`${line.itemId}|${line.variantId}`}>
            <span>
              {line.quantity} × {line.itemName}, {line.variantLabel}
              <small>{quantityLabel(line.quantity * line.unitTamales)}</small>
            </span>
            <strong>{formatMoney(line.lineTotalCents)}</strong>
          </div>
        ))}
      </div>
      <div className="summary-totals">
        <div>
          <span>Subtotal</span>
          <strong>{formatMoney(totals.subtotalCents)}</strong>
        </div>
        {delivery !== "none" && (
          <div>
            <span>Delivery fee</span>
            <strong>{delivery === "fee" ? formatMoney(totals.deliveryFeeCents) : "To be set"}</strong>
          </div>
        )}
        {totals.onlineFeeCents > 0 && (
          <div>
            <span>Online ordering fee</span>
            <strong>{formatMoney(totals.onlineFeeCents)}</strong>
          </div>
        )}
        <div>
          <span>Tax</span>
          <strong>{formatMoney(totals.taxCents)}</strong>
        </div>
        <div className="grand-total">
          <span>Total</span>
          <strong>{formatMoney(totals.totalCents)}</strong>
        </div>
      </div>
      {approvalNote && <p className="muted order-summary-note">We confirm the total when we approve your order.</p>}
    </section>
  );
}
