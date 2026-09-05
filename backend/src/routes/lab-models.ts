import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { AppError, NotFound } from "../lib/errors.js";
import { recordAudit } from "../services/audit.js";
import {
  deleteModel,
  getModel,
  listModels,
  forecastAndStore,
  predictOverDataset,
  predictWith,
  readAllRows,
  runForecast,
  trainAndStore,
} from "../services/lab-models.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import { proxyToSimService } from "../services/ml-simulation.js";
import { resolveEnvironment } from "../services/ontology.js";

// ---------------------------------------------------------------------------
// The lab — supervised learning on a table, and a cell to write it by hand.
// ---------------------------------------------------------------------------

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

const foldOut = z.object({
  origin: z.string(),
  nTrain: z.number(),
  nTest: z.number(),
  mae: z.number(),
  rmse: z.number(),
  naiveMae: z.number(),
  mase: z.number(),
});

const modelOut = z.object({
  id: z.string(),
  kind: z.enum(["tabular", "timeseries"]),
  projectId: z.string(),
  name: z.string(),
  datasetId: z.string().nullable(),
  datasetName: z.string(),
  task: z.enum(["regression", "classification"]),
  estimator: z.string(),
  params: z.record(z.unknown()),
  target: z.string(),
  features: z.array(z.string()),
  numericFeatures: z.array(z.string()),
  categoricalFeatures: z.array(z.string()),
  split: z.enum(["random", "chronological"]),
  testSize: z.number(),
  timeColumn: z.string().nullable(),
  metrics: z.record(z.number()),
  baseline: z.record(z.number()),
  importances: z.array(z.object({ feature: z.string(), weight: z.number() })),
  warnings: z.array(z.string()),
  classes: z.array(z.string()),
  nTrain: z.number(),
  nTest: z.number(),
  droppedRows: z.number(),
  timeLags: z.number().nullable(),
  horizon: z.number().nullable(),
  exog: z.array(z.string()),
  folds: z.array(foldOut),
  createdAt: z.string(),
});

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

const labRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/lab/estimators",
    {
      schema: {
        summary: "Which models the lab can fit",
        description:
          "The catalogue the picker shows, with the defaults it pre-fills. Read straight from the Python service so the two can never disagree.",
        tags: ["lab"],
        response: {
          200: z.object({
            estimators: z.array(
              z.object({
                key: z.string(),
                label: z.string(),
                task: z.string(),
                params: z.record(z.unknown()),
                note: z.string().optional(),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      await requireUserId(req);
      const estimators = await proxyToSimService<
        Array<{ key: string; label: string; task: string; params: Record<string, unknown> }>
      >("/lab/estimators", undefined, "GET");
      return { estimators };
    },
  );

  app.get(
    "/ontology/:env/lab/models",
    {
      schema: {
        summary: "List trained models",
        tags: ["lab"],
        params: z.object({ env: z.string().min(1) }),
        response: { 200: z.object({ models: z.array(modelOut) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return { models: await listModels(req.db, env.id) };
    },
  );

  app.post(
    "/ontology/:env/lab/models",
    {
      schema: {
        summary: "Fit a model and keep it",
        description:
          "Reads every row of the dataset — not a preview — fits in the Python service, and stores the fitted pipeline with everything that produced the score.",
        tags: ["lab"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          name: z.string().min(1),
          datasetId: z.string().uuid(),
          target: z.string().min(1),
          features: z.array(z.string().min(1)).min(1),
          estimator: z.string().min(1),
          params: z.record(z.unknown()).default({}),
          split: z.enum(["random", "chronological"]).default("random"),
          testSize: z.number().gt(0.05).lt(0.6).default(0.25),
          timeColumn: z.string().nullable().default(null),
        }),
        response: { 201: modelOut, 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const model = await trainAndStore(req.db, env.id, req.body, userId);
      await recordAudit(req.db, {
        projectId: env.id,
        actorUserId: userId,
        action: "lab.model.train",
        resourceType: "lab_model",
        resourceId: model.id,
        metadata: {
          estimator: model.estimator,
          target: model.target,
          metrics: model.metrics,
        },
      });
      return reply.code(201).send(model);
    },
  );

  app.post(
    "/ontology/:env/lab/forecasts",
    {
      schema: {
        summary: "Fit a forecaster and keep it",
        description:
          "Walks forward through the series — every origin trained on its own past — then refits on all of it. The baseline is the naive forecast, not the mean: on a smooth series the mean is hopeless and beating it proves nothing.",
        tags: ["lab"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          name: z.string().min(1),
          datasetId: z.string().uuid(),
          timeColumn: z.string().min(1),
          target: z.string().min(1),
          estimator: z.string().min(1),
          lags: z.number().int().min(1).max(60).default(7),
          horizon: z.number().int().min(1).max(90).default(1),
          exog: z.array(z.string()).default([]),
          params: z.record(z.unknown()).default({}),
          folds: z.number().int().min(2).max(8).default(4),
        }),
        response: { 201: modelOut, 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const model = await forecastAndStore(req.db, env.id, req.body, userId);
      await recordAudit(req.db, {
        projectId: env.id,
        actorUserId: userId,
        action: "lab.forecast.train",
        resourceType: "lab_model",
        resourceId: model.id,
        metadata: {
          estimator: model.estimator,
          target: model.target,
          horizon: model.horizon,
          metrics: model.metrics,
        },
      });
      return reply.code(201).send(model);
    },
  );

  app.post(
    "/lab/models/:id/forecast",
    {
      schema: {
        summary: "Continue the series past its last observation",
        description:
          "Recursive: each predicted point becomes a lag for the next, so the error compounds. The note in the response says so — a smooth line implies a confidence the fit does not support.",
        tags: ["lab"],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ steps: z.number().int().min(1).max(365).default(14) }),
        response: {
          200: z.object({
            points: z.array(
              z.object({ step: z.number(), t: z.string(), value: z.number() }),
            ),
            note: z.string(),
          }),
          400: errorEnvelope,
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      await requireUserId(req);
      return runForecast(req.db, req.params.id, req.body.steps);
    },
  );

  app.get(
    "/lab/models/:id",
    {
      schema: {
        summary: "Read one model",
        tags: ["lab"],
        params: z.object({ id: z.string().uuid() }),
        response: { 200: modelOut, 404: errorEnvelope },
      },
    },
    async (req) => {
      await requireUserId(req);
      return getModel(req.db, req.params.id);
    },
  );

  app.delete(
    "/lab/models/:id",
    {
      schema: {
        summary: "Delete a model",
        tags: ["lab"],
        params: z.object({ id: z.string().uuid() }),
        response: { 204: z.null(), 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      await requireUserId(req);
      await deleteModel(req.db, req.params.id);
      return reply.code(204).send(null);
    },
  );

  app.post(
    "/lab/models/:id/predict",
    {
      schema: {
        summary: "Apply a model to rows, or to a whole dataset",
        tags: ["lab"],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          rows: z.array(z.record(z.unknown())).optional(),
          datasetId: z.string().uuid().optional(),
        }),
        response: {
          200: z.object({
            predictions: z.array(z.unknown()),
            rows: z.array(z.record(z.unknown())).optional(),
          }),
          400: errorEnvelope,
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      await requireUserId(req);
      if (req.body.datasetId) {
        return predictOverDataset(req.db, req.params.id, req.body.datasetId);
      }
      if (!req.body.rows?.length) {
        throw new AppError(
          "NOTHING_TO_PREDICT",
          "Fournissez des lignes, ou un jeu de données.",
          400,
        );
      }
      return { predictions: await predictWith(req.db, req.params.id, req.body.rows) };
    },
  );

  app.post(
    "/ontology/:env/lab/cell",
    {
      schema: {
        summary: "Run Python against a dataset",
        description:
          "The cell runs in a child process with no credentials in its environment. It is not a container boundary: see the service's sandbox module for exactly what is and is not contained.",
        tags: ["lab"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          code: z.string().min(1).max(200_000),
          datasetId: z.string().uuid().nullable().default(null),
          timeoutS: z.number().int().min(1).max(120).default(30),
        }),
        response: {
          200: z.object({
            ok: z.boolean(),
            stdout: z.string(),
            stderr: z.string(),
            result: z.unknown(),
            durationMs: z.number(),
            timedOut: z.boolean(),
          }),
          400: errorEnvelope,
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const rows = req.body.datasetId
        ? await readAllRows(req.db, req.body.datasetId)
        : [];
      // Audited by name only. The code itself is the user's working material,
      // and copying every keystroke into an audit table would make the log a
      // second, unreviewed store of whatever they pasted in.
      await recordAudit(req.db, {
        projectId: env.id,
        actorUserId: userId,
        action: "lab.cell.run",
        resourceType: "dataset",
        resourceId: req.body.datasetId ?? null,
        metadata: { rows: rows.length, bytes: req.body.code.length },
      });
      return proxyToSimService("/lab/cell", {
        code: req.body.code,
        rows,
        timeout_s: req.body.timeoutS,
      });
    },
  );
};

export default labRoutes;
