import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { AppError, NotFound } from "../lib/errors.js";
import { parseWhere } from "../lib/where-filter.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import {
  computeMetrics,
  DEFAULT_SCORE_SPEC,
  scoreInstance,
  type ScoreSpec,
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

      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const send = async () => {
        const metrics = await computeMetrics(req.db, env.id, wherePairs);
        reply.raw.write(`data: ${JSON.stringify(metrics)}\n\n`);
      };

      await send();
      const interval = setInterval(() => {
        void send().catch(() => {
          /* client may have disconnected */
        });
      }, 5000);

      const heartbeat = setInterval(() => {
        reply.raw.write(": ping\n\n");
      }, 15000);

      req.raw.on("close", () => {
        clearInterval(interval);
        clearInterval(heartbeat);
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

      let spec: ScoreSpec = DEFAULT_SCORE_SPEC;
      if (req.query.definition) {
        const { rows } = await req.db.query<{ spec: ScoreSpec }>(
          `SELECT spec FROM app.metric_definition
            WHERE environment_id = $1 AND name = $2 AND kind = 'score'`,
          [env.id, req.query.definition],
        );
        if (rows[0]?.spec) spec = rows[0].spec;
      }

      return scoreInstance(req.db, env.id, req.params.id, spec);
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
