import { CheckCircle2, ClipboardList } from "lucide-react";
import { useEffect, useState } from "react";
import { firstName } from "../components/publicForm";
import { SiteLink } from "../components/SiteFooter";
import { useAvailabilityWindows, usePickupLocations } from "../lib/availabilityStore";
import { fetchOrderByToken } from "../lib/firestoreClient";
import { formatMoney } from "../lib/money";
import { formatWindow } from "../lib/time";
import type { OrderRecord } from "../lib/types";

function localCopy(publicToken: string): OrderRecord | null {
  // The order page stashes a copy at submit time so this renders instantly;
  // Firestore remains the source of truth for revisits from the email link.
  const stored = sessionStorage.getItem(`bbt-order-${publicToken}`);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as OrderRecord;
  } catch {
    return null;
  }
}

export function ConfirmationPage({ publicToken }: { publicToken: string }) {
  const [order, setOrder] = useState<OrderRecord | null>(() => localCopy(publicToken));
  const [loading, setLoading] = useState(order === null);
  const availabilityWindows = useAvailabilityWindows();
  const pickupLocations = usePickupLocations();

  useEffect(() => {
    let active = true;
    fetchOrderByToken(publicToken)
      .then((remote) => {
        if (!active) return;
        if (remote) setOrder(remote);
        setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [publicToken]);

  const window = order
    ? availabilityWindows.find((item) => item.id === order.availabilityWindowId)
    : undefined;
  const location = window
    ? pickupLocations.find((item) => item.id === window.locationId)
    : undefined;

  if (!order && loading) {
    return (
      <main className="page-shell narrow">
        <section className="empty-state">
          <ClipboardList size={42} aria-hidden="true" />
          <h1 className="sr-only">Your order</h1>
          <p role="status">Finding your order.</p>
        </section>
      </main>
    );
  }

  if (!order) {
    return (
      <main className="page-shell narrow">
        <section className="empty-state">
          <ClipboardList size={42} aria-hidden="true" />
          <h1>Order not found.</h1>
          <p>Check the link in your email, or place a new order.</p>
          <SiteLink className="button button-primary" href="/order">
            Place an Order
          </SiteLink>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell narrow">
      <section className="confirmation-card">
        <CheckCircle2 size={48} className="success-icon" aria-hidden="true" />
        <h1>Thanks, {firstName(order.customer.name)}!</h1>
        <p className="confirmation-number">
          Order number <strong>{order.orderNumber}</strong>
        </p>
        <p>We have your order. We will send you an email when we approve it.</p>
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
            <span>Total</span>
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
