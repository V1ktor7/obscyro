/**
 * The run on screen, as the analyst is given it.
 *
 * The analyst answers from what tools return, and the run lives in this page:
 * two step × site grids the engine sent back. This reduces them to what a
 * question can be about — the island's curve, each site's queue, arrivals —
 * using the same functions the Result panel reads, so the analyst and the panel
 * cannot disagree about a figure.
 *
 * Day-by-day series travel only for the sites where somebody waits. A site
 * that held has nothing to explain, and thirty flat curves are thirty curves
 * nobody asked about.
 */

import type { RunDigest, RunDigestSiteBreak, RunDigestVariant } from "../../analyst-api";

import type { RunOutput, VariantResult } from "./engine";
import { seriesOf, siteBreaks, strandedCatchments, summarise, waitingElsewhere, type SiteBreak } from "./results";
import type { TwinContext } from "./stamps";

const finite = (v: number | undefined, digits = 4): number | null => {
  if (v === undefined || !Number.isFinite(v)) return null;
  const k = 10 ** digits;
  return Math.round(v * k) / k;
};
const num = (v: number, digits = 4): number => finite(v, digits) ?? 0;

function breakOf(b: SiteBreak): RunDigestSiteBreak {
  return {
    firstDay: b.firstDay,
    days: b.days,
    peakWaiting: num(b.peakWaiting, 2),
    peakDay: b.peakDay,
    waitingDays: num(b.waitingDays, 2),
    peakOccupancy: num(b.peakOccupancy),
  };
}

export function runDigest(
  run: RunOutput,
  ctx: Pick<TwinContext, "facilities" | "populations" | "care">,
  stale: boolean,
): RunDigest {
  const acuity = ctx.care.find((c) => c.activity === run.activity)?.acuity ?? null;
  const stranded = strandedCatchments(ctx.populations, ctx.facilities, run.activity);
  const breaksEvents = siteBreaks(run.events, ctx.facilities, run.activity);
  const breaksFull = siteBreaks(run.full, ctx.facilities, run.activity);
  const fullByIndex = new Map(breaksFull.map((b) => [b.index, b]));

  const variant = (v: VariantResult, breaks: SiteBreak[]): RunDigestVariant => {
    const s = summarise(breaks, v);
    const elsewhere = stranded ? waitingElsewhere(v, breaks, acuity) : null;
    return {
      island: v.island.map((x) => finite(x)),
      sitesWithQueue: s.sites,
      sitesWithActivity: s.of,
      firstQueueDay: s.firstDay,
      waitingDays: num(s.waitingDays, 2),
      peakWaiting: num(s.peakWaiting, 2),
      peakWaitingDay: s.peakDay,
      strandedWaitingDays: elsewhere === null ? null : num(elsewhere, 2),
      arrivals: Object.fromEntries(Object.entries(v.arrivals).map(([k, xs]) => [k, xs.map((x) => num(x, 2))])),
      notes: v.notes,
    };
  };

  return {
    ranAt: run.ranAt,
    stale,
    horizon: run.horizon,
    activity: run.activity,
    events: variant(run.events, breaksEvents),
    full: variant(run.full, breaksFull),
    sites: breaksEvents.map((e) => {
      const f = fullByIndex.get(e.index) ?? e;
      const waits = e.firstDay !== null || f.firstDay !== null;
      return {
        id: e.id,
        name: e.name,
        capacity: e.capacity,
        events: breakOf(e),
        full: breakOf(f),
        daily: waits
          ? {
              occupancyEvents: seriesOf(run.events.occupancy, e.index).map((x) => finite(x)),
              occupancyFull: seriesOf(run.full.occupancy, e.index).map((x) => finite(x)),
              waitingEvents: seriesOf(run.events.waiting, e.index).map((x) => finite(x, 2)),
              waitingFull: seriesOf(run.full.waiting, e.index).map((x) => finite(x, 2)),
            }
          : null,
      };
    }),
    stranded,
  };
}
