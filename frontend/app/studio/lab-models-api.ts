/**
 * Supervised learning on a table, and a cell to write it by hand.
 *
 * The shapes here mirror scikit-learn's, on purpose: an estimator, its
 * parameters, a split, a score. What a user learns in this screen is what they
 * would write in a notebook, and the notebook tab is right beside it so the two
 * can be checked against each other.
 */

import { apiFetch } from "@/lib/auth";

const enc = encodeURIComponent;

export type LabTask = "regression" | "classification";
export type SplitMode = "random" | "chronological";

export interface Estimator {
  key: string;
  label: string;
  task: LabTask;
  params: Record<string, unknown>;
  note?: string;
}

export interface Importance {
  feature: string;
  weight: number;
}

export interface FoldScore {
  origin: string;
  nTrain: number;
  nTest: number;
  mae: number;
  rmse: number;
  naiveMae: number;
  mase: number;
}

export interface LabModel {
  id: string;
  /** A forecast and a table fit share one list, because a user has one list. */
  kind: "tabular" | "timeseries";
  projectId: string;
  name: string;
  datasetId: string | null;
  datasetName: string;
  task: LabTask;
  estimator: string;
  params: Record<string, unknown>;
  target: string;
  features: string[];
  numericFeatures: string[];
  categoricalFeatures: string[];
  split: SplitMode;
  testSize: number;
  timeColumn: string | null;
  /** The score on held-out rows. */
  metrics: Record<string, number>;
  /** The same score for a model that ignores every feature. */
  baseline: Record<string, number>;
  importances: Importance[];
  warnings: string[];
  classes: string[];
  nTrain: number;
  nTest: number;
  droppedRows: number;
  timeLags: number | null;
  horizon: number | null;
  exog: string[];
  /** Forecast only: every origin the walk-forward evaluation scored. */
  folds: FoldScore[];
  createdAt: string;
}

export interface TrainInput {
  name: string;
  datasetId: string;
  target: string;
  features: string[];
  estimator: string;
  params?: Record<string, unknown>;
  split?: SplitMode;
  testSize?: number;
  timeColumn?: string | null;
}

export interface CellResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  result: unknown;
  durationMs: number;
  timedOut: boolean;
}

export async function listEstimators(): Promise<{ estimators: Estimator[] }> {
  return apiFetch(`/v1/lab/estimators`);
}

export async function listLabModels(env: string): Promise<{ models: LabModel[] }> {
  return apiFetch(`/v1/ontology/${enc(env)}/lab/models`);
}

export async function trainLabModel(env: string, body: TrainInput): Promise<LabModel> {
  return apiFetch(`/v1/ontology/${enc(env)}/lab/models`, { method: "POST", body });
}

export interface ForecastInput {
  name: string;
  datasetId: string;
  timeColumn: string;
  target: string;
  estimator: string;
  lags?: number;
  horizon?: number;
  exog?: string[];
  params?: Record<string, unknown>;
  folds?: number;
}

export async function trainForecast(env: string, body: ForecastInput): Promise<LabModel> {
  return apiFetch(`/v1/ontology/${enc(env)}/lab/forecasts`, { method: "POST", body });
}

export async function runForecast(
  id: string,
  steps: number,
): Promise<{ points: Array<{ step: number; t: string; value: number }>; note: string }> {
  return apiFetch(`/v1/lab/models/${enc(id)}/forecast`, { method: "POST", body: { steps } });
}

export async function deleteLabModel(id: string): Promise<void> {
  await apiFetch(`/v1/lab/models/${enc(id)}`, { method: "DELETE" });
}

export async function predictWithModel(
  id: string,
  body: { rows?: Record<string, unknown>[]; datasetId?: string },
): Promise<{ predictions: unknown[]; rows?: Record<string, unknown>[] }> {
  return apiFetch(`/v1/lab/models/${enc(id)}/predict`, { method: "POST", body });
}

export async function runCell(
  env: string,
  body: { code: string; datasetId?: string | null; timeoutS?: number },
): Promise<CellResult> {
  return apiFetch(`/v1/ontology/${enc(env)}/lab/cell`, { method: "POST", body });
}

/**
 * How much better than nothing.
 *
 * The number a reader actually wants, and the one no library prints: not the
 * score, but the score against a model that ignores every feature. Returned as
 * a share of the error the baseline made, so 0 means "learned nothing" and 1
 * means "no error left".
 */
export function liftOverBaseline(model: LabModel): number | null {
  // A forecast is already scored against the right baseline: MASE is the error
  // divided by the naive forecast's error, so 1.0 means "no better than
  // repeating the last value". Recomputing a lift from MAE here would compare
  // it against the mean instead, which on a smooth series flatters everything.
  if (model.kind === "timeseries") {
    const mase = model.metrics.mase;
    return mase == null || !Number.isFinite(mase) ? null : 1 - mase;
  }
  if (model.task === "regression") {
    const mae = model.metrics.mae;
    const base = model.baseline.mae;
    if (mae == null || base == null || base === 0) return null;
    return 1 - mae / base;
  }
  const acc = model.metrics.accuracy;
  const base = model.baseline.accuracy;
  if (acc == null || base == null || base >= 1) return null;
  return (acc - base) / (1 - base);
}
