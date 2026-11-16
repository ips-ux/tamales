import { useEffect, useState } from "react";
import type { EventRecord } from "../../../shared/model";
import { watchEventByKioskToken } from "../../lib/eventsStore";

export type KioskEventLoad =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "error" }
  | { status: "found"; event: EventRecord };

/** The event of the kiosk link, live, so the owner's pause switch and sold-out marks show at once. */
export function useKioskEvent(kioskToken: string): KioskEventLoad {
  const [load, setLoad] = useState<KioskEventLoad>({ status: "loading" });
  useEffect(() => {
    setLoad({ status: "loading" });
    if (!/^[A-Za-z0-9_-]{8,200}$/.test(kioskToken)) {
      setLoad({ status: "missing" });
      return;
    }
    return watchEventByKioskToken(
      kioskToken,
      (event) => setLoad(event ? { status: "found", event } : { status: "missing" }),
      () => setLoad((current) => (current.status === "found" ? current : { status: "error" }))
    );
  }, [kioskToken]);
  return load;
}
