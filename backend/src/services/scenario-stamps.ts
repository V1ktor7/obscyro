import type { ScenarioOverride } from "./scenario-overrides.js";
import type { SimExport } from "./twin-export.js";

/**
 * Stamps, as the server reads them.
 *
 * A stamp is what a planner drops on the Scenarios map: an outbreak, a heat
 * wave, a measure, added capacity, a starting condition. The page turns them
 * into what the engine receives (`frontend/app/studio/simulation/hex/stamps.ts`)
 * and this file does the same on the server, so the analyst can test an option
 * through the engine without a browser in the loop.
 *
 * Two copies of one translation is a liability, and it is held by a test
 * rather than by care: `scenario-run-parity.fixture.json` is read by the test
 * beside this file and by the page's own test, and both must produce the same
 * engine input and the same figures from it. Change one side and the other
 * side's test fails.
 *
 * Nothing here knows a type or a link by name. What the twin declares is read
 * off the mechanics its properties are bound to.
 */

// ---------------------------------------------------------------------------
// What the twin declares.
// ---------------------------------------------------------------------------

export interface TwinFacility {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Total capacity per activity a resource here enables. */
  capacity: Record<string, number>;
}

export interface TwinPopulation {
  id: string;
  name: string;
  size: number;
  servedBy: string[];
}

