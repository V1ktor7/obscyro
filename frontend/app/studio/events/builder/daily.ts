/**
 * Arrivals a model wrote one day at a time.
 *
 * The spreading model and the Scenarios map do not write "arrivals rise by 30 %
 * from day 10": they write what each territory sends on each day, one change
 * per territory, severity and day. A 60-day outbreak over twelve territories is
 * 1,440 changes, and reading them as 1,440 sentences tells nobody anything.
 *
 * Read back, they are one curve per severity: how many arrive each day, and
 * where. The changes themselves are untouched — this is only how they read.
 */

import type { SimEffect } from "@/lib/platform-api";

export interface DailySeries {
  acuity: string;
  /** Territories it sends from, in the order first met. */
  pops: string[];
  first: number;
  last: number;
  /** Arrivals on each day from `first`, summed over the territories. */
  perDay: number[];
  /** How many stored changes this one line stands for. */
  count: number;
}

/** Fewer than this many day-by-day changes still read fine one by one. */
const MIN_CHANGES = 8;

function dailyAcuity(e: SimEffect): string | null {
  if (e.target !== "demand.incidence" || e.op !== "add" || e.builder || e.spatial) return null;
  const p = e.profile;
  if (!p || p.shape !== "step" || p.end == null || p.end !== p.start) return null;
  const used = Object.entries(e.select).filter(([, v]) => (v || []).length).map(([k]) => k);
  if (used.some((k) => k !== "acuity" && k !== "population")) return null;
  const acuity = e.select.acuity || [], pops = e.select.population || [];
  return acuity.length === 1 && pops.length === 1 ? acuity[0]! : null;
}

export function dailySeries(
  effects: SimEffect[],
  sizeOf: (population: string) => number,
): { series: DailySeries[]; rest: SimEffect[] } {
  const byAcuity = new Map<string, SimEffect[]>();
  for (const e of effects) {
    const a = dailyAcuity(e);
    if (a) byAcuity.set(a, [...(byAcuity.get(a) || []), e]);
  }
  const grouped = new Set<SimEffect>();
  const series: DailySeries[] = [];
  for (const [acuity, es] of Array.from(byAcuity)) {
    if (es.length < MIN_CHANGES) continue;
    const first = Math.min(...es.map((e) => e.profile.start));
    const last = Math.max(...es.map((e) => e.profile.start));
    const perDay = new Array<number>(last - first + 1).fill(0);
    const pops: string[] = [];
    for (const e of es) {
      const pop = e.select.population![0]!;
      if (!pops.includes(pop)) pops.push(pop);
      perDay[e.profile.start - first]! += (Number(e.value) || 0) * (sizeOf(pop) / 1000);
      grouped.add(e);
    }
    series.push({ acuity, pops, first, last, perDay, count: es.length });
  }
  return { series, rest: effects.filter((e) => !grouped.has(e)) };
}

/** The day it peaks and how many arrive then, and the total. */
export function seriesSummary(s: DailySeries): { peak: number; peakDay: number; total: number } {
  let peak = 0, peakDay = s.first, total = 0;
  s.perDay.forEach((v, i) => {
    total += v;
    if (v > peak) { peak = v; peakDay = s.first + i; }
  });
  return { peak, peakDay, total };
}

/**
 * One step change spanning the series, so the timeline draws it as one bar.
 * Drawn only, never sent: the timeline reads the profile, not the value.
 */
export function seriesBar(s: DailySeries): SimEffect {
  return {
    id: `daily-${s.acuity}`,
    target: "demand.incidence",
    select: { acuity: [s.acuity], population: s.pops },
    op: "add",
    value: 1,
    profile: { start: s.first, end: s.last, shape: "step", peak: 1 },
  } as SimEffect;
}
