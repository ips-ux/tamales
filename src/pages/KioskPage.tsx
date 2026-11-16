// The kiosk at /kiosk/{kioskToken}: a tablet at the booth. It has no site
// header and no link out. See docs/V1_DESIGN.md section 9 "Kiosk".

import { ArrowLeft, BookOpen, CheckCircle2, ClipboardList, QrCode, UserPlus } from "lucide-react";
import { useEffect, useReducer, useState, type CSSProperties, type ReactNode } from "react";
import type { CreateOrderResult, EventRecord } from "../../shared/model";
import { navigate } from "../App";
import { ExitControl } from "../components/kiosk/ExitControl";
import {
  formatEventHours,
  idleReducer,
  initialIdleState,
  kioskIsActive,
  mobileOrderUrl,
  orderTile,
  trackerUrl,
  type KioskScreen
} from "../components/kiosk/kioskRules";
import { useKioskEvent } from "../components/kiosk/useKioskEvent";
import { WaitlistForm } from "../components/kiosk/WaitlistForm";
import { OrderFlow } from "../components/order/OrderFlow";
import { splitParagraphs } from "../components/publicForm";
import { QRCodePanel } from "../components/QRCodePanel";
import { useScreenWakeLock } from "../components/tracker/wakeLock";
import { useBusinessSettings } from "../lib/businessSettings";
import { useNow } from "../lib/publicData";
import { useSiteContent, useSiteImage } from "../lib/siteContent";

const EXIT_PATH = "/admin/events";

function KioskShell({ children, exit }: { children: ReactNode; exit: ReactNode }) {
  const hero = useSiteImage("hero");
  const style = { "--kiosk-photo": `url("${hero}")` } as CSSProperties;
  return (
    <main className="kiosk-shell" style={style}>
      <div className="kiosk-frame">
        <div className="kiosk-brand">
          <span className="brand-chip">
            <img src="/media/logo1.webp" alt="Bangin Bustos Tamales" />
          </span>
        </div>
        {children}
      </div>
      {exit}
    </main>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button className="button kiosk-back" type="button" onClick={onBack}>
      <ArrowLeft size={26} aria-hidden="true" />
      Back
    </button>
  );
}

function exitKiosk() {
  navigate(EXIT_PATH);
}

export function KioskPage({ kioskToken }: { kioskToken: string }) {
  const load = useKioskEvent(kioskToken);
  useScreenWakeLock(true);

  const event = load.status === "found" ? load.event : null;
  const exit = <ExitControl event={event} onExit={exitKiosk} />;

  if (load.status === "loading") {
    return (
      <KioskShell exit={exit}>
        <section className="kiosk-message">
          <h1 className="sr-only">Kiosk</h1>
          <p role="status">Opening the kiosk.</p>
        </section>
      </KioskShell>
    );
  }

  if (load.status === "error") {
    return (
      <KioskShell exit={exit}>
        <section className="kiosk-message">
          <h1>The kiosk cannot open.</h1>
          <p role="alert">Check the internet connection, then reload the page.</p>
        </section>
      </KioskShell>
    );
  }

  if (!event || !kioskIsActive(event)) {
    return (
      <KioskShell exit={exit}>
        <section className="kiosk-message">
          <h1>This kiosk is not active.</h1>
        </section>
      </KioskShell>
    );
  }

  return <ActiveKiosk event={event} kioskToken={kioskToken} exit={exit} />;
}

interface ActiveKioskProps {
  event: EventRecord;
  kioskToken: string;
  exit: ReactNode;
}

