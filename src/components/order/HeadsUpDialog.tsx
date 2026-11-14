// The marketing dialog. The text is fixed by docs/V1_DESIGN.md section 8.
import { useEffect, useRef } from "react";

export const HEADS_UP_TITLE = "Heads up!";
export const HEADS_UP_YES = "Let me know about future pop-ups";
export const HEADS_UP_NO = "I'm fine, don't let me know about future pop-ups";

interface HeadsUpDialogProps {
  /** true = add the customer to the email list. */
  onAnswer: (optIn: boolean) => void;
  /** Escape or a tap outside the card. The order is not sent. */
  onClose: () => void;
}

export function HeadsUpDialog({ onAnswer, onClose }: HeadsUpDialogProps) {
  const primaryRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    primaryRef.current?.focus();
    const onKey = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);

  return (
    <div
      className="modal-overlay heads-up-overlay"
      onClick={(clickEvent) => {
        if (clickEvent.target === clickEvent.currentTarget) onClose();
      }}
    >
      <div className="modal-card heads-up-card" role="dialog" aria-modal="true" aria-labelledby="heads-up-title">
        <h2 id="heads-up-title">{HEADS_UP_TITLE}</h2>
        <div className="heads-up-actions">
          <button className="button button-ghost" type="button" onClick={() => onAnswer(false)}>
            {HEADS_UP_NO}
          </button>
          <button className="button button-primary" type="button" ref={primaryRef} onClick={() => onAnswer(true)}>
            {HEADS_UP_YES}
          </button>
        </div>
      </div>
    </div>
  );
}
