/**
 * Stamps: what a person drops on the map, and what the engine receives.
 *
 * A stamp is one sentence a planner can read ("schools closed within 5 km of
 * Villeray, days 14 to 27") and one input the engine already understands — a
 * seed, a layer change, or an effect. Nothing here invents a new kind of input:
 * the translation below is the whole contract, and it is pure so it can be
 * tested without a server.
 *
 * Stamps persist as overlay-scenario overrides of target type `param`. Those are
 * stored with a start offset and a duration and are ignored by ontology reads,
 * so a scenario full of stamps never changes what the live twin shows.
 */

import type { ScenarioOverride, OverrideOp, OverrideTargetType } from "../../scenarios-api";
import type { SimEffect, SimExport } from "@/lib/platform-api";

// ---------------------------------------------------------------------------
// What the twin declares, read off its mechanics rather than its names.
// ---------------------------------------------------------------------------

export interface TwinFacility {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Total capacity per activity a resource here enables. */
  capacity: Record<string, number>;
  /** What is in use now, per activity, as the export read it. */
  census: Record<string, number>;
  /**
   * Units marked in use, per activity: capacity less what is free. Zero both
   * when everything is free and when the twin never marks status, so it is a
   * reading only where some site somewhere has a unit in use.
   */
  inUse: Record<string, number>;
}

