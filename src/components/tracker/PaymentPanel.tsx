import { Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import type { PaymentHelp } from "./trackerRules";

/** Copies text. Uses the old copy command when the Clipboard API is not available. */
async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Try the fallback below.
  }
  try {
    const field = document.createElement("textarea");
    field.value = value;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    return copied;
  } catch {
    return false;
  }
}

/** The payment block of the order tracker: a status line, or the copy button and the payment link. */
export function PaymentPanel({ help }: { help: PaymentHelp }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  if (help.type === "none") return null;
  if (help.type === "text") {
    return (
      <section className="tracker-payment" aria-label="Payment">
        <p className="tracker-payment-status">{help.text}</p>
      </section>
    );
  }

  async function copy(value: string) {
    setCopyState((await copyText(value)) ? "copied" : "failed");
  }

  return (
    <section className="tracker-payment" aria-label="Payment">
      <p className="tracker-payment-note">Paste this text in the payment note.</p>
      <p className="tracker-payment-description">{help.description}</p>
      <div className="tracker-payment-actions">
        <button className="button button-ghost" type="button" onClick={() => void copy(help.description)}>
          <Copy size={18} aria-hidden="true" />
          Copy Payment Description
        </button>
        {help.url && (
          <a className="button button-primary" href={help.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={18} aria-hidden="true" />
            {help.buttonLabel}
          </a>
        )}
      </div>
      <p className="tracker-copy-status" aria-live="polite">
        {copyState === "copied" && "Copied."}
        {copyState === "failed" && "Select the text above and copy it."}
      </p>
    </section>
  );
}
