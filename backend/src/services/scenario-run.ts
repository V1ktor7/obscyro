import type { RunDigest } from "./analyst-tools.js";
import { proxyToSimService } from "./ml-simulation.js";
import {
  engineInput,
  shiftEffects,
  twinContext,
  type SimEffect,
  type Stamp,
  type TwinContext,
  type Variant,
} from "./scenario-stamps.js";
import { spreadPayload, type SpreadPayload } from "./spread-payload.js";
import type { SimExport } from "./twin-export.js";

/**
 * A scenario's run, on the server.
 *
 * The Scenarios page runs a scenario from the browser: it turns the stamps
 * into engine input, asks for the spread, stores the event, runs the network
 * with the do-nothing response, twice, and reads the two tables that come back
 * (`frontend/app/studio/simulation/hex/engine.ts`, `results.ts`,
 * `run-digest.ts`). This does the same from here, so an option can be tested
 * by the engine when the one asking is the analyst rather than a person
 * pressing Run.
 *
 * What it must hold to: the same scenario gives the same figures here and on
 * the page. The functions below mirror the page's line for line, and
 * `scenario-run.unit.test.ts` reads the same fixture the page's test reads.
 *
 * Two things differ, on purpose. Nothing is stored: a tested option is not an
 * event in the organisation's library, and the analyst writes nothing. And the
 * twin is read once per question rather than once per engine call.
 */

// ---------------------------------------------------------------------------
// The engine, as this file calls it.
// ---------------------------------------------------------------------------

/** One table of a run, as the engine returns it. */
export interface SimDataset {
  name: string;
  columns: string[];
  rows: Array<Array<string | number | boolean | null>>;
}

export interface ComparePayload {
  system: SimExport;
  template: null;
  event: { id: string; name: string; description: string; horizon: number; effects: SimEffect[] };
  policies: string[];
  custom_policies: never[];
  seed: null;
  population_sizes: Record<string, number>;
  route_capacity: number;
  census_acuity: string | null;
  baseline_occupancy: Record<string, number>;
  collect: string[];
}

/** The two calls a run makes. Narrow, so a test can stand in for the simulation service. */
export interface ScenarioEngine {
  spread(payload: SpreadPayload): Promise<{ event: { effects: SimEffect[] } }>;
  compare(payload: ComparePayload): Promise<{ datasets?: SimDataset[] }>;
}

export const simServiceEngine: ScenarioEngine = {
  spread: (payload) => proxyToSimService("/events/spread", payload),
  compare: (payload) => proxyToSimService("/events/compare", payload),
};

// ---------------------------------------------------------------------------
// Reading the engine's tables. Mirrors the page's `engine.ts`.
// ---------------------------------------------------------------------------

export interface VariantResult {
  /** [step][facility] occupancy ratio for the chosen activity; NaN where unreported. */
  occupancy: number[][];
  /** [step][facility] people waiting for the chosen activity at the end of the step. */
  waiting: number[][];
  /** [step][facility] units of the chosen activity the site holds in this run. */
  capacity: number[][];
  /** Arrivals per step across every catchment, by severity. */
  arrivals: Record<string, number[]>;
  /** People left unserved at the end of each step, by severity. */
  unmet: Record<string, number[]>;
  /** Capacity-weighted occupancy over every facility that has the activity. */
  island: number[];
  notes: string[];
}

export interface RunOutput {
  horizon: number;
  activity: string;
  events: VariantResult;
  full: VariantResult;
  ranAt: string;
}

