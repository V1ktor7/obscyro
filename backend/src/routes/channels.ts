import crypto from "node:crypto";

import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { AppError, Conflict, NotFound } from "../lib/errors.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import { resolveEnvironment } from "../services/ontology.js";

// ---------------------------------------------------------------------------
// Data channels — saved linear parse pipelines (intake → steps → save).
// The step list is an ordered JSONB array; step semantics (what "extract" or
// "validate" do) live in the client runner, the API guarantees shape + order.
// ---------------------------------------------------------------------------

const stepType = z.enum(["intake", "transform", "extract", "validate", "save"]);

const channelStep = z.object({
  id: z.string().min(1),
  type: stepType,
  enabled: z.boolean(),
  config: z.record(z.unknown()),
});

const channelStatus = z.enum(["draft", "live", "paused"]);

const channelStats = z.object({
  runsToday: z.number().int(),
  avgDurationMs: z.number().nullable(),
  savedToday: z.number().int(),
  flaggedToday: z.number().int(),
});

const channelOut = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  status: channelStatus,
  steps: z.array(channelStep),
  sourceId: z.string().uuid().nullable(),
  webhookUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastRunAt: z.string().nullable(),
  stats: channelStats,
});

const runStatus = z.enum(["succeeded", "flagged", "failed"]);
const runTrigger = z.enum(["manual", "webhook", "source"]);

const runOut = z.object({
  id: z.string().uuid(),
  status: runStatus,
  trigger: runTrigger,
  inputChars: z.number().int().nullable(),
  conceptCount: z.number().int(),
  savedCount: z.number().int(),
  flaggedCount: z.number().int(),
  durationMs: z.number().int().nullable(),
  stepTimings: z.record(z.unknown()),
  error: z.string().nullable(),
  createdAt: z.string(),
});

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function webhookToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

function publicBase(): string {
  const base = process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
  return base.replace(/\/$/, "");
}

type ChannelStep = z.infer<typeof channelStep>;

function defaultSteps(): ChannelStep[] {
  return [
    { id: "intake", type: "intake", enabled: true, config: { mode: "paste" } },
    { id: "transform", type: "transform", enabled: true, config: { language: "auto" } },
    {
      id: "extract",
      type: "extract",
      enabled: true,
      config: { acceptThreshold: 0.85, translate: false, targetSystem: "icd10" },
    },
    {
      id: "validate",
      type: "validate",
      enabled: true,
      config: { minConfidence: 0.6, skipDuplicates: true },
    },
    {
      id: "save",
      type: "save",
      enabled: true,
      config: { objectType: "ClinicalFinding", patientIdentifierSource: "" },
    },
  ];
}

interface ChannelRow {
  id: string;
  name: string;
  slug: string;
  status: z.infer<typeof channelStatus>;
  steps: unknown;
  source_id: string | null;
  webhook_token: string | null;
  created_at: Date;
  updated_at: Date;
  last_run_at: Date | null;
  runs_today: string;
  avg_duration_ms: string | null;
  saved_today: string;
  flagged_today: string;
}

function channelRowOut(r: ChannelRow): z.infer<typeof channelOut> {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    status: r.status,
    steps: r.steps as ChannelStep[],
    sourceId: r.source_id,
    webhookUrl: r.webhook_token ? `${publicBase()}/v1/webhooks/${r.webhook_token}` : null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    lastRunAt: r.last_run_at ? r.last_run_at.toISOString() : null,
    stats: {
      runsToday: Number(r.runs_today),
      avgDurationMs: r.avg_duration_ms === null ? null : Math.round(Number(r.avg_duration_ms)),
      savedToday: Number(r.saved_today),
      flaggedToday: Number(r.flagged_today),
    },
  };
}

const CHANNEL_SELECT = `
  SELECT c.id, c.name, c.slug, c.status, c.steps, c.source_id, s.webhook_token,
         c.created_at, c.updated_at,
         MAX(r.created_at) AS last_run_at,
         COUNT(r.id) FILTER (WHERE r.created_at >= date_trunc('day', now())) AS runs_today,
         AVG(r.duration_ms) FILTER (WHERE r.created_at >= date_trunc('day', now())) AS avg_duration_ms,
         COALESCE(SUM(r.saved_count) FILTER (WHERE r.created_at >= date_trunc('day', now())), 0) AS saved_today,
         COALESCE(SUM(r.flagged_count) FILTER (WHERE r.created_at >= date_trunc('day', now())), 0) AS flagged_today
    FROM app.data_channel c
    LEFT JOIN app.ingest_sources s ON s.id = c.source_id
    LEFT JOIN app.data_channel_run r ON r.channel_id = c.id`;

async function findChannel(
  db: DbClient,
  environmentId: string,
  slug: string,
): Promise<ChannelRow> {
  const { rows } = await db.query<ChannelRow>(
    `${CHANNEL_SELECT}
      WHERE c.environment_id = $1 AND c.slug = $2
      GROUP BY c.id, s.webhook_token`,
    [environmentId, slug],
  );
  const row = rows[0];
  if (!row) throw NotFound("CHANNEL_NOT_FOUND", `Channel "${slug}" not found.`);
  return row;
}

const channelsRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/ontology/:env/channels",
    {
      schema: {
        summary: "List data channels for an environment with today's run stats",
        tags: ["channels"],
        params: z.object({ env: z.string().min(1) }),
        response: {
          200: z.object({ channels: z.array(channelOut) }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const { rows } = await req.db.query<ChannelRow>(
        `${CHANNEL_SELECT}
          WHERE c.environment_id = $1
          GROUP BY c.id, s.webhook_token
          ORDER BY c.created_at ASC`,
        [env.id],
      );
      return { channels: rows.map(channelRowOut) };
    },
  );

  app.post(
    "/ontology/:env/channels",
    {
      schema: {
        summary: "Create a data channel (defaults to the standard five-step pipeline)",
        tags: ["channels"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          name: z.string().min(1).max(120),
          steps: z.array(channelStep).optional(),
        }),
        response: {
          201: channelOut,
          404: errorEnvelope,
          409: errorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const slug = slugify(req.body.name);
      if (!slug) throw new AppError("INVALID_NAME", "Channel name must contain letters or digits.", 400);
      const steps = req.body.steps ?? defaultSteps();
      const { rows } = await req.db.query<{ id: string }>(
        `INSERT INTO app.data_channel
                (environment_id, owner_user_id, organization_id, name, slug, steps)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (environment_id, slug) DO NOTHING
         RETURNING id`,
        [env.id, userId, env.organizationId, req.body.name.trim(), slug, JSON.stringify(steps)],
      );
      if (!rows[0]) {
        throw Conflict("CHANNEL_EXISTS", `A channel named "${req.body.name}" already exists.`);
      }
      const row = await findChannel(req.db, env.id, slug);
      return reply.status(201).send(channelRowOut(row));
    },
  );

  app.patch(
    "/ontology/:env/channels/:slug",
    {
      schema: {
        summary: "Update a channel's name, status, or step list",
        tags: ["channels"],
        params: z.object({ env: z.string().min(1), slug: z.string().min(1) }),
        body: z.object({
          name: z.string().min(1).max(120).optional(),
          status: channelStatus.optional(),
          steps: z.array(channelStep).optional(),
          sourceId: z.string().uuid().nullable().optional(),
        }),
        response: {
          200: channelOut,
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const existing = await findChannel(req.db, env.id, req.params.slug);

      const sets: string[] = ["updated_at = NOW()"];
      const params: unknown[] = [];
      if (req.body.name !== undefined) {
        params.push(req.body.name.trim());
        sets.push(`name = $${params.length}`);
      }
      if (req.body.status !== undefined) {
        params.push(req.body.status);
        sets.push(`status = $${params.length}`);
      }
      if (req.body.steps !== undefined) {
        params.push(JSON.stringify(req.body.steps));
        sets.push(`steps = $${params.length}::jsonb`);
      }
      if (req.body.sourceId !== undefined) {
        if (req.body.sourceId !== null) {
          const src = await req.db.query<{ id: string }>(
            `SELECT id FROM app.ingest_sources WHERE id = $1 AND user_id = $2`,
            [req.body.sourceId, userId],
          );
          if (!src.rows[0]) {
            throw NotFound("SOURCE_NOT_FOUND", "Ingest source not found.");
          }
        }
        params.push(req.body.sourceId);
        sets.push(`source_id = $${params.length}`);
      }
      params.push(existing.id);
      await req.db.query(
        `UPDATE app.data_channel SET ${sets.join(", ")} WHERE id = $${params.length}`,
        params,
      );
      return channelRowOut(await findChannel(req.db, env.id, req.params.slug));
    },
  );

  app.delete(
    "/ontology/:env/channels/:slug",
    {
      schema: {
        summary: "Delete a channel and its run history",
        tags: ["channels"],
        params: z.object({ env: z.string().min(1), slug: z.string().min(1) }),
        response: {
          200: z.object({ ok: z.literal(true) }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const existing = await findChannel(req.db, env.id, req.params.slug);
      await req.db.query(`DELETE FROM app.data_channel WHERE id = $1`, [existing.id]);
      return { ok: true as const };
    },
  );

  app.post(
    "/ontology/:env/channels/:slug/webhook",
    {
      schema: {
        summary: "Provision a dedicated inbound webhook for a channel",
        description:
          "Creates a webhook ingest source bound to this channel (or returns the " +
          "existing binding). Payloads POSTed to the returned URL trigger a " +
          "server-side run of the channel when its status is live.",
        tags: ["channels"],
        params: z.object({ env: z.string().min(1), slug: z.string().min(1) }),
        response: {
          201: z.object({
            sourceId: z.string().uuid(),
            webhookUrl: z.string(),
            method: z.string(),
          }),
          404: errorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const channel = await findChannel(req.db, env.id, req.params.slug);

      // Reuse the existing bound webhook source when there is one.
      if (channel.source_id) {
        const existing = await req.db.query<{
          id: string;
          webhook_token: string | null;
          webhook_method: string;
        }>(
          `SELECT id, webhook_token, webhook_method FROM app.ingest_sources
            WHERE id = $1 AND type = 'webhook'`,
          [channel.source_id],
        );
        const src = existing.rows[0];
        if (src?.webhook_token) {
          return reply.code(201).send({
            sourceId: src.id,
            webhookUrl: `${publicBase()}/v1/webhooks/${src.webhook_token}`,
            method: src.webhook_method,
          });
        }
      }

      const token = webhookToken();
      const inserted = await req.db.query<{ id: string }>(
        `INSERT INTO app.ingest_sources (user_id, name, type, webhook_token, webhook_method, webhook_config)
         VALUES ($1, $2, 'webhook', $3, 'POST', '{}'::jsonb)
         RETURNING id`,
        [userId, `Channel: ${channel.name}`, token],
      );
      const sourceId = inserted.rows[0]!.id;
      await req.db.query(
        `UPDATE app.data_channel SET source_id = $2, updated_at = NOW() WHERE id = $1`,
        [channel.id, sourceId],
      );

      return reply.code(201).send({
        sourceId,
        webhookUrl: `${publicBase()}/v1/webhooks/${token}`,
        method: "POST",
      });
    },
  );

  app.get(
    "/ontology/:env/channels/:slug/runs",
    {
      schema: {
        summary: "List recent runs for a channel",
        tags: ["channels"],
        params: z.object({ env: z.string().min(1), slug: z.string().min(1) }),
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(100).default(20),
        }),
        response: {
          200: z.object({ runs: z.array(runOut) }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const channel = await findChannel(req.db, env.id, req.params.slug);
      const { rows } = await req.db.query<{
        id: string;
        status: z.infer<typeof runStatus>;
        run_trigger: z.infer<typeof runTrigger>;
        input_chars: number | null;
        concept_count: number;
        saved_count: number;
        flagged_count: number;
        duration_ms: number | null;
        step_timings: Record<string, unknown>;
        error: string | null;
        created_at: Date;
      }>(
        `SELECT id, status, run_trigger, input_chars, concept_count, saved_count,
                flagged_count, duration_ms, step_timings, error, created_at
           FROM app.data_channel_run
          WHERE channel_id = $1
          ORDER BY created_at DESC
          LIMIT $2`,
        [channel.id, req.query.limit],
      );
      return {
        runs: rows.map((r) => ({
          id: r.id,
          status: r.status,
          trigger: r.run_trigger,
          inputChars: r.input_chars,
          conceptCount: r.concept_count,
          savedCount: r.saved_count,
          flaggedCount: r.flagged_count,
          durationMs: r.duration_ms,
          stepTimings: r.step_timings,
          error: r.error,
          createdAt: r.created_at.toISOString(),
        })),
      };
    },
  );

  app.post(
    "/ontology/:env/channels/:slug/runs",
    {
      schema: {
        summary: "Record a channel run (executed by the client runner)",
        tags: ["channels"],
        params: z.object({ env: z.string().min(1), slug: z.string().min(1) }),
        body: z.object({
          status: runStatus,
          trigger: runTrigger.default("manual"),
          inputChars: z.number().int().min(0).nullable().optional(),
          conceptCount: z.number().int().min(0).default(0),
          savedCount: z.number().int().min(0).default(0),
          flaggedCount: z.number().int().min(0).default(0),
          durationMs: z.number().int().min(0).nullable().optional(),
          stepTimings: z.record(z.number()).default({}),
          error: z.string().nullable().optional(),
        }),
        response: {
          201: runOut,
          404: errorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const channel = await findChannel(req.db, env.id, req.params.slug);
      const { rows } = await req.db.query<{ id: string; created_at: Date }>(
        `INSERT INTO app.data_channel_run
                (channel_id, status, run_trigger, input_chars, concept_count,
                 saved_count, flagged_count, duration_ms, step_timings, error)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
         RETURNING id, created_at`,
        [
          channel.id,
          req.body.status,
          req.body.trigger,
          req.body.inputChars ?? null,
          req.body.conceptCount,
          req.body.savedCount,
          req.body.flaggedCount,
          req.body.durationMs ?? null,
          JSON.stringify(req.body.stepTimings),
          req.body.error ?? null,
        ],
      );
      return reply.status(201).send({
        id: rows[0]!.id,
        status: req.body.status,
        trigger: req.body.trigger,
        inputChars: req.body.inputChars ?? null,
        conceptCount: req.body.conceptCount,
        savedCount: req.body.savedCount,
        flaggedCount: req.body.flaggedCount,
        durationMs: req.body.durationMs ?? null,
        stepTimings: req.body.stepTimings,
        error: req.body.error ?? null,
        createdAt: rows[0]!.created_at.toISOString(),
      });
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

export default channelsRoutes;