export interface TwinContext {
  facilities: TwinFacility[];
  populations: TwinPopulation[];
  /** The state a coupled transition drains: who can still catch it. */
  susceptible: string | null;
  /** The state that drives coupled transitions: who passes it on. */
  infectious: string | null;
  /** Where someone who cannot catch it sits; null when the model declares none. */
  immune: string | null;
  couplings: string[];
  /** Severities the declared model produces, in order of first appearance. */
  acuities: string[];
  /** Activities some facility can provide. */
  activities: string[];
  /** What each severity occupies, as the twin's care protocols declare it. */
  care: { acuity: string; activity: string }[];
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function twinContext(ex: SimExport): TwinContext {
  const facilities: TwinFacility[] = [];
  const activities = new Set<string>();
  for (const f of ex.facilities) {
    // A site with no location is not on the map, so the page never runs it.
    if (!f.location) continue;
    const capacity: Record<string, number> = {};
    for (const r of Object.values(f.resources)) {
      const cap = Number(r.capacity) || 0;
      for (const a of r.enables) {
        capacity[a] = (capacity[a] ?? 0) + cap;
        activities.add(a);
      }
    }
    facilities.push({ id: f.id, name: f.name, lat: f.location[0], lon: f.location[1], capacity });
  }

  // mechanic -> property key, per type.
  const bound = new Map<string, Map<string, string>>();
  for (const t of ex.object_types) {
    const m = new Map<string, string>();
    for (const p of t.properties) if (p.mechanic && !m.has(p.mechanic)) m.set(p.mechanic, p.key);
    bound.set(t.name, m);
  }
  const drivers = new Map<string, number>();
  const leaving = new Map<string, Map<string, number>>();
  const couplings = new Set<string>();
  const acuities: string[] = [];
  const left = new Set<string>();
  /** Quiet exits: a spontaneous passage that asks for no care. */
  const quiet: { from: string; to: string }[] = [];
  const care: TwinContext["care"] = [];
  for (const o of ex.objects) {
    const m = bound.get(o.type);
    if (m?.has("serves_severity") && m.has("consumes_activity")) {
      const acuity = text(o.properties[m.get("serves_severity")!]);
      const activity = text(o.properties[m.get("consumes_activity")!]);
      if (acuity && activity && !care.some((c) => c.acuity === acuity && c.activity === activity)) care.push({ acuity, activity });
    }
    if (!m?.has("leaves_state") || !m.has("enters_state")) continue;
    const prop = (mech: string) => (m.has(mech) ? text(o.properties[m.get(mech)!]) : null);
    const leaves = prop("leaves_state");
    const enters = prop("enters_state");
    const driven = prop("driven_by_state");
    const along = prop("couples_along");
    const produces = prop("produces_demand");
    if (leaves) left.add(leaves);
    if (leaves && enters && !driven && !produces) quiet.push({ from: leaves, to: enters });
    if (along) couplings.add(along);
    if (produces && !acuities.includes(produces)) acuities.push(produces);
    if (driven && leaves) {
      drivers.set(driven, (drivers.get(driven) ?? 0) + 1);
      const l = leaving.get(driven) ?? new Map<string, number>();
      l.set(leaves, (l.get(leaves) ?? 0) + 1);
      leaving.set(driven, l);
    }
  }
  const top = (m: Map<string, number> | undefined) =>
    m ? Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null : null;
  const infectious = top(drivers);
  const immune =
    quiet
      .filter((q) => q.from === infectious && !left.has(q.to))
      .map((q) => q.to)
      .sort()[0] ?? null;
  return {
    facilities,
    populations: ex.populations.map((p) => ({ id: p.id, name: p.name || p.id, size: p.size, servedBy: p.served_by })),
    susceptible: infectious ? top(leaving.get(infectious)) : null,
    infectious,
    immune,
    couplings: Array.from(couplings).sort(),
    acuities,
    activities: Array.from(activities).sort(),
    care,
  };
}

// ---------------------------------------------------------------------------
// The stamps.
// ---------------------------------------------------------------------------

export interface Anchor {
  lat: number;
  lon: number;
}

export type StampBody =
  | { kind: "seed"; at: Anchor; population: string; count: number }
  | { kind: "heat"; acuity: string; perThousand: number }
  | {
      kind: "measure";
      label: string;
      layers: { layer: string; factor: number }[];
      at: Anchor | null;
      radiusKm: number | null;
      /** Null covers every catchment. */
      populations: string[] | null;
    }
  | { kind: "capacity"; facility: string; activity: string; amount: number }
  /** Share of the units providing an activity already in use, at every site, for the whole run. */
  | { kind: "occupancy"; activity: string; share: number }
  /** Share of every catchment that cannot catch it when the run starts. */
  | { kind: "immunity"; share: number }
  /** Every contact layer scaled for the whole run. */
  | { kind: "variant"; factor: number };

export type Stamp = StampBody & {
  /** The override's id once saved; a temporary id before. */
  id: string;
  /** First day it applies, counted from day 0. */
  start: number;
  /** How many days it lasts. */
  days: number;
};

/** What the planner decided, as opposed to what happens to the city. */
export function isChoice(s: Pick<Stamp, "kind">): boolean {
  return s.kind === "measure" || s.kind === "capacity";
}

export const STAMP_PREFIX = "stamp:";

/** Null for any override that is not a stamp: the scenario may hold other edits. */
export function stampFromOverride(o: ScenarioOverride): Stamp | null {
  if (o.targetType !== "param" || o.op !== "set_param") return null;
  const key = String(o.payload.key ?? "");
  if (!key.startsWith(STAMP_PREFIX)) return null;
  const body = o.payload.value as StampBody | undefined;
  if (!body || typeof body !== "object" || !("kind" in body)) return null;
  const start = Math.max(0, Math.round(o.effectiveOffsetHours / 24));
  const days = Math.max(1, Math.round((o.durationHours ?? 24) / 24));
  return { ...body, id: o.id, start, days } as Stamp;
}

/** a, b, … z, aa, ab, … */
function letters(i: number): string {
  let s = "";
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(97 + (n % 26)) + s;
  return s;
}

export type ChoiceStamp = Stamp & { kind: "measure" | "capacity" };

/**
 * What each choice of a scenario is called while one exchange lasts: the
 * stamp's id, to the name a tool reads and writes (`choice-a`, `choice-b`, …).
 *
 * A stamp's own id is a UUID. Handed to a language model it is thirty-six
 * characters to copy without a slip, and it is full of digits that the checker
 * of figures would then find "in a step". A name made of letters is neither.
 * It is not kept anywhere: what an option records is the stamp's id.
 */
export function choiceRefs(overrides: ScenarioOverride[]): Map<string, string> {
  const refs = new Map<string, string>();
  for (const o of overrides) {
    const s = stampFromOverride(o);
    if (s && isChoice(s)) refs.set(s.id, `choice-${letters(refs.size)}`);
  }
  return refs;
}

/** A scenario's stamps, in the order the page holds them: by the day they start. */
export function stampsOf(overrides: ScenarioOverride[]): Stamp[] {
  return overrides
    .map(stampFromOverride)
    .filter((s): s is Stamp => s !== null)
    .sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------------------
// What the engine receives.
// ---------------------------------------------------------------------------

/** One effect of an event, as the engine's own model names its fields. */
export interface SimEffect {
  id: string;
  target: string;
  select: Record<string, string[]>;
  op: "multiply" | "add" | "set";
  value: number | string;
  profile: { start: number; end: number | null; shape: string; peak: number; peak_tick?: number | null };
  [extra: string]: unknown;
}

export type Variant = "events" | "full";

export interface SpreadInput {
  seeds: Record<string, Record<string, number>>;
  changes: { layer: string; factor: number; fromStep: number; toStep: number | null; populations?: string[] }[];
  /** The spread starts on this day; its output is shifted back by it. */
  offset: number;
  horizon: number;
}

export interface EngineInput {
  spread: SpreadInput | null;
  /** Effects that do not come from the spreading model. */
  effects: SimEffect[];
  /** Usual occupancy by activity, as a share: where the network starts, in both runs. */
  occupancy: Record<string, number>;
  /** Said on screen, never solved silently. */
  notes: string[];
}

/**
 * The same stamps, as one of two runs.
 *
 * `events` keeps what happens to the city and drops what the planner chose;
 * `full` keeps everything. The difference between the two is the effect of the
 * choices, built rather than inferred.
 */
export function engineInput(
  stamps: Stamp[],
  ctx: Pick<TwinContext, "populations" | "susceptible" | "infectious"> & Partial<Pick<TwinContext, "immune" | "couplings">>,
  variant: Variant,
  horizon: number,
): EngineInput {
  const notes: string[] = [];
  const effects: SimEffect[] = [];
  const seeds = stamps.filter((s): s is Stamp & { kind: "seed" } => s.kind === "seed");
  let spread: SpreadInput | null = null;

  // Conditions hold in both runs: they describe where things start, not a choice.
  const occupancy: Record<string, number> = {};
  for (const s of stamps) {
    if (s.kind !== "occupancy") continue;
    const v = Math.max(0, Math.min(1, s.share));
    if (s.activity in occupancy && occupancy[s.activity] !== v)
      notes.push(`Two usual occupancies are set for ${s.activity}; the higher one is used.`);
    occupancy[s.activity] = Math.max(occupancy[s.activity] ?? 0, v);
  }
  const immunities = stamps.filter((s): s is Stamp & { kind: "immunity" } => s.kind === "immunity");
  const immuneShare = immunities.length ? Math.max(0, Math.min(1, Math.max(...immunities.map((s) => s.share)))) : 0;
  if (immunities.length > 1) notes.push("Two prior immunities are set; the higher one is used.");
  const variants = stamps.filter((s): s is Stamp & { kind: "variant" } => s.kind === "variant");

  if (seeds.length > 0) {
    if (!ctx.susceptible || !ctx.infectious) {
      notes.push(
        "The twin declares no spreading model (no transition driven by a state), so outbreaks cannot run. Heat and capacity still do.",
      );
    } else {
      const offset = Math.min(...seeds.map((s) => s.start));
      if (seeds.some((s) => s.start !== offset))
        notes.push(`The engine seeds once, so every outbreak starts on day ${offset}, the earliest one.`);
      const seeded = new Map<string, number>();
      for (const s of seeds) seeded.set(s.population, (seeded.get(s.population) ?? 0) + s.count);
      const placeImmune = immuneShare > 0 && !!ctx.immune;
      if (immuneShare > 0 && !ctx.immune)
        notes.push(
          "The twin's model declares no state for people who recovered without care, so prior immunity has nowhere to be placed and is left out.",
        );
      const out: SpreadInput["seeds"] = {};
      for (const p of ctx.populations) {
        if (p.size <= 0) continue;
        const sick = Math.min(p.size, seeded.get(p.id) ?? 0);
        // Whole people: a share of a head count is rounded, and never takes the sick.
        const immune = placeImmune ? Math.min(p.size - sick, Math.round(p.size * immuneShare)) : 0;
        out[p.id] = {
          [ctx.susceptible]: p.size - sick - immune,
          ...(sick > 0 ? { [ctx.infectious]: sick } : {}),
          ...(immune > 0 ? { [ctx.immune!]: immune } : {}),
        };
      }
      const changes: SpreadInput["changes"] = [];
      // The variant first, in both runs: it is what happens, and a measure
      // then scales what is left of each layer.
      for (const v of variants) {
        if (!(v.factor > 0) || v.factor === 1) continue;
        for (const layer of ctx.couplings ?? []) changes.push({ layer, factor: v.factor, fromStep: 0, toStep: null });
      }
      if (variant === "full") {
        for (const m of stamps) {
          if (m.kind !== "measure") continue;
          const from = m.start - offset;
          const to = m.start + m.days - 1 - offset;
          if (to < 0) {
            notes.push(`"${m.label}" ends before the outbreak starts, so it changes nothing.`);
            continue;
          }
          for (const l of m.layers)
            changes.push({
              layer: l.layer,
              factor: l.factor,
              fromStep: Math.max(0, from),
              toStep: to,
              ...(m.populations ? { populations: m.populations } : {}),
            });
        }
      }
      spread = { seeds: out, changes, offset, horizon: Math.max(1, horizon - offset) };
    }
  } else {
    if (variant === "full" && stamps.some((s) => s.kind === "measure"))
      notes.push("Measures act on how an outbreak spreads. With no outbreak stamped, they change nothing.");
    if (immunities.length || variants.length)
      notes.push("Prior immunity and the variant act on an outbreak. With no outbreak stamped, they change nothing.");
  }

  for (const s of stamps) {
    if (s.kind === "heat") {
      effects.push({
        id: `heat-${s.id}`,
        target: "demand.incidence",
        select: { acuity: [s.acuity] },
        op: "add",
        value: s.perThousand,
        profile: { start: s.start, end: s.start + s.days - 1, shape: "step", peak: 1 },
      });
    }
    if (s.kind === "capacity" && variant === "full") {
      effects.push({
        id: `capacity-${s.id}`,
        target: "resource.capacity",
        select: { facility: [s.facility], activity: [s.activity] },
        op: "add",
        value: s.amount,
        profile: { start: s.start, end: null, shape: "step", peak: 1 },
      });
    }
  }
  return { spread, effects, occupancy, notes };
}

/** Moves a spread run's effects to the day it actually started. */
export function shiftEffects(effects: SimEffect[], by: number): SimEffect[] {
  if (!by) return effects;
  return effects.map((e) => ({
    ...e,
    profile: {
      ...e.profile,
      start: (e.profile?.start ?? 0) + by,
      end: e.profile?.end == null ? null : e.profile.end + by,
    },
  }));
}

// ---------------------------------------------------------------------------
// How sure anyone can be of a stamp.
// ---------------------------------------------------------------------------

/**
 * The three levels of evidence the decision loop keeps apart
 * (`docs/decision-loop.md`): read from the twin or the network's data, taken
 * from an official source, or put there by a person or the scenario.
 */
export type Evidence = "measured" | "published" | "assumption";

export interface Basis {
  /** What the run rests on, as a sentence. */
  element: string;
  evidence: Evidence;
  /** Where it comes from: the twin, the scenario, the option being tested, or a rule of the engine. */
  from: "twin" | "scenario" | "option" | "engine";
}

const share = (x: number) => `${Math.round(x * 1000) / 10} %`;

/**
 * A choice, as a line: what is opened or closed where and from when, or which
 * contact is scaled, where and for how long. Written by the program from the
 * stamp, so the screen can say what an option adds, replaces or removes
 * without a sentence of the model's.
 */
export function choiceLine(s: ChoiceStamp, ctx: Pick<TwinContext, "populations" | "facilities">): string {
  if (s.kind === "capacity") {
    const f = ctx.facilities.find((x) => x.id === s.facility)?.name ?? s.facility;
    return `${s.amount > 0 ? "+" : ""}${s.amount} ${s.activity} at ${f} from day ${s.start}`;
  }
  const popName = (id: string) => ctx.populations.find((p) => p.id === id)?.name ?? id;
  const where =
    s.populations === null ? "every catchment" : s.populations.length === 1 ? popName(s.populations[0]!) : `${s.populations.length} catchments`;
  const layers = s.layers.map((l) => `${l.layer} ×${l.factor}`).join(", ");
  return `${s.label} in ${where}, days ${s.start} to ${s.start + s.days - 1}: contact scaled (${layers})`;
}

/**
 * What a stamp asks anyone to believe, and on what grounds.
 *
 * Assigned from what the stamp is, never written by the model: a level of
 * evidence a language model chose is itself an unsourced claim. A heat wave
 * carries two, because its rate is published and the share needing a stretcher
 * is not.
 */
export function basisOfStamp(
  s: Stamp,
  ctx: Pick<TwinContext, "populations" | "facilities">,
  from: "scenario" | "option",
): Basis[] {
  const popName = (id: string) => ctx.populations.find((p) => p.id === id)?.name ?? id;
  const last = s.start + s.days - 1;
  switch (s.kind) {
    case "seed":
      return [{ element: `Outbreak: ${s.count} sick in ${popName(s.population)} on day ${s.start}`, evidence: "assumption", from }];
    case "heat":
      return [
        {
          element: `Heat wave, days ${s.start} to ${last}: +${s.perThousand} ${s.acuity} arrivals per 1,000 residents per day (INRS–INSPQ, hottest days in Québec)`,
          evidence: "published",
          from,
        },
        { element: "Half of the extra heat arrivals need a stretcher", evidence: "assumption", from },
      ];
    case "measure":
      return [{ element: choiceLine(s, ctx), evidence: "assumption", from }];
    case "capacity":
      // That a bed can be opened is one thing; that somebody can staff it is
      // another, and the twin holds no staff to say so.
      return [{ element: `${choiceLine(s, ctx)}, ${s.amount > 0 ? "open and staffed" : "closed"}`, evidence: "assumption", from }];
    case "occupancy":
      return [{ element: `Usual occupancy: ${share(s.share)} of ${s.activity} already in use at every site`, evidence: "assumption", from }];
    case "immunity":
      return [{ element: `${share(s.share)} of every catchment already immune at the start`, evidence: "assumption", from }];
    case "variant":
      return [{ element: `Variant: contact passes it on ×${Math.round(s.factor * 100) / 100}`, evidence: "assumption", from }];
  }
}
