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
import { config } from "../lib/config.js";
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
        createdAt: run.createdAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
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
