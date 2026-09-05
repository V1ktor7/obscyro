import type { DbClient } from "../lib/db.js";
import { BadRequest, NotFound } from "../lib/errors.js";
import { getDataset } from "./datasets.js";
import { proxyToSimService } from "./ml-simulation.js";

/**
 * Models trained in the lab, and the rows they were trained on.
 *
 * The Python service is stateless by design: it fits, scores, and hands back an
 * artifact. Everything that survives a restart lives here, beside the ontology
 * the model was trained against.
 *
 * The whole training context is stored with the score — columns, split, test
 * fraction, baseline, rows dropped. A model whose provenance is gone is a
 * number nobody can defend, which is the one thing this platform exists not to
 * produce.
 */

/** A fit reads the whole table, not a preview. Past this it is refused. */
const MAX_TRAINING_ROWS = 200_000;

export interface FoldScore {
  origin: string;
  nTrain: number;
  nTest: number;
  mae: number;
  rmse: number;
  naiveMae: number;
  mase: number;
}

export interface LabModelRow {
  id: string;
  /** A forecast and a table fit live in one list, because a user has one list. */
  kind: "tabular" | "timeseries";
  projectId: string;
  name: string;
  datasetId: string | null;
  datasetName: string;
  task: "regression" | "classification";
  estimator: string;
  params: Record<string, unknown>;
  target: string;
  features: string[];
  numericFeatures: string[];
  categoricalFeatures: string[];
  split: "random" | "chronological";
  testSize: number;
  timeColumn: string | null;
  metrics: Record<string, number>;
  baseline: Record<string, number>;
  importances: Array<{ feature: string; weight: number }>;
  warnings: string[];
  classes: string[];
  nTrain: number;
  nTest: number;
  droppedRows: number;
  /** Forecast only: how far back the features reach, and how far ahead it aims. */
  timeLags: number | null;
  horizon: number | null;
  exog: string[];
  /** Forecast only: every origin the walk-forward evaluation scored. */
  folds: FoldScore[];
  createdAt: string;
}

interface Raw {
  id: string;
  kind: "tabular" | "timeseries";
  project_id: string;
  name: string;
  dataset_id: string | null;
  dataset_name: string;
  task: LabModelRow["task"];
  estimator: string;
  params: Record<string, unknown>;
  target: string;
  features: string[];
  numeric_features: string[];
  categorical_features: string[];
  split: LabModelRow["split"];
  test_size: number;
  time_column: string | null;
  metrics: Record<string, number>;
  baseline: Record<string, number>;
  importances: Array<{ feature: string; weight: number }>;
  warnings: string[];
  classes: string[];
  n_train: number;
  n_test: number;
  dropped_rows: number;
  time_lags: number | null;
  horizon: number | null;
  exog: string[];
  folds: Array<Record<string, number | string>>;
  created_at: Date;
}

function toModel(r: Raw): LabModelRow {
  return {
    id: r.id,
    kind: r.kind ?? "tabular",
    projectId: r.project_id,
    name: r.name,
    datasetId: r.dataset_id,
    datasetName: r.dataset_name,
    task: r.task,
    estimator: r.estimator,
    params: r.params ?? {},
    target: r.target,
    features: r.features ?? [],
    numericFeatures: r.numeric_features ?? [],
    categoricalFeatures: r.categorical_features ?? [],
    split: r.split,
    testSize: Number(r.test_size),
    timeColumn: r.time_column,
    metrics: r.metrics ?? {},
    baseline: r.baseline ?? {},
    importances: r.importances ?? [],
    warnings: r.warnings ?? [],
    classes: r.classes ?? [],
    nTrain: r.n_train,
    nTest: r.n_test,
    droppedRows: r.dropped_rows,
    timeLags: r.time_lags,
    horizon: r.horizon,
    exog: r.exog ?? [],
    folds: (r.folds ?? []).map((f) => ({
      origin: String(f.origin ?? ""),
      nTrain: Number(f.n_train ?? 0),
      nTest: Number(f.n_test ?? 0),
      mae: Number(f.mae ?? 0),
      rmse: Number(f.rmse ?? 0),
      naiveMae: Number(f.naive_mae ?? 0),
      mase: Number(f.mase ?? 0),
    })),
    createdAt: r.created_at.toISOString(),
  };
}

const SELECT = `
  SELECT id, kind, project_id, name, dataset_id, dataset_name, task, estimator, params,
         target, features, numeric_features, categorical_features,
         split, test_size, time_column, metrics, baseline, importances, warnings,
         classes, n_train, n_test, dropped_rows, time_lags, horizon, exog, folds,
         created_at
    FROM app.lab_model`;

/**
 * Every row of a dataset's current state.
 *
 * `previewRows` caps at a few hundred, which is right for a picker and wrong
 * for a fit: a model trained on the first two hundred rows of a three-year
 * series has seen one season.
 */
