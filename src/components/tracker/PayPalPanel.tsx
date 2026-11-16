// PayPal Checkout on the order tracker: the total, the time that remains, and the PayPal buttons.
// The Worker creates and captures the payment. The live tracker document then shows "Payment received."

import { useEffect, useRef, useState } from "react";
import { ApiError, capturePayment, createPayment } from "../../lib/api";
import { formatMoney } from "../../lib/money";
import { formatBusinessDateTime } from "../../lib/time";
import {
  PAID_MESSAGE,
  PAYING_MESSAGE,
  PAY_LOAD_FAILED_MESSAGE,
  PAY_UNAVAILABLE_MESSAGE,
  payDeadline,
  payErrorMessage
} from "./payRules";
import { configuredPayPalClientId, loadPayPalSdk, type PayPalButtonsInstance } from "./paypalSdk";

type Phase = "loading" | "ready" | "paying" | "paid" | "load_failed";

interface PayPalPanelProps {
  trackerToken: string;
  totalCents: number;
  /** Empty for an order with no time limit. */
  payByUtc: string;
}

/** The current time. It updates each second while `everySecond` is true, and each 30 seconds if not. */
function useClock(everySecond: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), everySecond ? 1000 : 30_000);
    return () => window.clearInterval(timer);
  }, [everySecond]);
  return now;
}

export function PayPalPanel({ trackerToken, totalCents, payByUtc }: PayPalPanelProps) {
  const clientId = configuredPayPalClientId();
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [live, setLive] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  // The reason from the Worker. PayPal reports its own error object after a failed call.
  const workerMessage = useRef("");

  const now = useClock(live);
  const deadline = payDeadline(payByUtc, now, formatBusinessDateTime);
  useEffect(() => setLive(deadline.live), [deadline.live]);

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    let buttons: PayPalButtonsInstance | null = null;
    setPhase("loading");

    loadPayPalSdk(clientId)
      .then((paypal) => {
        if (!active || !container.current) return;
        buttons = paypal.Buttons({
          createOrder: async () => {
            setError("");
            workerMessage.current = "";
            try {
              const result = await createPayment({ trackerToken });
              return result.paypalOrderId;
            } catch (caught) {
              workerMessage.current = caught instanceof ApiError ? caught.message : "";
              throw caught;
            }
          },
          onApprove: async (data) => {
            setPhase("paying");
            try {
              const result = await capturePayment({ trackerToken, paypalOrderId: data.orderID });
              if (!active) return;
              if (result.paid) {
                setPhase("paid");
              } else {
                setError(payErrorMessage(""));
                setPhase("ready");
              }
            } catch (caught) {
              if (!active) return;
              setError(payErrorMessage(caught instanceof ApiError ? caught.message : ""));
              setPhase("ready");
            }
          },
          // The customer closed PayPal. The order stays open, and this is not an error.
          onCancel: () => {
            if (active) setPhase("ready");
          },
          onError: () => {
            if (!active) return;
            setError(payErrorMessage(workerMessage.current));
            setPhase("ready");
          }
        });
        return buttons.render(container.current).then(() => {
          if (active) setPhase("ready");
        });
      })
      .catch(() => {
        if (active) setPhase("load_failed");
      });

    return () => {
      active = false;
      void buttons?.close().catch(() => undefined);
    };
  }, [clientId, trackerToken, attempt]);

  if (!clientId) {
    return (
      <section className="tracker-payment" aria-label="Payment">
        <p className="tracker-payment-note">{PAY_UNAVAILABLE_MESSAGE}</p>
      </section>
    );
  }

  if (phase === "paid") {
    return (
      <section className="tracker-payment" aria-label="Payment">
        <p className="tracker-payment-status" role="status">
          {PAID_MESSAGE}
        </p>
      </section>
    );
  }

  return (
    <section className="tracker-payment" aria-label="Payment">
      <p className="tracker-pay-total">
        <span>Total</span>
        <strong>{formatMoney(totalCents)}</strong>
      </p>
      {deadline.text && <p className="tracker-payment-note">{deadline.text}</p>}
      {error && (
        <p className="form-notice form-notice-error" role="alert">
          {error}
        </p>
      )}
      <div aria-live="polite">
        {phase === "loading" && <p className="muted tracker-pay-wait">Loading the payment buttons.</p>}
        {phase === "paying" && <p className="tracker-payment-note">{PAYING_MESSAGE}</p>}
      </div>
      {phase === "load_failed" && (
        <>
          <p className="form-notice form-notice-error" role="alert">
            {PAY_LOAD_FAILED_MESSAGE}
          </p>
          <button className="button button-ghost" type="button" onClick={() => setAttempt((count) => count + 1)}>
            Try Again
          </button>
        </>
      )}
      <div className="tracker-paypal" ref={container} hidden={phase === "paying" || phase === "load_failed"} />
    </section>
  );
}
