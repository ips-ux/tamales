// The phone keeps the order tracker of an open order in local storage.
// Other pages call `activeTrackerToken()` to link back to /t/{trackerToken}.
// See docs/V1_FUNDAMENTALS.md section 9.

import { isTrackerToken } from "./trackerRules";

const STORAGE_KEY = "bbt:tracker";
/** An entry older than this is ignored. */
export const RESUME_MAX_AGE_MS = 48 * 60 * 60 * 1000;

export interface ResumeEntry {
  trackerToken: string;
  /** Milliseconds since 1970, from `Date.now()`. */
  savedAt: number;
}

/** Reads the stored text. Returns null for text that is not a valid entry or is too old. */
export function parseResume(raw: string | null, nowMs: number): ResumeEntry | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ResumeEntry> | null;
    if (!value || typeof value.trackerToken !== "string" || typeof value.savedAt !== "number") return null;
    if (!isTrackerToken(value.trackerToken)) return null;
    const age = nowMs - value.savedAt;
    if (!Number.isFinite(age) || age < 0 || age > RESUME_MAX_AGE_MS) return null;
    return { trackerToken: value.trackerToken, savedAt: value.savedAt };
  } catch {
    return null;
  }
}

/** The tracker token of the open order on this phone, or null. */
export function activeTrackerToken(nowMs = Date.now()): string | null {
  try {
    return parseResume(window.localStorage.getItem(STORAGE_KEY), nowMs)?.trackerToken ?? null;
  } catch {
    return null;
  }
}

/** The path of the order tracker for the open order on this phone, or null. */
export function activeTrackerPath(nowMs = Date.now()): string | null {
  const token = activeTrackerToken(nowMs);
  return token ? `/t/${token}` : null;
}

/** Saves the tracker of an order that is not in a final state. */
export function saveActiveTracker(trackerToken: string, nowMs = Date.now()): void {
  try {
    const entry: ResumeEntry = { trackerToken, savedAt: nowMs };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // Private mode or full storage. The tracker still works on this page.
  }
}

/** Removes the entry. With a token, removes it only if the entry is for that order. */
export function clearActiveTracker(trackerToken?: string): void {
  try {
    if (trackerToken) {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const stored = raw ? (JSON.parse(raw) as Partial<ResumeEntry> | null) : null;
      if (stored && stored.trackerToken !== trackerToken) return;
    }
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}
