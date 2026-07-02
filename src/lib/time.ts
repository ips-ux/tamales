import { getBusinessSettings } from "./businessSettings";
import type { AvailabilityWindow } from "./types";

interface ZoneFormatters {
  dateTime: Intl.DateTimeFormat;
  time: Intl.DateTimeFormat;
  dayKey: Intl.DateTimeFormat;
}

// Intl.DateTimeFormat construction is expensive, so cache per timezone; the
// business timezone is owner-editable and can change at runtime.
const formatterCache = new Map<string, ZoneFormatters>();

function formatters(): ZoneFormatters {
  const timeZone = getBusinessSettings().timezone || "America/Denver";
  let entry = formatterCache.get(timeZone);
  if (!entry) {
    entry = {
      dateTime: new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      }),
      time: new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "numeric",
        minute: "2-digit"
      }),
      // en-CA renders as YYYY-MM-DD, giving a sortable/comparable day key.
      dayKey: new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      })
    };
    formatterCache.set(timeZone, entry);
  }
  return entry;
}

export function businessDateKey(iso: string): string {
  return formatters().dayKey.format(new Date(iso));
}

export function businessTodayKey(): string {
  return formatters().dayKey.format(new Date());
}

export function formatBusinessDateTime(iso: string): string {
  return formatters().dateTime.format(new Date(iso));
}

export function formatWindow(window: AvailabilityWindow): string {
  return `${formatBusinessDateTime(window.startsAtUtc)} - ${formatters().time.format(
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