export interface TwinContext {
  facilities: TwinFacility[];
  populations: { id: string; name: string; size: number; servedBy: string[] }[];
  /** The state a coupled transition drains: who can still catch it. */
  susceptible: string | null;
  /** The state that drives coupled transitions: who passes it on. */
  infectious: string | null;
  couplings: string[];
  /** Severities the declared model produces, in order of first appearance. */
  acuities: string[];
  /** Activities some facility can provide. */
  activities: string[];
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function twinContext(ex: SimExport): TwinContext {
  const facilities: TwinFacility[] = [];
  const activities = new Set<string>();
  for (const f of ex.facilities) {
    if (!f.location) continue;
    const capacity: Record<string, number> = {};
    const inUse: Record<string, number> = {};
    for (const r of Object.values(f.resources)) {
      const cap = Number(r.capacity) || 0;
      const free = Number(r.quantity);
      for (const a of r.enables) {
        capacity[a] = (capacity[a] ?? 0) + cap;
        // A missing quantity is not "none free": it would read as a full site.
        if (Number.isFinite(free)) inUse[a] = (inUse[a] ?? 0) + Math.max(0, cap - free);
        activities.add(a);
      }
    }
    facilities.push({
      id: f.id,
      name: f.name,
      lat: f.location[0],
      lon: f.location[1],
      capacity,
      census: { ...f.census },
      inUse,
    });
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
  for (const o of ex.objects) {
    const m = bound.get(o.type);
    if (!m?.has("leaves_state") || !m.has("enters_state")) continue;
    const prop = (mech: string) => (m.has(mech) ? text(o.properties[m.get(mech)!]) : null);
    const leaves = prop("leaves_state");
    const driven = prop("driven_by_state");
    const along = prop("couples_along");
    const produces = prop("produces_demand");
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
  return {
    facilities,
    populations: ex.populations.map((p) => ({ id: p.id, name: p.name || p.id, size: p.size, servedBy: p.served_by })),
    susceptible: infectious ? top(leaving.get(infectious)) : null,
    infectious,
    couplings: Array.from(couplings).sort(),
    acuities,
    activities: Array.from(activities).sort(),
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
  | { kind: "capacity"; facility: string; activity: string; amount: number };

export type Stamp = StampBody & {
  /** The override's id once saved; a temporary id before. */
  id: string;
  /** First day it applies, counted from day 0. */
  start: number;
  /** How many days it lasts. */
  days: number;
};

export type Lane = "Events" | "Measures" | "Resources";

export function laneOf(s: Pick<Stamp, "kind">): Lane {
  return s.kind === "seed" || s.kind === "heat" ? "Events" : s.kind === "measure" ? "Measures" : "Resources";
}

export const STAMP_PREFIX = "stamp:";

export interface OverrideBody {
  targetType: OverrideTargetType;
  targetLocalKey: string;
  op: OverrideOp;
  payload: Record<string, unknown>;
  effectiveOffsetHours: number;
  durationHours: number;
  note: string;
}

export function stampToOverride(s: Stamp, note: string, nonce: string): OverrideBody {
  // Timing travels in the override's own fields; the id is the override's.
  const body: Record<string, unknown> = { ...s };
  delete body.id;
  delete body.start;
  delete body.days;
  const { start, days } = s;
  const key = `${STAMP_PREFIX}${nonce}`;
  return {
    targetType: "param",
    targetLocalKey: key,
    op: "set_param",
    payload: { key, value: body },
    effectiveOffsetHours: start * 24,
    durationHours: days * 24,
    note,
  };
}

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

// ---------------------------------------------------------------------------
// How a stamp reads, and how sure anyone can be of it.
// ---------------------------------------------------------------------------

export type Tier = "Declared model" | "Published × assumption" | "Assumption" | "Decision";

export interface Described {
  title: string;
  when: string;
  tier: Tier;
  why: string;
}

/** INRS–INSPQ hottest-5 %-of-days ER total, per person per day, half on a stretcher. */
export const HEAT_PER_THOUSAND = 0.08;

export function describe(s: Stamp, ctx: Pick<TwinContext, "populations" | "facilities">): Described {
  const last = s.start + s.days - 1;
  const span = s.days > 1 ? `days ${s.start}–${last}` : `day ${s.start}`;
  const popName = (id: string) => ctx.populations.find((p) => p.id === id)?.name ?? id;
  switch (s.kind) {
    case "seed":
      return {
        title: `Outbreak: ${s.count.toLocaleString("en-CA")} sick in ${popName(s.population)}`,
        when: `day ${s.start}`,
        tier: "Declared model",
        why: "Where and when it starts is your call. How it spreads is the transmission model the twin declares.",
      };
    case "heat":
      return {
        title: "Heat wave, everywhere",
        when: span,
        tier: "Published × assumption",
        why:
          `+${s.perThousand} ${s.acuity} arrivals per 1,000 residents per day. From the INRS–INSPQ ` +
          "hottest-days ER total for Québec (published); that half need a stretcher is an assumption.",
      };
    case "measure": {
      const where =
        s.populations === null
          ? "everywhere"
          : s.radiusKm
            ? `within ${s.radiusKm} km (${s.populations.length} catchment${s.populations.length === 1 ? "" : "s"})`
            : s.populations.length === 1
              ? `in ${popName(s.populations[0]!)}`
              : `in ${s.populations.length} catchments`;
      const layers = s.layers.map((l) => `${l.layer} ×${l.factor}`).join(", ");
      return {
        title: `${s.label}, ${where}`,
        when: span,
        tier: "Assumption",
        why: `Contact layers scaled: ${layers}. The size of a measure comes from evidence ranges, run here at a central value.`,
      };
    }
    case "capacity": {
      const f = ctx.facilities.find((x) => x.id === s.facility)?.name ?? s.facility;
      return {
        title: `${s.amount > 0 ? "+" : ""}${s.amount} ${s.activity} at ${f}`,
        when: `from day ${s.start}`,
        tier: "Decision",
        why: "A choice, not evidence: it changes capacity directly.",
      };
    }
  }
}

export function weakestTier(stamps: Stamp[], ctx: Pick<TwinContext, "populations" | "facilities">): Tier | null {
  const order: Tier[] = ["Assumption", "Published × assumption", "Declared model", "Decision"];
  const seen = new Set(stamps.map((s) => describe(s, ctx).tier));
  return order.find((t) => seen.has(t)) ?? null;
}

// ---------------------------------------------------------------------------
// What the engine receives.
// ---------------------------------------------------------------------------

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
  /** Said on screen, never solved silently. */
  notes: string[];
}

/**
 * The same stamps, as one of two runs.
 *
 * `events` keeps what happens to the city — outbreaks and heat — and drops what
 * the planner chose. `full` keeps everything. The difference between the two is
 * the effect of the choices, built rather than inferred.
 */
export function engineInput(
  stamps: Stamp[],
  ctx: Pick<TwinContext, "populations" | "susceptible" | "infectious">,
  variant: Variant,
  horizon: number,
): EngineInput {
  const notes: string[] = [];
  const effects: SimEffect[] = [];
  const seeds = stamps.filter((s): s is Stamp & { kind: "seed" } => s.kind === "seed");
  let spread: SpreadInput | null = null;

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
      const out: SpreadInput["seeds"] = {};
      for (const p of ctx.populations) {
        if (p.size <= 0) continue;
        const sick = Math.min(p.size, seeded.get(p.id) ?? 0);
        out[p.id] = { [ctx.susceptible]: p.size - sick, ...(sick > 0 ? { [ctx.infectious]: sick } : {}) };
      }
      const changes: SpreadInput["changes"] = [];
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
  } else if (variant === "full" && stamps.some((s) => s.kind === "measure")) {
    notes.push("Measures act on how an outbreak spreads. With no outbreak stamped, they change nothing.");
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
  return { spread, effects, notes };
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
// Measure presets, offered only when the twin declares the layer they need.
// ---------------------------------------------------------------------------

export interface MeasurePreset {
  key: string;
  label: string;
  layers: { layer: string; factor: number }[];
}

export function measurePresets(couplings: string[]): MeasurePreset[] {
  const find = (re: RegExp) => couplings.filter((c) => re.test(c));
  const out: MeasurePreset[] = [];
  const school = find(/ecole|école|school/i);
  const home = find(/domicile|home|household|ménage|menage/i);
  if (school.length)
    out.push({
      key: "schools",
      label: "Schools closed",
      // 10–30 % of removed school contact moves home; 1.27 is the central value.
      layers: [...school.map((layer) => ({ layer, factor: 0 })), ...home.map((layer) => ({ layer, factor: 1.27 }))],
    });
  const night = find(/visiteur|visitor|autre|other|leisure|loisir/i);
  if (night.length)
    out.push({
      key: "curfew",
      label: "Curfew 8 p.m.–5 a.m.",
      // −39 % overnight mobility × 25–40 % of that contact after 8 p.m.
      layers: night.map((layer) => ({ layer, factor: 0.875 })),
    });
  for (const c of couplings) out.push({ key: `half:${c}`, label: `Halve ${c} contact`, layers: [{ layer: c, factor: 0.5 }] });
  return out;
}
