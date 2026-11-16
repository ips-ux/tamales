// The order tracker at /t/{trackerToken}. It reads 1 tracker document live.
// See docs/V1_DESIGN.md section 9 "Order tracker" and docs/V1_FUNDAMENTALS.md section 9.

import { BellRing, CheckCircle2, ClipboardList, WifiOff } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { OrderState, TrackerRecord } from "../../shared/model";
import { SiteLink } from "../components/SiteFooter";
import { playReadyChimes, unlockChime, vibrateReady } from "../components/tracker/alertSound";
import { PaymentPanel } from "../components/tracker/PaymentPanel";
import { refundText } from "../components/tracker/payRules";
import { clearActiveTracker, saveActiveTracker } from "../components/tracker/resume";
import {
  flashIsAlternate,
  flashPlan,
  isFinalTrackerState,
  itemText,
  moneyLines,
  paymentHelp,
  readyDetail,
  resumeAction,
  scheduledLabel,
  shouldAlert,
  statusAnnouncement,
  stepWord,
  TRACKER_STEPS,
  trackerHeadline,
  trackerView,
  waitsForReady
} from "../components/tracker/trackerRules";
import { useTracker } from "../components/tracker/useTracker";
import { useScreenWakeLock } from "../components/tracker/wakeLock";
import { formatMoney } from "../lib/money";
import { usePaymentHandles } from "../lib/publicData";
import { formatBusinessDateTime } from "../lib/time";

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Counts the color changes of the slow ready flash. Returns the number of changes done. */
function useReadyFlash(): [number, () => void] {
  const [changes, setChanges] = useState(0);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearInterval(timer.current);
    },
    []
  );

  function start() {
    const plan = flashPlan(prefersReducedMotion());
    if (timer.current !== null) window.clearInterval(timer.current);
    setChanges(0);
    if (plan.changes === 0) return;
    let done = 0;
    timer.current = window.setInterval(() => {
      done += 1;
      setChanges(done);
      if (done >= plan.changes && timer.current !== null) {
        window.clearInterval(timer.current);
        timer.current = null;
      }
    }, plan.intervalMs);
  }

  return [changes, start];
}

function StatusShell({ children }: { children: ReactNode }) {
  return (
    <main className="page-shell narrow">
      <section className="empty-state tracker-state">{children}</section>
    </main>
  );
}

