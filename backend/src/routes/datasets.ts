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
// Projects, datasets, and the reference graph.
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

const projectOut = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  datasetCount: z.number(),
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

/** Confirm a project belongs to an environment the caller can reach. */
async function assertProjectInEnv(
  db: DbClient,
  projectId: string,
  environmentId: string,
): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM app.project WHERE id = $1 AND environment_id = $2`,
    [projectId, environmentId],
  );
  if (!rows[0]) throw NotFound("PROJECT_NOT_FOUND", "Project not found in this environment.");
}

const datasetRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // --- Projects -------------------------------------------------------------
  app.get(
    "/ontology/:env/projects",
    {
      schema: {
        summary: "List projects in an environment",
        tags: ["projects"],
        params: z.object({ env: z.string().min(1) }),
        response: { 200: z.object({ projects: z.array(projectOut) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const { rows } = await req.db.query<{
        id: string;
        name: string;
        slug: string;
        description: string | null;
        status: string;
        dataset_count: string;
        created_at: Date;
      }>(
        `SELECT p.id, p.name, p.slug, p.description, p.status,
                COUNT(d.id) AS dataset_count, p.created_at
           FROM app.project p
           LEFT JOIN app.dataset d ON d.project_id = p.id
          WHERE p.environment_id = $1
          GROUP BY p.id
          ORDER BY p.created_at ASC`,
        [env.id],
      );
      return {
        projects: rows.map((r) => ({
          id: r.id,
          name: r.name,
          slug: r.slug,
          description: r.description,
          status: r.status,
          datasetCount: Number(r.dataset_count),
          createdAt: r.created_at.toISOString(),
        })),
      };
    },
  );

  app.post(
    "/ontology/:env/projects",
    {
      schema: {
        summary: "Create a project",
        tags: ["projects"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          name: z.string().min(1).max(120),
          description: z.string().max(500).optional(),
        }),
        response: { 201: projectOut, 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const slug =
        req.body.name
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 64) || "project";
      const { rows } = await req.db.query<{
        id: string;
        name: string;
        slug: string;
        description: string | null;
        status: string;
        created_at: Date;
      }>(
        `INSERT INTO app.project (environment_id, name, slug, description, created_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (environment_id, slug) DO UPDATE SET updated_at = now()
         RETURNING id, name, slug, description, status, created_at`,
        [env.id, req.body.name, slug, req.body.description ?? null, userId],
      );
      const p = rows[0]!;
      await recordAudit(req.db, {
        environmentId: env.id,
        actorUserId: userId,
        action: "project.create",
        resourceType: "project",
        resourceId: p.id,
        metadata: { slug: p.slug },
      });
      return reply.code(201).send({
        id: p.id,
        name: p.name,
        slug: p.slug,
        description: p.description,
        status: p.status,
        datasetCount: 0,
        createdAt: p.created_at.toISOString(),
      });
    },
  );

  // --- Datasets -------------------------------------------------------------
  app.get(
    "/ontology/:env/projects/:projectId/datasets",
    {
      schema: {
        summary: "List datasets in a project",
        tags: ["datasets"],
        params: z.object({ env: z.string().min(1), projectId: z.string().uuid() }),
        response: { 200: z.object({ datasets: z.array(datasetOut) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      await assertProjectInEnv(req.db, req.params.projectId, env.id);
      return { datasets: await listDatasets(req.db, req.params.projectId) };
    },
  );

  app.post(
    "/ontology/:env/projects/:projectId/datasets",
    {
      schema: {
        summary: "Create a dataset (table = versioned, stream = append-only)",
        tags: ["datasets"],
        params: z.object({ env: z.string().min(1), projectId: z.string().uuid() }),
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
      await assertProjectInEnv(req.db, req.params.projectId, env.id);
      const ds = await createDataset(req.db, {
        projectId: req.params.projectId,
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
