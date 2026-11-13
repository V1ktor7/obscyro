import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { AppError, NotFound } from "../lib/errors.js";
import { recordAudit } from "../services/audit.js";
import {
  catchUpOnce,
  createLoop,
  deleteLoop,
  getLoop,
  listLoops,
  loopView,
} from "../services/forecast-loops.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import { resolveEnvironment } from "../services/ontology.js";

// ---------------------------------------------------------------------------
// Live forecasts: the daily loop over a series, its frozen forecasts and how
// good they turned out.
// ---------------------------------------------------------------------------

const errorEnvelope = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});

const loopOut = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  datasetId: z.string(),
  datasetName: z.string(),
  timeColumn: z.string(),
  target: z.string(),
  driver: z
    .object({ datasetId: z.string(), datasetName: z.string(), timeColumn: z.string(), column: z.string(), delay: z.number() })
    .nullable(),
  horizons: z.array(z.number()),
  lags: z.number(),
  specs: z.array(
    z.object({ key: z.string(), label: z.string(), estimator: z.string(), exog: z.boolean(), params: z.record(z.unknown()) }),
  ),
  startDate: z.string(),
  frozenThrough: z.string().nullable(),
  status: z.enum(["replaying", "live", "failed"]),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

async function requireUserId(req: { apiKey?: { id: string } | null; db: DbClient }): Promise<string> {
  const apiKey = req.apiKey;
  if (!apiKey) throw new AppError("INVALID_API_KEY", "API key required.", 401);
  const userId = await resolveUserIdForApiKey(req.db, apiKey.id);
  if (!userId) throw NotFound("USER_NOT_FOUND", "User not found for API key.");
  return userId;
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date, YYYY-MM-DD.");

const forecastLoopRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/ontology/:env/forecast-loops",
    {
      schema: {
        summary: "Forecast loops in a project",
        tags: ["lab"],
        params: z.object({ env: z.string().min(1) }),
        response: { 200: z.object({ loops: z.array(loopOut) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return { loops: await listLoops(req.db, env.id) };
    },
  );

  app.post(
    "/ontology/:env/forecast-loops",
    {
      schema: {
        summary: "Start a daily forecasting loop over a series",
        description:
          "The loop starts at `startDate` and freezes a forecast every morning since, at every " +
          "horizon and for both models, until the morning after the last value — then waits for " +
          "the dataset to grow. Each forecast uses only what was known that morning.",
        tags: ["lab"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          name: z.string().trim().min(1).max(120),
          datasetId: z.string().uuid(),
          timeColumn: z.string().min(1),
          target: z.string().min(1),
          driver: z
            .object({ datasetId: z.string().uuid(), timeColumn: z.string().min(1), column: z.string().min(1), delay: z.number().int().min(0).max(14).optional() })
            .nullable()
            .optional(),
          horizons: z.array(z.number().int().min(1).max(60)).min(1).max(8).optional(),
          lags: z.number().int().min(1).max(60).optional(),
          startDate: day,
        }),
        response: { 201: loopOut, 400: errorEnvelope, 404: errorEnvelope, 409: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const loop = await createLoop(req.db, env.id, userId, req.body);
      await recordAudit(req.db, {
        actorUserId: userId,
        projectId: env.id,
        action: "lab.forecast_loop.create",
        resourceType: "forecast_loop",
        resourceId: loop.id,
        metadata: { name: loop.name, target: loop.target },
      });
      return reply.code(201).send(loop);
    },
  );

  app.get(
    "/ontology/:env/forecast-loops/:id/view",
    {
      schema: {
        summary: "A loop's series, frozen forecasts and refits",
        tags: ["lab"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        response: {
          200: z.object({
            loop: loopOut,
            actual: z.record(z.number()),
            lastDay: z.string().nullable(),
            forecasts: z.array(z.object({ made: z.string(), h: z.number(), spec: z.string(), value: z.number() })),
            retrains: z.array(z.object({ on: z.string(), h: z.number(), spec: z.string(), mae: z.number().nullable(), points: z.number() })),
          }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return loopView(req.db, await getLoop(req.db, req.params.id, env.id));
    },
  );

  app.post(
    "/ontology/:env/forecast-loops/:id/catch-up",
    {
      schema: {
        summary: "Freeze the next block of mornings now",
        tags: ["lab"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        response: { 200: loopOut, 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const loop = await getLoop(req.db, req.params.id, env.id);
      return catchUpOnce(req.db, loop.id);
    },
  );

  app.delete(
    "/ontology/:env/forecast-loops/:id",
    {
      schema: {
        summary: "Delete a loop and every forecast it froze",
        tags: ["lab"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        response: { 200: z.object({ deleted: z.boolean() }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const loop = await getLoop(req.db, req.params.id, env.id);
      await deleteLoop(req.db, loop.id);
      await recordAudit(req.db, {
        actorUserId: userId,
        projectId: env.id,
        action: "lab.forecast_loop.delete",
        resourceType: "forecast_loop",
        resourceId: loop.id,
        metadata: { name: loop.name },
      });
      return { deleted: true };
    },
  );
};

export default forecastLoopRoutes;
