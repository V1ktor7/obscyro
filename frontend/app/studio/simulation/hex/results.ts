/**
 * Where a run breaks, and when.
 *
 * A peak of 96 % across every site says the network held. It does not say that
 * four hospitals were full for three weeks while the others had room, and that
 * is the part somebody has to act on. Occupancy cannot say it either: it stops
 * at 100 % and is silent about who was turned away. What says it is the queue —
 * people still waiting for the unit when the day ends — read site by site.
 *
 * Everything here is counted from the engine's own table. Nothing is estimated.
 */

import type { VariantResult } from "./engine";

/** A queue smaller than this is arithmetic, not a person waiting. */
export const QUEUE = 0.5;

export interface SiteBreak {
  /** Position in the twin's facility list. */
  index: number;
  id: string;
  name: string;
  /** Units the site holds for the activity, before anything is added. */
  capacity: number;
  /** First day somebody waits there; null when nobody ever does. */
  firstDay: number | null;
  /** Days on which somebody waits. */
  days: number;
  /** The most people waiting at once, and the day it happens. */
  peakWaiting: number;
  peakDay: number;
  /** People waiting, summed over the days: one person waiting three days counts three. */
  waitingDays: number;
  peakOccupancy: number;
}

export interface Summary {
  /** Sites where somebody waits at some point. */
  sites: number;
  /** Sites that provide the activity at all. */
  of: number;
  firstDay: number | null;
  waitingDays: number;
  /** The most people waiting across every site on one day, and that day. */
  peakWaiting: number;
  peakDay: number;
}

export function siteBreaks(
  v: Pick<VariantResult, "occupancy" | "waiting">,
  facilities: { id: string; name: string; capacity: Record<string, number> }[],
  activity: string,
): SiteBreak[] {
  const out: SiteBreak[] = [];
  facilities.forEach((f, index) => {
    const capacity = f.capacity[activity] ?? 0;
    if (capacity <= 0) return;
    let firstDay: number | null = null;
    let days = 0;
    let peakWaiting = 0;
    let peakDay = 0;
    let waitingDays = 0;
    let peakOccupancy = 0;
    v.waiting.forEach((row, t) => {
      const w = row[index];
      const occ = v.occupancy[t]?.[index];
      if (occ !== undefined && Number.isFinite(occ) && occ > peakOccupancy) peakOccupancy = occ;
      if (w === undefined || !Number.isFinite(w) || w < QUEUE) return;
      if (firstDay === null) firstDay = t;
      days += 1;
      waitingDays += w;
      if (w > peakWaiting) {
        peakWaiting = w;
        peakDay = t;
      }
    });
    out.push({ index, id: f.id, name: f.name, capacity, firstDay, days, peakWaiting, peakDay, waitingDays, peakOccupancy });
  });
  return out;
}

export function summarise(breaks: SiteBreak[], v: Pick<VariantResult, "waiting">): Summary {
  const broken = breaks.filter((b) => b.firstDay !== null);
  const watched = new Set(breaks.map((b) => b.index));
  let peakWaiting = 0;
  let peakDay = 0;
  v.waiting.forEach((row, t) => {
    let total = 0;
    row.forEach((w, i) => {
      if (watched.has(i) && Number.isFinite(w) && w >= QUEUE) total += w;
    });
    if (total > peakWaiting) {
      peakWaiting = total;
      peakDay = t;
    }
  });
  return {
    sites: broken.length,
    of: breaks.length,
    firstDay: broken.length ? Math.min(...broken.map((b) => b.firstDay!)) : null,
    waitingDays: broken.reduce((a, b) => a + b.waitingDays, 0),
    peakWaiting,
    peakDay,
  };
}

export interface BreakRow {
  index: number;
  id: string;
  name: string;
  capacity: number;
  /** The same site in each run. */
  events: SiteBreak;
  full: SiteBreak;
}

/**
 * Both runs side by side, worst first.
 *
 * Only sites where somebody waits in at least one run: a list of every site
 * that held is a list nobody reads. Ordered by when the planner's own run
 * breaks, then by how badly, so the top of the list is where to act first; a
 * site the choices fully relieved sinks below the ones still in trouble.
 */
export function breakRows(events: SiteBreak[], full: SiteBreak[]): BreakRow[] {
  const byIndex = new Map(full.map((b) => [b.index, b]));
  const rows: BreakRow[] = [];
  for (const e of events) {
    const f = byIndex.get(e.index);
    if (!f || (e.firstDay === null && f.firstDay === null)) continue;
    rows.push({ index: e.index, id: e.id, name: e.name, capacity: e.capacity, events: e, full: f });
  }
  const day = (b: SiteBreak) => (b.firstDay === null ? Number.POSITIVE_INFINITY : b.firstDay);
  return rows.sort(
    (a, b) =>
      day(a.full) - day(b.full) ||
      b.full.waitingDays - a.full.waitingDays ||
      day(a.events) - day(b.events) ||
      b.events.waitingDays - a.events.waitingDays ||
      a.name.localeCompare(b.name),
  );
}

/** One site's series out of a step × facility grid. */
export function seriesOf(grid: number[][], index: number): number[] {
  return grid.map((row) => row[index] ?? Number.NaN);
}

/** People, rounded the way a person reads them: 0.4 of a patient is "under 1". */
export function people(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n > 0 && n < 1) return "under 1";
  return Math.round(n).toLocaleString("en-CA");
}
