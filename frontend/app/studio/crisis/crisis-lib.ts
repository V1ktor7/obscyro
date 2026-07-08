/**
 * Crisis library, factor derivation from the live twin tree, and client-side
 * effect-channel projection. Real backend runs (clone/inject/run/simulate) are
 * orchestrated in CrisisView; projections are always badge-labeled.
 */

import type {
  AlertTimelineEvent,
  DailyTrajectory,
  MlSimResult,
  OutbreakParams,
  RunResult,
  TwinTreeSnapshot,
  TwinUnitNode,
} from "@/lib/platform-api";

// ---------------------------------------------------------------------------
// Effect-channel math (ported from design/twin-sim-flux-view.html)
// ---------------------------------------------------------------------------

export type EffectChannels = {
  occ: number;
  intake: number;
  iso: number;
  staff: number;
  beds: number;
  lab: number;
  unc: number;
};

const gauss = (t: number, p: number, w: number) =>
  t < 0 ? 0 : Math.exp(-Math.pow((t - p) / w, 2));
const ramp = (t: number, d: number) => (t < 0 ? 0 : Math.min(t / d, 1));
const decay = (t: number, d: number) => (t < 0 ? 0 : Math.exp(-t / d));

export interface CrisisDef {
  id: string;
  icon: string;
  name: string;
  description: string;
  /** Real backend mapping when applicable. */
  backendKind?: "infectious" | "close_unit" | "add_beds";
  ch: (t: number, intensity: number) => Partial<EffectChannels>;
}

export const CRISES: CrisisDef[] = [
  {
    id: "covid",
    icon: "🦠",
    name: "Infectious index case",
    description: "Inject index patient → SEIR wave on scenario clone",
    backendKind: "infectious",
    ch: (t, k) => ({
      occ: 0.5 * gauss(t, 48, 24) * k,
      intake: 0.25 * gauss(t, 40, 20) * k,
      iso: 1.2 * gauss(t, 36, 18) * k,
    }),
  },
  {
    id: "surge",
    icon: "📈",
    name: "Patient intake surge",
    description: "Sustained admission ramp (flu-season peak)",
    ch: (t, k) => ({
      intake: 0.9 * ramp(t, 6) * k,
      occ: 0.45 * ramp(t, 14) * k,
    }),
  },
  {
    id: "masscas",
    icon: "🚑",
    name: "Mass casualty event",
    description: "Sudden influx — multi-patient disaster",
    ch: (t, k) => ({
      intake: 2.2 * decay(t, 3) * k,
      occ: 0.38 * decay(t, 48) * (t > 0 ? 1 : 0) * k,
    }),
  },
  {
    id: "staffout",
    icon: "🧑‍⚕️",
    name: "Staff shortage",
    description: "Reduced nursing capacity, slower discharge",
    ch: (t, k) => ({ occ: 0.25 * ramp(t, 20) * k }),
  },
  {
    id: "wardclose",
    icon: "🚧",
    name: "Ward closure / outage",
    description: "Beds go offline — structural intervention",
    backendKind: "close_unit",
    ch: (t, k) => ({
      beds: 0.4 * ramp(t, 2) * k,
      occ: 0.3 * ramp(t, 3) * k,
    }),
  },
  {
    id: "equip",
    icon: "⚙️",
    name: "Equipment failure (lab)",
    description: "Analyzer down — turnaround degrades",
    ch: (t, k) => ({
      occ: 0.15 * ramp(t, 12) * k,
    }),
  },
  {
    id: "supply",
    icon: "💊",
    name: "Supply shortage",
    description: "Critical medication or PPE stock-out",
    ch: (t, k) => ({ iso: 0.2 * ramp(t, 24) * k }),
  },
  {
    id: "season",
    icon: "🌡️",
    name: "Seasonal / heatwave surge",
    description: "Slow environmental ramp over days",
    ch: (t, k) => ({
      intake: 0.35 * ramp(t, 48) * k,
      occ: 0.3 * ramp(t, 60) * k,
    }),
  },
  {
    id: "evac",
    icon: "🏥",
    name: "Regional transfer wave",
    description: "Neighbouring hospital evacuates → transfer influx",
    ch: (t, k) => ({
      intake: 0.5 * decay(t, 12) * (t > 0 ? 1 : 0) * k,
      occ: 0.3 * ramp(t, 8) * k,
    }),
  },
  {
    id: "fluxout",
    icon: "📡",
    name: "Data source outage",
    description: "Flux goes dark — uncertainty grows (projection only)",
    ch: (t, k) => ({ unc: 0.6 * ramp(t, 4) * k }),
  },
];

