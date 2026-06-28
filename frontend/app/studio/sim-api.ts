import { apiFetch } from "@/lib/auth";

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

export interface Scenario {
  id: string;
  name: string;
  params: Record<string, unknown>;
  createdAt: string;
}

export interface SimulationRun {
  id: string;
  status: string;
  seed: string;
  runs: number;
  createdAt: string;
  finishedAt: string | null;
}

export interface RunResult {
  runId: string;
  summary: OutbreakSummary;
  trajectories: {
    p5: DailyTrajectory[];
    p50: DailyTrajectory[];
    p95: DailyTrajectory[];
  };
}

export interface RunDetail {
  id: string;
  status: string;
  seed: string;
  params: Record<string, unknown>;
  runs: number;
  summary: OutbreakSummary | null;
  trajectories: RunResult["trajectories"] | null;
  createdAt: string;
  finishedAt: string | null;
}

function enc(env: string): string {
  return encodeURIComponent(env);
}

export async function createScenario(
  env: string,
  body: { name: string; params?: OutbreakParams },
): Promise<Scenario> {
  return apiFetch(`/v1/ontology/${enc(env)}/scenarios`, {
    method: "POST",
    body,
  });
}

export async function addScenarioOverride(
  env: string,
  scenarioId: string,
  body: {
    targetType: string;
    targetId?: string | null;
    op: string;
    payload?: Record<string, unknown>;
  },
): Promise<{ id: string }> {
  return apiFetch(`/v1/ontology/${enc(env)}/scenarios/${scenarioId}/overrides`, {
    method: "POST",
    body,
  });
}

export async function runScenario(
  env: string,
  scenarioId: string,
  body?: { params?: OutbreakParams; runs?: number; seed?: number },
): Promise<RunResult> {
  return apiFetch(`/v1/ontology/${enc(env)}/scenarios/${scenarioId}/run`, {
    method: "POST",
    body: body ?? {},
  });
}

export async function listScenarioRuns(
  env: string,
  scenarioId: string,
): Promise<{ runs: SimulationRun[] }> {
  return apiFetch(`/v1/ontology/${enc(env)}/scenarios/${scenarioId}/runs`);
}

export async function getScenarioRun(
  env: string,
  scenarioId: string,
  runId: string,
): Promise<RunDetail> {
  return apiFetch(
    `/v1/ontology/${enc(env)}/scenarios/${scenarioId}/runs/${runId}`,
  );
}
