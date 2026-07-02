import { useEffect, useState } from "react";
import { businessSettings as defaults } from "../data/fixtures";
import { firebaseConfigured } from "./firebaseClient";
import { watchStoredBusinessSettings } from "./firestoreClient";
import type { BusinessSettings } from "./types";

// One app-wide subscription to the settings/business doc. Fixture values act
// as defaults until (or in case) the remote doc loads, so every consumer can
// read synchronously and never sees missing fields.
let current: BusinessSettings = defaults;
let started = false;
const listeners = new Set<(settings: BusinessSettings) => void>();

function ensureStarted() {
  if (started || !firebaseConfigured()) return;
  started = true;
  watchStoredBusinessSettings(
    (stored) => {
      current = { ...defaults, ...stored };
      listeners.forEach((listener) => listener(current));
    },
    () => {
      // Keep serving defaults if the doc is unreadable (offline, rules, etc.).
    }
  );
}

export function getBusinessSettings(): BusinessSettings {
  ensureStarted();
  return current;
}

export function useBusinessSettings(): BusinessSettings {
  const [settings, setSettings] = useState<BusinessSettings>(getBusinessSettings());

  useEffect(() => {
    setSettings(current);
    const listener = (next: BusinessSettings) => setSettings(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return settings;
}
