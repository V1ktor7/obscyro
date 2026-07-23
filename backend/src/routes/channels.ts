import crypto from "node:crypto";

import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { AppError, Conflict, NotFound } from "../lib/errors.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import {
  CLINICAL_FINDING_SCHEMA,
  PATIENT_SCHEMA,
  getOrCreateLinkType,
  getOrCreateObjectType,
  resolveEnvironment,
} from "../services/ontology.js";
import {
  persistExtractResults,
  type PersistableExtractResult,
} from "../services/persist-extract.js";
import {
  buildMapProperties,
  type MappingRule,
} from "../services/channel-runner.js";
import { findInstanceIdByKey, type PropertyDef } from "../services/ontology.js";

// ---------------------------------------------------------------------------
// Data channels — saved linear parse pipelines (intake → steps → save).
// The step list is an ordered JSONB array; step semantics (what "extract" or
// "validate" do) live in the client runner, the API guarantees shape + order.
// ---------------------------------------------------------------------------

const stepType = z.enum(["intake", "transform", "map", "extract", "validate", "save"]);

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
  queuedJobs: z.number().int(),
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
  stepIo: z.array(
    z.object({
      stepId: z.string(),
      type: z.string(),
      input: z.string(),
      output: z.string(),
      note: z.string().optional(),
    }),
  ),
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

interface StepIoOut {
  stepId: string;
  type: string;
  input: string;
  output: string;
  note?: string;
}

