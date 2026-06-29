import { config } from "../lib/config.js";
import type { DbClient } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { withTransaction } from "../lib/transaction.js";
import {
  buildContactGraphFromCopy,
  runOutbreakSimulation,
  type OutbreakParams,
} from "./simulation.js";
import type { ScenarioInstanceRow, ScenarioLinkRow } from "./twin-clone.js";

// ---------------------------------------------------------------------------
// Cross-service contract (mirrors simulation-service/app/schemas.py)
// ---------------------------------------------------------------------------

export interface SimDaily {
  day: number;
  S: number;
  E: number;
  I: number;
  R: number;
  isolationDemand: number;
}

export interface SimQuantileBands {
  p10: SimDaily[];
  p50: SimDaily[];
  p90: SimDaily[];
}

export interface SimModelInfo {
  type: string;
  id?: string | null;
  version?: string | null;
  fallback: boolean;
  fallback_reason?: string | null;
}

export interface SimPredictedProperties {
  instanceId: string;
  properties: Record<string, unknown>;
}

export interface SimResponse {
  engine: "ml";
  model: SimModelInfo;
  seed: number;
  horizonDays: number;
  quantiles: SimQuantileBands;
  baseline: SimQuantileBands;
  summary: {
    peakInfected: number;
    peakIsolationDemand: number;
    attackRate: number;
    daysToContain: number | null;
    hcwInfections: number;
  };
  ml_baseline_error: { rmse: number; mae: number; peakAbsError: number };
  feature_importances: Array<{ feature: string; importance: number }>;
  predicted_properties: SimPredictedProperties[];
  graph_trace: Array<{ node: string; type: string; status: string; detail?: string | null }>;
}

export interface GraphSpec {
  nodes: Array<{ id: string; type: string; inputs?: string[]; params?: Record<string, unknown> }>;
  output?: string;
}

export interface Intervention {
  kind: "none" | "close_unit" | "add_isolation_beds";
  unitId?: string | null;
  beds?: number | null;
}

export interface BuildSimPayloadOptions {
  scenarioId: string;
  instances: ScenarioInstanceRow[];
  links: ScenarioLinkRow[];
  params: OutbreakParams;
  seed: number;
  graphSpec?: GraphSpec | null;
  intervention?: Intervention | null;
  model?: { id?: string | null; version?: string | null } | null;
}

export interface SimPayload {
  scenario_id: string;
  seed: number;
  graph: {
    nodes: Array<{ id: string; type: string; properties: Record<string, unknown> }>;
    links: Array<{ linkTypeName: string; fromId: string; toId: string }>;
  };
  params: OutbreakParams;
  graph_spec?: GraphSpec | null;
  intervention?: Intervention | null;
  model?: { id?: string | null; version?: string | null } | null;
}

/** Build the stateless payload the simulation-service consumes from a scenario copy. */
export function buildSimPayload(opts: BuildSimPayloadOptions): SimPayload {
  return {
    scenario_id: opts.scenarioId,
    seed: opts.seed,
    graph: {
      nodes: opts.instances.map((i) => ({
        id: i.id,
        type: i.objectTypeName,
        properties: i.properties ?? {},
      })),
      links: opts.links.map((l) => ({
        linkTypeName: l.linkTypeName,
        fromId: l.fromId,
        toId: l.toId,
      })),
    },
    params: opts.params,
    graph_spec: opts.graphSpec ?? parseDefaultGraph(),
    intervention: opts.intervention ?? null,
    model: opts.model ?? null,
  };
}

function parseDefaultGraph(): GraphSpec | null {
  if (!config.simDefaultGraph) return null;
  try {
    return JSON.parse(config.simDefaultGraph) as GraphSpec;
  } catch {
    return null;
  }
}