export interface StackItem {
  cid: string;
  intensity: number;
  onsetH: number;
}

export interface WatchFactor {
  id: string;
  scope: string;
  name: string;
  unitId?: string;
  base: number;
  fmt: (v: number) => string;
  warn: number;
  crit: number;
  invert?: boolean;
  color: string;
  sens: Partial<Record<keyof EffectChannels, number>>;
}

/** Derive watch factors from the live twin tree (no invented metrics). */
export function deriveFactors(snapshot: TwinTreeSnapshot): WatchFactor[] {
  const factors: WatchFactor[] = [];
  const hospitals = snapshot.nodes.filter((n) => n.kind === "hospital");
  const wards = snapshot.nodes.filter((n) => n.kind === "ward");
  const roots = snapshot.roots
    .map((id) => snapshot.nodes.find((n) => n.id === id))
    .filter((n): n is TwinUnitNode => Boolean(n));

  const scopeNodes = hospitals.length ? hospitals : roots.length ? roots : snapshot.nodes;

  if (scopeNodes.length) {
    const occVals = scopeNodes
      .map((n) => n.metrics.occupancyPct)
      .filter((v): v is number => v != null);
    const avgOcc = occVals.length
      ? occVals.reduce((a, b) => a + b, 0) / occVals.length
      : 0;
    let beds = 0;
    let patients = 0;
    for (const n of scopeNodes) {
      beds += n.metrics.instanceCountByType["Bed"] ?? 0;
      patients += n.metrics.instanceCountByType["Patient"] ?? 0;
    }
    const bedsAvail = Math.max(0, beds - patients);

    factors.push({
      id: "hosp-occ",
      scope: scopeNodes[0]!.name,
      name: "Avg occupancy",
      base: avgOcc || 0,
      fmt: (v) => `${Math.round(v)}%`,
      warn: 85,
      crit: 95,
      color: "#6366f1",
      sens: { occ: 1, intake: 0.25, beds: 0.5 },
    });
    factors.push({
      id: "hosp-beds",
      scope: scopeNodes[0]!.name,
      name: "Beds available",
      base: bedsAvail,
      fmt: (v) => String(Math.round(v)),
      warn: 30,
      crit: 12,
      invert: true,
      color: "#84cc16",
      sens: { occ: -0.9, beds: -1, intake: -0.3 },
    });
  }

  for (const w of wards.slice(0, 8)) {
    const occ = w.metrics.occupancyPct ?? 0;
    factors.push({
      id: `ward-${w.id.slice(0, 8)}`,
      scope: w.name,
      name: "Occupancy",
      unitId: w.id,
      base: occ,
      fmt: (v) => `${Math.round(v)}%`,
      warn: 85,
      crit: 95,
      color: "#f472b6",
      sens: { occ: 1.1, intake: 0.5, beds: 0.6 },
    });
  }

  return factors;
}

export function effectAt(t: number, stack: StackItem[]): EffectChannels {
  const out: EffectChannels = {
    occ: 0,
    intake: 0,
    iso: 0,
    staff: 0,
    beds: 0,
    lab: 0,
    unc: 0,
  };
  for (const s of stack) {
    const c = CRISES.find((x) => x.id === s.cid);
    if (!c) continue;
    const e = c.ch(t - s.onsetH, s.intensity);
    for (const k of Object.keys(e) as (keyof EffectChannels)[]) {
      out[k] += e[k] ?? 0;
    }
  }
  return out;
}

export interface ProjPoint {
  t: number;
  v: number;
  lo: number;
  hi: number;
}

export interface TimelineEvent {
  t: number;
  severity: "info" | "warn" | "critical";
  message: string;
  source: "projection" | "backend";
}