export function occupancyGrid(
  dataset: SimDataset | undefined,
  facilityIds: string[],
  activity: string,
  horizon: number,
  column: "occupancy" | "waiting" = "occupancy",
): number[][] {
  const grid = Array.from({ length: horizon }, () => facilityIds.map(() => Number.NaN));
  if (!dataset) return grid;
  const col = (name: string) => dataset.columns.indexOf(name);
  const [cPolicy, cStep, cFac, cAct, cOcc] = ["policy", "step", "facility_id", "activity", column].map(col);
  if ([cPolicy, cStep, cFac, cAct, cOcc].some((c) => c === undefined || c < 0)) return grid;
  const where = new Map(facilityIds.map((id, i) => [id, i]));
  // One response was run; the first one named is the do-nothing run asked for.
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

/**
 * Units of an activity each site holds at each step of one run: the usual
 * capacity, plus what the planner added, in the full run only and only from
 * the day it opens.
 */
export function capacityGrid(
  facilities: { id: string; capacity: Record<string, number> }[],
  stamps: Stamp[],
  variant: Variant,
  activity: string,
  horizon: number,
): number[][] {
  const added = stamps.filter(
    (s): s is Stamp & { kind: "capacity" } => variant === "full" && s.kind === "capacity" && s.activity === activity,
  );
  return Array.from({ length: horizon }, (_, t) =>
    facilities.map((f) => {
      const base = f.capacity[activity] ?? 0;
      const extra = added.filter((s) => s.facility === f.id && t >= s.start).reduce((a, s) => a + s.amount, 0);
      return Math.max(0, base + extra);
    }),
  );
}

/** One family of columns of the `steps` table, per step and severity. */
export function stepsBySeverity(
  dataset: SimDataset | undefined,
  horizon: number,
  prefix: "arrived_" | "served_" | "unmet_",
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  if (!dataset) return out;
  const cPolicy = dataset.columns.indexOf("policy");
  const cStep = dataset.columns.indexOf("step");
  if (cPolicy < 0 || cStep < 0) return out;
  const cols = dataset.columns
    .map((name, i) => ({ name, i }))
    .filter((c) => c.name.startsWith(prefix))
    .map((c) => ({ acuity: c.name.slice(prefix.length), i: c.i }));
  for (const c of cols) out[c.acuity] = new Array<number>(horizon).fill(0);
  const policy = dataset.rows[0]?.[cPolicy];
  for (const row of dataset.rows) {
    if (row[cPolicy] !== policy) continue;
    const step = Number(row[cStep]);
    if (!(step >= 0 && step < horizon)) continue;
    for (const c of cols) out[c.acuity]![step] = Number(row[c.i]) || 0;
  }
  return out;
}

/** Island-wide occupancy: each facility's ratio weighted by its capacity that day. */
export function islandSeries(grid: number[][], capacities: number[][]): number[] {
  return grid.map((row, t) => {
    let used = 0;
    let cap = 0;
    const caps = capacities[t] ?? [];
    row.forEach((r, i) => {
      const c = caps[i] ?? 0;
      if (!Number.isFinite(r) || c <= 0) return;
      used += r * c;
      cap += c;
    });
    return cap > 0 ? used / cap : Number.NaN;
  });
}

// ---------------------------------------------------------------------------
// Where a run breaks. Mirrors the page's `results.ts`.
// ---------------------------------------------------------------------------

/** A queue smaller than this is arithmetic, not a person waiting. */
export const QUEUE = 0.5;

export interface SiteBreak {
  index: number;
  id: string;
  name: string;
  capacity: number;
  firstDay: number | null;
  days: number;
  peakWaiting: number;
  peakDay: number;
  waitingDays: number;
  peakOccupancy: number;
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

interface Summary {
  sites: number;
  of: number;
  firstDay: number | null;
  waitingDays: number;
  peakWaiting: number;
  peakDay: number;
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

/** Catchments none of whose sites provides the activity. */
export function strandedCatchments(
  populations: { name: string; size: number; servedBy: string[] }[],
  facilities: { id: string; capacity: Record<string, number> }[],
  activity: string,
): { names: string[]; residents: number } | null {
  const able = new Set(facilities.filter((f) => (f.capacity[activity] ?? 0) > 0).map((f) => f.id));
  const out = populations.filter((p) => p.size > 0 && !p.servedBy.some((id) => able.has(id)));
  return out.length ? { names: out.map((p) => p.name), residents: out.reduce((a, p) => a + p.size, 0) } : null;
}

/** People waiting where no list shows them, summed over the days. Never below zero. */
export function waitingElsewhere(
  v: Pick<VariantResult, "waiting" | "unmet">,
  breaks: SiteBreak[],
  acuity: string | null,
): number | null {
  const unmet = acuity ? v.unmet[acuity] : undefined;
  if (!unmet) return null;
  const watched = new Set(breaks.map((b) => b.index));
  let total = 0;
  v.waiting.forEach((row, t) => {
    let seen = 0;
    row.forEach((w, i) => {
      if (watched.has(i) && Number.isFinite(w)) seen += w;
    });
    total += Math.max(0, (unmet[t] ?? 0) - seen);
  });
  return total;
}

const seriesOf = (grid: number[][], index: number): number[] => grid.map((row) => row[index] ?? Number.NaN);

// ---------------------------------------------------------------------------
// The run as the analyst is given it. Mirrors the page's `run-digest.ts`.
// ---------------------------------------------------------------------------

const finite = (v: number | undefined, digits = 4): number | null => {
  if (v === undefined || !Number.isFinite(v)) return null;
  const k = 10 ** digits;
  return Math.round(v * k) / k;
};
const num = (v: number, digits = 4): number => finite(v, digits) ?? 0;

function breakOf(b: SiteBreak): RunDigest["sites"][number]["events"] {
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

  const variant = (v: VariantResult, breaks: SiteBreak[]): RunDigest["events"] => {
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

// ---------------------------------------------------------------------------
// The run.
// ---------------------------------------------------------------------------

const EVENT_NAME: Record<Variant, string> = {
  events: "events only",
  full: "with your measures",
};

/** What the page sends for a route whose flow the twin does not hold. */
const ROUTE_CAPACITY = 20;

export interface ScenarioWorld {
  /** The twin as it stands: what the page builds its map and its context from. */
  reality: SimExport;
  /** The same twin read through the scenario: what the engine is sent. */
  system: SimExport;
  scenario: { id: string; name: string };
  horizon: number;
  activity: string;
}

/**
 * Runs for one scenario, with the parts that cannot change kept between them.
 *
 * Testing three options against a scenario is one events-only run, one run of
 * the scenario as it stands, and one run per option: the events-only run never
 * sees a choice, so it is the same for all of them. A spread is kept by what
 * was asked of it, so an option that only adds beds does not integrate the
 * epidemic a second time.
 */
export class ScenarioRunner {
  readonly ctx: TwinContext;
  private readonly spreads = new Map<string, Promise<SimEffect[]>>();
  private eventsRun: Promise<VariantResult> | null = null;
  /** Engine calls made so far: what a tested option costs. */
  calls = 0;

  constructor(
    private readonly engine: ScenarioEngine,
    private readonly world: ScenarioWorld,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.ctx = twinContext(world.reality);
  }

  private spread(input: NonNullable<ReturnType<typeof engineInput>["spread"]>): Promise<SimEffect[]> {
    const body = { seeds: input.seeds, horizon: input.horizon, changes: input.changes };
    const key = JSON.stringify(body);
    let p = this.spreads.get(key);
    if (!p) {
      this.calls += 1;
      p = this.engine
        .spread(spreadPayload(this.world.system, body))
        .then((out) => shiftEffects(out.event.effects, input.offset));
      this.spreads.set(key, p);
    }
    return p;
  }

  /** One pass of the engine over a set of stamps. */
  async variant(stamps: Stamp[], variant: Variant): Promise<VariantResult> {
    const { ctx, world } = this;
    const { horizon, activity } = world;
    const input = engineInput(stamps, ctx, variant, horizon);
    let effects: SimEffect[] = [...input.effects];
    if (input.spread) effects = [...(await this.spread(input.spread)), ...effects];

    const populationSizes: Record<string, number> = {};
    for (const p of ctx.populations) if (p.size > 0) populationSizes[p.id] = p.size;
    const censusAcuity = ctx.acuities.find((a) => /urg|emerg/i.test(a)) ?? ctx.acuities[0] ?? null;

    this.calls += 1;
    const run = await this.engine.compare({
      system: world.system,
      template: null,
      event: {
        id: `scenario-${world.scenario.id}-${variant}`,
        name: `Hex twin · ${world.scenario.name} · ${EVENT_NAME[variant]}`,
        description: "Run on the server for the analyst. Not stored.",
        horizon,
        effects,
      },
      policies: ["null"],
      custom_policies: [],
      seed: null,
      population_sizes: populationSizes,
      route_capacity: ROUTE_CAPACITY,
      census_acuity: censusAcuity,
      baseline_occupancy: input.occupancy,
      collect: ["facilities", "steps"],
    });
    const facilityIds = ctx.facilities.map((f) => f.id);
    const table = run.datasets?.find((d) => d.name === "facilities");
    const steps = run.datasets?.find((d) => d.name === "steps");
    const grid = occupancyGrid(table, facilityIds, activity, horizon);
    const capacity = capacityGrid(ctx.facilities, stamps, variant, activity, horizon);
    return {
      occupancy: grid,
      waiting: occupancyGrid(table, facilityIds, activity, horizon, "waiting"),
      capacity,
      arrivals: stepsBySeverity(steps, horizon, "arrived_"),
      unmet: stepsBySeverity(steps, horizon, "unmet_"),
      island: islandSeries(grid, capacity),
      notes: input.notes,
    };
  }

  /**
   * The scenario's stamps plus some more, as the page would run them: once with
   * the events only, once with every choice.
   *
   * The events-only pass is run once and reused, so `stamps` must be the same
   * scenario each time, differing only in its choices.
   */
  async run(stamps: Stamp[]): Promise<RunOutput> {
    if (!this.eventsRun) {
      const attempt = this.variant(stamps, "events");
      this.eventsRun = attempt;
      // A pass that failed is not a result to hand to the next option.
      attempt.catch(() => {
        if (this.eventsRun === attempt) this.eventsRun = null;
      });
    }
    // In sequence, as the page does: the second failure is easier to read alone.
    const events = await this.eventsRun;
    const full = await this.variant(stamps, "full");
    return { horizon: this.world.horizon, activity: this.world.activity, events, full, ranAt: this.now().toISOString() };
  }

  /** The run, as the summary the analyst and the page both read. */
  async digest(stamps: Stamp[]): Promise<RunDigest> {
    return runDigest(await this.run(stamps), this.ctx, false);
  }

  /**
   * A scenario's stamps with an option's added, in the order the page will
   * hold them once a person adds the option: by the day each starts, the
   * scenario's own first among equals.
   */
  static withOption(scenario: Stamp[], option: Stamp[]): Stamp[] {
    return [...scenario, ...option].sort((a, b) => a.start - b.start);
  }
}
