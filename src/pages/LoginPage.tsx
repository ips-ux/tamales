import { ArrowRight, Gift, History, KeyRound, ReceiptText, UserRound } from "lucide-react";
import { FormEvent, MouseEvent, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { navigate } from "../App";
import { ChangePasswordForm } from "../components/ChangePasswordForm";
import {
  firebaseConfigured,
  sendPasswordReset,
  signIn,
  signOutCurrentUser,
  userIsAdmin,
  watchAuth
} from "../lib/firebaseClient";
import { clearMustChangePassword, fetchMustChangePassword } from "../lib/firestoreClient";

export function LoginPage() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    return watchAuth((nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        setIsAdmin(false);
        setMustChangePassword(false);
        return;
      }
      userIsAdmin(nextUser)
        .then((admin) => {
          setIsAdmin(admin);
          if (!admin) {
            setMustChangePassword(false);
            return;
          }
          // Owner-provisioned employee accounts start with a temporary
          // password and this flag; it only shows the change-password form
          // until they set their own, then stays cleared for every login after.
          fetchMustChangePassword(nextUser.uid)
            .then(setMustChangePassword)
            .catch(() => setMustChangePassword(false));
        })
        .catch(() => {
          setIsAdmin(false);
          setMustChangePassword(false);
        });
    });
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
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
      }
    } catch {
      setError("That login did not work. Check the email and password, then try again.");
    }
  }

  async function handleForgotPassword(event: MouseEvent<HTMLButtonElement>) {
    setError("");
    setNotice("");
    const form = event.currentTarget.form;
    const email = String(new FormData(form ?? undefined).get("email") ?? "").trim();
    if (!email) {
      setError("Enter your email above first, then tap Forgot Password.");
      return;
    }
    if (!firebaseConfigured()) {
      setError("Firebase login is not configured locally yet. Add VITE_FIREBASE values to .env.local.");
      return;
    }
    try {
      await sendPasswordReset(email);
    } catch {
      // Fall through to the generic notice so the form never confirms
      // whether an email has an account.
    }
    setNotice(`If ${email} has an account, a password reset link is on its way.`);
  }

  async function handleSignOut() {
    setError("");
    setNotice("");
    await signOutCurrentUser();
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

        {user ? (
          <div className="login-card">
            <div className="login-card-icon" aria-hidden="true">
              <UserRound size={26} />
            </div>
            <h2>Your Account</h2>
            <p>
              Signed in as <strong>{user.email}</strong>
            </p>
            {isAdmin && (
              <button className="button button-primary" type="button" onClick={() => navigate("/admin")}>
                Go to Owner Area
                <ArrowRight size={18} />
              </button>
            )}
            {mustChangePassword && (
              <>
                <h3>Change password</h3>
                <p className="form-notice" role="status">
                  You&rsquo;re signed in with a temporary password. Set a new one to continue.
                </p>
                <ChangePasswordForm
                  onSuccess={() => {
                    setMustChangePassword(false);
                    if (user) void clearMustChangePassword(user.uid);
                  }}
                />
              </>
            )}
            <button className="button button-ghost" type="button" onClick={handleSignOut}>
              Sign Out
            </button>
          </div>
        ) : (
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
            {notice && (
              <div className="login-notice" role="status">
                {notice}
              </div>
            )}
            <button className="button button-primary" type="submit">
              Continue
              <ArrowRight size={18} />
            </button>
            <button className="button button-ghost" type="button" onClick={handleForgotPassword}>
              Forgot Password?
            </button>
            <button className="button button-ghost" type="button" onClick={() => navigate("/order")}>
              Order as Guest
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