function ActiveKiosk({ event, kioskToken, exit }: ActiveKioskProps) {
  const [idle, dispatch] = useReducer(idleReducer, Date.now(), initialIdleState);
  const [result, setResult] = useState<CreateOrderResult | null>(null);
  const now = useNow(15_000);
  const { timezone } = useBusinessSettings();
  const content = useSiteContent();
  const origin = window.location.origin;

  const screen = idle.screen;
  const go = (next: KioskScreen) => dispatch({ type: "go", screen: next, now: Date.now() });
  const goHome = () => go("home");

  // Each touch or key resets the idle timer. The tick returns the screen home.
  useEffect(() => {
    const input = () => dispatch({ type: "input", now: Date.now() });
    window.addEventListener("pointerdown", input);
    window.addEventListener("keydown", input);
    const timer = window.setInterval(() => dispatch({ type: "tick", now: Date.now() }), 1000);
    return () => {
      window.removeEventListener("pointerdown", input);
      window.removeEventListener("keydown", input);
      window.clearInterval(timer);
    };
  }, []);

  const tile = orderTile(event, now, formatEventHours(event.startsAtUtc, event.endsAtUtc, timezone));

  // Go home if the owner turns the order tile off while a customer orders.
  useEffect(() => {
    if (screen === "order" && !tile.enabled) goHome();
    // goHome only dispatches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, tile.enabled]);

  function orderDone(next: CreateOrderResult) {
    setResult(next);
    go("order_thanks");
  }

  let body: ReactNode;
  switch (screen) {
    case "order":
      body = (
        <div className="kiosk-panel kiosk-order">
          <OrderFlow kind={tile.kind} source="kiosk" event={event} kioskToken={kioskToken} onDone={orderDone} />
        </div>
      );
      break;
    case "order_thanks":
      body = result ? (
        <section className="kiosk-panel kiosk-thanks">
          <CheckCircle2 size={56} className="kiosk-success-icon" aria-hidden="true" />
          <h1>Thanks! We have your order.</h1>
          <p className="kiosk-order-number">
            <span>Order number</span>
            <strong>{result.orderNumber}</strong>
          </p>
          {result.state === "requested" && <p>We will send you an email when we approve your order.</p>}
          <div className="kiosk-thanks-qr">
            <QRCodePanel
              url={trackerUrl(origin, result.trackerToken)}
              eventName={event.name}
              title={result.state === "approved" ? "Scan to pay on your phone." : "Scan to track your order on your phone."}
              alt="QR code for your order tracker"
            />
          </div>
          <button className="button button-primary kiosk-done" type="button" onClick={goHome}>
            Done
          </button>
        </section>
      ) : null;
      break;
    case "scan":
      body = (
        <div className="kiosk-scan">
          <h1 className="sr-only">Scan to Order</h1>
          <QRCodePanel url={mobileOrderUrl(origin, event.id)} eventName={event.name} alt="QR code to order on your phone" />
        </div>
      );
      break;
    case "waitlist":
      body = <WaitlistForm eventId={event.id} onDone={() => go("waitlist_thanks")} />;
      break;
    case "waitlist_thanks":
      body = (
        <section className="kiosk-panel kiosk-thanks">
          <CheckCircle2 size={56} className="kiosk-success-icon" aria-hidden="true" />
          <h1>You are on the waitlist!</h1>
          <p>We will send you an email when the next batch opens.</p>
          <button className="button button-primary kiosk-done" type="button" onClick={goHome}>
            Done
          </button>
        </section>
      );
      break;
    case "story": {
      const paragraphs = splitParagraphs(content.aboutStory);
      body = (
        <section className="kiosk-panel kiosk-story">
          <h1>{content.aboutHeadline}</h1>
          {paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </section>
      );
      break;
    }
    default:
      body = (
        <section className="kiosk-home">
          <h1 className="kiosk-event-name">{event.name}</h1>
          <div className="kiosk-tiles">
            <button
              className="kiosk-tile kiosk-tile-primary"
              type="button"
              disabled={!tile.enabled}
              aria-describedby={tile.reason ? "kiosk-order-reason" : undefined}
              onClick={() => go("order")}
            >
              <ClipboardList size={38} aria-hidden="true" />
              <span>
                Order Here
                {tile.reason && (
                  <small id="kiosk-order-reason" className="kiosk-tile-reason">
                    {tile.reason}
                  </small>
                )}
              </span>
            </button>
            <button className="kiosk-tile" type="button" onClick={() => go("scan")}>
              <QrCode size={38} aria-hidden="true" />
              <span>Scan to Order</span>
            </button>
            {event.waitlistEnabled && (
              <button className="kiosk-tile" type="button" onClick={() => go("waitlist")}>
                <UserPlus size={38} aria-hidden="true" />
                <span>Join the Next Batch</span>
              </button>
            )}
            <button className="kiosk-tile" type="button" onClick={() => go("story")}>
              <BookOpen size={38} aria-hidden="true" />
              <span>Our Story</span>
            </button>
          </div>
        </section>
      );
  }

  return (
    <KioskShell exit={exit}>
      {screen !== "home" && screen !== "order_thanks" && screen !== "waitlist_thanks" && <BackButton onBack={goHome} />}
      {body}
    </KioskShell>
  );
}