export async function readAllRows(
  db: DbClient,
  datasetId: string,
): Promise<Record<string, unknown>[]> {
  const ds = await getDataset(db, datasetId);
  const sql =
    ds.kind === "stream"
      ? `SELECT data FROM app.dataset_row WHERE dataset_id = $1 LIMIT ${MAX_TRAINING_ROWS + 1}`
      : `SELECT r.data
           FROM app.dataset_row r
           JOIN app.dataset_version v ON v.id = r.version_id
          WHERE r.dataset_id = $1
            AND v.version = (SELECT MAX(version) FROM app.dataset_version WHERE dataset_id = $1)
          ORDER BY r.id ASC
          LIMIT ${MAX_TRAINING_ROWS + 1}`;
  const { rows } = await db.query<{ data: Record<string, unknown> }>(sql, [datasetId]);
  if (rows.length > MAX_TRAINING_ROWS) {
    throw BadRequest(
      "DATASET_TOO_LARGE",
      `Ce jeu dépasse ${MAX_TRAINING_ROWS.toLocaleString("fr-CA")} lignes. ` +
        "Filtrez-le par un pipeline avant d'entraîner.",
    );
  }
  return rows.map((r) => r.data);
}

export interface TrainInput {
  name: string;
  datasetId: string;
  target: string;
  features: string[];
  estimator: string;
  params?: Record<string, unknown>;
  split?: "random" | "chronological";
  testSize?: number;
  timeColumn?: string | null;
}

interface SimTrainResponse {
  task: LabModelRow["task"];
  estimator: string;
  params: Record<string, unknown>;
  metrics: Record<string, number>;
  baseline: Record<string, number>;
  importances: Array<{ feature: string; weight: number }>;
  n_train: number;
  n_test: number;
  dropped_rows: number;
  numeric_features: string[];
  categorical_features: string[];
  split: LabModelRow["split"];
  classes: string[];
  warnings: string[];
  artifact_b64: string;
}