export interface ClientProjection {
  kind: "projection";
  proj: Record<string, ProjPoint[]>;
  baseline: Record<string, ProjPoint[]>;
  events: TimelineEvent[];
  horizonH: number;
}

export function computeClientProjection(
  factors: WatchFactor[],
  selectedIds: Set<string>,
  stack: StackItem[],
  horizonH: number,
  engine: "mechanistic" | "ml",
): ClientProjection {
  const proj: Record<string, ProjPoint[]> = {};
  const baseline: Record<string, ProjPoint[]> = {};
  const events: TimelineEvent[] = [];

  for (const f of factors) {
    if (!selectedIds.has(f.id)) continue;
    const pts: ProjPoint[] = [];
    const basePts: ProjPoint[] = [];
    const v0 = f.base;
    for (let t = 0; t <= horizonH; t++) {
      const e = effectAt(t, stack);
      let mult = 0;
      for (const k of Object.keys(f.sens) as (keyof EffectChannels)[]) {
        mult += (f.sens[k] ?? 0) * (e[k] ?? 0);
      }
      let v = f.invert ? v0 * (1 + mult) : v0 * (1 + mult);
      v = Math.max(0, v);
      const band = (engine === "ml" ? 0.16 : 0.07) + (e.unc ?? 0) * 0.5;
      pts.push({ t, v, lo: v * (1 - band), hi: v * (1 + band) });
      basePts.push({ t, v: v0, lo: v0, hi: v0 });
    }
    proj[f.id] = pts;
    baseline[f.id] = basePts;

    let crossedWarn = false;
    let crossedCrit = false;
    for (const pt of pts) {
      const breach = f.invert ? pt.v <= f.crit : pt.v >= f.crit;
      const wbreach = f.invert ? pt.v <= f.warn : pt.v >= f.warn;
      const wasWarn = f.invert ? f.base <= f.warn : f.base >= f.warn;
      if (!crossedCrit && breach) {
        crossedCrit = true;
        events.push({
          t: pt.t,
          severity: "critical",
          message: `${f.scope} · ${f.name} crosses critical (${f.fmt(pt.v)})`,
          source: "projection",
        });
      } else if (!crossedWarn && wbreach && !wasWarn) {
        crossedWarn = true;
        events.push({
          t: pt.t,
          severity: "warn",
          message: `${f.scope} · ${f.name} crosses warn (${f.fmt(pt.v)})`,
          source: "projection",
        });
      }
    }
  }

  for (const s of stack) {
    const c = CRISES.find((x) => x.id === s.cid);
    if (c) {
      events.push({
        t: s.onsetH,
        severity: "info",
        message: `${c.name} · onset`,
        source: "projection",
      });
    }
  }

  events.sort((a, b) => a.t - b.t);
  return { kind: "projection", proj, baseline, events, horizonH };
}

export interface BackendRunResult {
  kind: "backend";
  runId: string;
  seed: string;
  engine: "mechanistic" | "ml";
  mechanistic?: RunResult;
  ml?: MlSimResult;
  alertTimeline: AlertTimelineEvent[];
  isolationSeries: DailyTrajectory[];
  usedFallback?: boolean;
}

/** Map backend trajectories onto isolation-demand factor series (hours = days). */
export function isolationSeriesFromRun(
  trajectories: { p50: DailyTrajectory[]; p10?: DailyTrajectory[]; p90?: DailyTrajectory[] },
): ProjPoint[] {
  return trajectories.p50.map((d) => ({
    t: d.day * 24,
    v: d.isolationDemand,
    lo: d.isolationDemand * 0.85,
    hi: d.isolationDemand * 1.15,
  }));
}

export function outbreakParamsFromStack(
  stack: StackItem[],
  base: OutbreakParams,
): OutbreakParams {
  const infectious = stack.find((s) => s.cid === "covid");
  const r0 = base.r0 ?? 2.5;
  const intensity = infectious?.intensity ?? 1;
  return {
    ...base,
    r0: r0 * intensity,
  };
}

export const DEFAULT_OUTBREAK: OutbreakParams = {
  r0: 2.5,
  incubationDays: 3,
  infectiousDays: 5,
  isolationCapacity: 10,
  runs: 10,
  horizonDays: 3,
};
