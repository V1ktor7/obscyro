import crypto from "node:crypto";

import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { AppError, NotFound } from "../lib/errors.js";
import { recordAudit } from "../services/audit.js";
import {
  CONNECTORS,
  createSync,
  listSyncs,
  runPullSync,
} from "../services/connectivity.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import { resolveEnvironment } from "../services/ontology.js";

// ---------------------------------------------------------------------------
// Sources, syncs and the connector catalogue.
// ---------------------------------------------------------------------------

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

const connectorKind = z.enum([
  "webhook",
  "rest",
  "file_upload",
  "http_poll",
  "postgres",
  "hl7v2",
]);

const syncOut = z.object({
  id: z.string(),
  projectId: z.string(),
  sourceId: z.string(),
  datasetId: z.string(),
  name: z.string(),
  mode: z.enum(["stream", "snapshot", "incremental"]),
  intervalSeconds: z.number().nullable(),
  incrementalColumn: z.string().nullable(),
  watermark: z.string().nullable(),
  status: z.string(),
  lastRunAt: z.string().nullable(),
  lastError: z.string().nullable(),
});

const sourceOut = z.object({
  id: z.string(),
  name: z.string(),
  connector: z.string(),
  status: z.string(),
  webhookUrl: z.string().nullable(),
  lastError: z.string().nullable(),
  syncCount: z.number(),
  createdAt: z.string(),
});

function publicBase(): string {
  const base = process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
  return base.replace(/\/$/, "");
}

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

const connectivityRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // --- Connector catalogue --------------------------------------------------
  app.get(
    "/connectors",
    {
      schema: {
        summary: "Available connector types",
        tags: ["connectivity"],
        response: {
          200: z.object({
            connectors: z.array(
              z.object({
                kind: z.string(),
                label: z.string(),
                direction: z.enum(["push", "pull"]),
                modes: z.array(z.string()),
                description: z.string(),
                implemented: z.boolean(),
              }),
            ),
          }),
        },
      },
    },
    async () => ({ connectors: CONNECTORS }),
  );

  // --- Sources --------------------------------------------------------------
  app.get(
    "/ontology/:env/sources",
    {
      schema: {
        summary: "List sources in a project",
        tags: ["connectivity"],
        params: z.object({ env: z.string().min(1) }),
        response: { 200: z.object({ sources: z.array(sourceOut) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const { rows } = await req.db.query<{
        id: string;
        name: string;
        type: string;
        status: string;
        webhook_token: string | null;
        last_error: string | null;
        sync_count: string;
        created_at: Date;
      }>(
        `SELECT s.id, s.name, s.type, s.status, s.webhook_token, s.last_error,
                (SELECT COUNT(*) FROM app.sync y WHERE y.source_id = s.id) AS sync_count,
                s.created_at
           FROM app.ingest_sources s
          WHERE s.project_id = $1
          ORDER BY s.created_at ASC`,
        [env.id],
      );
      return {
        sources: rows.map((r) => ({
          id: r.id,
          name: r.name,
          connector: r.type,
          status: r.status,
          webhookUrl: r.webhook_token ? `${publicBase()}/v1/webhooks/${r.webhook_token}` : null,
          lastError: r.last_error,
          syncCount: Number(r.sync_count),
          createdAt: r.created_at.toISOString(),
        })),
      };
    },
  );

  app.post(
    "/ontology/:env/sources",
    {
      schema: {
        summary: "Create a source (a connection, not yet a sync)",
        tags: ["connectivity"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          name: z.string().min(1).max(120),
          connector: connectorKind,
          config: z.record(z.unknown()).default({}),
        }),
        response: { 201: sourceOut, 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);

      const meta = CONNECTORS.find((c) => c.kind === req.body.connector);
      if (meta && !meta.implemented) {
        throw new AppError(
          "CONNECTOR_NOT_IMPLEMENTED",
          `The ${meta.label} connector is defined but not yet implemented.`,
          400,
        );
      }
      // Push connectors get a URL to receive on; pull connectors do not.
      const isPush = meta?.direction === "push";
      const token = isPush ? crypto.randomBytes(24).toString("base64url") : null;

      const { rows } = await req.db.query<{
        id: string;
        name: string;
        type: string;
        status: string;
        webhook_token: string | null;
        last_error: string | null;
        created_at: Date;
      }>(
        `INSERT INTO app.ingest_sources
                (user_id, project_id, name, type, webhook_token, connector_config)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         RETURNING id, name, type, status, webhook_token, last_error, created_at`,
        [
          userId,
          env.id,
          req.body.name,
          req.body.connector,
          token,
          JSON.stringify(req.body.config),
        ],
      );
      const r = rows[0]!;
      await recordAudit(req.db, {
        projectId: env.id,
        actorUserId: userId,
        action: "source.create",
        resourceType: "source",
        resourceId: r.id,
        metadata: { connector: r.type },
      });
      return reply.code(201).send({
        id: r.id,
        name: r.name,
        connector: r.type,
        status: r.status,
        webhookUrl: r.webhook_token ? `${publicBase()}/v1/webhooks/${r.webhook_token}` : null,
        lastError: r.last_error,
        syncCount: 0,
        createdAt: r.created_at.toISOString(),
      });
    },
  );

  // --- Syncs ----------------------------------------------------------------
  app.get(
    "/ontology/:env/syncs",
    {
      schema: {
        summary: "List syncs in a project",
        tags: ["connectivity"],
        params: z.object({ env: z.string().min(1) }),
        response: { 200: z.object({ syncs: z.array(syncOut) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return { syncs: await listSyncs(req.db, env.id) };
    },
  );

  app.post(
    "/ontology/:env/syncs",
    {
      schema: {
        summary: "Create a sync from a source into a dataset",
        tags: ["connectivity"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          name: z.string().min(1).max(120),
          sourceId: z.string().uuid(),
          datasetId: z.string().uuid(),
          mode: z.enum(["stream", "snapshot", "incremental"]).default("stream"),
          intervalSeconds: z.number().int().min(30).max(86_400).nullable().optional(),
          incrementalColumn: z.string().max(120).nullable().optional(),
        }),
        response: { 201: syncOut, 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const sync = await createSync(req.db, {
        projectId: env.id,
        sourceId: req.body.sourceId,
        datasetId: req.body.datasetId,
        name: req.body.name,
        mode: req.body.mode,
        intervalSeconds: req.body.intervalSeconds ?? null,
        incrementalColumn: req.body.incrementalColumn ?? null,
        createdBy: userId,
      });
      await recordAudit(req.db, {
        projectId: env.id,
        actorUserId: userId,
        action: "sync.create",
        resourceType: "sync",
        resourceId: sync.id,
        metadata: { mode: sync.mode },
      });
      return reply.code(201).send(sync);
    },
  );

  app.post(
    "/syncs/:id/run",
    {
      schema: {
        summary: "Run a pull sync now",
        tags: ["connectivity"],
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: z.object({
            rowsRead: z.number(),
            rowsWritten: z.number(),
            error: z.string().nullable(),
          }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      await requireUserId(req);
      return runPullSync(req.db, req.params.id);
    },
  );

  app.get(
    "/syncs/:id/runs",
    {
      schema: {
        summary: "Run history for a sync",
        tags: ["connectivity"],
        params: z.object({ id: z.string().uuid() }),
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }),
        response: {
          200: z.object({
            runs: z.array(
              z.object({
                id: z.string(),
                status: z.string(),
                rowsRead: z.number(),
                rowsWritten: z.number(),
                error: z.string().nullable(),
                startedAt: z.string(),
                finishedAt: z.string().nullable(),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      await requireUserId(req);
      const { rows } = await req.db.query<{
        id: string;
        status: string;
        rows_read: string;
        rows_written: string;
        error: string | null;
        started_at: Date;
        finished_at: Date | null;
      }>(
        `SELECT id, status, rows_read, rows_written, error, started_at, finished_at
           FROM app.sync_run WHERE sync_id = $1
          ORDER BY started_at DESC LIMIT $2`,
        [req.params.id, req.query.limit],
      );
      return {
        runs: rows.map((r) => ({
          id: r.id,
          status: r.status,
          rowsRead: Number(r.rows_read),
          rowsWritten: Number(r.rows_written),
          error: r.error,
          startedAt: r.started_at.toISOString(),
          finishedAt: r.finished_at ? r.finished_at.toISOString() : null,
        })),
      };
    },
  );
};

export default connectivityRoutes;
