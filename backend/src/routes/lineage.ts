import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { AppError, NotFound } from "../lib/errors.js";
import { recordAudit } from "../services/audit.js";
import {
  createDatasource,
  getProjectGraph,
  listDatasources,
  materialize,
} from "../services/lineage.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import { resolveEnvironment } from "../services/ontology.js";

// ---------------------------------------------------------------------------
// Ontology output (dataset → object type) and the project lineage graph.
// ---------------------------------------------------------------------------

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

const mappingRule = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  coerce: z.enum(["string", "number", "boolean", "date"]).optional(),
  onMissing: z.enum(["skip", "null", "flag"]).optional(),
});

const datasourceOut = z.object({
  id: z.string(),
  projectId: z.string(),
  objectTypeId: z.string(),
  objectTypeName: z.string(),
  datasetId: z.string(),
  datasetName: z.string(),
  identityProperties: z.array(z.string()),
  columnMapping: z.array(mappingRule),
  writeback: z.boolean(),
  lastSyncedAt: z.string().nullable(),
  lastStatus: z.string().nullable(),
  lastError: z.string().nullable(),
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

const lineageRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // --- The graph ------------------------------------------------------------
  app.get(
    "/ontology/:env/graph",
    {
      schema: {
        summary: "Project lineage graph: sources, datasets, object types and their edges",
        tags: ["lineage"],
        params: z.object({ env: z.string().min(1) }),
        response: {
          200: z.object({
            nodes: z.array(
              z.object({
                id: z.string(),
                type: z.enum(["source", "dataset", "object_type"]),
                name: z.string(),
                subtitle: z.string(),
                status: z.enum(["ok", "warn", "idle"]),
                count: z.number().nullable(),
              }),
            ),
            edges: z.array(
              z.object({ from: z.string(), to: z.string(), kind: z.string() }),
            ),
          }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return getProjectGraph(req.db, env.id);
    },
  );

  // --- Ontology output ------------------------------------------------------
  app.get(
    "/ontology/:env/datasources",
    {
      schema: {
        summary: "List dataset → object type bindings",
        tags: ["lineage"],
        params: z.object({ env: z.string().min(1) }),
        response: {
          200: z.object({ datasources: z.array(datasourceOut) }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return { datasources: await listDatasources(req.db, env.id) };
    },
  );

  app.post(
    "/ontology/:env/datasources",
    {
      schema: {
        summary: "Bind a dataset to an object type (the ontology output)",
        tags: ["lineage"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          objectTypeName: z.string().min(1),
          datasetId: z.string().uuid(),
          identityProperties: z.array(z.string().min(1)).min(1),
          columnMapping: z.array(mappingRule).min(1),
        }),
        response: { 201: datasourceOut, 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const ds = await createDatasource(req.db, {
        projectId: env.id,
        objectTypeName: req.body.objectTypeName,
        datasetId: req.body.datasetId,
        identityProperties: req.body.identityProperties,
        columnMapping: req.body.columnMapping,
        createdBy: userId,
      });
      await recordAudit(req.db, {
        projectId: env.id,
        actorUserId: userId,
        action: "ontology.datasource.bind",
        resourceType: "object_type",
        resourceId: ds.objectTypeId,
        metadata: { dataset: ds.datasetName, identity: ds.identityProperties },
      });
      return reply.code(201).send(ds);
    },
  );

  app.post(
    "/datasources/:id/materialize",
    {
      schema: {
        summary: "Read the bound dataset and upsert instances",
        tags: ["lineage"],
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: z.object({
            read: z.number(),
            written: z.number(),
            skipped: z.number(),
            issues: z.array(z.object({ row: z.number(), reason: z.string() })),
          }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const result = await materialize(req.db, req.params.id);
      await recordAudit(req.db, {
        actorUserId: userId,
        action: "ontology.materialize",
        resourceType: "datasource",
        resourceId: req.params.id,
        metadata: { written: result.written, skipped: result.skipped },
      });
      return result;
    },
  );
};

export default lineageRoutes;
