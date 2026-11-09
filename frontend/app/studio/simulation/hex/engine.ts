/**
 * Run: the stamps, through the real engine, twice.
 *
 * Once with only what happens to the city (outbreaks, heat) and once with what
 * the planner chose as well (measures, capacity). Each goes the platform's own
 * way: the declared spreading model writes demand, that demand plus the other
 * effects is stored as an event, and the event is run against the twin with the
 * do-nothing response so the only difference between the two is the stamps.
 *
 * The two stored events are rewritten on every run under fixed names, so the
 * events library gains two entries per scenario, not two per click.
 */

import { ApiError } from "@/lib/auth";
import {
  listSimEvents,
  runSimulation,
  runSpread,
  saveSimEvent,
  type SimDataset,
  type SimEffect,
  type SpreadState,
} from "@/lib/platform-api";

import { engineInput, shiftEffects, type Stamp, type TwinContext, type Variant } from "./stamps";

export interface VariantResult {
  /** [step][facility] occupancy ratio for the chosen activity; NaN where unreported. */
  occupancy: number[][];
  /** Capacity-weighted occupancy over every facility that has the activity. */
  island: number[];
  /** Per catchment, per step: people in the infectious state per 1,000. */
  sick: Record<string, number[]>;
  notes: string[];
}

export interface RunOutput {
  horizon: number;
  activity: string;
  facilityIds: string[];
  events: VariantResult;
  full: VariantResult;
  ranAt: string;
}

/** Rows of the `facilities` table, as a step × facility grid for one activity. */
export function occupancyGrid(
  dataset: SimDataset | undefined,
  facilityIds: string[],
  activity: string,
  horizon: number,
): number[][] {
  const grid = Array.from({ length: horizon }, () => facilityIds.map(() => Number.NaN));
  if (!dataset) return grid;
  const col = (name: string) => dataset.columns.indexOf(name);
  const [cPolicy, cStep, cFac, cAct, cOcc] = ["policy", "step", "facility_id", "activity", "occupancy"].map(col);
  if ([cPolicy, cStep, cFac, cAct, cOcc].some((c) => c === undefined || c < 0)) return grid;
  const where = new Map(facilityIds.map((id, i) => [id, i]));
  // One response was run; if the engine ever returns more, the first one named
  // is the do-nothing run this page asked for.
  const policy = dataset.rows[0]?.[cPolicy!];
  for (const row of dataset.rows) {
    if (row[cPolicy!] !== policy || row[cAct!] !== activity) continue;
    const step = Number(row[cStep!]);
    const f = where.get(String(row[cFac!]));
    if (f === undefined || !(step >= 0 && step < horizon)) continue;
    grid[step]![f] = Number(row[cOcc!]);
  }
  return grid;
}

/** Island-wide occupancy: each facility's ratio weighted by its capacity. */
export function islandSeries(grid: number[][], capacities: number[]): number[] {
  return grid.map((row) => {
    let used = 0;
    let cap = 0;
    row.forEach((r, i) => {
      const c = capacities[i] ?? 0;
      if (!Number.isFinite(r) || c <= 0) return;
      used += r * c;
      cap += c;
    });
    return cap > 0 ? used / cap : Number.NaN;
  });
}

/** The spread's states as infectious per 1,000, placed on the real calendar. */
export function sickSeries(
  states: SpreadState[],
  ctx: Pick<TwinContext, "populations" | "infectious">,
  offset: number,
  horizon: number,
): Record<string, number[]> {
  const size = new Map(ctx.populations.map((p) => [p.id, p.size]));
  const out: Record<string, number[]> = {};
  for (const p of ctx.populations) out[p.id] = new Array(horizon).fill(0);
  if (!ctx.infectious) return out;
  for (const s of states) {
    const day = s.tick + offset;
    const n = size.get(s.population) ?? 0;
    if (!(day >= 0 && day < horizon) || n <= 0 || !out[s.population]) continue;
    out[s.population]![day] = ((s.states[ctx.infectious] ?? 0) / n) * 1000;
  }
  return out;
}

export function engineMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 503)
      return "The simulation service is not reachable from the API. Check that SIM_SERVICE_URL points at a running simulation-service, then run again.";
    return `${err.message} (${err.code})`;
  }
  return err instanceof Error ? err.message : String(err);
}

const EVENT_NAME: Record<Variant, string> = {
  events: "events only",
  full: "with your measures",
};

export async function runScenario(args: {
  env: string;
  scenario: { id: string; name: string };
  stamps: Stamp[];
  ctx: TwinContext;
  horizon: number;
  activity: string;
  onProgress?: (label: string) => void;
}): Promise<RunOutput> {
  const { env, scenario, stamps, ctx, horizon, activity, onProgress } = args;
  const facilityIds = ctx.facilities.map((f) => f.id);
  const capacities = ctx.facilities.map((f) => f.capacity[activity] ?? 0);
  const populationSizes: Record<string, number> = {};
  for (const p of ctx.populations) if (p.size > 0) populationSizes[p.id] = p.size;
  const censusAcuity = ctx.acuities.find((a) => /urg|emerg/i.test(a)) ?? ctx.acuities[0];
  const existing = (await listSimEvents(env)).events;

  const one = async (variant: Variant): Promise<VariantResult> => {
    const input = engineInput(stamps, ctx, variant, horizon);
    let effects: SimEffect[] = [...input.effects];
    let sick: Record<string, number[]> = sickSeries([], ctx, 0, horizon);
    if (input.spread) {
      onProgress?.(`Spreading (${EVENT_NAME[variant]})`);
      const out = await runSpread(env, {
        seeds: input.spread.seeds,
        horizon: input.spread.horizon,
        changes: input.spread.changes,
        twinScenarioId: scenario.id,
      });
      effects = [...shiftEffects(out.event.effects as SimEffect[], input.spread.offset), ...effects];
      sick = sickSeries(out.states, ctx, input.spread.offset, horizon);
    }
    const name = `Hex twin · ${scenario.name} · ${EVENT_NAME[variant]}`;
    const prior = existing.find((e) => e.name === name);
    onProgress?.(`Storing the event (${EVENT_NAME[variant]})`);
    const event = await saveSimEvent(
      env,
      {
        name,
        description: "Written by the Scenarios map from its stamps. Rewritten on every run.",
        horizon,
        effects,
        twinScenarioId: scenario.id,
      },
      prior?.id,
    );
    onProgress?.(`Running the network (${EVENT_NAME[variant]})`);
    const run = await runSimulation(env, {
      eventId: event.id,
      policies: ["null"],
      populationSizes,
      routeCapacity: 20,
      censusAcuity,
      twinScenarioId: scenario.id,
      collect: ["facilities"],
    });
    const grid = occupancyGrid(
      run.datasets?.find((d) => d.name === "facilities"),
      facilityIds,
      activity,
      horizon,
    );
    return { occupancy: grid, island: islandSeries(grid, capacities), sick, notes: input.notes };
  };

  // In sequence: both rewrite events in the same library, and the second run
  // is cheap next to the cost of reasoning about two interleaved failures.
  const events = await one("events");
  const full = await one("full");
  return { horizon, activity, facilityIds, events, full, ranAt: new Date().toISOString() };
}
