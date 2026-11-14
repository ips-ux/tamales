import { CheckCircle2, CircleAlert, Mail, Phone } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import {
  CONTACT_MESSAGE_MAX,
  cleanContactFields,
  type ContactFields,
  formatPhone,
  phoneHref,
  validateContact
} from "../components/publicForm";
import { SiteLink } from "../components/SiteFooter";
import {
  HoneypotField,
  TURNSTILE_WAIT_MESSAGE,
  TurnstileWidget,
  turnstileEnabled,
  type TurnstileHandle
} from "../components/TurnstileWidget";
import { ApiError, sendContactMessage } from "../lib/api";
import { useBusinessSettings } from "../lib/businessSettings";

const emptyFields: ContactFields = { firstName: "", lastName: "", email: "", phone: "", message: "" };

export function ContactPage() {
  const business = useBusinessSettings();
  const [fields, setFields] = useState<ContactFields>(emptyFields);
  const [website, setWebsite] = useState("");
  const [token, setToken] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [sentName, setSentName] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);

  function update(key: keyof ContactFields, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problems = validateContact(fields);
    if (problems.length === 0 && turnstileEnabled() && !token) problems.push(TURNSTILE_WAIT_MESSAGE);
    setErrors(problems);
    if (problems.length > 0) return;

    const clean = cleanContactFields(fields);
    setBusy(true);
    try {
      await sendContactMessage({ ...clean, turnstileToken: token, website });
      setSentName(clean.firstName);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (caught) {
      setErrors([
        caught instanceof ApiError
          ? caught.message
          : "We could not send your message. Check your connection, then try again."
      ]);
      turnstileRef.current?.reset();
    } finally {
      setBusy(false);
    }
  }

  if (sentName !== null) {
    return (
      <main className="page-shell narrow">
        <section className="confirmation-card" role="status">
          <CheckCircle2 size={48} className="success-icon" aria-hidden="true" />
          <h1>Thanks, {sentName}!</h1>
          <p className="large-copy">We have your message. We will answer by email.</p>
          <div className="order-actions card-actions">
            <SiteLink className="button button-primary" href="/">
              Back to Home
            </SiteLink>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <section className="contact-layout">
        <div className="contact-intro">
          <h1>Send us a message.</h1>
          <p className="large-copy">Ask about an order, an event, or a batch request.</p>
          <div className="contact-pills">
            <a href={phoneHref(business.contactPhone)}>
              <Phone size={17} aria-hidden="true" />
              {formatPhone(business.contactPhone)}
            </a>
            <a href={`mailto:${business.contactEmail}`}>
              <Mail size={17} aria-hidden="true" />
              {business.contactEmail}
            </a>
          </div>
        </div>

        <form className="contact-form" onSubmit={handleSubmit} noValidate>
          {errors.length > 0 && (
            <div className="error-summary" role="alert">
              <CircleAlert size={20} aria-hidden="true" />
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
                name="firstName"
                type="text"
                autoComplete="given-name"
                maxLength={60}
                value={fields.firstName}
                onChange={(event) => update("firstName", event.target.value)}
                required
              />
            </label>
            <label>
              Last name
              <input
                name="lastName"
                type="text"
                autoComplete="family-name"
                maxLength={60}
                value={fields.lastName}
                onChange={(event) => update("lastName", event.target.value)}
                required
              />
            </label>
            <label>
              Email address
              <input
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                maxLength={254}
                value={fields.email}
                onChange={(event) => update("email", event.target.value)}
                required
              />
            </label>
            <label>
              Phone (optional)
              <input
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                maxLength={30}
                value={fields.phone}
                onChange={(event) => update("phone", event.target.value)}
              />
            </label>
            <label className="full-span">
              Message
              <textarea
                name="message"
                rows={6}
                maxLength={CONTACT_MESSAGE_MAX}
                value={fields.message}
                onChange={(event) => update("message", event.target.value)}
                required
              />
              <span className="field-count">
                {fields.message.length.toLocaleString("en-US")} of 2,000 characters
              </span>
            </label>
          </div>
          <HoneypotField value={website} onChange={setWebsite} />
          <TurnstileWidget ref={turnstileRef} onToken={setToken} />
          <div className="order-actions">
            <button className="button button-primary" type="submit" disabled={busy}>
              {busy ? "Sending..." : "Send Message"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
