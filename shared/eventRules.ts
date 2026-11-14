// When an event takes orders. See docs/V1_FUNDAMENTALS.md sections 5 and 8.

import type { EventRecord } from "./model";

type Moment = Date | string | number;

function ms(value: Moment): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/** True from the start time up to, but not at, the end time, if live orders are on and not paused. */
export function eventIsLive(
  event: Pick<EventRecord, "active" | "liveOrdersEnabled" | "liveOrdersPaused" | "startsAtUtc" | "endsAtUtc">,
  now: Moment
): boolean {
  if (event.active !== true || event.liveOrdersEnabled !== true || event.liveOrdersPaused === true) return false;
  const at = ms(now);
  const start = ms(event.startsAtUtc);
  const end = ms(event.endsAtUtc);
  if (Number.isNaN(at) || Number.isNaN(start) || Number.isNaN(end)) return false;
  return at >= start && at < end;
}

/**
 * True before the pre-order cutoff and before the event starts, if the mode is not "off".
 * An event with no cutoff takes pre-orders until it starts.
 */
export function preorderIsOpen(
  event: Pick<EventRecord, "active" | "preorderMode" | "preorderCutoffUtc" | "startsAtUtc">,
  now: Moment
): boolean {
  if (event.active !== true) return false;
  if (event.preorderMode !== "fixed" && event.preorderMode !== "open") return false;
  const at = ms(now);
  const start = ms(event.startsAtUtc);
  if (Number.isNaN(at) || Number.isNaN(start) || at >= start) return false;
  if (!event.preorderCutoffUtc) return true;
  const cutoff = ms(event.preorderCutoffUtc);
  if (Number.isNaN(cutoff)) return false;
  return at < cutoff;
}

/** The menu item ids for sale at the event. An empty `itemIds` means all active menu items. */
export function eventItemIds(event: Pick<EventRecord, "itemIds">, allActiveItemIds: string[]): string[] {
  const selected = event.itemIds ?? [];
  if (selected.length === 0) return [...allActiveItemIds];
  return allActiveItemIds.filter((id) => selected.includes(id));
}
