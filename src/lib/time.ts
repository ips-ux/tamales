import { getBusinessSettings } from "./businessSettings";
import type { AvailabilityWindow, FulfillmentType } from "./types";

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

export function formatWindow(window: Pick<AvailabilityWindow, "startsAtUtc" | "endsAtUtc">): string {
  return `${formatBusinessDateTime(window.startsAtUtc)} - ${formatters().time.format(
    new Date(window.endsAtUtc)
  )}`;
}

export function formatWeekday(iso: string): string {
  const timeZone = getBusinessSettings().timezone || "America/Denver";
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(new Date(iso));
}

export function formatTimeRange(window: Pick<AvailabilityWindow, "startsAtUtc" | "endsAtUtc">): string {
  return `${formatters().time.format(new Date(window.startsAtUtc))} - ${formatters().time.format(
    new Date(window.endsAtUtc)
  )}`;
}

// A pre-order can be placed for a window when: the owner has it active and
// hasn't turned pre-orders off for it, it hasn't started yet, its calendar
// day (in business time) hasn't arrived yet — the day of the event is
// walk-up/in-person only regardless of the toggle — its explicit cutoff (if
// any) hasn't passed, and it isn't already full.
export function isWindowSelectable(window: AvailabilityWindow, now = new Date()): boolean {
  if (!window.active || !window.preordersEnabled) return false;
  const startMs = new Date(window.startsAtUtc).getTime();
  if (startMs <= now.getTime()) return false;
  if (businessDateKey(window.startsAtUtc) === businessDateKey(now.toISOString())) return false;
  if (new Date(window.cutoffAtUtc).getTime() <= now.getTime()) return false;
  return window.committedOrders < window.capacity;
}

/**
 * The next upcoming windows for a fulfillment type, soonest first. Used both
 * to detect that nothing is currently bookable (empty result after filtering
 * to selectable windows) and to advertise what's coming up otherwise.
 */
export function nextAvailableWindows(
  windows: AvailabilityWindow[],
  fulfillmentType: FulfillmentType,
  count = 3,
  now = new Date()
): AvailabilityWindow[] {
  return windows
    .filter((window) => window.fulfillmentType === fulfillmentType && isWindowSelectable(window, now))
    .sort((a, b) => new Date(a.startsAtUtc).getTime() - new Date(b.startsAtUtc).getTime())
    .slice(0, count);
}

/**
 * The soonest active event that hasn't ended yet, regardless of whether
 * pre-orders are currently open for it — this is "what's next" for display
 * (homepage badge, admin summary), distinct from whether it's bookable.
 */
export function nextUpcomingEvent(
  windows: AvailabilityWindow[],
  now = new Date()
): AvailabilityWindow | undefined {
  return [...windows]
    .filter((window) => window.active && new Date(window.endsAtUtc).getTime() >= now.getTime())
    .sort((a, b) => new Date(a.startsAtUtc).getTime() - new Date(b.startsAtUtc).getTime())[0];
}
