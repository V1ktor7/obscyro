/**
 * Where validated events sit on a scenario's timeline.
 *
 * The timeline counts days from 0; an event has calendar dates. The two meet
 * only when the scenario says which date day 0 is (its reality check). Without
 * that there is nothing honest to draw, and the lane says so instead.
 */

import type { HealthEvent } from "../../analyst-api";

const DAY_MS = 86_400_000;

/** How many days after `origin` a date falls; negative when it is before. */
export function dayOf(origin: string, date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${origin}T00:00:00Z`)) / DAY_MS);
}

export interface PlacedEvent {
  event: HealthEvent;
  /** First day shown, on the run's axis. */
  start: number;
  /** Days shown, at least one. */
  days: number;
  /** Which line of the lane it sits on, so two events over the same days do not cover each other. */
  row: number;
  /** It started before day 0, or goes on past the last day: the bar is cut. */
  startsBefore: boolean;
  endsAfter: boolean;
}

/**
 * The events that touch the days a scenario runs over, each on a line where it
 * overlaps no other.
 *
 * `outside` counts the validated events that fall wholly before day 0 or after
 * the last day: they exist, they are just not in this window.
 */
export function placeEvents(events: readonly HealthEvent[], origin: string, horizon: number): { placed: PlacedEvent[]; rows: number; outside: number } {
  const last = horizon - 1;
  const inside: Omit<PlacedEvent, "row">[] = [];
  let outside = 0;
  for (const event of events) {
    const from = dayOf(origin, event.startsOn);
    const to = dayOf(origin, event.endsOn ?? event.startsOn);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < 0 || from > last) {
      outside += 1;
      continue;
    }
    const start = Math.max(0, from);
    const end = Math.min(last, to);
    inside.push({ event, start, days: end - start + 1, startsBefore: from < 0, endsAfter: to > last });
  }
  inside.sort((a, b) => a.start - b.start || b.days - a.days);

  // First line that is free again by the time this one starts.
  const busyUntil: number[] = [];
  const placed = inside.map((p) => {
    let row = busyUntil.findIndex((end) => end < p.start);
    if (row < 0) row = busyUntil.length;
    busyUntil[row] = p.start + p.days - 1;
    return { ...p, row };
  });
  return { placed, rows: busyUntil.length, outside };
}
