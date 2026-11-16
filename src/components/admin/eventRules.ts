// Pure helpers for the Events area: form checks, the stock arithmetic for a
// fixed allotment, the kiosk token, and the exit PIN hash.

import type { EventRecord, KioskTarget, PreorderMode } from "../../../shared/model";
import { utcToZonedInput, zonedInputToUtc } from "./businessDateTime";

export const preorderModeLabels: Record<PreorderMode, string> = {
  off: "Off",
  fixed: "Fixed allotment",
  open: "Open interest"
};

export const kioskTargetLabels: Record<KioskTarget, string> = {
  today: "Today's orders",
  next_batch: "Next batch"
};

export interface EventFormValues {
  name: string;
  areaName: string;
  /** datetime-local values in the business time zone. */
  starts: string;
  ends: string;
  active: boolean;
  /** Checked menu item ids. None checked means all menu items. */
  itemIds: string[];
  preorderMode: PreorderMode;
  cutoff: string;
  /** Text typed for each menu item id, in tamales. */
  allotment: Record<string, string>;
  liveOrdersEnabled: boolean;
  kioskTarget: KioskTarget;
  waitlistEnabled: boolean;
}

export function emptyEventForm(): EventFormValues {
  return {
    name: "",
    areaName: "",
    starts: "",
    ends: "",
    active: true,
    itemIds: [],
    preorderMode: "off",
    cutoff: "",
    allotment: {},
    liveOrdersEnabled: true,
    kioskTarget: "today",
    waitlistEnabled: true
  };
}

export function eventToFormValues(event: EventRecord, timeZone: string): EventFormValues {
  const allotment: Record<string, string> = {};
  for (const [itemId, tamales] of Object.entries(event.allotment)) allotment[itemId] = String(tamales);
  return {
    name: event.name,
    areaName: event.areaName,
    starts: utcToZonedInput(event.startsAtUtc, timeZone),
    ends: utcToZonedInput(event.endsAtUtc, timeZone),
    active: event.active,
    itemIds: [...event.itemIds],
    preorderMode: event.preorderMode,
    cutoff: utcToZonedInput(event.preorderCutoffUtc, timeZone),
    allotment,
    liveOrdersEnabled: event.liveOrdersEnabled,
    kioskTarget: event.kioskTarget,
    waitlistEnabled: event.waitlistEnabled
  };
}

/** The part of an event that the form sets. The store adds the id, the token, the PIN hash and the live controls. */
export type EventFormFields = Pick<
  EventRecord,
  | "name"
  | "areaName"
  | "startsAtUtc"
  | "endsAtUtc"
  | "active"
  | "itemIds"
  | "preorderMode"
  | "preorderCutoffUtc"
  | "allotment"
  | "liveOrdersEnabled"
  | "kioskTarget"
  | "waitlistEnabled"
>;

export interface EventFormResult {
  errors: string[];
  fields: EventFormFields | null;
}

/**
 * Checks the form and builds the event fields.
 * `menuItemIds` are all menu items that the form shows.
 */
