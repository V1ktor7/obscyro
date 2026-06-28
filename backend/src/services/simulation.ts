import type { DbClient } from "../lib/db.js";
import { NotFound } from "../lib/errors.js";
import { listInstancesForEnv, listLinksForEnv } from "./ontology.js";

export type SeirState = "S" | "E" | "I" | "R";

export interface ContactNode {
  id: string;
  type: string;
  properties: Record<string, unknown>;
  state: SeirState;
  daysInState: number;
  isolated: boolean;
}

export interface ContactGraph {
  nodes: Map<string, ContactNode>;
  adjacency: Map<string, string[]>;
}

export interface ScenarioOverrideRow {
  targetType: string;
  targetId: string | null;
  op: string;
  payload: Record<string, unknown>;
}

export interface OutbreakParams {
  beta?: number;
  r0?: number;
  incubationDays?: number;
  infectiousDays?: number;
  indexNodeIds?: string[];
  isolationCapacity?: number;
  runs?: number;
  horizonDays?: number;
  containThreshold?: number;
}

export interface DailyTrajectory {
  day: number;
  S: number;
  E: number;
  I: number;
  R: number;
  isolationDemand: number;
}

export interface OutbreakSummary {
  peakInfected: number;
  peakIsolationDemand: number;
  attackRate: number;
  daysToContain: number | null;
  hcwInfections: number;
}

export interface OutbreakResult {
  summary: OutbreakSummary;
  trajectories: {
    p5: DailyTrajectory[];
    p50: DailyTrajectory[];
    p95: DailyTrajectory[];
  };
}

