import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { AppError, NotFound } from "../lib/errors.js";
import { recordAudit } from "../services/audit.js";
import {
  addReference,
  appendToStream,
  createDataset,
  getDataset,
  getReferences,
  listDatasets,
  loadTableVersion,
  previewRows,
} from "../services/datasets.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import { resolveEnvironment } from "../services/ontology.js";

// ---------------------------------------------------------------------------
// Datasets and the reference graph.
//
// A project IS an environment (they collapsed in migration 032), so datasets
// hang directly off /ontology/:env. Project listing lives on Home.
// ---------------------------------------------------------------------------

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

const resourceType = z.enum([
  "source",
  "dataset",
  "pipeline",
  "channel",
  "object_type",
  "model",
]);

const datasetOut = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  slug: z.string(),
  kind: z.enum(["table", "stream"]),
  description: z.string().nullable(),
  path: z.string(),
  columnSchema: z.array(
    z.object({
      name: z.string(),
      type: z.enum(["string", "number", "boolean", "object"]),
      nullable: z.boolean(),
    }),
  ),
  rowCount: z.number(),
  retentionDays: z.number(),
  sourceId: z.string().nullable(),
  lastWrittenAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
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

const datasetRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // --- Datasets -------------------------------------------------------------
  app.get(
    "/ontology/:env/datasets",
    {
      schema: {
        summary: "List datasets in a project",
        tags: ["datasets"],
        params: z.object({ env: z.string().min(1) }),
        response: { 200: z.object({ datasets: z.array(datasetOut) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return { datasets: await listDatasets(req.db, env.id) };
    },
  );

  app.post(
    "/ontology/:env/datasets",
    {
      schema: {
        summary: "Create a dataset (table = versioned, stream = append-only)",
        tags: ["datasets"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          name: z.string().min(1).max(120),
          kind: z.enum(["table", "stream"]).default("table"),
          description: z.string().max(500).optional(),
          retentionDays: z.number().int().min(1).max(3650).optional(),
          sourceId: z.string().uuid().nullable().optional(),
        }),
        response: { 201: datasetOut, 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const ds = await createDataset(req.db, {
        projectId: env.id,
        name: req.body.name,
        kind: req.body.kind,
        description: req.body.description,
        retentionDays: req.body.retentionDays,
        sourceId: req.body.sourceId ?? null,
        createdBy: userId,
      });
      // A dataset fed by a source is downstream of it — record the edge now so
      // lineage is built as a side effect of normal use, not a later crawl.
      if (req.body.sourceId) {
        await addReference(req.db, {
          fromType: "source",
          fromId: req.body.sourceId,
          toType: "dataset",
          toId: ds.id,
          kind: "writes",
        });
      }
      await recordAudit(req.db, {
        environmentId: env.id,
        actorUserId: userId,
        action: "dataset.create",
        resourceType: "dataset",
        resourceId: ds.id,
        metadata: { kind: ds.kind, slug: ds.slug },
      });
      return reply.code(201).send(ds);
    },
  );

  app.get(
    "/datasets/:id",
    {
      schema: {
        summary: "Dataset detail with a row preview",
        tags: ["datasets"],
        params: z.object({ id: z.string().uuid() }),
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }),
        response: {
          200: z.object({
            dataset: datasetOut,
            preview: z.array(z.record(z.unknown())),
            references: z.object({
              upstream: z.array(z.object({ type: z.string(), id: z.string(), kind: z.string() })),
              downstream: z.array(z.object({ type: z.string(), id: z.string(), kind: z.string() })),
            }),
          }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      await requireUserId(req);
      const dataset = await getDataset(req.db, req.params.id);
      const [preview, references] = await Promise.all([
        previewRows(req.db, req.params.id, req.query.limit),
        getReferences(req.db, "dataset", req.params.id),
      ]);
      return { dataset, preview, references };
    },
  );

  // Load rows: a new immutable version for tables, an append for streams.
  app.post(
    "/datasets/:id/rows",
    {
      schema: {
        summary: "Load rows (table = new version, stream = append)",
        tags: ["datasets"],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          rows: z.array(z.record(z.unknown())).max(50_000),
          note: z.string().max(200).optional(),
        }),
        response: {
          200: z.object({
            kind: z.enum(["table", "stream"]),
            version: z.number().optional(),
            rowCount: z.number(),
          }),
          400: errorEnvelope,
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const ds = await getDataset(req.db, req.params.id);
      if (ds.kind === "stream") {
        const { appended } = await appendToStream(req.db, ds.id, req.body.rows);
        return { kind: "stream" as const, rowCount: appended };
      }
      const res = await loadTableVersion(req.db, ds.id, req.body.rows, {
        note: req.body.note,
        createdBy: userId,
      });
      await recordAudit(req.db, {
        actorUserId: userId,
        action: "dataset.version.create",
        resourceType: "dataset",
        resourceId: ds.id,
        metadata: { version: res.version, rows: res.rowCount },
      });
      return { kind: "table" as const, version: res.version, rowCount: res.rowCount };
    },
  );

  // --- Reference graph ------------------------------------------------------
  app.get(
    "/references/:type/:id",
    {
      schema: {
        summary: "Upstream and downstream references for a resource",
        tags: ["projects"],
        params: z.object({ type: resourceType, id: z.string().min(1) }),
        response: {
          200: z.object({
            upstream: z.array(z.object({ type: z.string(), id: z.string(), kind: z.string() })),
            downstream: z.array(z.object({ type: z.string(), id: z.string(), kind: z.string() })),
          }),
        },
      },
    },
    async (req) => {
      await requireUserId(req);
      return getReferences(req.db, req.params.type, req.params.id);
    },
  );
};

export default datasetRoutes;
