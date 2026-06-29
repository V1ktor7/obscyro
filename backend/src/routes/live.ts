import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { config } from "../lib/config.js";
import type { DbClient } from "../lib/db.js";
import { AppError, NotFound } from "../lib/errors.js";
import { startSseStream } from "../lib/sse.js";
import { parseWhere } from "../lib/where-filter.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import {
  computeMetrics,
  deleteScoreSpec,
  listScoreSpecs,
  resolveScoreSpec,
  scoreInstance,
  upsertScoreSpec,
} from "../services/live-analysis.js";
import { resolveEnvironment } from "../services/ontology.js";

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

const scoreSpecSchema = z.object({
  rules: z.array(
    z.object({
      key: z.string(),
      bands: z.array(z.object({ max: z.number(), score: z.number() })),
    }),
  ),
});

const liveRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/ontology/:env/metrics",
    {
      schema: {
        summary: "Snapshot of live operational metrics for an environment",
        tags: ["live-analysis"],
        params: z.object({ env: z.string().min(1) }),
        querystring: z.object({ where: z.string().optional() }),
        response: {
          200: z.object({
            computedAt: z.string(),
            totalInstances: z.number(),
            byType: z.array(
              z.object({
                typeName: z.string(),
                count: z.number(),
                freshnessSeconds: z.number().nullable(),
                newestUpdatedAt: z.string().nullable(),
              }),
            ),
            occupancy: z.array(
              z.object({
                typeName: z.string(),
                property: z.string(),
                value: z.string(),
                count: z.number(),
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
      const wherePairs = parseWhere(req.query.where);
      return computeMetrics(req.db, env.id, wherePairs);
    },
  );

  app.get(
    "/ontology/:env/metrics/stream",
    {
      schema: {
        summary: "SSE stream of live metrics (recomputed every ~5s)",
        tags: ["live-analysis"],
        params: z.object({ env: z.string().min(1) }),
        querystring: z.object({ where: z.string().optional() }),
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const wherePairs = parseWhere(req.query.where);

      startSseStream(req, reply, {
        name: "metrics",
        intervalMs: config.metricsSseIntervalMs,
        produce: () => computeMetrics(req.db, env.id, wherePairs),
      });
    },
  );

  app.get(
    "/ontology/:env/instances/:id/score",
    {
      schema: {
        summary: "Rule-based score for a single instance (NEWS2-style banding)",
        tags: ["live-analysis"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        querystring: z.object({
          definition: z.string().optional(),
        }),
        response: {
          200: z.object({
            instanceId: z.string().uuid(),
            typeName: z.string(),
            total: z.number(),
            breakdown: z.record(z.number()),
          }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const spec = await resolveScoreSpec(req.db, env.id, req.query.definition);
      return scoreInstance(req.db, env.id, req.params.id, spec);
    },
  );

  app.get(
    "/ontology/:env/score-specs",
    {
      schema: {
        summary: "List persisted per-environment score specs",
        tags: ["live-analysis"],
        params: z.object({ env: z.string().min(1) }),
        response: {
          200: z.object({
            specs: z.array(
              z.object({
                id: z.string().uuid(),
                name: z.string(),
                spec: scoreSpecSchema,
                isDefault: z.boolean(),
                createdAt: z.string(),
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
      const specs = await listScoreSpecs(req.db, env.id);
      return { specs };
    },
  );

  app.put(
    "/ontology/:env/score-specs/:name",
    {
      schema: {
        summary: "Create or update a per-environment score spec",
        tags: ["live-analysis"],
        params: z.object({ env: z.string().min(1), name: z.string().min(1).max(64) }),
        body: z.object({ spec: scoreSpecSchema, isDefault: z.boolean().optional() }),
        response: {
          200: z.object({
            id: z.string().uuid(),
            name: z.string(),
            spec: scoreSpecSchema,
            isDefault: z.boolean(),
            createdAt: z.string(),
          }),
          400: errorEnvelope,
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return upsertScoreSpec(req.db, env.id, userId, env.organizationId, {
        name: req.params.name,
        spec: req.body.spec,
        isDefault: req.body.isDefault,
      });
    },
  );

  app.delete(
    "/ontology/:env/score-specs/:name",
    {
      schema: {
        summary: "Delete a per-environment score spec",
        tags: ["live-analysis"],
        params: z.object({ env: z.string().min(1), name: z.string().min(1).max(64) }),
        response: { 200: z.object({ ok: z.literal(true) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      await deleteScoreSpec(req.db, env.id, req.params.name);
      return { ok: true as const };
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

export default liveRoutes;
