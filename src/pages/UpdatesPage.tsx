import { Flame, Mail, PartyPopper } from "lucide-react";
import { FormEvent, useState } from "react";
import { navigate } from "../App";
import { addMarketingSignup } from "../lib/firestoreClient";

export function UpdatesPage() {
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const prefill = new URLSearchParams(window.location.search).get("email") ?? "";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    if (!email) return;
    setBusy(true);
    setError("");
    try {
      await addMarketingSignup(email);
      setDone(true);
    } catch {
      setError("That didn't go through. Give it another shot in a second.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page-shell narrow">
      {done ? (
        <section className="confirmation-card">
          <PartyPopper size={42} className="success-icon" />
          <h1>You're on the list!</h1>
          <p className="large-copy">
            Great choice. You'll be first to know when the next batch drops — pop-up dates,
            preorder windows, and the occasional special. That's it. No junk, just tamales.
          </p>
          <div className="order-actions">
            <button className="button button-primary" type="button" onClick={() => navigate("/order")}>
              Place an Order
            </button>
            <button className="button button-ghost" type="button" onClick={() => navigate("/")}>
              Back to Home
            </button>
          </div>
        </section>
      ) : (
        <section className="confirmation-card">
          <Flame size={42} className="success-icon" />
          <p className="eyebrow">The Batch List</p>
          <h1>Never miss a batch.</h1>
          <p className="large-copy">
            Small batches sell out fast. Get first dibs on pop-up dates, preorder windows, and
            specials — straight to your inbox. Zero spam, all tamales.
          </p>
          <form className="updates-form" onSubmit={handleSubmit}>
            <label>
              Email address
              <input
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                defaultValue={prefill}
                placeholder="you@example.com"
                required
              />
            </label>
            {error && (
              <p className="form-notice form-notice-error" role="alert">
                {error}
              </p>
            )}
            <button className="button button-primary" type="submit" disabled={busy}>
              <Mail size={18} />
              {busy ? "Signing you up…" : "Sign Me Up"}
            </button>
          </form>
          <p className="muted updates-fine-print">
            We only send the good stuff. Unsubscribe anytime by replying to any email.
          </p>
        </section>
      )}
    </main>
  );
}
