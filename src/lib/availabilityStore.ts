import { useEffect, useState } from "react";
import {
  availabilityWindows as starterWindows,
  pickupLocations as starterLocations
} from "../data/fixtures";
import { firebaseConfigured } from "./firebaseClient";
import { watchAvailabilityWindows, watchPickupLocations } from "./firestoreClient";
import type { AvailabilityWindow, PickupLocation } from "./types";

// Two app-wide subscriptions (windows collection, locations collection),
// each following the same pattern as businessSettings.ts / menuStore.ts:
// fixture values serve as defaults until the remote data loads (or when
// Firebase isn't configured), so every consumer reads synchronously.

let currentWindows: AvailabilityWindow[] = starterWindows;
let windowsStarted = false;
const windowsListeners = new Set<(windows: AvailabilityWindow[]) => void>();

function ensureWindowsStarted() {
  if (windowsStarted || !firebaseConfigured()) return;
  windowsStarted = true;
  watchAvailabilityWindows(
    (remote) => {
      currentWindows = remote.length > 0 ? remote : starterWindows;
      windowsListeners.forEach((listener) => listener(currentWindows));
    },
    () => {
      // Keep serving the current windows if the snapshot fails (offline etc.).
    }
  );
}

export function getAvailabilityWindows(): AvailabilityWindow[] {
  ensureWindowsStarted();
  return currentWindows;
}

export function useAvailabilityWindows(): AvailabilityWindow[] {
  const [windows, setWindows] = useState<AvailabilityWindow[]>(getAvailabilityWindows());

  useEffect(() => {
    setWindows(currentWindows);
    const listener = (next: AvailabilityWindow[]) => setWindows(next);
    windowsListeners.add(listener);
    return () => {
      windowsListeners.delete(listener);
    };
  }, []);

  return windows;
}

let currentLocations: PickupLocation[] = starterLocations;
let locationsStarted = false;
const locationsListeners = new Set<(locations: PickupLocation[]) => void>();

function ensureLocationsStarted() {
  if (locationsStarted || !firebaseConfigured()) return;
  locationsStarted = true;
  watchPickupLocations(
    (remote) => {
      currentLocations = remote.length > 0 ? remote : starterLocations;
      locationsListeners.forEach((listener) => listener(currentLocations));
    },
    () => {
      // Keep serving the current locations if the snapshot fails (offline etc.).
    }
  );
}

export function getPickupLocations(): PickupLocation[] {
  ensureLocationsStarted();
  return currentLocations;
}

export function usePickupLocations(): PickupLocation[] {
  const [locations, setLocations] = useState<PickupLocation[]>(getPickupLocations());

  useEffect(() => {
    setLocations(currentLocations);
    const listener = (next: PickupLocation[]) => setLocations(next);
    locationsListeners.add(listener);
    return () => {
      locationsListeners.delete(listener);
    };
  }, []);

  return locations;
}