export function buildEventFields(
  values: EventFormValues,
  menuItemIds: string[],
  timeZone: string
): EventFormResult {
  const errors: string[] = [];
  const name = values.name.trim();
  const areaName = values.areaName.trim();
  if (!name) errors.push("Enter the event name.");
  if (!areaName) errors.push("Enter the area name.");

  const startsAtUtc = zonedInputToUtc(values.starts, timeZone);
  const endsAtUtc = zonedInputToUtc(values.ends, timeZone);
  if (!startsAtUtc) errors.push("Enter the start date and time.");
  if (!endsAtUtc) errors.push("Enter the end date and time.");
  if (startsAtUtc && endsAtUtc && endsAtUtc <= startsAtUtc) {
    errors.push("Set the end time after the start time.");
  }

  let preorderCutoffUtc = zonedInputToUtc(values.cutoff, timeZone);
  if (values.preorderMode === "off") {
    preorderCutoffUtc = "";
  } else if (!preorderCutoffUtc) {
    errors.push("Enter the pre-order cutoff.");
  } else if (endsAtUtc && preorderCutoffUtc > endsAtUtc) {
    errors.push("Set the pre-order cutoff before the end time.");
  }

  const itemIds = menuItemIds.filter((id) => values.itemIds.includes(id));
  const offered = itemIds.length > 0 ? itemIds : menuItemIds;

  const allotment: Record<string, number> = {};
  if (values.preorderMode === "fixed") {
    let badNumber = false;
    for (const itemId of offered) {
      const text = (values.allotment[itemId] ?? "").trim();
      if (text === "") continue;
      if (!/^\d+$/.test(text)) {
        badNumber = true;
        continue;
      }
      const tamales = Number(text);
      if (tamales > 0) allotment[itemId] = tamales;
    }
    if (badNumber) {
      errors.push("Enter each allotment as a whole number of tamales.");
    } else if (Object.keys(allotment).length === 0) {
      errors.push("Enter an allotment for 1 menu item or more.");
    }
  }

  if (errors.length > 0) return { errors, fields: null };
  return {
    errors,
    fields: {
      name,
      areaName,
      startsAtUtc,
      endsAtUtc,
      active: values.active,
      itemIds,
      preorderMode: values.preorderMode,
      preorderCutoffUtc,
      allotment,
      liveOrdersEnabled: values.liveOrdersEnabled,
      kioskTarget: values.kioskTarget,
      waitlistEnabled: values.waitlistEnabled
    }
  };
}

/**
 * The tamales that remain for pre-order after the owner saves a fixed allotment.
 * `previous` is null on the first save with a fixed allotment: remaining = allotment.
 * On a later save, remaining changes by the same amount as the allotment, and
 * it does not go below 0. A menu item that is new in the allotment starts full.
 */
export function nextRemaining(
  previous: { allotment: Record<string, number>; remaining: Record<string, number> } | null,
  allotment: Record<string, number>
): Record<string, number> {
  const remaining: Record<string, number> = {};
  for (const [itemId, tamales] of Object.entries(allotment)) {
    const before = previous?.allotment[itemId];
    if (!previous || before === undefined) {
      remaining[itemId] = Math.max(0, tamales);
      continue;
    }
    const left = previous.remaining[itemId] ?? before;
    remaining[itemId] = Math.max(0, left + (tamales - before));
  }
  return remaining;
}

/** True when the text is an exit PIN: 4 to 6 digits. */
export function isValidExitPin(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

/** SHA-256 hex of `${eventId}:${pin}`. The kiosk compares it in the browser. */
export async function hashExitPin(eventId: string, pin: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${eventId}:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** 64 hex characters that nobody can guess. */
export function newKioskToken(): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

/** Upcoming events (soonest first) and past events (latest first). An event is past after its end time. */
export function splitEvents(
  events: EventRecord[],
  now: Date
): { upcoming: EventRecord[]; past: EventRecord[] } {
  const nowIso = now.toISOString();
  const upcoming = events
    .filter((event) => event.endsAtUtc >= nowIso)
    .sort((a, b) => a.startsAtUtc.localeCompare(b.startsAtUtc));
  const past = events
    .filter((event) => event.endsAtUtc < nowIso)
    .sort((a, b) => b.startsAtUtc.localeCompare(a.startsAtUtc));
  return { upcoming, past };
}

/**
 * The event that is in its hours now, for the Live POS controls. A paused
 * event still counts, so the owner can turn mobile orders on again.
 * With more than 1 event, the one that ends first wins.
 */
export function currentEvent(events: EventRecord[], now: Date): EventRecord | null {
  const nowIso = now.toISOString();
  const live = events
    .filter((event) => event.active && event.startsAtUtc <= nowIso && nowIso < event.endsAtUtc)
    .sort((a, b) => a.endsAtUtc.localeCompare(b.endsAtUtc));
  return live[0] ?? null;
}

/** Adds or removes 1 id. Returns a new list. */
export function toggleId(ids: string[], id: string, on: boolean): string[] {
  const without = ids.filter((item) => item !== id);
  return on ? [...without, id] : without;
}

export function kioskPath(event: Pick<EventRecord, "kioskToken">): string {
  return `/kiosk/${event.kioskToken}`;
}

export function mobileOrderPath(event: Pick<EventRecord, "id">): string {
  return `/e/${event.id}`;
}