export function TrackerPage({ trackerToken }: { trackerToken: string }) {
  const { load, offline } = useTracker(trackerToken);
  const handles = usePaymentHandles();
  const [alertsOn, setAlertsOn] = useState(false);
  const [flashChanges, startFlash] = useReadyFlash();
  const previousState = useRef<OrderState | null>(null);

  const record: TrackerRecord | null = load.status === "found" ? load.record : null;
  const state = record?.state ?? null;

  useScreenWakeLock(alertsOn && state !== null && !isFinalTrackerState(state));

  // The ready alert: only for a change to ready while the page is open, not on the first load.
  useEffect(() => {
    if (!state) return;
    if (shouldAlert(previousState.current, state)) {
      playReadyChimes();
      vibrateReady();
      startFlash();
    }
    previousState.current = state;
    // startFlash is stable for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // The phone remembers an open order, and forgets it at a final state.
  useEffect(() => {
    if (load.status === "not_found") clearActiveTracker(trackerToken);
    if (!state) return;
    if (resumeAction(state) === "save") saveActiveTracker(trackerToken);
    else clearActiveTracker(trackerToken);
  }, [load.status, state, trackerToken]);

  async function turnOnAlerts() {
    await unlockChime();
    setAlertsOn(true);
  }

  if (load.status === "loading") {
    return (
      <StatusShell>
        <ClipboardList size={42} aria-hidden="true" />
        <h1 className="sr-only">Order tracker</h1>
        <p role="status">{offline ? "You are offline. Connect to the internet to see your order." : "Finding your order."}</p>
      </StatusShell>
    );
  }

  if (load.status === "not_found") {
    return (
      <StatusShell>
        <ClipboardList size={42} aria-hidden="true" />
        <h1>Order not found.</h1>
        <p>Check the link in your email.</p>
        <SiteLink className="button button-primary" href="/order">
          Place an Order
        </SiteLink>
      </StatusShell>
    );
  }

  if (load.status === "error" || !record) {
    return (
      <StatusShell>
        <WifiOff size={42} aria-hidden="true" />
        <h1>We could not load your order.</h1>
        <p role="alert">Check your connection, then reload the page.</p>
      </StatusShell>
    );
  }

  const view = trackerView(record);
  const ready = view.type === "steps" && view.ready;
  const flashing = ready && flashIsAlternate(flashChanges, flashPlan(prefersReducedMotion()));
  const help = paymentHelp(record, handles);
  const final = isFinalTrackerState(record.state);
  const detail = view.type === "message" ? view.detail : ready ? readyDetail(record) : "";
  const refund = refundText(record);

  const pageClass = ["tracker-page", ready ? "tracker-page-ready" : "", flashing ? "tracker-page-flash" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <main className={pageClass}>
      <div className="page-shell narrow tracker-shell">
        {offline && (
          <p className="tracker-offline" role="status">
            <WifiOff size={18} aria-hidden="true" />
            <strong>Offline</strong>
            <span>The status updates when you connect again.</span>
          </p>
        )}

        <section className="tracker-card">
          <p className="tracker-number">
            Order number <strong>{record.orderNumber}</strong>
          </p>
          {record.eventName && <p className="tracker-event muted">{record.eventName}</p>}

          {ready && <CheckCircle2 size={48} className="tracker-ready-icon" aria-hidden="true" />}
          <h1 className="tracker-headline">{trackerHeadline(view)}</h1>
          {detail && <p className="tracker-detail">{detail}</p>}
          {record.state === "expired" && (
            <SiteLink className="button button-primary" href="/order">
              Place an Order
            </SiteLink>
          )}
          <p className="sr-only" aria-live="polite">
            {statusAnnouncement(record)}
          </p>

          {view.type === "steps" && (
            <ol className="tracker-steps" aria-label="Order status">
              {TRACKER_STEPS.map((step, index) => {
                const word = stepWord(index, view.current);
                return (
                  <li
                    key={step}
                    className={`tracker-step tracker-step-${word.toLowerCase()}`}
                    aria-current={word === "Now" ? "step" : undefined}
                  >
                    <span className="tracker-step-number" aria-hidden="true">
                      {index + 1}
                    </span>
                    <span className="tracker-step-name">{step}</span>
                    <span className="tracker-step-word">{word}</span>
                  </li>
                );
              })}
            </ol>
          )}

          {!final && (
            <div className="tracker-alerts">
              <p className="tracker-keep-open">Keep this page open.</p>
              {waitsForReady(record.state) &&
                (alertsOn ? (
                  <p className="tracker-alerts-on" role="status">
                    <BellRing size={18} aria-hidden="true" />
                    Alerts are on
                  </p>
                ) : (
                  <button className="button button-ghost" type="button" onClick={() => void turnOnAlerts()}>
                    <BellRing size={18} aria-hidden="true" />
                    Turn On Alerts
                  </button>
                ))}
            </div>
          )}

          <PaymentPanel
            help={help}
            trackerToken={trackerToken}
            totalCents={record.totals.totalCents}
            payByUtc={record.payByUtc}
          />
          {refund && <p className="tracker-refund">{refund}</p>}

          {record.scheduledAtUtc && (
            <p className="tracker-scheduled">
              <strong>{scheduledLabel(record.fulfillment)}:</strong> {formatBusinessDateTime(record.scheduledAtUtc)}
            </p>
          )}

          {record.items.length > 0 && (
            <ul className="tracker-items" aria-label="Items">
              {record.items.map((item, index) => (
                <li key={`${item.label}-${index}`}>{itemText(item)}</li>
              ))}
            </ul>
          )}

          <dl className="tracker-money">
            {moneyLines(record.totals).map((line) => (
              <div key={line.label} className={line.total ? "tracker-money-total" : undefined}>
                <dt>{line.label}</dt>
                <dd>{formatMoney(line.cents)}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </main>
  );
}
