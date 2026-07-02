import { ShoppingBasket } from "lucide-react";
import { menuProducts } from "../data/fixtures";
import { calculateTotals, buildOrderLines } from "../lib/order";
import { formatMoney } from "../lib/money";
import type { CartSelection } from "../lib/types";

interface OrderSummaryProps {
  selections: CartSelection[];
  compact?: boolean;
}

export function OrderSummary({ selections, compact = false }: OrderSummaryProps) {
  const lines = buildOrderLines(selections, menuProducts);
  const totals = calculateTotals(lines);

  return (
    <aside className={compact ? "order-summary order-summary-compact" : "order-summary"}>
      <div className="summary-title">
        <ShoppingBasket size={20} />
        <h2>Order Summary</h2>
      </div>
      {lines.length === 0 ? (
        <p className="muted">Choose a package to start your request.</p>
      ) : (
        <>
          <div className="summary-lines">
            {lines.map((line) => (
              <div key={line.variantId}>
                <span>
                  {line.quantity} × {line.productName} · {line.variantLabel}
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
            <div>
              <span>Estimated tax</span>
              <strong>{formatMoney(totals.taxCents)}</strong>
            </div>
            <div className="grand-total">
              <span>Estimated total</span>
              <strong>{formatMoney(totals.totalCents)}</strong>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
