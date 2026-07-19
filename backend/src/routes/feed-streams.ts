import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { AppError, NotFound } from "../lib/errors.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import { resolveEnvironment } from "../services/ontology.js";
import { resolveStreamUrl, type FeedStreamConfig } from "../services/feed-sim.js";

// ---------------------------------------------------------------------------
// Feed simulator streams — CRUD + start/pause + event injection. Execution
// happens in the server-side scheduler (services/feed-sim.ts); these routes
// only manage state.
// ---------------------------------------------------------------------------

const datasetIn = z.object({
  name: z.string().min(1).max(200),
  rows: z.array(z.record(z.string())).max(2000),
});

const configIn = z.object({
  targetMode: z.enum(["channel", "url"]),
  channelSlug: z.string().max(120).default(""),
  url: z.string().max(500).default(""),
  templateMode: z.enum(["template", "dataset"]),
  templateKind: z.string().max(60).default("lab"),
  template: z.string().max(8000).default(""),
  datasets: z.array(datasetIn).max(10).default([]),
  datasetLoop: z.boolean().default(true),
  ratePerSec: z.number().min(0.01).max(20),
  diurnal: z.boolean().default(true),
  weekendDipPct: z.number().min(0).max(100).default(35),
  maxCount: z.number().int().min(0).max(1_000_000).default(0),
  abnormalPct: z.number().min(0).max(100).default(10),
  malformedPct: z.number().min(0).max(100).default(2),
  duplicatePct: z.number().min(0).max(100).default(3),
  poolSize: z.number().int().min(1).max(100_000).default(250),
});

const streamStatus = z.enum(["running", "paused"]);

const streamOut = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: streamStatus,
  config: z.record(z.unknown()),
  sentCount: z.number().int(),
  failedCount: z.number().int(),
  datasetIndex: z.number().int(),
  surgeUntil: z.string().nullable(),
  stallUntil: z.string().nullable(),
  lastSentAt: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
});

