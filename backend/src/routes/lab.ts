import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { AppError, NotFound } from "../lib/errors.js";
import {
  buildSeries,
  forecastModel,
  getLabModel,
  listCausalityEdges,
  listSignals,
  nextModelVersion,
  scanCausality,
  trainModel,
  type ModelMetrics,
  type ModelSpec,
} from "../services/causal-lab.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import { resolveEnvironment } from "../services/ontology.js";

// ---------------------------------------------------------------------------
// Causal simulation lab routes: signals, causality scan, named model training
// (ridge ARX on live series), forecasts + event-injected simulations.
// ---------------------------------------------------------------------------

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

const signalOut = z.object({
  signal: z.string(),
  kind: z.enum(["type_count", "type_property", "channel"]),
  label: z.string(),
  entity: z.string(),
});

const edgeOut = z.object({
  fromSignal: z.string(),
  toSignal: z.string(),
  lagHours: z.number().int(),
  strength: z.number(),
  confidence: z.number(),
  sampleCount: z.number().int(),
  computedAt: z.string(),
});

const featureIn = z.object({
  signal: z.string().min(1),
  lag: z.number().int().min(1).max(48).default(1),
});

const metricsOut = z.object({
  mae: z.number(),
  mape: z.number().nullable(),
  baselineMae: z.number(),
  improvement: z.number(),
  samples: z.number().int(),
});

const modelOut = z.object({
  id: z.string().uuid(),
  name: z.string(),
  version: z.string(),
  status: z.string(),
  targetSignal: z.string(),
  features: z.array(z.object({ signal: z.string(), lag: z.number().int() })),
  horizonHours: z.number().int(),
  windowHours: z.number().int(),
  metrics: metricsOut,
  isActive: z.boolean(),
  createdAt: z.string(),
});

const labRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/ontology/:env/lab/signals",
    {
      schema: {
        summary: "List signals available for causality and model training",
        tags: ["lab"],
        params: z.object({ env: z.string().min(1) }),
        response: { 200: z.object({ signals: z.array(signalOut) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return { signals: await listSignals(req.db, env.id) };
    },
  );

  app.get(
    "/ontology/:env/lab/causality",
    {
      schema: {
        summary: "List auto-discovered causality edges",
        tags: ["lab"],
        params: z.object({ env: z.string().min(1) }),
        response: { 200: z.object({ edges: z.array(edgeOut) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return { edges: await listCausalityEdges(req.db, env.id) };
    },
  );

  app.post(
    "/ontology/:env/lab/causality/scan",
    {
      schema: {
        summary: "Scan flux signals for lagged influences and save them as edges",
        tags: ["lab"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          windowHours: z.number().int().min(48).max(2160).optional(),
          maxLagHours: z.number().int().min(1).max(48).optional(),
        }),
        response: {
          200: z.object({
            edges: z.array(edgeOut),
            signalCount: z.number().int(),
            windowHours: z.number().int(),
          }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return scanCausality(req.db, env.id, req.body);
    },
  );

  app.get(
    "/ontology/:env/lab/models",
    {
      schema: {
        summary: "List trained lab models (named, versioned)",
        tags: ["lab"],
        params: z.object({ env: z.string().min(1) }),
        response: { 200: z.object({ models: z.array(modelOut) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const { rows } = await req.db.query<{
        id: string;
        name: string;
        version: string;
        status: string;
        spec: ModelSpec;
        metrics: ModelMetrics;
        is_active: boolean;
        created_at: Date;
      }>(
        `SELECT id, name, version, status, spec, metrics, is_active, created_at
           FROM app.simulation_model
          WHERE environment_id = $1 AND model_type = 'causal_arx'
          ORDER BY created_at DESC`,
        [env.id],
      );
      return {
        models: rows.map((r) => ({
          id: r.id,
          name: r.name,
          version: r.version,
          status: r.status,
          targetSignal: r.spec.targetSignal,
          features: r.spec.features,
          horizonHours: r.spec.horizonHours,
          windowHours: r.spec.windowHours,
          metrics: r.metrics,
          isActive: r.is_active,
          createdAt: r.created_at.toISOString(),
        })),
      };
    },
  );

  app.post(
    "/ontology/:env/lab/models",
    {
      schema: {
        summary: "Train and save a named model on live signals",
        description:
          "Trains a one-step ridge ARX regressor on the target signal using the given " +
          "feature signals (causality-recommended or manually added), backtests it on a " +
          "held-out tail, and saves it to the model registry under the given name.",
        tags: ["lab"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          name: z.string().min(1).max(120),
          targetSignal: z.string().min(1),
          features: z.array(featureIn).max(10),
          horizonHours: z.number().int().min(6).max(168).optional(),
          windowHours: z.number().int().min(72).max(2160).optional(),
          // Uploaded CSV columns (name → ordered numeric values, oldest first).
          dataset: z
            .record(z.string().min(1).max(120), z.array(z.number()).min(60).max(20000))
            .optional()
            .refine((d) => d === undefined || Object.keys(d).length <= 24, {
              message: "Dataset may contain at most 24 columns.",
            }),
        }),
        response: { 201: modelOut, 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const { spec, metrics } = await trainModel(req.db, env.id, {
        targetSignal: req.body.targetSignal,
        features: req.body.features,
        horizonHours: req.body.horizonHours,
        windowHours: req.body.windowHours,
        dataset: req.body.dataset,
      });
      const version = await nextModelVersion(req.db, env.id, req.body.name.trim());
      const { rows } = await req.db.query<{ id: string; created_at: Date }>(
        `INSERT INTO app.simulation_model
                (environment_id, model_type, name, version, status, metrics, spec,
                 owner_user_id, organization_id, is_active)
         VALUES ($1, 'causal_arx', $2, $3, 'ready', $4::jsonb, $5::jsonb, $6, $7, TRUE)
         RETURNING id, created_at`,
        [
          env.id,
          req.body.name.trim(),
          version,
          JSON.stringify(metrics),
          JSON.stringify(spec),
          userId,
          env.organizationId,
        ],
      );
      // Older versions of the same name are no longer the active one.
      await req.db.query(
        `UPDATE app.simulation_model SET is_active = FALSE
          WHERE environment_id = $1 AND model_type = 'causal_arx'
            AND name = $2 AND id <> $3`,
        [env.id, req.body.name.trim(), rows[0]!.id],
      );
      return reply.status(201).send({
        id: rows[0]!.id,
        name: req.body.name.trim(),
        version,
        status: "ready",
        targetSignal: spec.targetSignal,
        features: spec.features,
        horizonHours: spec.horizonHours,
        windowHours: spec.windowHours,
        metrics,
        isActive: true,
        createdAt: rows[0]!.created_at.toISOString(),
      });
    },
  );

  app.delete(
    "/ontology/:env/lab/models/:id",
    {
      schema: {
        summary: "Delete a trained lab model",
        tags: ["lab"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        response: { 200: z.object({ ok: z.literal(true) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const result = await req.db.query(
        `DELETE FROM app.simulation_model
          WHERE environment_id = $1 AND id = $2 AND model_type = 'causal_arx'`,
        [env.id, req.params.id],
      );
      if (result.rowCount === 0) throw NotFound("MODEL_NOT_FOUND", "Model not found.");
      return { ok: true as const };
    },
  );

  app.post(
    "/ontology/:env/lab/models/:id/forecast",
    {
      schema: {
        summary: "Forecast with a trained model; optionally inject an event",
        description:
          "Returns the observed series, the model's backtest line over it, the forward " +
          "forecast, and — when an event is provided — the simulated trajectory with the " +
          "event applied to one of the model's feature signals.",
        tags: ["lab"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        body: z.object({
          event: z
            .object({
              signal: z.string().min(1),
              delta: z.number(),
              startHours: z.number().int().min(0).max(168).default(0),
              durationHours: z.number().int().min(1).max(168).default(6),
            })
            .nullable()
            .optional(),
        }),
        response: {
          200: z.object({
            pastHours: z.array(z.string()),
            observed: z.array(z.number()),
            backtest: z.array(z.number().nullable()),
            futureHours: z.array(z.string()),
            forecast: z.array(z.number()),
            simulated: z.array(z.number()).nullable(),
          }),
          400: errorEnvelope,
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const model = await getLabModel(req.db, env.id, req.params.id);
      return forecastModel(req.db, env.id, model.spec, req.body.event ?? null);
    },
  );

  // Raw series for context charts (used by the lab UI to sanity-check signals).
  app.post(
    "/ontology/:env/lab/series",
    {
      schema: {
        summary: "Hourly series for a set of signals",
        tags: ["lab"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          signals: z.array(z.string().min(1)).min(1).max(20),
          windowHours: z.number().int().min(24).max(2160).default(336),
        }),
        response: {
          200: z.object({
            hours: z.array(z.string()),
            series: z.record(z.array(z.number())),
          }),
          400: errorEnvelope,
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const { hours, series } = await buildSeries(
        req.db,
        env.id,
        req.body.signals,
        req.body.windowHours,
      );
      const out: Record<string, number[]> = {};
      for (const [k, v] of series) out[k] = v.map((x) => Number(x.toFixed(4)));
      return { hours, series: out };
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

export default labRoutes;
