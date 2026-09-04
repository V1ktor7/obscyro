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

export interface LabModel {
  id: string;
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