const sendOut = z.object({
  id: z.string().uuid(),
  streamId: z.string().uuid(),
  streamName: z.string(),
  payload: z.unknown(),
  statusCode: z.number().int().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

// Total dataset rows across a stream's files stays bounded.
function validateDatasetSize(config: z.infer<typeof configIn>): void {
  const total = config.datasets.reduce((n, d) => n + d.rows.length, 0);
  if (total > 2000) {
    throw new AppError("DATASET_TOO_LARGE", "A stream may hold at most 2,000 dataset rows.", 400);
  }
}

interface StreamRow {
  id: string;
  name: string;
  status: z.infer<typeof streamStatus>;
  config: FeedStreamConfig;
  sent_count: string;
  failed_count: string;
  dataset_index: number;
  surge_until: Date | null;
  stall_until: Date | null;
  last_sent_at: Date | null;
  last_error: string | null;
  created_at: Date;
}

function streamRowOut(r: StreamRow): z.infer<typeof streamOut> {
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    config: r.config as unknown as Record<string, unknown>,
    sentCount: Number(r.sent_count),
    failedCount: Number(r.failed_count),
    datasetIndex: r.dataset_index,
    surgeUntil: r.surge_until ? r.surge_until.toISOString() : null,
    stallUntil: r.stall_until ? r.stall_until.toISOString() : null,
    lastSentAt: r.last_sent_at ? r.last_sent_at.toISOString() : null,
    lastError: r.last_error,
    createdAt: r.created_at.toISOString(),
  };
}

const STREAM_SELECT = `
  SELECT id, name, status, config, sent_count, failed_count, dataset_index,
         surge_until, stall_until, last_sent_at, last_error, created_at
    FROM app.feed_stream`;

async function findStream(db: DbClient, environmentId: string, id: string): Promise<StreamRow> {
  const { rows } = await db.query<StreamRow>(
    `${STREAM_SELECT} WHERE environment_id = $1 AND id = $2`,
    [environmentId, id],
  );
  const row = rows[0];
  if (!row) throw NotFound("STREAM_NOT_FOUND", "Feed stream not found.");
  return row;
}

const feedStreamRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/ontology/:env/feed-streams",
    {
      schema: {
        summary: "List feed simulator streams (server-side generators)",
        tags: ["feed-sim"],
        params: z.object({ env: z.string().min(1) }),
        response: { 200: z.object({ streams: z.array(streamOut) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const { rows } = await req.db.query<StreamRow>(
        `${STREAM_SELECT} WHERE environment_id = $1 ORDER BY created_at ASC`,
        [env.id],
      );
      return { streams: rows.map(streamRowOut) };
    },
  );

  app.post(
    "/ontology/:env/feed-streams",
    {
      schema: {
        summary: "Create a feed stream",
        tags: ["feed-sim"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({ name: z.string().min(1).max(120), config: configIn }),
        response: { 201: streamOut, 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      validateDatasetSize(req.body.config);
      const { rows } = await req.db.query<{ id: string }>(
        `INSERT INTO app.feed_stream
                (environment_id, owner_user_id, organization_id, name, config)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         RETURNING id`,
        [env.id, userId, env.organizationId, req.body.name.trim(), JSON.stringify(req.body.config)],
      );
      return reply.status(201).send(streamRowOut(await findStream(req.db, env.id, rows[0]!.id)));
    },
  );

  app.patch(
    "/ontology/:env/feed-streams/:id",
    {
      schema: {
        summary: "Update a stream's name, config, or run status",
        tags: ["feed-sim"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        body: z.object({
          name: z.string().min(1).max(120).optional(),
          config: configIn.optional(),
          status: streamStatus.optional(),
        }),
        response: { 200: streamOut, 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const existing = await findStream(req.db, env.id, req.params.id);
      if (req.body.config) validateDatasetSize(req.body.config);

      // Starting a stream with no reachable target fails fast with a clear error.
      if (req.body.status === "running") {
        const config = (req.body.config ?? existing.config) as FeedStreamConfig;
        const url = await resolveStreamUrl(req.db, env.id, config);
        if (!url) {
          throw new AppError(
            "NO_TARGET",
            "Set a target first — pick a channel with a webhook or paste a URL.",
            400,
          );
        }
      }

      await req.db.query(
        `UPDATE app.feed_stream
            SET name = COALESCE($3, name),
                config = COALESCE($4::jsonb, config),
                status = COALESCE($5, status),
                last_error = CASE WHEN $5 = 'running' THEN NULL ELSE last_error END,
                dataset_index = CASE WHEN $4 IS NOT NULL THEN 0 ELSE dataset_index END,
                updated_at = NOW()
          WHERE id = $1 AND environment_id = $2`,
        [
          req.params.id,
          env.id,
          req.body.name?.trim() ?? null,
          req.body.config ? JSON.stringify(req.body.config) : null,
          req.body.status ?? null,
        ],
      );
      return streamRowOut(await findStream(req.db, env.id, req.params.id));
    },
  );

  app.post(
    "/ontology/:env/feed-streams/:id/inject",
    {
      schema: {
        summary: "Inject a temporary event into a stream (surge or stall)",
        tags: ["feed-sim"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        body: z.object({
          kind: z.enum(["surge", "stall"]),
          minutes: z.number().int().min(1).max(24 * 60).default(30),
          factor: z.number().min(1).max(20).default(4),
        }),
        response: { 200: streamOut, 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      await findStream(req.db, env.id, req.params.id);
      if (req.body.kind === "surge") {
        await req.db.query(
          `UPDATE app.feed_stream
              SET surge_until = NOW() + make_interval(mins => $2),
                  surge_factor = $3, stall_until = NULL, updated_at = NOW()
            WHERE id = $1`,
          [req.params.id, req.body.minutes, req.body.factor],
        );
      } else {
        await req.db.query(
          `UPDATE app.feed_stream
              SET stall_until = NOW() + make_interval(mins => $2),
                  surge_until = NULL, updated_at = NOW()
            WHERE id = $1`,
          [req.params.id, req.body.minutes],
        );
      }
      return streamRowOut(await findStream(req.db, env.id, req.params.id));
    },
  );

  app.delete(
    "/ontology/:env/feed-streams/:id",
    {
      schema: {
        summary: "Delete a feed stream and its send log",
        tags: ["feed-sim"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        response: { 200: z.object({ ok: z.literal(true) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      await findStream(req.db, env.id, req.params.id);
      await req.db.query(`DELETE FROM app.feed_stream WHERE id = $1`, [req.params.id]);
      return { ok: true as const };
    },
  );

  app.get(
    "/ontology/:env/feed-sends",
    {
      schema: {
        summary: "Recent objects sent by feed streams (send log / Data Studio input)",
        tags: ["feed-sim"],
        params: z.object({ env: z.string().min(1) }),
        querystring: z.object({
          streamId: z.string().uuid().optional(),
          stream: z.string().max(120).optional(),
          limit: z.coerce.number().int().min(1).max(500).default(100),
        }),
        response: { 200: z.object({ sends: z.array(sendOut) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const params: unknown[] = [env.id];
      let where = `s.environment_id = $1`;
      if (req.query.streamId) {
        params.push(req.query.streamId);
        where += ` AND fs.stream_id = $${params.length}`;
      }
      if (req.query.stream?.trim()) {
        params.push(`%${req.query.stream.trim()}%`);
        where += ` AND s.name ILIKE $${params.length}`;
      }
      params.push(req.query.limit);
      const { rows } = await req.db.query<{
        id: string;
        stream_id: string;
        stream_name: string;
        payload: unknown;
        status_code: number | null;
        note: string | null;
        created_at: Date;
      }>(
        `SELECT fs.id, fs.stream_id, s.name AS stream_name, fs.payload,
                fs.status_code, fs.note, fs.created_at
           FROM app.feed_stream_send fs
           JOIN app.feed_stream s ON s.id = fs.stream_id
          WHERE ${where}
          ORDER BY fs.created_at DESC
          LIMIT $${params.length}`,
        params,
      );
      return {
        sends: rows.map((r) => ({
          id: r.id,
          streamId: r.stream_id,
          streamName: r.stream_name,
          payload: r.payload,
          statusCode: r.status_code,
          note: r.note,
          createdAt: r.created_at.toISOString(),
        })),
      };
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

export default feedStreamRoutes;
