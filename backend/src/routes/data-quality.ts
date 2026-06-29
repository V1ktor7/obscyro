import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { config } from "../lib/config.js";
import type { DbClient } from "../lib/db.js";
import { AppError, NotFound } from "../lib/errors.js";
import { parseWhere } from "../lib/where-filter.js";
import {
  listFlags,
  scanEnvironment,
  updateFlagStatus,
} from "../services/data-quality.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import { resolveEnvironment } from "../services/ontology.js";

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

const flagSchema = z.object({
  id: z.string().uuid(),
  instanceId: z.string().uuid(),
  layer: z.number(),
  severity: z.enum(["info", "warn", "error"]),
  code: z.string(),
  message: z.string(),
  observedValue: z.string().nullable(),
  status: z.enum(["open", "reviewed", "dismissed"]),
  createdAt: z.string(),
});

const dataQualityRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/ontology/:env/quality/scan",
    {
      schema: {
        summary: "Run layered data-quality scan and upsert open flags",
        tags: ["data-quality"],
        params: z.object({ env: z.string().min(1) }),
        querystring: z.object({
          where: z.string().optional(),
          incremental: z.coerce.boolean().optional(),
          maxLayer: z.coerce.number().int().min(1).max(6).optional(),
        }),
        response: {
          200: z.object({
            summary: z.object({
              byLayer: z.record(z.number()),
              bySeverity: z.record(z.number()),
              flagCount: z.number(),
            }),
            flagCount: z.number(),
            scannedCount: z.number(),
            incremental: z.boolean(),
          }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const wherePairs = parseWhere(req.query.where);
      const result = await scanEnvironment(req.db, env.id, {
        wherePairs,
        incremental: req.query.incremental,
        maxLayer: req.query.maxLayer,
      });
      req.log.info(
        {
          environmentId: env.id,
          incremental: result.incremental,
          scannedCount: result.scannedCount,
          flagCount: result.summary.flagCount,
        },
        "data-quality scan completed",
      );
      return {
        summary: result.summary,
        flagCount: result.summary.flagCount,
        scannedCount: result.scannedCount,
        incremental: result.incremental,
      };
    },
  );

  app.get(
    "/ontology/:env/quality/flags",
    {
      schema: {
        summary: "List data-quality flags for an environment",
        tags: ["data-quality"],
        params: z.object({ env: z.string().min(1) }),
        querystring: z.object({
          status: z.enum(["open", "reviewed", "dismissed"]).optional(),
          layer: z.coerce.number().int().min(1).max(6).optional(),
          severity: z.enum(["info", "warn", "error"]).optional(),
          limit: z.coerce.number().int().min(1).max(config.listMaxLimit).optional(),
          offset: z.coerce.number().int().min(0).optional(),
        }),
        response: {
          200: z.object({ flags: z.array(flagSchema) }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const flags = await listFlags(req.db, env.id, {
        status: req.query.status,
        layer: req.query.layer,
        severity: req.query.severity,
        limit: req.query.limit,
        offset: req.query.offset,
      });
      return { flags };
    },
  );

  app.patch(
    "/ontology/:env/quality/flags/:id",
    {
      schema: {
        summary: "Update flag review status (does not mutate instance properties)",
        tags: ["data-quality"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        body: z.object({
          status: z.enum(["open", "reviewed", "dismissed"]),
        }),
        response: {
          200: z.object({ ok: z.literal(true) }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      await updateFlagStatus(req.db, env.id, req.params.id, req.body.status);
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

export default dataQualityRoutes;
