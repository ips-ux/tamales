export function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function zoneLabel(timeZone: string): string {
  return timeZone === "America/Denver" ? "MT" : timeZone;
}

function clean(value: string): string {
  // Some ICU versions put a narrow no-break space before AM or PM.
  return value.replace(/[  ]/g, " ");
}

function safeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "America/Denver";
  }
}

function formatTime(date: Date, zone: string): string {
  return clean(new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(date));
}

function formatDay(date: Date, zone: string): string {
  return clean(
    new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", month: "short", day: "numeric" }).format(date)
  );
}

/** "Sat, Nov 14, 5:00 PM MT" */
export function formatDateTime(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const zone = safeZone(timeZone);
  return `${formatDay(date, zone)}, ${formatTime(date, zone)} ${zoneLabel(zone)}`;
}

/** "Sat, Nov 14, 5:00 PM - 8:00 PM MT" */
export function formatRange(startIso: string, endIso: string, timeZone: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime())) return "";
  if (Number.isNaN(end.getTime())) return formatDateTime(startIso, timeZone);
  const zone = safeZone(timeZone);
  return `${formatDay(start, zone)}, ${formatTime(start, zone)} - ${formatTime(end, zone)} ${zoneLabel(zone)}`;
}

/** "2026-11-14" in the given time zone. */
export function dateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: safeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}
