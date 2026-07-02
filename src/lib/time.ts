import type { AvailabilityWindow } from "./types";

const denverDateTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Denver",
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

const denverTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Denver",
  hour: "numeric",
  minute: "2-digit"
});

// en-CA renders as YYYY-MM-DD, giving a sortable/comparable day key in Denver time.
const denverDayKey = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Denver",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export function denverDateKey(iso: string): string {
  return denverDayKey.format(new Date(iso));
}

export function denverTodayKey(): string {
  return denverDayKey.format(new Date());
}

export function formatDenverDateTime(iso: string): string {
  return denverDateTime.format(new Date(iso));
}

export function formatWindow(window: AvailabilityWindow): string {
  return `${formatDenverDateTime(window.startsAtUtc)} - ${denverTime.format(
    new Date(window.endsAtUtc)
  )}`;
}

export function isWindowSelectable(window: AvailabilityWindow, now = new Date()): boolean {
  return (
    window.active &&
    new Date(window.cutoffAtUtc).getTime() > now.getTime() &&
    window.committedOrders < window.capacity
  );
}
