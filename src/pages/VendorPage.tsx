import { ArrowRight, ClipboardList, Info, RotateCcw, UserPlus } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { navigate } from "../App";
import { QRCodePanel } from "../components/QRCodePanel";
import { vendorSessions } from "../data/fixtures";
import { useBusinessSettings } from "../lib/businessSettings";

export function VendorPage({ sessionToken }: { sessionToken: string }) {
  const businessSettings = useBusinessSettings();
  const session = vendorSessions.find((item) => item.publicToken === sessionToken);
  const [mode, setMode] = useState<"home" | "qr" | "waitlist" | "thanks">("home");
  const orderUrl = useMemo(
    () => `${window.location.origin}/order?vendor=${encodeURIComponent(sessionToken)}`,
    [sessionToken]
  );

  useEffect(() => {
    if (mode === "home") return;
    const timer = window.setTimeout(() => setMode("home"), mode === "thanks" ? 4500 : 120_000);
    return () => window.clearTimeout(timer);
  }, [mode]);

  if (!session || !session.active) {
    return (
      <main className="vendor-shell">
        <section className="empty-state">
          <h1>Vendor session unavailable</h1>
          <p>This ordering session is not active.</p>
        </section>
      </main>
    );
  }

  function submitWaitlist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.currentTarget.reset();
    setMode("thanks");
  }

  return (
    <main className="vendor-shell">
      <section className="vendor-hero">
        <div className="brand-lockup vendor-brand">
          <span className="brand-chip" aria-hidden="true">
            <img src="/media/logo1.webp" alt="" />
          </span>
          <span>
            <strong className="sr-only">Bangin Bustos</strong>
            <small>{session.name}</small>
          </span>
        </div>

        {mode === "home" && (
          <div className="vendor-actions">
            <button className="vendor-action-primary" type="button" onClick={() => navigate("/order")}>
              <ClipboardList size={34} />
              <span>Order Here</span>
              <ArrowRight size={24} />
            </button>
            <button type="button" onClick={() => setMode("qr")}>
              <RotateCcw size={31} />
              <span>Scan to Order</span>
            </button>
            {session.contactCaptureEnabled && (
              <button type="button" onClick={() => setMode("waitlist")}>
                <UserPlus size={31} />
                <span>Join the Next Batch</span>
              </button>
            )}
            <button type="button" onClick={() => navigate("/about")}>
              <Info size={31} />
              <span>About the Business</span>
            </button>
          </div>
        )}

        {mode === "qr" && <QRCodePanel url={orderUrl} eventName={session.name} />}

        {mode === "waitlist" && (
          <form className="vendor-form" onSubmit={submitWaitlist}>
            <h1>Next Batch List</h1>
            <label>
              Name
              <input name="name" required />
            </label>
            <label>
              Phone or email
              <input name="contact" required />
            </label>
            <label>
              Product interest
              <input name="interest" placeholder="Red, green, or both" />
            </label>
            <label>
              Approximate quantity
              <input name="quantity" />
            </label>
            <label className="toggle-row">
              <input name="consent" type="checkbox" required />
              <span>I agree to be contacted about future tamale batches.</span>
            </label>
            <div className="order-actions">
              <button className="button button-ghost" type="button" onClick={() => setMode("home")}>
                Back
              </button>
              <button className="button button-primary" type="submit">
                Join List
              </button>
            </div>
          </form>
        )}

        {mode === "thanks" && (
          <div className="vendor-thanks">
            <h1>You are on the list.</h1>
            <p>{businessSettings.shortName} will reach out when the next batch opens.</p>
          </div>
        )}
      </section>
    </main>
  );
}
