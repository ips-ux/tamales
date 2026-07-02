import { ArrowRight, Gift, History, KeyRound, ReceiptText } from "lucide-react";
import { FormEvent, useState } from "react";
import { navigate } from "../App";
import { firebaseConfigured, signIn, userIsAdmin } from "../lib/firebaseClient";

export function LoginPage() {
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    if (!firebaseConfigured()) {
      setError("Firebase login is not configured locally yet. Add VITE_FIREBASE values to .env.local.");
      return;
    }
    try {
      const credential = await signIn(email, password);
      if (await userIsAdmin(credential.user)) {
        navigate("/admin");
        return;
      }
      setSubmitted(true);
    } catch {
      setError("That login did not work. Check the email and password, then try again.");
    }
  }

  return (
    <main className="login-page">
      <section className="login-hero">
        <div className="login-copy">
          <p className="eyebrow">Tamale Points</p>
          <h1>Sign in before your next batch.</h1>
          <p className="large-copy">
            Returning customers can keep order details close, collect points, and move through
            pickup faster when the next batch opens.
          </p>
          <div className="login-perks" aria-label="Account perks">
            <span>
              <Gift size={17} />
              Earn batch points
            </span>
            <span>
              <History size={17} />
              Reorder faster
            </span>
            <span>
              <ReceiptText size={17} />
              Track requests
            </span>
          </div>
        </div>

        <form className="login-card" onSubmit={handleSubmit}>
          <div className="login-card-icon" aria-hidden="true">
            <KeyRound size={26} />
          </div>
          <h2>Member Login</h2>
          <p>
            Use the phone or email tied to your orders. Account access is routed automatically
            after verification.
          </p>
          <label>
            Email
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          {error && (
            <div className="login-notice login-error" role="alert">
              {error}
            </div>
          )}
          {submitted && (
            <div className="login-notice" role="status">
              You are signed in as a member. Rewards and order-history tools can be connected next.
            </div>
          )}
          <button className="button button-primary" type="submit">
            Continue
            <ArrowRight size={18} />
          </button>
          <button className="button button-ghost" type="button" onClick={() => navigate("/order")}>
            Order as Guest
          </button>
        </form>
      </section>
    </main>
  );
}
