// "Join the Next Batch" on the kiosk. The Worker saves the entry.

import { AlertCircle } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { ApiError, joinWaitlist } from "../../lib/api";
import {
  HoneypotField,
  TURNSTILE_WAIT_MESSAGE,
  TurnstileWidget,
  turnstileEnabled,
  type TurnstileHandle
} from "../TurnstileWidget";
import { validateWaitlist, WAITLIST_INTEREST_MAX, type WaitlistFields } from "./kioskRules";

const SEND_ERROR = "We could not add you to the waitlist. Check your connection, then try again.";

const emptyFields: WaitlistFields = { firstName: "", lastName: "", email: "", interest: "" };

export function WaitlistForm({ eventId, onDone }: { eventId: string; onDone: () => void }) {
  const [fields, setFields] = useState<WaitlistFields>(emptyFields);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [website, setWebsite] = useState("");
  const [token, setToken] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const turnstile = useRef<TurnstileHandle>(null);

  function update(name: keyof WaitlistFields, value: string) {
    setFields((current) => ({ ...current, [name]: value }));
  }

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const problems = validateWaitlist(fields);
    if (problems.length === 0 && turnstileEnabled() && !token) problems.push(TURNSTILE_WAIT_MESSAGE);
    setErrors(problems);
    if (problems.length > 0) return;
    setSending(true);
    try {
      await joinWaitlist({
        firstName: fields.firstName.trim(),
        lastName: fields.lastName.trim(),
        email: fields.email.trim(),
        interest: fields.interest.trim(),
        eventId,
        marketingOptIn,
        turnstileToken: token,
        website
      });
      onDone();
    } catch (error) {
      setErrors([error instanceof ApiError ? error.message : SEND_ERROR]);
      turnstile.current?.reset();
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="kiosk-panel kiosk-form" onSubmit={(formEvent) => void submit(formEvent)} noValidate>
      <h1>Join the Next Batch</h1>
      {errors.length > 0 && (
        <div className="error-summary" role="alert">
          <AlertCircle size={22} aria-hidden="true" />
          <ul>
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="form-grid">
        <label>
          First name
          <input
            type="text"
            autoComplete="given-name"
            maxLength={60}
            value={fields.firstName}
            onChange={(changeEvent) => update("firstName", changeEvent.target.value)}
          />
        </label>
        <label>
          Last name
          <input
            type="text"
            autoComplete="family-name"
            maxLength={60}
            value={fields.lastName}
            onChange={(changeEvent) => update("lastName", changeEvent.target.value)}
          />
        </label>
        <label className="full-span">
          Email
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            maxLength={200}
            value={fields.email}
            onChange={(changeEvent) => update("email", changeEvent.target.value)}
          />
        </label>
        <label className="full-span">
          What do you want?
          <textarea
            rows={2}
            maxLength={WAITLIST_INTEREST_MAX}
            value={fields.interest}
            onChange={(changeEvent) => update("interest", changeEvent.target.value)}
          />
        </label>
        <label className="toggle-row full-span">
          <input
            type="checkbox"
            checked={marketingOptIn}
            onChange={(changeEvent) => setMarketingOptIn(changeEvent.target.checked)}
          />
          <span>Sign me up for the email list.</span>
        </label>
      </div>
      <HoneypotField value={website} onChange={setWebsite} />
      <TurnstileWidget ref={turnstile} onToken={setToken} />
      <div className="kiosk-form-actions">
        <button className="button button-primary" type="submit" disabled={sending}>
          {sending ? "Sending..." : "Join the Waitlist"}
        </button>
      </div>
    </form>
  );
}
