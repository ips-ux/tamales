// Screen wake lock for the order tracker and the kiosk. A browser releases the
// lock when the page is hidden, so the hook requests it again when the page
// shows. A browser with no `navigator.wakeLock` keeps the normal screen timeout.

import { useEffect } from "react";

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
}

interface WakeLockLike {
  request: (type: "screen") => Promise<WakeLockSentinelLike>;
}

function wakeLockApi(): WakeLockLike | null {
  if (typeof navigator === "undefined") return null;
  const api = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
  return api && typeof api.request === "function" ? api : null;
}

/** Keeps the screen on while `enabled` is true and the page is visible. */
export function useScreenWakeLock(enabled: boolean): void {
  useEffect(() => {
    const api = wakeLockApi();
    if (!enabled || !api) return;
    let sentinel: WakeLockSentinelLike | null = null;
    let active = true;

    const request = () => {
      if (!active || document.visibilityState !== "visible") return;
      if (sentinel && !sentinel.released) return;
      api
        .request("screen")
        .then((lock) => {
          if (active) sentinel = lock;
          else void lock.release().catch(() => undefined);
        })
        .catch(() => {
          // The browser refused (low battery, no permission). The page still works.
        });
    };

    request();
    document.addEventListener("visibilitychange", request);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", request);
      if (sentinel && !sentinel.released) void sentinel.release().catch(() => undefined);
      sentinel = null;
    };
  }, [enabled]);
}
