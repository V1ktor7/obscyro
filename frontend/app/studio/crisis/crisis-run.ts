/**
 * Hybrid crisis run orchestration — real backend where supported,
 * always paired with a labeled client projection baseline.
 */

import {
  cloneTwinUnit,
  injectScenario,
  runMlSimulation,
  runScenario,
  type MlIntervention,
  type OutbreakParams,
  type TwinTreeSnapshot,
} from "@/lib/platform-api";

import {
  CRISES,
  DEFAULT_OUTBREAK,
  type BackendRunResult,
  type ClientProjection,
  type StackItem,
  type WatchFactor,
  computeClientProjection,
  isolationSeriesFromRun,
  outbreakParamsFromStack,
} from "./crisis-lib";
import type { ProjPoint } from "./crisis-lib";

export interface HybridRunInput {
  env: string;
  snapshot: TwinTreeSnapshot;
  factors: WatchFactor[];
  selectedFactorIds: Set<string>;
  stack: StackItem[];
  horizonH: number;
  runs: number;
  seed: string;
  engine: "mechanistic" | "ml";
}

export interface HybridRunOutput {
  projection: ClientProjection;
  backend: BackendRunResult | null;
  error: string | null;
}

function pickRootUnit(snapshot: TwinTreeSnapshot): string | null {
  const hospital = snapshot.nodes.find((n) => n.kind === "hospital");
  if (hospital) return hospital.id;
  const root = snapshot.roots[0];
  if (root) return root;
  return snapshot.nodes[0]?.id ?? null;
}

function pickWardUnit(snapshot: TwinTreeSnapshot): string | null {
  return snapshot.nodes.find((n) => n.kind === "ward")?.id ?? null;
}

function occSeriesFromInfected(
  base: number,
  p50: Array<{ day: number; I: number }>,
  p10?: Array<{ day: number; I: number }>,
  p90?: Array<{ day: number; I: number }>,
): ProjPoint[] {
  const peakI = Math.max(...p50.map((d) => d.I), 1);
  return p50.map((d, i) => {
    const v = Math.min(99, base + (d.I / peakI) * Math.max(95 - base, 5));
    const loPt = p10?.[i];
    const hiPt = p90?.[i];
    const lo = loPt
      ? Math.min(99, base + (loPt.I / peakI) * Math.max(95 - base, 5))
      : v * 0.9;
    const hi = hiPt
      ? Math.min(99, base + (hiPt.I / peakI) * Math.max(95 - base, 5))
      : v * 1.1;
    return { t: d.day * 24, v, lo, hi };
  });
}

function mergeBackendIntoProjection(
  projection: ClientProjection,
  backend: BackendRunResult,
  factors: WatchFactor[],
): ClientProjection {
  const proj = { ...projection.proj };
  const trajectories =
    backend.engine === "ml" && backend.ml
      ? backend.ml.quantiles
      : backend.mechanistic?.trajectories;

  if (!trajectories) return projection;

  const p50 = trajectories.p50;
  const p10 = "p10" in trajectories ? trajectories.p10 : trajectories.p5;
  const p90 = "p90" in trajectories ? trajectories.p90 : trajectories.p95;

  for (const f of factors) {
    if (f.id === "hosp-occ" || f.id.startsWith("ward-")) {
      proj[f.id] = occSeriesFromInfected(f.base, p50, p10, p90);
    }
  }

  const isoPts = isolationSeriesFromRun({ p50, p10, p90 });
  if (isoPts.length) {
    proj["iso-demand"] = isoPts;
  }

  const events = [...projection.events];
  for (const evt of backend.alertTimeline) {
    events.push({
      t: evt.day * 24,
      severity: evt.severity === "critical" ? "critical" : evt.severity === "warn" ? "warn" : "info",
      message: evt.message,
      source: "backend",
    });
  }
  events.sort((a, b) => a.t - b.t);

  return { ...projection, proj, events };
}

export async function executeHybridRun(
  input: HybridRunInput,
): Promise<HybridRunOutput> {
  const {
    env,
    snapshot,
    factors,
    selectedFactorIds,
    stack,
    horizonH,
    runs,
    seed,
    engine,
  } = input;

  const projection = computeClientProjection(
    factors,
    selectedFactorIds,
    stack,
    horizonH,
    engine,
  );

  const hasInfectious = stack.some((s) => s.cid === "covid");
  const hasWardClose = stack.some((s) => s.cid === "wardclose");
  const rootUnitId = pickRootUnit(snapshot);

  if (!hasInfectious && !(hasWardClose && engine === "ml")) {
    return { projection, backend: null, error: null };
  }

  if (!rootUnitId) {
    return {
      projection,
      backend: null,
      error: "No hospital/root unit in twin tree for backend run",
    };
  }

  try {
    const name = `crisis-${Date.now()}`;
    const { scenarioId } = await cloneTwinUnit(env, rootUnitId, name);

    let indexNodeId: string | undefined;
    if (hasInfectious) {
      const { instanceIds } = await injectScenario(env, scenarioId, {
        instances: [
          {
            objectTypeName: "Patient",
            properties: {
              identifier: "CRISIS-IDX",
              label: "Crisis index case",
            },
          },
        ],
      });
      indexNodeId = instanceIds[0];
    }

    const horizonDays = Math.max(1, Math.ceil(horizonH / 24));
    const params: OutbreakParams = outbreakParamsFromStack(stack, {
      ...DEFAULT_OUTBREAK,
      horizonDays,
      runs,
      indexNodeIds: indexNodeId ? [indexNodeId] : undefined,
    });

    let intervention: MlIntervention | undefined;
    if (engine === "ml" && hasWardClose) {
      const wardId = pickWardUnit(snapshot);
      intervention = {
        kind: "close_unit",
        unitId: wardId,
      };
    } else if (engine === "ml" && hasInfectious) {
      const intensity =
        stack.find((s) => s.cid === "covid")?.intensity ?? 1;
      intervention = {
        kind: "add_isolation_beds",
        beds: Math.round(10 * intensity),
      };
    }

    const seedNum = seed.trim() ? Number(seed) : undefined;
    let backend: BackendRunResult;

    if (engine === "ml") {
      const ml = await runMlSimulation(env, scenarioId, {
        params,
        seed: seedNum,
        intervention,
      });
      backend = {
        kind: "backend",
        runId: ml.runId,
        seed: ml.seed,
        engine: "ml",
        ml,
        alertTimeline: [],
        isolationSeries: ml.quantiles.p50,
        usedFallback: ml.usedFallback,
      };
    } else {
      const mech = await runScenario(env, scenarioId, {
        params,
        runs,
        seed: seedNum,
      });
      backend = {
        kind: "backend",
        runId: mech.runId,
        seed: seed.trim() || "auto",
        engine: "mechanistic",
        mechanistic: mech,
        alertTimeline: mech.alertTimeline,
        isolationSeries: mech.trajectories.p50,
      };
    }

    const merged = mergeBackendIntoProjection(projection, backend, factors);
    return { projection: merged, backend, error: null };
  } catch (err) {
    return {
      projection,
      backend: null,
      error: (err as Error).message,
    };
  }
}

/** Crisis types that map to real backend pipelines (for UI badges). */
export function backendMappedCrises(stack: StackItem[]): string[] {
  const ids: string[] = [];
  for (const s of stack) {
    const c = CRISES.find((x) => x.id === s.cid);
    if (c?.backendKind) ids.push(s.cid);
  }
  return ids;
}
