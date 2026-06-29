import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { AppError, BadRequest, NotFound } from "../lib/errors.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import { resolveEnvironment } from "../services/ontology.js";
import {
  buildContactGraphFromCopy,
  countContactEdges,
  runOutbreakSimulation,
  validateOutbreakParams,
  type OutbreakParams,
} from "../services/simulation.js";
import { config, clampLimit, clampOffset } from "../lib/config.js";
import { listAlertRules } from "../services/twin.js";
import {
  cloneSubtree,
  getScenarioForEnv,
  getSimulationRun,
  injectScenario,
  listScenarioRuns,
  listScenarios,
  loadScenarioCopy,
} from "../services/twin-clone.js";
import {
  listSimulationModels,
  persistMlRun,
  proxyToSimService,
  recordModel,
  recordTrainingRun,
  runMlSimulation,
  writePredictedProperties,
  type GraphSpec,
  type Intervention,
} from "../services/ml-simulation.js";

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

const dailyTrajectory = z.object({
  day: z.number(),
  S: z.number(),
  E: z.number(),
  I: z.number(),
  R: z.number(),
  isolationDemand: z.number(),
});

const outbreakParamsSchema = z.object({
  beta: z.number().gt(0).max(1).optional(),
  r0: z.number().gt(0).max(20).optional(),
  incubationDays: z.number().int().min(1).max(60).optional(),
  infectiousDays: z.number().int().min(1).max(120).optional(),
  indexNodeIds: z.array(z.string().uuid()).max(1000).optional(),
  isolationCapacity: z.number().int().nonnegative().optional(),
  runs: z.number().int().min(1).max(config.simMaxRuns).optional(),
  horizonDays: z.number().int().min(1).max(365).optional(),
  containThreshold: z.number().int().nonnegative().optional(),
});

const runResultSchema = z.object({
  runId: z.string().uuid(),
  seed: z.string(),
  summary: z.object({
    peakInfected: z.number(),
    peakIsolationDemand: z.number(),
    attackRate: z.number(),
    daysToContain: z.number().nullable(),
    hcwInfections: z.number(),
  }),
  trajectories: z.object({
    p5: z.array(dailyTrajectory),
    p50: z.array(dailyTrajectory),
    p95: z.array(dailyTrajectory),
  }),
  alertTimeline: z.array(
    z.object({
      day: z.number(),
      unitInstanceId: z.string().uuid(),
      ruleId: z.string().uuid().nullable(),
      metric: z.string(),
      value: z.number(),
      severity: z.enum(["info", "warn", "critical"]),
      message: z.string(),
    }),
  ),
});

const graphSpecSchema = z.object({
  nodes: z
    .array(
      z.object({
        id: z.string().min(1),
        type: z.string().min(1),
        inputs: z.array(z.string()).optional(),
        params: z.record(z.unknown()).optional(),
      }),
    )
    .min(1)
    .max(32),
  output: z.string().optional(),
});

const interventionSchema = z.object({
  kind: z.enum(["none", "close_unit", "add_isolation_beds"]),
  unitId: z.string().uuid().nullish(),
  beds: z.number().int().min(0).max(100000).nullish(),
});

const twinSimRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/ontology/:env/twin/units/:id/clone",
    {
      schema: {
        summary: "Clone OrgUnit subtree into an isolated scenario",
        tags: ["twin-simulation"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        body: z.object({ name: z.string().trim().min(1).max(128) }),
        response: {
          201: z.object({
            scenarioId: z.string().uuid(),
            instanceCount: z.number(),
            linkCount: z.number(),
          }),
          404: errorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const result = await cloneSubtree(
        req.db,
        env.id,
        req.params.id,
        req.body.name,
        userId,
        env.organizationId,
      );
      return reply.code(201).send(result);
    },
  );

  app.get(
    "/ontology/:env/scenarios",
    {
      schema: {
        summary: "List twin-clone scenarios for an environment",
        tags: ["twin-simulation"],
        params: z.object({ env: z.string().min(1) }),
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(config.listMaxLimit).optional(),
          offset: z.coerce.number().int().min(0).optional(),
        }),
        response: {
          200: z.object({
            scenarios: z.array(
              z.object({
                id: z.string().uuid(),
                name: z.string(),
                rootUnitInstanceId: z.string().uuid().nullable(),
                createdAt: z.string(),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const scenarios = await listScenarios(req.db, env.id, {
        limit: req.query.limit,
        offset: req.query.offset,
      });
      return {
        scenarios: scenarios.map((s) => ({
          id: s.id,
          name: s.name,
          rootUnitInstanceId: s.rootUnitInstanceId,
          createdAt: s.createdAt.toISOString(),
        })),
      };
    },
  );

  app.get(
    "/ontology/:env/scenarios/:id",
    {
      schema: {
        summary: "Get scenario detail with copy counts",
        tags: ["twin-simulation"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        response: { 200: z.record(z.unknown()), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const scenario = await getScenarioForEnv(req.db, req.params.id, env.id);
      const copy = await loadScenarioCopy(req.db, scenario.id);
      const runs = await listScenarioRuns(req.db, scenario.id);
      return {
        ...scenario,
        createdAt: scenario.createdAt.toISOString(),
        instanceCount: copy.instances.length,
        linkCount: copy.links.length,
        runs: runs.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
          finishedAt: r.finishedAt?.toISOString() ?? null,
        })),
      };
    },
  );

  app.post(
    "/ontology/:env/scenarios/:id/inject",
    {
      schema: {
        summary: "Inject scenario instances or param overrides",
        tags: ["twin-simulation"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        body: z.object({
          instances: z
            .array(
              z.object({
                objectTypeName: z.string().min(1),
                properties: z.record(z.unknown()),
                sourceInstanceId: z.string().uuid().nullable().optional(),
              }),
            )
            .optional(),
          paramOverrides: z.record(z.unknown()).optional(),
        }),
        response: {
          200: z.object({ instanceIds: z.array(z.string().uuid()) }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      await getScenarioForEnv(req.db, req.params.id, env.id);
      return injectScenario(req.db, req.params.id, req.body);
    },
  );

  app.post(
    "/ontology/:env/scenarios/:id/run",
    {
      schema: {
        summary: "Run outbreak simulation on scenario copy (never mutates live instances)",
        tags: ["twin-simulation"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        body: z.object({
          params: outbreakParamsSchema.optional(),
          runs: z.number().int().min(1).max(config.simMaxRuns).optional(),
          seed: z.number().int().optional(),
        }),
        response: { 200: runResultSchema, 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const scenario = await getScenarioForEnv(req.db, req.params.id, env.id);

      const copy = await loadScenarioCopy(req.db, scenario.id);
      if (!copy.instances.length) {
        throw BadRequest("SCENARIO_EMPTY", "Scenario has no cloned instances. Clone a unit first.");
      }

      const mergedParams: OutbreakParams = {
        ...(scenario.params as OutbreakParams),
        ...(req.body.params ?? {}),
        runs: req.body.runs ?? (req.body.params?.runs ?? (scenario.params as OutbreakParams).runs),
      };
      validateOutbreakParams(mergedParams);

      const graph = buildContactGraphFromCopy(copy.instances, copy.links);
      // A scenario with people but no contacts can only ever produce a flat
      // curve; surface that explicitly rather than returning misleading zeros.
      if (graph.nodes.size > 1 && countContactEdges(graph) === 0) {
        throw BadRequest(
          "SCENARIO_NO_CONTACTS",
          "Scenario copy has no contact links between instances. Add contacts before running.",
        );
      }

      const seed = BigInt(req.body.seed ?? Date.now());

      const { rows: runRows } = await req.db.query<{ id: string }>(
        `INSERT INTO app.simulation_run (scenario_id, status, seed, params, runs)
         VALUES ($1, 'running', $2, $3::jsonb, $4)
         RETURNING id`,
        [
          scenario.id,
          seed.toString(),
          JSON.stringify(mergedParams),
          mergedParams.runs ?? 10,
        ],
      );
      const runId = runRows[0]!.id;

      try {
        const rules = await listAlertRules(req.db, env.id);
        const result = runOutbreakSimulation(
          graph,
          mergedParams,
          Number(seed % BigInt(2 ** 32)),
          rules,
        );

        await req.db.query(
          `UPDATE app.simulation_run
              SET status = 'completed',
                  summary = $2::jsonb,
                  trajectories = $3::jsonb,
                  alert_timeline = $4::jsonb,
                  finished_at = NOW()
            WHERE id = $1`,
          [
            runId,
            JSON.stringify(result.summary),
            JSON.stringify(result.trajectories),
            JSON.stringify(result.alertTimeline),
          ],
        );

        req.log.info(
          {
            scenarioId: scenario.id,
            runId,
            seed: seed.toString(),
            runs: mergedParams.runs ?? 10,
            nodes: graph.nodes.size,
            contactEdges: countContactEdges(graph),
            peakInfected: result.summary.peakInfected,
          },
          "simulation run completed",
        );

        return {
          runId,
          seed: seed.toString(),
          summary: result.summary,
          trajectories: result.trajectories,
          alertTimeline: result.alertTimeline,
        };
      } catch (err) {
        await req.db.query(
          `UPDATE app.simulation_run SET status = 'failed', finished_at = NOW() WHERE id = $1`,
          [runId],
        );
        throw err;
      }
    },
  );

  app.get(
    "/ontology/:env/scenarios/:id/runs/:runId",
    {
      schema: {
        summary: "Get simulation run result",
        tags: ["twin-simulation"],
        params: z.object({
          env: z.string().min(1),
          id: z.string().uuid(),
          runId: z.string().uuid(),
        }),
        response: { 200: z.record(z.unknown()), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      await getScenarioForEnv(req.db, req.params.id, env.id);
      const run = await getSimulationRun(req.db, req.params.id, req.params.runId);
      return {
        id: run.id,
        status: run.status,
        seed: run.seed,
        params: run.params,
        runs: run.runs,
        summary: run.summary,
        trajectories: run.trajectories,
        alertTimeline: run.alertTimeline,
        engine: run.engine,
        modelId: run.modelId,
        modelVersion: run.modelVersion,
        graphSpec: run.graphSpec,
        quantiles: run.quantiles,
        baseline: run.baseline,
        mlBaselineError: run.mlBaselineError,
        featureImportances: run.featureImportances,
        createdAt: run.createdAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
      };
    },
  );

  // -------------------------------------------------------------------------
  // ML simulation: run the hybrid model DAG via the simulation-service,
  // persist the run + predicted properties (with provenance) onto the branch.
  // -------------------------------------------------------------------------
  app.post(
    "/ontology/:env/scenarios/:id/simulate",
    {
      schema: {
        summary: "Run hybrid ML simulation (model DAG) on a scenario branch",
        description:
          "Projects the scenario copy to the simulation-service, runs the model DAG " +
          "(mechanistic SEIR + Neural-ODE/UDE, with GNN/TFT/surrogate/causal fallbacks), " +
          "persists quantiles/baseline/error/feature-importances and writes predicted " +
          "properties + provenance onto the branch. Falls back to in-process mechanistic " +
          "SEIR when the service is unconfigured or unreachable.",
        tags: ["twin-simulation"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        body: z.object({
          params: outbreakParamsSchema.optional(),
          seed: z.number().int().optional(),
          graphSpec: graphSpecSchema.optional(),
          intervention: interventionSchema.optional(),
          model: z
            .object({ id: z.string().uuid().nullish(), version: z.string().nullish() })
            .optional(),
        }),
        response: { 200: z.record(z.unknown()), 400: errorEnvelope, 404: errorEnvelope, 502: errorEnvelope, 503: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const scenario = await getScenarioForEnv(req.db, req.params.id, env.id);

      const copy = await loadScenarioCopy(req.db, scenario.id);
      if (!copy.instances.length) {
        throw BadRequest("SCENARIO_EMPTY", "Scenario has no cloned instances. Clone a unit first.");
      }

      const mergedParams: OutbreakParams = {
        ...(scenario.params as OutbreakParams),
        ...(req.body.params ?? {}),
      };
      validateOutbreakParams(mergedParams);

      // Guard the same flat-curve case the mechanistic /run guards against.
      const graph = buildContactGraphFromCopy(copy.instances, copy.links);
      if (graph.nodes.size > 1 && countContactEdges(graph) === 0) {
        throw BadRequest(
          "SCENARIO_NO_CONTACTS",
          "Scenario copy has no contact links between instances. Add contacts before running.",
        );
      }

      const seed = BigInt(req.body.seed ?? Date.now());
      const seed32 = Number(seed % BigInt(2 ** 32));
      const graphSpec = (req.body.graphSpec as GraphSpec | undefined) ?? null;

      const { response, usedFallback } = await runMlSimulation({
        scenarioId: scenario.id,
        instances: copy.instances,
        links: copy.links,
        params: mergedParams,
        seed: seed32,
        graphSpec,
        intervention: (req.body.intervention as Intervention | undefined) ?? null,
        model: req.body.model ?? null,
      });

      const runId = await persistMlRun({
        db: req.db,
        scenarioId: scenario.id,
        seed,
        params: mergedParams,
        graphSpec,
        response,
      });

      const predictedWritten = await writePredictedProperties(
        req.db,
        scenario.id,
        response.predicted_properties,
        {
          model_id: response.model.id ?? null,
          version: response.model.version ?? null,
          run_id: runId,
          seed: seed.toString(),
        },
      );

      req.log.info(
        {
          scenarioId: scenario.id,
          runId,
          seed: seed.toString(),
          engine: response.engine,
          modelType: response.model.type,
          usedFallback,
          predictedWritten,
          nodes: graph.nodes.size,
          peakInfected: response.summary.peakInfected,
        },
        "ml simulation run completed",
      );

      return {
        runId,
        seed: seed.toString(),
        engine: response.engine,
        usedFallback,
        model: response.model,
        horizonDays: response.horizonDays,
        summary: response.summary,
        quantiles: response.quantiles,
        baseline: response.baseline,
        mlBaselineError: response.ml_baseline_error,
        featureImportances: response.feature_importances,
        predictedWritten,
        graphTrace: response.graph_trace,
      };
    },
  );

  app.get(
    "/ontology/:env/simulation-models",
    {
      schema: {
        summary: "List registered simulation models for an environment",
        tags: ["twin-simulation"],
        params: z.object({ env: z.string().min(1) }),
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(config.listMaxLimit).optional(),
          offset: z.coerce.number().int().min(0).optional(),
        }),
        response: { 200: z.object({ models: z.array(z.record(z.unknown())) }) },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const models = await listSimulationModels(req.db, env.id, env.organizationId, {
        limit: clampLimit(req.query.limit),
        offset: clampOffset(req.query.offset),
      });
      return {
        models: models.map((m) => ({
          id: m.id,
          environmentId: m.environmentId,
          modelType: m.modelType,
          name: m.name,
          version: m.version,
          datasetVersion: m.datasetVersion,
          status: m.status,
          metrics: m.metrics,
          artifactUri: m.artifactUri,
          isActive: m.isActive,
          createdAt: m.createdAt.toISOString(),
        })),
      };
    },
  );

  app.post(
    "/ontology/:env/simulation-models/:name/train",
    {
      schema: {
        summary: "Train (cold-start) a simulation model and register the artifact",
        description:
          "Proxies a cold-start training job to the simulation-service (synthetic SEIR data), " +
          "records the model + training run in the registry. Requires SIM_SERVICE_URL.",
        tags: ["twin-simulation"],
        params: z.object({ env: z.string().min(1), name: z.string().trim().min(1).max(128) }),
        body: z.object({
          modelType: z.string().trim().min(1).max(64).default("neural_ode_ude"),
          version: z.string().trim().min(1).max(64).default("0.1.0"),
          seed: z.number().int().optional(),
          datasetKind: z.enum(["synthetic", "history"]).default("synthetic"),
          samples: z.number().int().min(1).max(2000).optional(),
          epochs: z.number().int().min(1).max(1000).optional(),
        }),
        response: { 200: z.record(z.unknown()), 502: errorEnvelope, 503: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);

      const seed = req.body.seed ?? 1;
      const trainResult = await proxyToSimService<{
        model_type: string;
        name: string;
        version: string;
        status: "ready" | "failed";
        seed: number;
        dataset_kind: string;
        artifact_uri?: string | null;
        metrics: Record<string, unknown>;
      }>("/train", {
        model_type: req.body.modelType,
        name: req.params.name,
        version: req.body.version,
        seed,
        dataset_kind: req.body.datasetKind,
        samples: req.body.samples ?? 64,
        epochs: req.body.epochs ?? 50,
      });

      const modelId = await recordModel({
        db: req.db,
        environmentId: env.id,
        ownerUserId: userId,
        organizationId: env.organizationId,
        modelType: trainResult.model_type,
        name: trainResult.name,
        version: trainResult.version,
        status: trainResult.status === "ready" ? "ready" : "failed",
        metrics: trainResult.metrics,
        artifactUri: trainResult.artifact_uri ?? null,
      });

      await recordTrainingRun({
        db: req.db,
        modelId,
        environmentId: env.id,
        status: trainResult.status === "ready" ? "completed" : "failed",
        datasetKind: trainResult.dataset_kind,
        metrics: trainResult.metrics,
        seed,
      });

      req.log.info(
        { environmentId: env.id, modelId, name: trainResult.name, version: trainResult.version, status: trainResult.status },
        "simulation model training recorded",
      );

      return {
        modelId,
        modelType: trainResult.model_type,
        name: trainResult.name,
        version: trainResult.version,
        status: trainResult.status,
        seed,
        datasetKind: trainResult.dataset_kind,
        artifactUri: trainResult.artifact_uri ?? null,
        metrics: trainResult.metrics,
      };
    },
  );
};

async function requireUserId(req: {
  apiKey?: { id: string } | null;
  db: DbClient;
}): Promise<string> {
  const apiKey = req.apiKey;
  if (!apiKey) throw new AppError("INVALID_API_KEY", "API key required.", 401);
  const userId = await resolveUserIdForApiKey(req.db, apiKey.id);
  if (!userId) throw NotFound("USER_NOT_FOUND", "User not found for API key.");
  return userId;
}

export default twinSimRoutes;
