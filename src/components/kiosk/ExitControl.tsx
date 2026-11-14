// The hidden kiosk exit: hold the corner control for 2 seconds to open the
// number pad. See docs/V1_DESIGN.md section 9 "Kiosk".

import { Delete, Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { EventRecord } from "../../../shared/model";
import {
  addPinDigit,
  EXIT_HOLD_MS,
  exitNeedsPin,
  exitPinMatches,
  KIOSK_IDLE_MS,
  pinLocked,
  pinLockSeconds,
  pinTriesLeft,
  pinWrong,
  unlockedPin,
  type PinLockState
} from "./kioskRules";

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

interface ExitControlProps {
  /** Null when the kiosk link has no event. The pad then asks for a confirm only. */
  event: Pick<EventRecord, "id" | "exitPinHash"> | null;
  onExit: () => void;
}

export function ExitControl({ event, onExit }: ExitControlProps) {
  const [open, setOpen] = useState(false);
  const holdTimer = useRef<number | null>(null);
  // The lock stays when the pad closes, so closing it does not reset the tries.
  const [lock, setLock] = useState<PinLockState>(unlockedPin);

  function cancelHold() {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  }

  function startHold() {
    cancelHold();
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null;
      setOpen(true);
    }, EXIT_HOLD_MS);
  }

  useEffect(() => cancelHold, []);

  return (
    <>
      <button
        type="button"
        className="kiosk-exit-control"
        aria-label="Hold to open the exit PIN pad"
        onPointerDown={startHold}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onPointerCancel={cancelHold}
        onKeyDown={(keyEvent) => {
          if ((keyEvent.key === "Enter" || keyEvent.key === " ") && !keyEvent.repeat) startHold();
        }}
        onKeyUp={cancelHold}
        onContextMenu={(menuEvent) => menuEvent.preventDefault()}
      />
      {open && (
        <ExitPad
          event={event}
          lock={lock}
          onLockChange={setLock}
          onClose={() => setOpen(false)}
          onExit={onExit}
        />
      )}
    </>
  );
}

interface ExitPadProps {
  event: Pick<EventRecord, "id" | "exitPinHash"> | null;
  lock: PinLockState;
  onLockChange: (lock: PinLockState) => void;
  onClose: () => void;
  onExit: () => void;
}

function ExitPad({ event, lock, onLockChange, onClose, onExit }: ExitPadProps) {
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState("");
  const [checking, setChecking] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const needsPin = event ? exitNeedsPin(event) : false;
  const locked = pinLocked(lock, now);

  // The clock for the lock count. The pad also closes after 120 seconds with no touch.
  useEffect(() => {
    let lastInput = Date.now();
    const touch = () => {
      lastInput = Date.now();
    };
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current - lastInput >= KIOSK_IDLE_MS) onClose();
    }, 1000);
    window.addEventListener("pointerdown", touch);
    window.addEventListener("keydown", touch);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
    };
  }, [onClose]);

  async function submit() {
    if (!event || !needsPin) {
      onExit();
      return;
    }
    if (locked || checking || !pin) return;
    setChecking(true);
    const matches = await exitPinMatches(event, pin).catch(() => false);
    setChecking(false);
    setPin("");
    if (matches) {
      onLockChange(unlockedPin);
      onExit();
      return;
    }
    const next = pinWrong(lock, Date.now());
    onLockChange(next);
    setNow(Date.now());
    setMessage(pinLocked(next, Date.now()) ? "" : `Wrong exit PIN. ${pinTriesLeft(next)} tries left.`);
  }

  const lockSeconds = pinLockSeconds(lock, now);

  return (
    <div className="modal-overlay kiosk-exit-overlay">
      <div className="modal-card kiosk-exit-card" role="dialog" aria-modal="true" aria-labelledby="kiosk-exit-title">
        <h2 id="kiosk-exit-title">{needsPin ? "Enter the Exit PIN" : "Exit the Kiosk?"}</h2>

        {needsPin && (
          <>
            <p className="kiosk-pin-dots" aria-label={`${pin.length} digits entered`}>
              {pin.length === 0 ? " " : "●".repeat(pin.length)}
            </p>
            <p className="kiosk-pin-message" role="alert">
              {locked ? `Try again in ${lockSeconds} seconds.` : message}
            </p>
            <div className="kiosk-pin-pad">
              {DIGITS.map((digit) => (
                <button
                  key={digit}
                  type="button"
                  disabled={locked || checking}
                  onClick={() => {
                    setMessage("");
                    setPin((current) => addPinDigit(current, digit));
                  }}
                >
                  {digit}
                </button>
              ))}
              <button
                type="button"
                aria-label="Delete the last digit"
                disabled={locked || checking || !pin}
                onClick={() => setPin((current) => current.slice(0, -1))}
              >
                <Delete size={26} aria-hidden="true" />
              </button>
              <button
                type="button"
                disabled={locked || checking}
                onClick={() => {
                  setMessage("");
                  setPin((current) => addPinDigit(current, "0"));
                }}
              >
                0
              </button>
              <span aria-hidden="true">{locked && <Lock size={26} />}</span>
            </div>
          </>
        )}

        <div className="kiosk-exit-actions">
          <button className="button button-ghost" type="button" onClick={onClose}>
            Back
          </button>
          <button
            className="button button-primary"
            type="button"
            disabled={needsPin && (locked || checking || !pin)}
            onClick={() => void submit()}
          >
            {checking ? "Checking..." : "Exit"}
          </button>
        </div>
      </div>
    </div>
  );
}
