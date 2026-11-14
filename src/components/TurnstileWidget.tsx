import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

// Cloudflare Turnstile bot check for the public forms. The Worker verifies the
// token. With no site key (local development) this renders nothing and
// reports an empty token; the Worker skips the check when it has no secret.

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const siteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "").trim();

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
      theme?: "light" | "dark" | "auto";
    }
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.onload = () => {
        if (window.turnstile) resolve(window.turnstile);
        else reject(new Error("Turnstile did not load."));
      };
      script.onerror = () => {
        script.remove();
        reject(new Error("Turnstile did not load."));
      };
      document.head.appendChild(script);
    }).catch((error) => {
      // Let the next form try again.
      scriptPromise = null;
      throw error;
    });
  }
  return scriptPromise;
}

/** True when a site key is set, so a form must wait for a token before it sends. */
export function turnstileEnabled(): boolean {
  return Boolean(siteKey);
}

/** Shown when a customer submits before the check gives a token. */
export const TURNSTILE_WAIT_MESSAGE = "Wait for the security check to finish, then try again.";

export interface TurnstileHandle {
  /** Clears the used token and starts a new check. Call this after each submit. */
  reset: () => void;
}

interface TurnstileWidgetProps {
  /** Receives the token. Receives an empty string when the token expires or is reset. */
  onToken: (token: string) => void;
  theme?: "light" | "dark";
}

export const TurnstileWidget = forwardRef<TurnstileHandle, TurnstileWidgetProps>(
  function TurnstileWidget({ onToken, theme = "light" }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    const onTokenRef = useRef(onToken);
    onTokenRef.current = onToken;

    useImperativeHandle(ref, () => ({
      reset() {
        onTokenRef.current("");
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current);
        }
      }
    }));

    useEffect(() => {
      if (!siteKey) {
        onTokenRef.current("");
        return;
      }
      let active = true;
      loadTurnstile()
        .then((turnstile) => {
          if (!active || !containerRef.current) return;
          widgetIdRef.current = turnstile.render(containerRef.current, {
            sitekey: siteKey,
            theme,
            callback: (token) => onTokenRef.current(token),
            "expired-callback": () => onTokenRef.current(""),
            "error-callback": () => onTokenRef.current("")
          });
        })
        .catch(() => {
          // The form shows TURNSTILE_WAIT_MESSAGE on submit when there is no token.
        });
      return () => {
        active = false;
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.remove(widgetIdRef.current);
        }
        widgetIdRef.current = null;
        // A token belongs to the widget that made it.
        onTokenRef.current("");
      };
    }, [theme]);

    if (!siteKey) return null;
    return <div className="turnstile-box" ref={containerRef} />;
  }
);

interface HoneypotFieldProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * The hidden `website` field. A customer never sees or fills it. It stays in
 * the layout off-screen (not display:none) so automated tools fill it, and
 * the Worker rejects a request that has a value here.
 */
export function HoneypotField({ value, onChange }: HoneypotFieldProps) {
  return (
    <div className="hp-field" aria-hidden="true">
      <label>
        Website
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    </div>
  );
}
