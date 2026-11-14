import { Instagram, Mail, Phone } from "lucide-react";
import { type AnchorHTMLAttributes, type FormEvent, useRef, useState } from "react";
import { navigate } from "../App";
import { ApiError, sendSignup } from "../lib/api";
import { useBusinessSettings } from "../lib/businessSettings";
import { useSiteContent } from "../lib/siteContent";
import { formatPhone, phoneHref, validateSignupEmail } from "./publicForm";
import {
  HoneypotField,
  TURNSTILE_WAIT_MESSAGE,
  TurnstileWidget,
  turnstileEnabled,
  type TurnstileHandle
} from "./TurnstileWidget";

interface SiteLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
}

/** A real link that the in-app router handles. New tabs and copied links still work. */
export function SiteLink({ href, onClick, children, ...rest }: SiteLinkProps) {
  return (
    <a
      {...rest}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}

function FooterSignup() {
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [token, setToken] = useState("");
  // The bot check loads only after the customer touches the field, so it does
  // not load on each page view.
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const turnstileRef = useRef<TurnstileHandle>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    const problem = validateSignupEmail(email);
    if (problem) {
      setError(problem);
      return;
    }
    if (turnstileEnabled() && !token) {
      setError(TURNSTILE_WAIT_MESSAGE);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await sendSignup({ email: email.trim(), source: "footer", turnstileToken: token, website });
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

  if (done) {
    return (
      <p className="footer-signup-done" role="status">
        You are on the email list.
      </p>
    );
  }

  return (
    <form className="footer-signup" onSubmit={handleSubmit} noValidate>
      <label htmlFor="footer-signup-email">Join the email list</label>
      <div className="footer-signup-row">
        <input
          id="footer-signup-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onFocus={() => setTouched(true)}
          onChange={(event) => setEmail(event.target.value)}
        />
        <button className="button footer-signup-button" type="submit" disabled={busy}>
          {busy ? "Sending..." : "Sign Up"}
        </button>
      </div>
      <HoneypotField value={website} onChange={setWebsite} />
      {touched && <TurnstileWidget ref={turnstileRef} onToken={setToken} theme="dark" />}
      {error && (
        <p className="footer-signup-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function SiteFooter() {
  const business = useBusinessSettings();
  const content = useSiteContent();

  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-brand">
          <p className="site-footer-blurb">{content.footerBlurb}</p>
          <ul className="site-footer-contact">
            <li>
              <a href={phoneHref(business.contactPhone)}>
                <Phone size={17} aria-hidden="true" />
                {formatPhone(business.contactPhone)}
              </a>
            </li>
            <li>
              <a href={`mailto:${business.contactEmail}`}>
                <Mail size={17} aria-hidden="true" />
                {business.contactEmail}
              </a>
            </li>
            <li>
              {/* Placeholder until the owner supplies an Instagram handle. Do not hide this link. */}
              <a href="#">
                <Instagram size={17} aria-hidden="true" />
                Instagram
              </a>
            </li>
          </ul>
        </div>
        <FooterSignup />
        <nav className="site-footer-nav" aria-label="Footer">
          <SiteLink href="/contact">Contact</SiteLink>
          <SiteLink href="/privacy">Privacy</SiteLink>
          <SiteLink href="/terms">Terms</SiteLink>
          <SiteLink href="/login">Login</SiteLink>
        </nav>
      </div>
    </footer>
  );
}
