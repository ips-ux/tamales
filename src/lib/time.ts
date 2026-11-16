import { getBusinessSettings } from "./businessSettings";

/** Anything with a start and an end, for example an event. */
interface TimeSpan {
  startsAtUtc: string;
  endsAtUtc: string;
}

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

export function formatWindow(window: TimeSpan): string {
  return `${formatBusinessDateTime(window.startsAtUtc)} - ${formatters().time.format(
    new Date(window.endsAtUtc)
  )}`;
}

export function formatWeekday(iso: string): string {
  const timeZone = getBusinessSettings().timezone || "America/Denver";
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(new Date(iso));
}

export function formatTimeRange(window: TimeSpan): string {
  return `${formatters().time.format(new Date(window.startsAtUtc))} - ${formatters().time.format(
    new Date(window.endsAtUtc)
  )}`;
}
