import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { AppError, NotFound } from "../lib/errors.js";
import { recordAudit } from "../services/audit.js";
import { slugify } from "../services/datasets.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import { resolveEnvironment } from "../services/ontology.js";
import {
  createPipeline,
  deletePipeline,
  execute,
  getPipeline,
  listPipelines,
  listRuns,
  NODE_CATALOGUE,
  NODE_KINDS,
  savePipeline,
  validate,
  type PipelineEdge,
  type PipelineNode,
} from "../services/pipeline.js";

// ---------------------------------------------------------------------------
// Pipelines — the transformation between a dataset and whatever it becomes.
// ---------------------------------------------------------------------------

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

const nodeSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(NODE_KINDS),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  config: z.record(z.unknown()).default({}),
});

const edgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  toPort: z.enum(["left", "right"]).optional(),
});

const pipelineOut = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
  status: z.enum(["draft", "live", "paused"]),
  lastRunAt: z.string().nullable(),
  lastStatus: z.string().nullable(),
  lastError: z.string().nullable(),
});

const runOut = z.object({
  runId: z.string().nullable(),
  status: z.enum(["succeeded", "failed"]),
  rowsIn: z.number(),
  rowsOut: z.number(),
  nodeStats: z.record(
    z.object({
      in: z.number(),
      out: z.number(),
      dropped: z.number(),
      ms: z.number(),
      linked: z.number().optional(),
      unresolved: z.number().optional(),
      error: z.string().optional(),
    }),
  ),
  samples: z.record(z.array(z.record(z.unknown()))),
  error: z.string().nullable(),
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

const pipelineRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/pipeline-nodes",
    {
      schema: {
        summary: "The node palette",
        tags: ["pipelines"],
        response: {
          200: z.object({
            nodes: z.array(
              z.object({
                kind: z.string(),
                label: z.string(),
                category: z.string(),
                description: z.string(),
                inputs: z.number(),
                outputs: z.number(),
              }),
            ),
          }),
        },
      },
    },
    async () => ({ nodes: NODE_CATALOGUE }),
  );

  app.get(
    "/ontology/:env/pipelines",
    {
      schema: {
        summary: "List pipelines in a project",
        tags: ["pipelines"],
        params: z.object({ env: z.string().min(1) }),
        response: { 200: z.object({ pipelines: z.array(pipelineOut) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return { pipelines: await listPipelines(req.db, env.id) };
    },
  );

  app.post(
    "/ontology/:env/pipelines",
    {
      schema: {
        summary: "Create a pipeline",
        tags: ["pipelines"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          name: z.string().min(1),
          description: z.string().optional(),
        }),
        response: { 201: pipelineOut, 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const p = await createPipeline(req.db, {
        projectId: env.id,
        name: req.body.name,
        slug: slugify(req.body.name),
        description: req.body.description ?? null,
        createdBy: userId,
      });
      await recordAudit(req.db, {
        projectId: env.id,
        actorUserId: userId,
        action: "pipeline.create",
        resourceType: "pipeline",
        resourceId: p.id,
        metadata: { name: p.name },
      });
      return reply.code(201).send(p);
    },
  );

  app.get(
    "/pipelines/:id",
    {
      schema: {
        summary: "Read one pipeline",
        tags: ["pipelines"],
        params: z.object({ id: z.string().uuid() }),
        response: { 200: pipelineOut, 404: errorEnvelope },
      },
    },
    async (req) => {
      await requireUserId(req);
      return getPipeline(req.db, req.params.id);
    },
  );

  app.patch(
    "/pipelines/:id",
    {
      schema: {
        summary: "Save the graph",
        tags: ["pipelines"],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          name: z.string().min(1).optional(),
          nodes: z.array(nodeSchema).optional(),
          edges: z.array(edgeSchema).optional(),
          status: z.enum(["draft", "live", "paused"]).optional(),
        }),
        response: { 200: pipelineOut, 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const p = await savePipeline(req.db, req.params.id, {
        name: req.body.name,
        nodes: req.body.nodes as PipelineNode[] | undefined,
        edges: req.body.edges as PipelineEdge[] | undefined,
        status: req.body.status,
      });
      await recordAudit(req.db, {
        projectId: p.projectId,
        actorUserId: userId,
        action: "pipeline.save",
        resourceType: "pipeline",
        resourceId: p.id,
        metadata: { nodes: p.nodes.length, edges: p.edges.length, status: p.status },
      });
      return p;
    },
  );

  app.delete(
    "/pipelines/:id",
    {
      schema: {
        summary: "Delete a pipeline",
        tags: ["pipelines"],
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ deleted: z.boolean() }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const p = await getPipeline(req.db, req.params.id);
      await deletePipeline(req.db, req.params.id);
      await recordAudit(req.db, {
        projectId: p.projectId,
        actorUserId: userId,
        action: "pipeline.delete",
        resourceType: "pipeline",
        resourceId: req.params.id,
        metadata: { name: p.name },
      });
      return { deleted: true };
    },
  );

  // Validation is its own call so the canvas can show problems while you build
  // rather than only when you press run.
  app.post(
    "/pipelines/:id/validate",
    {
      schema: {
        summary: "Check the graph without running it",
        tags: ["pipelines"],
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: z.object({
            issues: z.array(z.object({ nodeId: z.string().nullable(), message: z.string() })),
          }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      await requireUserId(req);
      const p = await getPipeline(req.db, req.params.id);
      return { issues: validate(p) };
    },
  );

  // Preview computes everything and writes nothing, keeping a sample per node —
  // that sample is what makes "where did my rows go" answerable.
  app.post(
    "/pipelines/:id/preview",
    {
      schema: {
        summary: "Run against a sample without writing outputs",
        tags: ["pipelines"],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ limit: z.number().int().min(1).max(200).optional() }).default({}),
        response: { 200: runOut, 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req) => {
      await requireUserId(req);
      const p = await getPipeline(req.db, req.params.id);
      return execute(req.db, p, { preview: true, limit: req.body.limit, trigger: "preview" });
    },
  );

  app.post(
    "/pipelines/:id/run",
    {
      schema: {
        summary: "Run the pipeline and write its outputs",
        tags: ["pipelines"],
        params: z.object({ id: z.string().uuid() }),
        response: { 200: runOut, 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const p = await getPipeline(req.db, req.params.id);
      const result = await execute(req.db, p, { trigger: "manual" });
      await recordAudit(req.db, {
        projectId: p.projectId,
        actorUserId: userId,
        action: "pipeline.run",
        resourceType: "pipeline",
        resourceId: p.id,
        metadata: { status: result.status, rowsOut: result.rowsOut },
      });
      return result;
    },
  );

  app.get(
    "/pipelines/:id/runs",
    {
      schema: {
        summary: "Run history",
        tags: ["pipelines"],
        params: z.object({ id: z.string().uuid() }),
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }),
        response: {
          200: z.object({
            runs: z.array(
              z.object({
                id: z.string(),
                status: z.string(),
                trigger: z.string(),
                rowsIn: z.number(),
                rowsOut: z.number(),
                nodeStats: z.record(z.unknown()),
                error: z.string().nullable(),
                startedAt: z.string(),
                finishedAt: z.string().nullable(),
              }),
            ),
          }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      await requireUserId(req);
      return { runs: await listRuns(req.db, req.params.id, req.query.limit) };
    },
  );
};

export default pipelineRoutes;