/** step_io rows predating migration 027 are '[]'; tolerate any malformed shape. */
function normalizeStepIo(raw: unknown): StepIoOut[] {
  if (!Array.isArray(raw)) return [];
  const out: StepIoOut[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    out.push({
      stepId: String(r.stepId ?? ""),
      type: String(r.type ?? ""),
      input: String(r.input ?? ""),
      output: String(r.output ?? ""),
      ...(typeof r.note === "string" ? { note: r.note } : {}),
    });
  }
  return out;
}

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
  queued_jobs: string;
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
      queuedJobs: Number(r.queued_jobs),
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
         COALESCE(SUM(r.flagged_count) FILTER (WHERE r.created_at >= date_trunc('day', now())), 0) AS flagged_today,
         (SELECT COUNT(*) FROM app.channel_job jq
           WHERE jq.channel_id = c.id AND jq.status IN ('queued', 'running')) AS queued_jobs
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
        step_io: unknown;
        error: string | null;
        created_at: Date;
      }>(
        `SELECT id, status, run_trigger, input_chars, concept_count, saved_count,
                flagged_count, duration_ms, step_timings, step_io, error, created_at
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
          stepIo: normalizeStepIo(r.step_io),
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
          stepIo: z
            .array(
              z.object({
                stepId: z.string(),
                type: z.string(),
                input: z.string().max(4000),
                output: z.string().max(4000),
                note: z.string().max(400).optional(),
              }),
            )
            .max(12)
            .default([]),
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
                 saved_count, flagged_count, duration_ms, step_timings, step_io, error)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11)
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
          JSON.stringify(req.body.stepIo),
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
        stepIo: req.body.stepIo,
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


// ---------------------------------------------------------------------------
// Review queue — flagged/escalated extractions parked for a human decision.
// Confirming persists the instance with the settings the original run would
// have used; rejecting closes the item. Nothing is silently discarded.
// ---------------------------------------------------------------------------

const reviewItemOut = z.object({
  id: z.string().uuid(),
  channelName: z.string(),
  channelSlug: z.string(),
  span: z.string(),
  code: z.string().nullable(),
  display: z.string().nullable(),
  decision: z.enum(["flag", "escalate"]),
  confidence: z.number().nullable(),
  objectType: z.string(),
  readableNote: z.string(),
  status: z.enum(["pending", "confirmed", "rejected"]),
  createdAt: z.string(),
});

interface ReviewRow {
  id: string;
  span: string;
  code: string | null;
  display: string | null;
  decision: "flag" | "escalate";
  confidence: number | null;
  payload: {
    result?: PersistableExtractResult;
    objectType?: string;
    patientIdentifier?: string | null;
    inputHash?: string;
  };
  status: "pending" | "confirmed" | "rejected";
  created_at: Date;
  channel_name: string;
  channel_slug: string;
}

const reviewRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/ontology/:env/review-items",
    {
      schema: {
        summary: "List channel review items (flagged extractions awaiting a decision)",
        tags: ["channels"],
        params: z.object({ env: z.string().min(1) }),
        querystring: z.object({
          status: z.enum(["pending", "confirmed", "rejected"]).default("pending"),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
        response: {
          200: z.object({ items: z.array(reviewItemOut), pendingCount: z.number().int() }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const { rows } = await req.db.query<ReviewRow>(
        `SELECT r.id, r.span, r.code, r.display, r.decision, r.confidence,
                r.payload, r.status, r.created_at,
                c.name AS channel_name, c.slug AS channel_slug
           FROM app.channel_review_item r
           JOIN app.data_channel c ON c.id = r.channel_id
          WHERE r.environment_id = $1 AND r.status = $2
          ORDER BY r.created_at DESC
          LIMIT $3`,
        [env.id, req.query.status, req.query.limit],
      );
      const pending = await req.db.query<{ n: string }>(
        `SELECT COUNT(*)::bigint AS n FROM app.channel_review_item
          WHERE environment_id = $1 AND status = 'pending'`,
        [env.id],
      );
      return {
        items: rows.map((r) => ({
          id: r.id,
          channelName: r.channel_name,
          channelSlug: r.channel_slug,
          span: r.span,
          code: r.code,
          display: r.display,
          decision: r.decision,
          confidence: r.confidence,
          objectType: r.payload.objectType ?? "ClinicalFinding",
          readableNote: r.payload.result?.readable_note ?? "",
          status: r.status,
          createdAt: r.created_at.toISOString(),
        })),
        pendingCount: Number(pending.rows[0]?.n ?? 0),
      };
    },
  );

  // Dry-run the Map step against a sample payload using the SAME transform the
  // live runner uses (buildMapProperties) — so the editor preview can never
  // drift from what actually gets written. Read-only: no instances created.
  app.post(
    "/ontology/:env/map-preview",
    {
      schema: {
        summary: "Preview the Map step transform against a sample payload (read-only)",
        tags: ["channels"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          objectType: z.string().min(1),
          identity: z.array(z.string()).default([]),
          mappings: z.array(z.record(z.unknown())).default([]),
          sample: z.unknown(),
        }),
        response: {
          200: z.object({
            items: z.array(
              z.object({
                properties: z.record(z.unknown()),
                issues: z.array(z.object({ field: z.string(), reason: z.string() })),
                missingRequired: z.array(z.string()),
                action: z.enum(["insert", "update", "review"]),
              }),
            ),
            typeExists: z.boolean(),
          }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const { objectType, identity, mappings, sample } = req.body;

      const typeRes = await req.db.query<{ id: string; property_schema: PropertyDef[] }>(
        `SELECT id, property_schema FROM app.ontology_object_types
          WHERE environment_id = $1 AND name = $2`,
        [env.id, objectType],
      );
      const typeId = typeRes.rows[0]?.id ?? null;
      const schema = typeRes.rows[0]?.property_schema ?? [];
      const rules = mappings as unknown as MappingRule[];
      const scalarRules = rules.filter(
        (r) => r.from && (r.kind ?? "scalar") === "scalar" && r.to,
      );

      const rawItems = Array.isArray(sample) ? sample : [sample];
      const items = rawItems
        .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
        .slice(0, 20);

      const out = [];
      for (const item of items) {
        const { properties, issues, missingRequired } = buildMapProperties(
          item,
          scalarRules,
          schema,
        );
        let action: "insert" | "update" | "review" = "insert";
        if (issues.length > 0 || missingRequired.length > 0) {
          action = "review";
        } else if (typeId && identity.length > 0) {
          const key = identity.find((k) => properties[k] != null);
          if (key) {
            const existing = await findInstanceIdByKey(
              req.db,
              typeId,
              key,
              String(properties[key]),
            );
            if (existing) action = "update";
          }
        }
        out.push({ properties, issues, missingRequired, action });
      }
      return { items: out, typeExists: typeId !== null };
    },
  );

  app.post(
    "/ontology/:env/review-items/:id/resolve",
    {
      schema: {
        summary: "Confirm (persist) or reject a review item",
        tags: ["channels"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        body: z.object({ action: z.enum(["confirm", "reject"]) }),
        response: {
          200: z.object({
            ok: z.literal(true),
            status: z.enum(["confirmed", "rejected"]),
            savedInstanceId: z.string().nullable(),
          }),
          404: errorEnvelope,
          409: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const { rows } = await req.db.query<ReviewRow>(
        `SELECT r.id, r.span, r.code, r.display, r.decision, r.confidence,
                r.payload, r.status, r.created_at,
                c.name AS channel_name, c.slug AS channel_slug
           FROM app.channel_review_item r
           JOIN app.data_channel c ON c.id = r.channel_id
          WHERE r.environment_id = $1 AND r.id = $2`,
        [env.id, req.params.id],
      );
      const item = rows[0];
      if (!item) throw NotFound("REVIEW_ITEM_NOT_FOUND", "Review item not found.");
      if (item.status !== "pending") {
        throw Conflict("REVIEW_ALREADY_RESOLVED", `Item is already ${item.status}.`);
      }

      let savedInstanceId: string | null = null;
      if (req.body.action === "confirm") {
        const result = item.payload.result;
        if (!result) {
          throw Conflict("REVIEW_PAYLOAD_INVALID", "Item has no persistable payload.");
        }
        const objectType = item.payload.objectType ?? "ClinicalFinding";
        const findingTypeId = await getOrCreateObjectType(
          req.db,
          env.id,
          objectType,
          "Clinical finding extracted from text with its context envelope",
          CLINICAL_FINDING_SCHEMA,
        );
        const patientTypeId = await getOrCreateObjectType(
          req.db,
          env.id,
          "Patient",
          "Subject of clinical findings",
          PATIENT_SCHEMA,
        );
        const linkTypeId = await getOrCreateLinkType(
          req.db,
          env.id,
          "has_finding",
          patientTypeId,
          findingTypeId,
          "many_to_many",
        );
        const persisted = await persistExtractResults({
          environmentId: env.id,
          environmentSlug: env.slug,
          environmentName: env.name,
          objectTypeName: objectType,
          findingTypeId,
          patientTypeId,
          linkTypeId,
          patientIdentifier: item.payload.patientIdentifier ?? undefined,
          inputHash: item.payload.inputHash ?? "review-confirm",
          results: [{ ...result, decision: "accept" }],
        });
        savedInstanceId = persisted.objectIds[0] ?? null;
      }

      const status = req.body.action === "confirm" ? ("confirmed" as const) : ("rejected" as const);
      await req.db.query(
        `UPDATE app.channel_review_item
            SET status = $2, resolved_at = now()
          WHERE id = $1`,
        [item.id, status],
      );
      return { ok: true as const, status, savedInstanceId };
    },
  );
};

export { reviewRoutes };

export default channelsRoutes;
