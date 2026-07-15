/**
 * Causal simulation lab — client for /v1/ontology/:env/lab/*.
 * Signals, causality edges, named model training, forecasts + event injection.
 */

import { apiFetch } from "@/lib/auth";

export type SignalKind = "type_count" | "type_property" | "channel";

export interface LabSignal {
  signal: string;
  kind: SignalKind;
  label: string;
  entity: string;
}

export interface CausalityEdge {
  fromSignal: string;
  toSignal: string;
  lagHours: number;
  strength: number;
  confidence: number;
  sampleCount: number;
  computedAt: string;
}

export interface ModelFeature {
  signal: string;
  lag: number;
}

export interface LabModelMetrics {
  mae: number;
  mape: number | null;
  baselineMae: number;
  improvement: number;
  samples: number;
}

export interface LabModel {
  id: string;
  name: string;
  version: string;
  status: string;
  targetSignal: string;
  features: ModelFeature[];
  horizonHours: number;
  windowHours: number;
  metrics: LabModelMetrics;
  isActive: boolean;
  createdAt: string;
}

export interface ForecastEvent {
  signal: string;
  delta: number;
  startHours: number;
  durationHours: number;
}

export interface ForecastResult {
  pastHours: string[];
  observed: number[];
  backtest: (number | null)[];
  futureHours: string[];
  forecast: number[];
  simulated: number[] | null;
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

export async function listLabSignals(env: string): Promise<{ signals: LabSignal[] }> {
  return apiFetch(`/v1/ontology/${enc(env)}/lab/signals`);
}

export async function listCausality(env: string): Promise<{ edges: CausalityEdge[] }> {
  return apiFetch(`/v1/ontology/${enc(env)}/lab/causality`);
}

export async function scanCausality(
  env: string,
  opts?: { windowHours?: number; maxLagHours?: number },
): Promise<{ edges: CausalityEdge[]; signalCount: number; windowHours: number }> {
  return apiFetch(`/v1/ontology/${enc(env)}/lab/causality/scan`, {
    method: "POST",
    body: opts ?? {},
  });
}

export async function listLabModels(env: string): Promise<{ models: LabModel[] }> {
  return apiFetch(`/v1/ontology/${enc(env)}/lab/models`);
}

export async function trainLabModel(
  env: string,
  body: {
    name: string;
    targetSignal: string;
    features: ModelFeature[];
    horizonHours?: number;
    windowHours?: number;
    /** Uploaded CSV columns (name → ordered numeric values, oldest first). */
    dataset?: Record<string, number[]>;
  },
): Promise<LabModel> {
  return apiFetch(`/v1/ontology/${enc(env)}/lab/models`, { method: "POST", body });
}

export async function deleteLabModel(env: string, id: string): Promise<{ ok: true }> {
  return apiFetch(`/v1/ontology/${enc(env)}/lab/models/${enc(id)}`, { method: "DELETE" });
}

export async function forecastLabModel(
  env: string,
  id: string,
  event: ForecastEvent | null,
): Promise<ForecastResult> {
  return apiFetch(`/v1/ontology/${enc(env)}/lab/models/${enc(id)}/forecast`, {
    method: "POST",
    body: { event },
  });
}