/** Seeded PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export async function buildContactGraph(
  db: DbClient,
  environmentId: string,
): Promise<ContactGraph> {
  const instances = await listInstancesForEnv(db, environmentId, { limit: 10_000 });
  const links = await listLinksForEnv(db, environmentId);

  const nodes = new Map<string, ContactNode>();
  for (const inst of instances) {
    nodes.set(inst.id, {
      id: inst.id,
      type: inst.typeName,
      properties: inst.properties,
      state: "S",
      daysInState: 0,
      isolated: false,
    });
  }

  const adjacency = new Map<string, string[]>();
  for (const id of nodes.keys()) adjacency.set(id, []);
  for (const link of links) {
    if (!nodes.has(link.fromInstanceId) || !nodes.has(link.toInstanceId)) continue;
    adjacency.get(link.fromInstanceId)!.push(link.toInstanceId);
    adjacency.get(link.toInstanceId)!.push(link.fromInstanceId);
  }

  return { nodes, adjacency };
}

export function applyOverrides(
  graph: ContactGraph,
  overrides: ScenarioOverrideRow[],
): ContactGraph {
  const nodes = new Map<string, ContactNode>();
  for (const [id, n] of graph.nodes) {
    nodes.set(id, { ...n });
  }

  for (const o of overrides) {
    const targets = [...nodes.values()].filter((n) => {
      if (n.type !== o.targetType) return false;
      if (o.targetId) return n.id === o.targetId;
      return true;
    });
    for (const node of targets) {
      if (o.op === "index_infect" || o.op === "set_state") {
        const state = (o.payload.state as SeirState) ?? "I";
        node.state = state;
        node.daysInState = 0;
      }
      if (o.op === "set_isolated") {
        node.isolated = Boolean(o.payload.isolated);
      }
    }
  }

  return { nodes, adjacency: graph.adjacency };
}

function cloneGraph(graph: ContactGraph): ContactGraph {
  const nodes = new Map<string, ContactNode>();
  for (const [id, n] of graph.nodes) {
    nodes.set(id, { ...n });
  }
  return { nodes, adjacency: graph.adjacency };
}

function isHcwType(typeName: string): boolean {
  const t = typeName.toLowerCase();
  return t.includes("clinician") || t.includes("hcw") || t.includes("staff");
}

function resolveBeta(params: OutbreakParams, avgDegree: number): number {
  if (params.beta != null) return params.beta;
  const r0 = params.r0 ?? 2.5;
  const infectiousDays = params.infectiousDays ?? 5;
  const denom = Math.max(1, avgDegree) * infectiousDays;
  return r0 / denom;
}

function runSingleSimulation(
  baseGraph: ContactGraph,
  params: OutbreakParams,
  rng: () => number,
): { daily: DailyTrajectory[]; summary: OutbreakSummary } {
  const graph = cloneGraph(baseGraph);
  const nodeIds = [...graph.nodes.keys()];
  const n = nodeIds.length;
  if (n === 0) {
    return {
      daily: [{ day: 0, S: 0, E: 0, I: 0, R: 0, isolationDemand: 0 }],
      summary: {
        peakInfected: 0,
        peakIsolationDemand: 0,
        attackRate: 0,
        daysToContain: 0,
        hcwInfections: 0,
      },
    };
  }

  const horizonDays = params.horizonDays ?? 60;
  const incubationDays = params.incubationDays ?? 3;
  const infectiousDays = params.infectiousDays ?? 5;
  const isolationCapacity = params.isolationCapacity ?? Math.ceil(n * 0.1);
  const containThreshold = params.containThreshold ?? 1;

  let totalDegree = 0;
  for (const id of nodeIds) totalDegree += graph.adjacency.get(id)?.length ?? 0;
  const avgDegree = totalDegree / n;
  const beta = resolveBeta(params, avgDegree);

  const indexIds = params.indexNodeIds?.length
    ? params.indexNodeIds.filter((id) => graph.nodes.has(id))
    : [nodeIds[0]!];
  for (const id of indexIds) {
    const node = graph.nodes.get(id)!;
    node.state = "I";
    node.daysInState = 0;
  }

  const daily: DailyTrajectory[] = [];
  let peakInfected = 0;
  let peakIsolation = 0;
  let daysToContain: number | null = null;
  let hcwInfections = 0;

  for (let day = 0; day <= horizonDays; day++) {
    let s = 0;
    let e = 0;
    let i = 0;
    let r = 0;
    let isolationDemand = 0;

    for (const node of graph.nodes.values()) {
      if (node.state === "S") s++;
      else if (node.state === "E") e++;
      else if (node.state === "I") {
        i++;
        if (node.isolated) isolationDemand++;
      } else r++;
    }

    peakInfected = Math.max(peakInfected, i);
    peakIsolation = Math.max(peakIsolation, isolationDemand);
    if (daysToContain === null && i <= containThreshold && day > 0) {
      daysToContain = day;
    }

    daily.push({ day, S: s, E: e, I: i, R: r, isolationDemand });

    if (day === horizonDays) break;

    const newlyExposed: string[] = [];
    for (const id of nodeIds) {
      const node = graph.nodes.get(id)!;
      if (node.state !== "I" || node.isolated) continue;
      const neighbors = graph.adjacency.get(id) ?? [];
      for (const nid of neighbors) {
        const neighbor = graph.nodes.get(nid)!;
        if (neighbor.state !== "S") continue;
        if (rng() < beta) newlyExposed.push(nid);
      }
    }
    for (const id of newlyExposed) {
      const node = graph.nodes.get(id)!;
      if (node.state === "S") {
        node.state = "E";
        node.daysInState = 0;
      }
    }

    const newlyInfectious: string[] = [];
    const newlyRecovered: string[] = [];
    const toIsolate: string[] = [];

    for (const id of nodeIds) {
      const node = graph.nodes.get(id)!;
      node.daysInState++;
      if (node.state === "E" && node.daysInState >= incubationDays) {
        node.state = "I";
        node.daysInState = 0;
        newlyInfectious.push(id);
        if (isHcwType(node.type)) hcwInfections++;
      } else if (node.state === "I" && node.daysInState >= infectiousDays) {
        node.state = "R";
        node.daysInState = 0;
        newlyRecovered.push(id);
      }
    }

    let currentIsolated = isolationDemand;
    for (const id of newlyInfectious) {
      if (currentIsolated < isolationCapacity) {
        graph.nodes.get(id)!.isolated = true;
        currentIsolated++;
        toIsolate.push(id);
      }
    }
  }

  const attackRate = n > 0 ? (graph.nodes.size - [...graph.nodes.values()].filter((x) => x.state === "S").length) / n : 0;

  return {
    daily,
    summary: {
      peakInfected,
      peakIsolationDemand: peakIsolation,
      attackRate,
      daysToContain,
      hcwInfections,
    },
  };
}

function percentileTrajectories(
  allDaily: DailyTrajectory[][],
  p: number,
): DailyTrajectory[] {
  if (!allDaily.length) return [];
  const maxDay = Math.max(...allDaily.map((d) => d.length));
  const out: DailyTrajectory[] = [];
  for (let day = 0; day < maxDay; day++) {
    const rows = allDaily.map((d) => d[day]).filter(Boolean) as DailyTrajectory[];
    if (!rows.length) continue;
    const pick = (key: keyof DailyTrajectory) => {
      const vals = rows.map((r) => r[key] as number).sort((a, b) => a - b);
      const idx = Math.min(vals.length - 1, Math.floor(p * (vals.length - 1)));
      return vals[idx]!;
    };
    out.push({
      day,
      S: pick("S"),
      E: pick("E"),
      I: pick("I"),
      R: pick("R"),
      isolationDemand: pick("isolationDemand"),
    });
  }
  return out;
}

function aggregateSummaries(summaries: OutbreakSummary[]): OutbreakSummary {
  if (!summaries.length) {
    return {
      peakInfected: 0,
      peakIsolationDemand: 0,
      attackRate: 0,
      daysToContain: null,
      hcwInfections: 0,
    };
  }
  const avg = (fn: (s: OutbreakSummary) => number) =>
    summaries.reduce((a, s) => a + fn(s), 0) / summaries.length;
  const containDays = summaries
    .map((s) => s.daysToContain)
    .filter((d): d is number => d != null);
  return {
    peakInfected: Math.round(avg((s) => s.peakInfected)),
    peakIsolationDemand: Math.round(avg((s) => s.peakIsolationDemand)),
    attackRate: avg((s) => s.attackRate),
    daysToContain: containDays.length
      ? Math.round(containDays.reduce((a, b) => a + b, 0) / containDays.length)
      : null,
    hcwInfections: Math.round(avg((s) => s.hcwInfections)),
  };
}

export function runOutbreak(
  graph: ContactGraph,
  params: OutbreakParams,
  seed: number,
): OutbreakResult {
  const runs = Math.max(1, Math.min(params.runs ?? 10, 200));
  const allDaily: DailyTrajectory[][] = [];
  const summaries: OutbreakSummary[] = [];

  for (let run = 0; run < runs; run++) {
    const runSeed = (seed + run * 9973) >>> 0;
    const rng = mulberry32(runSeed);
    const { daily, summary } = runSingleSimulation(graph, params, rng);
    allDaily.push(daily);
    summaries.push(summary);
  }

  return {
    summary: aggregateSummaries(summaries),
    trajectories: {
      p5: percentileTrajectories(allDaily, 0.05),
      p50: percentileTrajectories(allDaily, 0.5),
      p95: percentileTrajectories(allDaily, 0.95),
    },
  };
}

export async function getScenarioForEnv(
  db: DbClient,
  scenarioId: string,
  environmentId: string,
): Promise<{
  id: string;
  environmentId: string;
  name: string;
  params: Record<string, unknown>;
  ownerUserId: string;
  organizationId: string;
}> {
  const { rows } = await db.query<{
    id: string;
    environment_id: string;
    name: string;
    params: Record<string, unknown>;
    owner_user_id: string;
    organization_id: string;
  }>(
    `SELECT id, environment_id, name, params, owner_user_id, organization_id
       FROM app.scenario
      WHERE id = $1 AND environment_id = $2`,
    [scenarioId, environmentId],
  );
  const r = rows[0];
  if (!r) throw NotFound("SCENARIO_NOT_FOUND", "Scenario not found in this environment.");
  return {
    id: r.id,
    environmentId: r.environment_id,
    name: r.name,
    params: r.params ?? {},
    ownerUserId: r.owner_user_id,
    organizationId: r.organization_id,
  };
}

export async function loadScenarioOverrides(
  db: DbClient,
  scenarioId: string,
): Promise<ScenarioOverrideRow[]> {
  const { rows } = await db.query<{
    target_type: string;
    target_id: string | null;
    op: string;
    payload: Record<string, unknown>;
  }>(
    `SELECT target_type, target_id, op, payload
       FROM app.scenario_override
      WHERE scenario_id = $1
      ORDER BY created_at ASC`,
    [scenarioId],
  );
  return rows.map((r) => ({
    targetType: r.target_type,
    targetId: r.target_id,
    op: r.op,
    payload: r.payload ?? {},
  }));
}