export async function trainAndStore(
  db: DbClient,
  projectId: string,
  input: TrainInput,
  userId: string | null,
): Promise<LabModelRow> {
  const name = (input.name ?? "").trim();
  if (!name) throw BadRequest("MODEL_NAME_REQUIRED", "Un modèle a besoin d'un nom.");

  const ds = await getDataset(db, input.datasetId);
  const rows = await readAllRows(db, input.datasetId);

  const out = await proxyToSimService<SimTrainResponse>("/lab/train", {
    rows,
    target: input.target,
    features: input.features,
    estimator: input.estimator,
    params: input.params ?? {},
    split: input.split ?? "random",
    test_size: input.testSize ?? 0.25,
    time_column: input.timeColumn ?? null,
  });

  const { rows: inserted } = await db.query<{ id: string }>(
    `INSERT INTO app.lab_model (
       project_id, name, dataset_id, dataset_name, task, estimator, params,
       target, features, numeric_features, categorical_features,
       split, test_size, time_column, metrics, baseline, importances, warnings,
       classes, n_train, n_test, dropped_rows, artifact, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10::jsonb,$11::jsonb,
             $12,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb,$19::jsonb,
             $20,$21,$22,$23,$24)
     RETURNING id`,
    [
      projectId,
      name,
      input.datasetId,
      ds.name,
      out.task,
      out.estimator,
      JSON.stringify(out.params),
      input.target,
      JSON.stringify(input.features),
      JSON.stringify(out.numeric_features),
      JSON.stringify(out.categorical_features),
      out.split,
      input.testSize ?? 0.25,
      input.timeColumn ?? null,
      JSON.stringify(out.metrics),
      JSON.stringify(out.baseline),
      JSON.stringify(out.importances),
      JSON.stringify(out.warnings),
      JSON.stringify(out.classes),
      out.n_train,
      out.n_test,
      out.dropped_rows,
      Buffer.from(out.artifact_b64, "base64"),
      userId,
    ],
  );
  return getModel(db, inserted[0]!.id);
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

interface SimForecastResponse {
  estimator: string;
  params: Record<string, unknown>;
  horizon: number;
  lags: number;
  exog: string[];
  folds: Array<Record<string, number | string>>;
  metrics: Record<string, number>;
  importances: Array<{ feature: string; weight: number }>;
  n_points: number;
  dropped_rows: number;
  warnings: string[];
  artifact_b64: string;
}

/**
 * Fit a forecaster, and keep every origin it was scored at.
 *
 * The baseline stored beside it is the naive forecast, not the mean — on a
 * smooth daily series the mean is hopeless, so beating it would prove nothing.
 * `metrics.mase` is the ratio: at 1.0 the model is exactly as good as repeating
 * the last value, and above it, worse.
 */
export async function forecastAndStore(
  db: DbClient,
  projectId: string,
  input: ForecastInput,
  userId: string | null,
): Promise<LabModelRow> {
  const name = (input.name ?? "").trim();
  if (!name) throw BadRequest("MODEL_NAME_REQUIRED", "Un modèle a besoin d'un nom.");

  const ds = await getDataset(db, input.datasetId);
  const rows = await readAllRows(db, input.datasetId);

  const out = await proxyToSimService<SimForecastResponse>("/lab/forecast/train", {
    rows,
    time_column: input.timeColumn,
    target: input.target,
    estimator: input.estimator,
    lags: input.lags ?? 7,
    horizon: input.horizon ?? 1,
    exog: input.exog ?? [],
    params: input.params ?? {},
    folds: input.folds ?? 4,
  });

  const { rows: inserted } = await db.query<{ id: string }>(
    `INSERT INTO app.lab_model (
       project_id, kind, name, dataset_id, dataset_name, task, estimator, params,
       target, features, numeric_features, categorical_features,
       split, test_size, time_column, metrics, baseline, importances, warnings,
       classes, n_train, n_test, dropped_rows, time_lags, horizon, exog, folds,
       artifact, created_by)
     VALUES ($1,'timeseries',$2,$3,$4,'regression',$5,$6::jsonb,
             $7,$8::jsonb,'[]'::jsonb,'[]'::jsonb,
             'chronological',0.25,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,
             '[]'::jsonb,$14,$15,$16,$17,$18,$19::jsonb,$20::jsonb,$21,$22)
     RETURNING id`,
    [
      projectId,
      name,
      input.datasetId,
      ds.name,
      out.estimator,
      JSON.stringify(out.params),
      input.target,
      JSON.stringify([input.target, ...(out.exog ?? [])]),
      input.timeColumn,
      JSON.stringify(out.metrics),
      // The naive forecast, lifted out of the metrics so it sits in the same
      // field a tabular model uses for its own baseline.
      JSON.stringify({ mae: out.metrics.naive_mae ?? null, mase: 1 }),
      JSON.stringify(out.importances),
      JSON.stringify(out.warnings),
      out.n_points,
      out.folds.length,
      out.dropped_rows,
      out.lags,
      out.horizon,
      JSON.stringify(out.exog ?? []),
      JSON.stringify(out.folds),
      Buffer.from(out.artifact_b64, "base64"),
      userId,
    ],
  );
  return getModel(db, inserted[0]!.id);
}

/** Continue a stored forecaster past the last observation in its dataset. */
export async function runForecast(
  db: DbClient,
  id: string,
  steps: number,
): Promise<{ points: Array<{ step: number; t: string; value: number }>; note: string }> {
  const model = await getModel(db, id);
  if (model.kind !== "timeseries") {
    throw BadRequest(
      "NOT_A_FORECASTER",
      "Ce modèle n'est pas un modèle de série temporelle.",
    );
  }
  if (!model.datasetId) {
    throw BadRequest(
      "SOURCE_GONE",
      "Le jeu de données de ce modèle n'existe plus, donc son historique non plus.",
    );
  }
  const { rows: found } = await db.query<{ artifact: Buffer }>(
    `SELECT artifact FROM app.lab_model WHERE id = $1`,
    [id],
  );
  if (!found[0]) throw NotFound("MODEL_NOT_FOUND", "Modèle introuvable.");
  const rows = await readAllRows(db, model.datasetId);
  return proxyToSimService("/lab/forecast/run", {
    artifact_b64: found[0].artifact.toString("base64"),
    rows,
    steps,
  });
}

export async function listModels(db: DbClient, projectId: string): Promise<LabModelRow[]> {
  const { rows } = await db.query<Raw>(
    `${SELECT} WHERE project_id = $1 ORDER BY created_at DESC`,
    [projectId],
  );
  return rows.map(toModel);
}

export async function getModel(db: DbClient, id: string): Promise<LabModelRow> {
  const { rows } = await db.query<Raw>(`${SELECT} WHERE id = $1`, [id]);
  if (!rows[0]) throw NotFound("MODEL_NOT_FOUND", "Modèle introuvable.");
  return toModel(rows[0]);
}

export async function deleteModel(db: DbClient, id: string): Promise<void> {
  const { rowCount } = await db.query(`DELETE FROM app.lab_model WHERE id = $1`, [id]);
  if (!rowCount) throw NotFound("MODEL_NOT_FOUND", "Modèle introuvable.");
}

/**
 * Apply a stored model to rows the caller supplies.
 *
 * The artifact travels back out to the Python service to be applied, which is
 * the only place it is ever deserialised — and it only ever came from there in
 * the first place.
 */
export async function predictWith(
  db: DbClient,
  id: string,
  rows: Record<string, unknown>[],
): Promise<unknown[]> {
  const { rows: found } = await db.query<{ artifact: Buffer }>(
    `SELECT artifact FROM app.lab_model WHERE id = $1`,
    [id],
  );
  if (!found[0]) throw NotFound("MODEL_NOT_FOUND", "Modèle introuvable.");
  const out = await proxyToSimService<{ predictions: unknown[] }>("/lab/predict", {
    artifact_b64: found[0].artifact.toString("base64"),
    rows,
  });
  return out.predictions;
}

/** Predict over a whole dataset — the path a dashboard card will use. */
export async function predictOverDataset(
  db: DbClient,
  id: string,
  datasetId: string,
): Promise<{ rows: Record<string, unknown>[]; predictions: unknown[] }> {
  const rows = await readAllRows(db, datasetId);
  return { rows, predictions: await predictWith(db, id, rows) };
}
