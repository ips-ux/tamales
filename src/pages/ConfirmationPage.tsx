import { CheckCircle2, ClipboardList } from "lucide-react";
import { navigate } from "../App";
import { availabilityWindows, pickupLocations, sampleOrders } from "../data/fixtures";
import { formatMoney } from "../lib/money";
import { formatWindow } from "../lib/time";
import type { OrderRecord } from "../lib/types";

function findOrder(publicToken: string): OrderRecord | undefined {
  const stored = sessionStorage.getItem(`bbt-order-${publicToken}`);
  if (stored) return JSON.parse(stored) as OrderRecord;
  return sampleOrders.find((order) => order.publicToken === publicToken);
}

export function ConfirmationPage({ publicToken }: { publicToken: string }) {
  const order = findOrder(publicToken);
  const window = order
    ? availabilityWindows.find((item) => item.id === order.availabilityWindowId)
    : undefined;
  const location = window
    ? pickupLocations.find((item) => item.id === window.locationId)
    : undefined;

  if (!order) {
    return (
      <main className="page-shell narrow">
        <section className="empty-state">
          <ClipboardList size={42} />
          <h1>Confirmation not found</h1>
          <p>Check the link or start a new request.</p>
          <button className="button button-primary" type="button" onClick={() => navigate("/order")}>
            Place an Order
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell narrow">
      <section className="confirmation-card">
        <CheckCircle2 size={48} className="success-icon" />
        <p className="eyebrow">Request Received</p>
        <h1>{order.orderNumber}</h1>
        <p>
          Your request is in the owner queue. You will receive a confirmation through your preferred
          contact method before the order is final.
        </p>
        <div className="summary-lines">
          {order.items.map((line) => (
            <div key={line.variantId}>
              <span>
                {line.quantity} × {line.productName} · {line.variantLabel}
              </span>
              <strong>{formatMoney(line.lineTotalCents)}</strong>
            </div>
          ))}
        </div>
        <div className="summary-totals">
          <div className="grand-total">
            <span>Estimated total</span>
            <strong>{formatMoney(order.totals.totalCents)}</strong>
          </div>
        </div>
        {window && (
          <div className="confirmation-details">
            <strong>{window.label}</strong>
            <span>{formatWindow(window)}</span>
            <span>{location?.name}</span>
          </div>
        )}
      </section>
    </main>
  );
}
