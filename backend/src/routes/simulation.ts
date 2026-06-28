import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { AppError, NotFound } from "../lib/errors.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import { resolveEnvironment } from "../services/ontology.js";
import {
  applyOverrides,
  buildContactGraph,
  getScenarioForEnv,
  loadScenarioOverrides,
  runOutbreak,
  type OutbreakParams,
} from "../services/simulation.js";

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
  beta: z.number().optional(),
  r0: z.number().optional(),
  incubationDays: z.number().int().positive().optional(),
  infectiousDays: z.number().int().positive().optional(),
  indexNodeIds: z.array(z.string().uuid()).optional(),
  isolationCapacity: z.number().int().nonnegative().optional(),
  runs: z.number().int().min(1).max(200).optional(),
  horizonDays: z.number().int().min(1).max(365).optional(),
  containThreshold: z.number().int().nonnegative().optional(),
});

const simulationRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/ontology/:env/scenarios",
    {
      schema: {
        summary: "Create a simulation scenario for an environment",
        tags: ["simulation"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          name: z.string().trim().min(1).max(128),
          params: z.record(z.unknown()).optional(),
        }),
        response: {
          201: z.object({
            id: z.string().uuid(),
            name: z.string(),
            params: z.record(z.unknown()),
            createdAt: z.string(),
          }),
          404: errorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const params = req.body.params ?? {};
      const { rows } = await req.db.query<{
        id: string;
        created_at: Date;
      }>(
        `INSERT INTO app.scenario (environment_id, name, params, owner_user_id, organization_id)
         VALUES ($1, $2, $3::jsonb, $4, $5)
         RETURNING id, created_at`,
        [env.id, req.body.name, JSON.stringify(params), userId, env.organizationId],
      );
      const row = rows[0]!;
      return reply.code(201).send({
        id: row.id,
        name: req.body.name,
        params,
        createdAt: row.created_at.toISOString(),
      });
    },
  );

  app.post(
    "/ontology/:env/scenarios/:id/overrides",
    {
      schema: {
        summary: "Add an in-memory override to a scenario",
        tags: ["simulation"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        body: z.object({
          targetType: z.string().min(1),
          targetId: z.string().uuid().nullable().optional(),
          op: z.string().min(1),
          payload: z.record(z.unknown()).optional(),
        }),
        response: {
          201: z.object({ id: z.string().uuid() }),
          404: errorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      await getScenarioForEnv(req.db, req.params.id, env.id);
      const { rows } = await req.db.query<{ id: string }>(
        `INSERT INTO app.scenario_override (scenario_id, target_type, target_id, op, payload)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         RETURNING id`,
        [
          req.params.id,
          req.body.targetType,
          req.body.targetId ?? null,
          req.body.op,
          JSON.stringify(req.body.payload ?? {}),
        ],
      );
      return reply.code(201).send({ id: rows[0]!.id });
    },
  );

  app.post(
    "/ontology/:env/scenarios/:id/run",
    {
      schema: {
        summary: "Run outbreak simulation (read-only over ontology instances)",
        tags: ["simulation"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        body: z.object({
          params: outbreakParamsSchema.optional(),
          runs: z.number().int().min(1).max(200).optional(),
          seed: z.number().int().optional(),
        }),
        response: {
          200: z.object({
            runId: z.string().uuid(),
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
          }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const scenario = await getScenarioForEnv(req.db, req.params.id, env.id);

      const mergedParams: OutbreakParams = {
        ...(scenario.params as OutbreakParams),
        ...(req.body.params ?? {}),
        runs: req.body.runs ?? (req.body.params?.runs ?? (scenario.params as OutbreakParams).runs),
      };
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
        const baseGraph = await buildContactGraph(req.db, env.id);
        const overrides = await loadScenarioOverrides(req.db, scenario.id);
        const graph = applyOverrides(baseGraph, overrides);
        const result = runOutbreak(graph, mergedParams, Number(seed % BigInt(2 ** 32)));

        await req.db.query(
          `UPDATE app.simulation_run
              SET status = 'completed', summary = $2::jsonb, trajectories = $3::jsonb, finished_at = NOW()
            WHERE id = $1`,
          [runId, JSON.stringify(result.summary), JSON.stringify(result.trajectories)],
        );

        return { runId, summary: result.summary, trajectories: result.trajectories };
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
    "/ontology/:env/scenarios/:id/runs",
    {
      schema: {
        summary: "List simulation runs for a scenario",
        tags: ["simulation"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        response: {
          200: z.object({
            runs: z.array(
              z.object({
                id: z.string().uuid(),
                status: z.string(),
                seed: z.string(),
                runs: z.number(),
                createdAt: z.string(),
                finishedAt: z.string().nullable(),
              }),
            ),
          }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      await getScenarioForEnv(req.db, req.params.id, env.id);
      const { rows } = await req.db.query<{
        id: string;
        status: string;
        seed: string;
        runs: number;
        created_at: Date;
        finished_at: Date | null;
      }>(
        `SELECT id, status, seed::text, runs, created_at, finished_at
           FROM app.simulation_run
          WHERE scenario_id = $1
          ORDER BY created_at DESC
          LIMIT 50`,
        [req.params.id],
      );
      return {
        runs: rows.map((r) => ({
          id: r.id,
          status: r.status,
          seed: r.seed,
          runs: r.runs,
          createdAt: r.created_at.toISOString(),
          finishedAt: r.finished_at?.toISOString() ?? null,
        })),
      };
    },
  );

  app.get(
    "/ontology/:env/scenarios/:id/runs/:runId",
    {
      schema: {
        summary: "Get a simulation run result",
        tags: ["simulation"],
        params: z.object({
          env: z.string().min(1),
          id: z.string().uuid(),
          runId: z.string().uuid(),
        }),
        response: {
          200: z.object({
            id: z.string().uuid(),
            status: z.string(),
            seed: z.string(),
            params: z.record(z.unknown()),
            runs: z.number(),
            summary: z.record(z.unknown()).nullable(),
            trajectories: z.record(z.unknown()).nullable(),
            createdAt: z.string(),
            finishedAt: z.string().nullable(),
          }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      await getScenarioForEnv(req.db, req.params.id, env.id);
      const { rows } = await req.db.query<{
        id: string;
        status: string;
        seed: string;
        params: Record<string, unknown>;
        runs: number;
        summary: Record<string, unknown> | null;
        trajectories: Record<string, unknown> | null;
        created_at: Date;
        finished_at: Date | null;
      }>(
        `SELECT id, status, seed::text, params, runs, summary, trajectories, created_at, finished_at
           FROM app.simulation_run
          WHERE id = $1 AND scenario_id = $2`,
        [req.params.runId, req.params.id],
      );
      const r = rows[0];
      if (!r) throw NotFound("RUN_NOT_FOUND", "Simulation run not found.");
      return {
        id: r.id,
        status: r.status,
        seed: r.seed,
        params: r.params ?? {},
        runs: r.runs,
        summary: r.summary,
        trajectories: r.trajectories,
        createdAt: r.created_at.toISOString(),
        finishedAt: r.finished_at?.toISOString() ?? null,
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

export default simulationRoutes;
