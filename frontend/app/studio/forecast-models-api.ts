/**
 * Imported forecasting models: plugged in, checked, replayed on the past, put on trial.
 *
 * A model already trained somewhere else is shown the history the platform
 * keeps and gives back a forecast. Nothing here trains anything, and no key is
 * ever typed, sent or shown: an address that needs one names an environment
 * variable an administrator set on the API.
 */

import { apiFetch } from "@/lib/auth";

export type ModelSource = "reference" | "service" | "endpoint";
export type ModelState = "imported" | "verified" | "tried" | "on_trial";
export type ForecastStep = "hour" | "day";
export type Cell = number | null;

export interface Companion {
  name: string;
  kind: "past" | "known";
  /** `twin:<measure>`, the key of a declared series, or `calendar:hour` / `calendar:weekday`. */
  series: string;
  entity: string | null;
}

export interface ModelDraft {
  label: string;
  source: ModelSource;
  serviceModel: string | null;
  endpointUrl: string | null;
  /** The NAME of the environment variable that holds the key. Never the key. */
  endpointKeyEnv: string | null;
  metric: string;
  units: string[] | null;
  step: ForecastStep;
  historySteps: number;
  horizonSteps: number;
  holdHours: number | null;
  minHistoryDays: number;
  companions: Companion[];
  timeZone: string | null;
}

/** The three errors over the same steps, and how many steps that is. */
export interface Score {
  n: number;
  model: number | null;
  /** "The same hour a week before." */
  reference: number | null;
  /** "The last value holds." */
  held: number | null;
  /** The share of measures that fell inside the model's range, 0 to 1. */
  inside: number | null;
}

export interface Backtest {
  ranAt: string;
  days: number;
  step: ForecastStep;
  horizon: number;
  origins: { origin: string; series: number; leftOut: number; score: Score }[];
  overall: Score;
  byHorizon: Score[];
  verdict: { beats: boolean | null; why: string };
  partial: boolean;
  stopped: string | null;
  said: { name?: string; version?: string } | null;
  unit: string | null;
}

export interface Standing {
  computedAt: string;
  windowDays: number;
  forecasts: number;
  origins: number;
  overall: Score;
  byHorizon: Score[];
  shown: boolean;
  why: string;
  unit: string | null;
}

export interface ForecastModel extends ModelDraft {
  id: string;
  key: string;
  state: ModelState;
  verifiedAt: string | null;
  triedAt: string | null;
  backtest: Backtest | null;
  lastError: string | null;
  trialEveryHours: number;
  trialStartedAt: string | null;
  lastRunAt: string | null;
  standing: Standing | null;
  createdAt: string;
  updatedAt: string;
}

export interface ModelOffer {
  measures: { key: string; label: string; unit: string | null; units: number; since: string | null }[];
  series: { key: string; label: string; entities: string[] }[];
  calendar: string[];
  service: { configured: boolean; says: string };
  keyPrefix: string;
  contract: number;
  limits: { horizonMax: number; historyMax: number; seriesMax: number; sampleUnits: number; backtestDays: number };
}

export interface Verification {
  ok: boolean;
  why: string | null;
  sent: { to: string; series: number; history: number; horizon: number; step: ForecastStep; companions: string[]; bytes: number };
  leftOut: { unitId: string; name: string; why: string }[];
  sample: { unit: string; origin: string; low: Cell[]; likely: Cell[]; high: Cell[] } | null;
  said: { name?: string; version?: string } | null;
  ms: number | null;
}

export interface TrialRun {
  origin: string;
  frozen: number;
  why: string | null;
  missed: boolean;
}

/** A forecast a screen may show for a unit: only from a model the display rule lets through. */
export interface ShownForecast {
  model: { key: string; label: string; source: ModelSource; said: { name?: string; version?: string } | null };
  metric: string;
  unit: string | null;
  step: ForecastStep;
  origin: string;
  issuedAt: string;
  low: Cell[];
  likely: Cell[];
  high: Cell[];
  record: { overall: Score; why: string; windowDays: number };
}

const enc = (s: string): string => encodeURIComponent(s);
const base = (env: string): string => `/v1/ontology/${enc(env)}/forecast-models`;

export async function fetchForecastModels(env: string): Promise<{ models: ForecastModel[]; offer: ModelOffer }> {
  return apiFetch(base(env));
}
export async function importForecastModel(env: string, draft: ModelDraft): Promise<{ model: ForecastModel }> {
  return apiFetch(base(env), { method: "POST", body: draft });
}
export async function removeForecastModel(env: string, key: string): Promise<void> {
  await apiFetch(`${base(env)}/${enc(key)}`, { method: "DELETE" });
}
/** Sends the model a sample and checks what comes back against the contract. */
export async function verifyForecastModel(env: string, key: string): Promise<{ model: ForecastModel; verification: Verification }> {
  return apiFetch(`${base(env)}/${enc(key)}/verify`, { method: "POST", body: {} });
}
/** Replays the model on the last days, each time with only what was known then. */
export async function backtestForecastModel(env: string, key: string, days?: number): Promise<{ model: ForecastModel; backtest: Backtest }> {
  return apiFetch(`${base(env)}/${enc(key)}/backtest`, { method: "POST", body: days ? { days } : {} });
}
export async function setForecastTrial(
  env: string,
  key: string,
  on: boolean,
  everyHours?: number,
): Promise<{ model: ForecastModel; run: TrialRun | null; standing: Standing; nextRunAt: string | null }> {
  return apiFetch(`${base(env)}/${enc(key)}/trial`, { method: "POST", body: { on, ...(everyHours ? { everyHours } : {}) } });
}
/** What a screen may show for a unit. An empty list means no model has earned its place. */
export async function fetchShownForecasts(env: string, unitId: string): Promise<{ forecasts: ShownForecast[] }> {
  return apiFetch(`/v1/ontology/${enc(env)}/forecasts?unit=${enc(unitId)}`);
}
