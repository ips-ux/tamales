// Converts between UTC ISO strings and the value of a datetime-local input,
// in the business time zone. The owner's device can be in a different zone.

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function zonedParts(ms: number, timeZone: string): Parts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(ms))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour % 24,
    minute: parts.minute
  };
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

/** UTC ISO string to "YYYY-MM-DDTHH:mm" in the time zone. Empty when the input is not a date. */
export function utcToZonedInput(iso: string | undefined, timeZone: string): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const parts = zonedParts(ms, timeZone);
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** "YYYY-MM-DDTHH:mm" in the time zone to a UTC ISO string. Empty when the input is not a date and time. */
export function zonedInputToUtc(value: string, timeZone: string): string {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return "";
  const [, year, month, day, hour, minute] = match.map(Number);
  const wallMs = Date.UTC(year, month - 1, day, hour, minute);
  if (Number.isNaN(wallMs)) return "";
  // The offset of the zone at a moment = (wall clock read as UTC) - (the moment).
  const offsetAt = (ms: number) => {
    const parts = zonedParts(ms, timeZone);
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - ms;
  };
  let utcMs = wallMs - offsetAt(wallMs);
  // A second pass corrects a time near a daylight saving change.
  utcMs = wallMs - offsetAt(utcMs);
  return new Date(utcMs).toISOString();
}
