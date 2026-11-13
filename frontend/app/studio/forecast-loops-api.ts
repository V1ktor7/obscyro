/**
 * Live forecasts: a daily loop over one series, every forecast frozen the
 * morning it was made. The server replays the mornings in blocks and keeps
 * going on its own; this screen reads what it froze.
 */

import { apiFetch } from "@/lib/auth";

const enc = encodeURIComponent;

export interface LoopSpec {
  key: string;
  label: string;
  estimator: string;
  exog: boolean;
  params: Record<string, unknown>;
}

export interface ForecastLoop {
  id: string;
  projectId: string;
  name: string;
  datasetId: string;
  datasetName: string;
  timeColumn: string;
  target: string;
  driver: { datasetId: string; datasetName: string; timeColumn: string; column: string; delay: number } | null;
  horizons: number[];
  lags: number;
  specs: LoopSpec[];
  startDate: string;
  frozenThrough: string | null;
  status: "replaying" | "live" | "failed";
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LoopView {
  loop: ForecastLoop;
  actual: Record<string, number>;
  lastDay: string | null;
  forecasts: Array<{ made: string; h: number; spec: string; value: number }>;
  retrains: Array<{ on: string; h: number; spec: string; mae: number | null; points: number }>;
}

export async function listForecastLoops(env: string): Promise<{ loops: ForecastLoop[] }> {
  return apiFetch(`/v1/ontology/${enc(env)}/forecast-loops`);
}

export async function createForecastLoop(
  env: string,
  body: {
    name: string;
    datasetId: string;
    timeColumn: string;
    target: string;
    driver?: { datasetId: string; timeColumn: string; column: string; delay?: number } | null;
    startDate: string;
  },
): Promise<ForecastLoop> {
  return apiFetch(`/v1/ontology/${enc(env)}/forecast-loops`, { method: "POST", body });
}

export async function forecastLoopView(env: string, id: string): Promise<LoopView> {
  return apiFetch(`/v1/ontology/${enc(env)}/forecast-loops/${id}/view`);
}

export async function catchUpForecastLoop(env: string, id: string): Promise<ForecastLoop> {
  return apiFetch(`/v1/ontology/${enc(env)}/forecast-loops/${id}/catch-up`, { method: "POST" });
}

export async function deleteForecastLoop(env: string, id: string): Promise<{ deleted: boolean }> {
  return apiFetch(`/v1/ontology/${enc(env)}/forecast-loops/${id}`, { method: "DELETE" });
}
