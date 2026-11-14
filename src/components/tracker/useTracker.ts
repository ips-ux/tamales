// Live read of 1 tracker document: `trackers/{token}`. The rules allow a
// public get by token and no list. See firebase/firestore.rules.

import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import type { TrackerRecord } from "../../../shared/model";
import { firebaseConfigured } from "../../lib/firebaseClient";
import { db } from "../../lib/firestoreClient";
import { isTrackerToken, mapTrackerDoc } from "./trackerRules";

export type TrackerLoad =
  | { status: "loading" }
  | { status: "not_found" }
  | { status: "error" }
  | { status: "found"; record: TrackerRecord };

/** The tracker, live. `offline` is true while the browser has no connection. */
export function useTracker(token: string): { load: TrackerLoad; offline: boolean } {
  const [load, setLoad] = useState<TrackerLoad>({ status: "loading" });
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && navigator.onLine === false);

  useEffect(() => {
    const update = () => setOffline(navigator.onLine === false);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    setLoad({ status: "loading" });
    if (!isTrackerToken(token)) {
      setLoad({ status: "not_found" });
      return;
    }
    if (!firebaseConfigured()) {
      setLoad({ status: "error" });
      return;
    }
    return onSnapshot(
      doc(db(), "trackers", token),
      { includeMetadataChanges: true },
      (snapshot) => {
        if (!snapshot.exists()) {
          // With no connection, Firestore answers from its empty cache. Wait for the server.
          if (snapshot.metadata.fromCache) return;
          setLoad({ status: "not_found" });
          return;
        }
        const record = mapTrackerDoc(snapshot.data());
        setLoad(record ? { status: "found", record } : { status: "not_found" });
      },
      () => setLoad((current) => (current.status === "found" ? current : { status: "error" }))
    );
  }, [token]);

  return { load, offline };
}
