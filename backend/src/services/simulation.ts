import type { ScenarioInstanceRow, ScenarioLinkRow } from "./twin-clone.js";
import type { TwinAlertOp, TwinAlertRuleRow, TwinAlertSeverity } from "./twin.js";
import { LOCATED_IN_LINK_NAMES } from "./twin.js";

export type SeirState = "S" | "E" | "I" | "R";

export interface ContactNode {
  id: string;
  type: string;
  properties: Record<string, unknown>;
  state: SeirState;
  daysInState: number;
  isolated: boolean;
  unitId: string | null;
}

export interface ContactGraph {
  nodes: Map<string, ContactNode>;
  adjacency: Map<string, string[]>;
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

export interface AlertTimelineEvent {
  day: number;
  unitInstanceId: string;
  ruleId: string | null;
  metric: string;
  value: number;
  severity: TwinAlertSeverity;
  message: string;
}

export interface SimulationRunResult extends OutbreakResult {
  alertTimeline: AlertTimelineEvent[];
}

/** Build contact graph from cloned scenario copies only. */
export function buildContactGraphFromCopy(
  instances: ScenarioInstanceRow[],
  links: ScenarioLinkRow[],
): ContactGraph {
  const nodeToUnit = new Map<string, string>();
  for (const link of links) {
    if (!LOCATED_IN_LINK_NAMES.includes(link.linkTypeName as (typeof LOCATED_IN_LINK_NAMES)[number])) {
      continue;
    }
    nodeToUnit.set(link.fromId, link.toId);
  }

  const nodes = new Map<string, ContactNode>();
  for (const inst of instances) {
    nodes.set(inst.id, {
      id: inst.id,
      type: inst.objectTypeName,
      properties: inst.properties,
      state: "S",
      daysInState: 0,
      isolated: false,
      unitId: inst.objectTypeName === "OrgUnit" ? inst.id : (nodeToUnit.get(inst.id) ?? null),
    });
  }

  const adjacency = new Map<string, string[]>();
  for (const id of nodes.keys()) adjacency.set(id, []);

  for (const link of links) {
    if (LOCATED_IN_LINK_NAMES.includes(link.linkTypeName as (typeof LOCATED_IN_LINK_NAMES)[number])) {
      continue;
    }
    if (!nodes.has(link.fromId) || !nodes.has(link.toId)) continue;
    adjacency.get(link.fromId)!.push(link.toId);
    adjacency.get(link.toId)!.push(link.fromId);
  }

  return { nodes, adjacency };
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

function compareOp(op: TwinAlertOp, value: number, threshold: number): boolean {
  switch (op) {
    case "<":
      return value < threshold;
    case ">":
      return value > threshold;
    case ">=":
      return value >= threshold;
    case "<=":
      return value <= threshold;
    case "==":
      return value === threshold;
    default:
      return false;
  }
}

function fillTemplate(tpl: string, value: number, threshold: number): string {
  return tpl
    .replace(/\{\{value\}\}/g, String(Math.round(value * 100) / 100))
    .replace(/\{\{threshold\}\}/g, String(threshold));
}

function unitMetricsFromGraph(graph: ContactGraph): Map<string, { infectedCount: number; isolationDemand: number }> {
  const byUnit = new Map<string, { infectedCount: number; isolationDemand: number }>();
  for (const node of graph.nodes.values()) {
    if (!node.unitId) continue;
    const cur = byUnit.get(node.unitId) ?? { infectedCount: 0, isolationDemand: 0 };
    if (node.state === "I") {
      cur.infectedCount++;
      if (node.isolated) cur.isolationDemand++;
    }
    byUnit.set(node.unitId, cur);
  }
  return byUnit;
}

function evaluateRulesForDay(
  day: number,
  unitMetrics: Map<string, { infectedCount: number; isolationDemand: number }>,
  unitKinds: Map<string, string>,
  rules: TwinAlertRuleRow[],
): AlertTimelineEvent[] {
  const events: AlertTimelineEvent[] = [];
  for (const [unitId, metrics] of unitMetrics) {
    const kind = unitKinds.get(unitId) ?? null;
    const metricValues: Record<string, number> = {
      infectedCount: metrics.infectedCount,
      isolationDemand: metrics.isolationDemand,
    };
    for (const rule of rules) {
      if (rule.unitKind && rule.unitKind !== kind) continue;
      const val = metricValues[rule.metric];
      if (val == null) continue;
      if (!compareOp(rule.op, val, rule.threshold)) continue;
      events.push({
        day,
        unitInstanceId: unitId,
        ruleId: rule.id,
        metric: rule.metric,
        value: val,
        severity: rule.severity,
        message: fillTemplate(rule.messageTemplate, val, rule.threshold),
      });
    }
  }
  return events;
}

function runSingleSimulation(
  baseGraph: ContactGraph,
  params: OutbreakParams,
  rng: () => number,
  rules: TwinAlertRuleRow[],
  unitKinds: Map<string, string>,
  collectAlerts: boolean,
): {
  daily: DailyTrajectory[];
  summary: OutbreakSummary;
  alertTimeline: AlertTimelineEvent[];
} {
  const graph = cloneGraph(baseGraph);
  const nodeIds = [...graph.nodes.keys()];
  const n = nodeIds.length;
  const alertTimeline: AlertTimelineEvent[] = [];

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
      alertTimeline: [],
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

    if (collectAlerts && rules.length > 0) {
      const unitMetrics = unitMetricsFromGraph(graph);
      alertTimeline.push(...evaluateRulesForDay(day, unitMetrics, unitKinds, rules));
    }

    if (day === horizonDays) break;

    const newlyExposed: string[] = [];
    for (const id of nodeIds) {
      const node = graph.nodes.get(id)!;
      if (node.state !== "I" || node.isolated) continue;
      for (const nid of graph.adjacency.get(id) ?? []) {
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
      }
    }

    let currentIsolated = isolationDemand;
    for (const id of newlyInfectious) {
      if (currentIsolated < isolationCapacity) {
        graph.nodes.get(id)!.isolated = true;
        currentIsolated++;
      }
    }
  }

  const attackRate =
    n > 0
      ? (graph.nodes.size - [...graph.nodes.values()].filter((x) => x.state === "S").length) / n
      : 0;

  return {
    daily,
    summary: {
      peakInfected,
      peakIsolationDemand: peakIsolation,
      attackRate,
      daysToContain,
      hcwInfections,
    },
    alertTimeline,
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

/** Monte Carlo outbreak on scenario copy; alert timeline from the p50 representative run. */
export function runOutbreakSimulation(
  graph: ContactGraph,
  params: OutbreakParams,
  seed: number,
  rules: TwinAlertRuleRow[] = [],
): SimulationRunResult {
  const runs = Math.max(1, Math.min(params.runs ?? 10, 200));
  const allDaily: DailyTrajectory[][] = [];
  const summaries: OutbreakSummary[] = [];

  const unitKinds = new Map<string, string>();
  for (const node of graph.nodes.values()) {
    if (node.type === "OrgUnit") {
      unitKinds.set(node.id, String(node.properties.kind ?? "org"));
    }
  }

  let alertTimeline: AlertTimelineEvent[] = [];
  const p50RunIndex = Math.floor(runs / 2);

  for (let run = 0; run < runs; run++) {
    const runSeed = (seed + run * 9973) >>> 0;
    const rng = mulberry32(runSeed);
    const collectAlerts = run === p50RunIndex;
    const { daily, summary, alertTimeline: runAlerts } = runSingleSimulation(
      graph,
      params,
      rng,
      rules,
      unitKinds,
      collectAlerts,
    );
    allDaily.push(daily);
    summaries.push(summary);
    if (collectAlerts) alertTimeline = runAlerts;
  }

  return {
    summary: aggregateSummaries(summaries),
    trajectories: {
      p5: percentileTrajectories(allDaily, 0.05),
      p50: percentileTrajectories(allDaily, 0.5),
      p95: percentileTrajectories(allDaily, 0.95),
    },
    alertTimeline,
  };
}

/** @deprecated Use runOutbreakSimulation on scenario copies. */
export function runOutbreak(
  graph: ContactGraph,
  params: OutbreakParams,
  seed: number,
): OutbreakResult {
  const result = runOutbreakSimulation(graph, params, seed, []);
  return {
    summary: result.summary,
    trajectories: result.trajectories,
  };
}

export function buildUnitKindsFromGraph(graph: ContactGraph): Map<string, string> {
  const map = new Map<string, string>();
  for (const node of graph.nodes.values()) {
    if (node.type === "OrgUnit") {
      map.set(node.id, String(node.properties.kind ?? "org"));
    }
  }
  return map;
}