/** POST to the simulation-service. Throws AppError on config/transport errors. */
export async function proxyToSimService<T>(path: string, body: unknown): Promise<T> {
  const base = config.simServiceUrl;
  if (!base) {
    throw new AppError(
      "SIM_UNAVAILABLE",
      "Simulation service is not configured. Set `SIM_SERVICE_URL`.",
      503,
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.simServiceTimeoutMs);
  try {
    const upstream = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let data: unknown = null;
    try {
      data = await upstream.json();
    } catch {
      data = null;
    }
    if (!upstream.ok) {
      throw new AppError(
        "SIM_UPSTREAM_ERROR",
        "Simulation service returned an error.",
        502,
        data ?? undefined,
      );
    }
    return data as T;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("SIM_UNAVAILABLE", "Simulation service is unreachable.", 503);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run an ML simulation. Tries the simulation-service; if it is unconfigured or
 * unreachable, falls back to the in-process mechanistic SEIR so `/simulate`
 * still returns a usable baseline (clearly tagged as a fallback).
 */
export async function runMlSimulation(
  opts: BuildSimPayloadOptions,
): Promise<{ response: SimResponse; usedFallback: boolean }> {
  const payload = buildSimPayload(opts);
  if (config.simServiceUrl) {
    try {
      const response = await proxyToSimService<SimResponse>("/simulate", payload);
      return { response, usedFallback: false };
    } catch (err) {
      // Only swallow transport/availability errors; surface upstream 4xx/5xx
      // detail when the service explicitly rejected the request.
      if (err instanceof AppError && err.code === "SIM_UPSTREAM_ERROR") throw err;
    }
  }
  return { response: mechanisticFallback(opts), usedFallback: true };
}

/** Build a SimResponse from the in-process mechanistic SEIR (no external service). */
export function mechanisticFallback(opts: BuildSimPayloadOptions): SimResponse {
  const graph = buildContactGraphFromCopy(opts.instances, opts.links);
  const result = runOutbreakSimulation(graph, opts.params, opts.seed, []);
  const bands: SimQuantileBands = {
    p10: result.trajectories.p5,
    p50: result.trajectories.p50,
    p90: result.trajectories.p95,
  };
  const horizon =
    result.trajectories.p50.length > 0
      ? result.trajectories.p50[result.trajectories.p50.length - 1]!.day
      : (opts.params.horizonDays ?? 60);
  return {
    engine: "ml",
    model: {
      type: "mechanistic_seir",
      id: opts.model?.id ?? null,
      version: opts.model?.version ?? null,
      fallback: true,
      fallback_reason: "simulation-service unavailable; in-process mechanistic baseline",
    },
    seed: opts.seed,
    horizonDays: horizon,
    quantiles: bands,
    baseline: bands,
    summary: result.summary,
    ml_baseline_error: { rmse: 0, mae: 0, peakAbsError: 0 },
    feature_importances: [],
    predicted_properties: [],
    graph_trace: [{ node: "seir", type: "mechanistic_seir", status: "fallback" }],
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export interface PersistMlRunOptions {
  db: DbClient;
  scenarioId: string;
  seed: bigint;
  params: OutbreakParams;
  graphSpec: GraphSpec | null;
  response: SimResponse;
}

/** Persist an ML simulation_run row. Returns the run id. */
export async function persistMlRun(opts: PersistMlRunOptions): Promise<string> {
  const { db, response } = opts;
  const modelId = isUuid(response.model.id) ? response.model.id : null;
  // Keep the legacy trajectories column populated for back-compat consumers.
  const legacyTrajectories = {
    p5: response.quantiles.p10,
    p50: response.quantiles.p50,
    p95: response.quantiles.p90,
  };
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO app.simulation_run
       (scenario_id, status, seed, params, runs, engine, model_id, model_version,
        graph_spec, quantiles, baseline, ml_baseline_error, feature_importances,
        summary, trajectories, alert_timeline, finished_at)
     VALUES ($1, 'completed', $2, $3::jsonb, $4, 'ml', $5, $6,
             $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb,
             $12::jsonb, $13::jsonb, '[]'::jsonb, NOW())
     RETURNING id`,
    [
      opts.scenarioId,
      opts.seed.toString(),
      JSON.stringify(opts.params),
      opts.params.runs ?? 10,
      modelId,
      response.model.version ?? null,
      opts.graphSpec ? JSON.stringify(opts.graphSpec) : null,
      JSON.stringify(response.quantiles),
      JSON.stringify(response.baseline),
      JSON.stringify(response.ml_baseline_error),
      JSON.stringify(response.feature_importances),
      JSON.stringify(response.summary),
      JSON.stringify(legacyTrajectories),
    ],
  );
  return rows[0]!.id;
}

/** Write predicted properties + provenance back onto the scenario branch. */
export async function writePredictedProperties(
  db: DbClient,
  scenarioId: string,
  predicted: SimPredictedProperties[],
  provenance: { model_id: string | null; version: string | null; run_id: string; seed: string },
): Promise<number> {
  if (!predicted.length) return 0;
  return withTransaction(async (tx) => {
    let written = 0;
    for (const p of predicted) {
      const { rowCount } = await tx.query(
        `UPDATE app.scenario_instance
            SET predicted_properties = $3::jsonb,
                prediction_provenance = $4::jsonb
          WHERE id = $1 AND scenario_id = $2`,
        [p.instanceId, scenarioId, JSON.stringify(p.properties), JSON.stringify(provenance)],
      );
      written += rowCount ?? 0;
    }
    return written;
  });
}

// ---------------------------------------------------------------------------
// Model registry (owner/org-scoped)
// ---------------------------------------------------------------------------

export interface SimulationModelRow {
  id: string;
  environmentId: string | null;
  modelType: string;
  name: string;
  version: string;
  datasetVersion: string | null;
  status: string;
  metrics: Record<string, unknown>;
  artifactUri: string | null;
  isActive: boolean;
  createdAt: Date;
}

export async function listSimulationModels(
  db: DbClient,
  environmentId: string,
  organizationId: string,
  page?: { limit: number; offset: number },
): Promise<SimulationModelRow[]> {
  const { rows } = await db.query<{
    id: string;
    environment_id: string | null;
    model_type: string;
    name: string;
    version: string;
    dataset_version: string | null;
    status: string;
    metrics: Record<string, unknown>;
    artifact_uri: string | null;
    is_active: boolean;
    created_at: Date;
  }>(
    `SELECT id, environment_id, model_type, name, version, dataset_version,
            status, metrics, artifact_uri, is_active, created_at
       FROM app.simulation_model
      WHERE (environment_id = $1 OR environment_id IS NULL)
        AND organization_id = $2
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4`,
    [environmentId, organizationId, page?.limit ?? 100, page?.offset ?? 0],
  );
  return rows.map((r) => ({
    id: r.id,
    environmentId: r.environment_id,
    modelType: r.model_type,
    name: r.name,
    version: r.version,
    datasetVersion: r.dataset_version,
    status: r.status,
    metrics: r.metrics ?? {},
    artifactUri: r.artifact_uri,
    isActive: r.is_active,
    createdAt: r.created_at,
  }));
}

export interface RecordModelOptions {
  db: DbClient;
  environmentId: string;
  ownerUserId: string;
  organizationId: string;
  modelType: string;
  name: string;
  version: string;
  datasetVersion?: string | null;
  status?: string;
  metrics?: Record<string, unknown>;
  artifactUri?: string | null;
}

export async function recordModel(opts: RecordModelOptions): Promise<string> {
  const { rows } = await opts.db.query<{ id: string }>(
    `INSERT INTO app.simulation_model
       (environment_id, model_type, name, version, dataset_version, status,
        metrics, artifact_uri, owner_user_id, organization_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
     ON CONFLICT (environment_id, name, version)
       DO UPDATE SET status = EXCLUDED.status,
                     metrics = EXCLUDED.metrics,
                     artifact_uri = EXCLUDED.artifact_uri,
                     dataset_version = EXCLUDED.dataset_version
     RETURNING id`,
    [
      opts.environmentId,
      opts.modelType,
      opts.name,
      opts.version,
      opts.datasetVersion ?? null,
      opts.status ?? "registered",
      JSON.stringify(opts.metrics ?? {}),
      opts.artifactUri ?? null,
      opts.ownerUserId,
      opts.organizationId,
    ],
  );
  return rows[0]!.id;
}

export async function recordTrainingRun(opts: {
  db: DbClient;
  modelId: string;
  environmentId: string;
  status: string;
  datasetKind: string;
  metrics: Record<string, unknown>;
  seed: number | null;
}): Promise<string> {
  const { rows } = await opts.db.query<{ id: string }>(
    `INSERT INTO app.simulation_training_run
       (model_id, environment_id, status, dataset_kind, metrics, seed, finished_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW())
     RETURNING id`,
    [
      opts.modelId,
      opts.environmentId,
      opts.status,
      opts.datasetKind,
      JSON.stringify(opts.metrics),
      opts.seed,
    ],
  );
  return rows[0]!.id;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
