import { CheckCircle2, Mail } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { validateSignupEmail } from "../components/publicForm";
import { SiteLink } from "../components/SiteFooter";
import {
  HoneypotField,
  TURNSTILE_WAIT_MESSAGE,
  TurnstileWidget,
  turnstileEnabled,
  type TurnstileHandle
} from "../components/TurnstileWidget";
import { ApiError, sendSignup } from "../lib/api";

export function UpdatesPage() {
  const [email, setEmail] = useState(
    () => new URLSearchParams(window.location.search).get("email") ?? ""
  );
  const [website, setWebsite] = useState("");
  const [token, setToken] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const turnstileRef = useRef<TurnstileHandle>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem =
      validateSignupEmail(email) || (turnstileEnabled() && !token ? TURNSTILE_WAIT_MESSAGE : "");
    setError(problem);
    if (problem) return;
    setBusy(true);
    try {
      await sendSignup({ email: email.trim(), source: "landing", turnstileToken: token, website });
      setDone(true);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "We could not add you to the email list. Check your connection, then try again."
      );
      turnstileRef.current?.reset();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page-shell narrow">
      {done ? (
        <section className="confirmation-card" role="status">
          <CheckCircle2 size={48} className="success-icon" aria-hidden="true" />
          <h1>You are on the list!</h1>
          <p className="large-copy">We will send you the date of the next pop-up.</p>
          <div className="order-actions card-actions">
            <SiteLink className="button button-ghost" href="/">
              Back to Home
            </SiteLink>
            <SiteLink className="button button-primary" href="/order">
              Place an Order
            </SiteLink>
          </div>
        </section>
      ) : (
        <section className="confirmation-card">
          <h1>Join the email list.</h1>
          <p className="large-copy">We send pop-up dates and pre-order news. We send nothing else.</p>
          <form className="updates-form" onSubmit={handleSubmit} noValidate>
            {error && (
              <div className="error-summary" role="alert">
                {error}
              </div>
            )}
            <label>
              Email address
              <input
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <HoneypotField value={website} onChange={setWebsite} />
            <TurnstileWidget ref={turnstileRef} onToken={setToken} />
            <button className="button button-primary" type="submit" disabled={busy}>
              <Mail size={18} aria-hidden="true" />
              {busy ? "Sending..." : "Sign Up"}
            </button>
          </form>
          <p className="muted updates-fine-print">To leave the email list, reply to an email from us.</p>
        </section>
      )}
    </main>
  );
}
