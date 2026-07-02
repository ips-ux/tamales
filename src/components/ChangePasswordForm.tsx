import { FormEvent, useState } from "react";
import { changePassword } from "../lib/firebaseClient";

function friendlyError(error: unknown): string {
  const code = (error as { code?: string }).code ?? "";
  if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
    return "Your current password is incorrect.";
  }
  if (code === "auth/weak-password") {
    return "The new password is too weak. Use at least 6 characters.";
  }
  if (code === "auth/too-many-requests") {
    return "Too many attempts. Wait a few minutes and try again.";
  }
  return error instanceof Error ? error.message : "Could not update the password.";
}

export function ChangePasswordForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const currentPassword = String(form.get("currentPassword") ?? "");
    const newPassword = String(form.get("newPassword") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");
    setError("");
    setSuccess(false);
    if (newPassword !== confirmPassword) {
      setError("The new passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      setSuccess(true);
      formElement.reset();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="change-password-form" onSubmit={handleSubmit}>
      <label>
        Current password
        <input name="currentPassword" type="password" autoComplete="current-password" required />
      </label>
      <label>
        New password
        <input
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={6}
          required
        />
      </label>
      <label>
        Confirm new password
        <input
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={6}
          required
        />
      </label>
      {error && (
        <p className="form-notice form-notice-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="form-notice" role="status">
          Password updated.
        </p>
      )}
      <button className="button button-primary" type="submit" disabled={busy}>
        {busy ? "Updating…" : "Update Password"}
      </button>
    </form>
  );
}
