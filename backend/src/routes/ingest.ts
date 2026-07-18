import crypto from "node:crypto";

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { AppError, NotFound } from "../lib/errors.js";
import {
  hashSecret,
  ipAllowed,
  isBot,
  verifyBasic,
  verifyHeader,
  verifyJwtHS256,
  type WebhookAuthType,
} from "../lib/webhook-auth.js";
import { dispatchChannelsForSource } from "../services/channel-runner.js";
import { resolveUserIdForApiKey } from "../services/login.js";

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

const WEBHOOK_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const;

function webhookToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

function publicBase(): string {
  const base = process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
  return base.replace(/\/$/, "");
}

// ---------------------------------------------------------------------------
// Webhook config: types, validation, storage shaping, sanitization
// ---------------------------------------------------------------------------

type Kv = { name: string; value: string };

interface StoredWebhookConfig {
  auth: {
    type: WebhookAuthType;
    basic?: { username: string; passwordHash: string };
    header?: { name: string; valueHash: string };
    jwt?: { algorithm: "HS256"; secret: string };
  };
  response: {
    code: number;
    contentType: string;
    body: string | null;
    headers: Kv[];
    noBody: boolean;
  };
  options: {
    allowedOrigins: string;
    ipWhitelist: string[];
    ignoreBots: boolean;
    rawBody: boolean;
    binaryProperty: string | null;
  };
}

const kvSchema = z.object({ name: z.string(), value: z.string() });

const webhookConfigInput = z
  .object({
    auth: z
      .object({
        type: z.enum(["none", "basic", "header", "jwt"]).default("none"),
        basic: z.object({ username: z.string(), password: z.string() }).partial().optional(),
        header: z.object({ name: z.string(), value: z.string() }).partial().optional(),
        jwt: z
          .object({ algorithm: z.literal("HS256"), secret: z.string() })
          .partial()
          .optional(),
      })
      .default({ type: "none" }),
    response: z
      .object({
        code: z.coerce.number().int().min(100).max(599).default(200),
        contentType: z.string().default("application/json"),
        body: z.string().nullable().default(null),
        headers: z.array(kvSchema).default([]),
        noBody: z.boolean().default(false),
      })
      .default({}),
    options: z
      .object({
        allowedOrigins: z.string().default("*"),
        ipWhitelist: z.array(z.string()).default([]),
        ignoreBots: z.boolean().default(true),
        rawBody: z.boolean().default(false),
        binaryProperty: z.string().nullable().default(null),
      })
      .default({}),
  })
  .default({});

type WebhookConfigInput = z.infer<typeof webhookConfigInput>;

const methodSchema = z.enum([...WEBHOOK_METHODS, "ANY"]);

function defaultStoredConfig(): StoredWebhookConfig {
  return {
    auth: { type: "none" },
    response: {
      code: 200,
      contentType: "application/json",
      body: null,
      headers: [],
      noBody: false,
    },
    options: {
      allowedOrigins: "*",
      ipWhitelist: [],
      ignoreBots: true,
      rawBody: false,
      binaryProperty: null,
    },
  };
}

/** Merge DB jsonb (may be `{}` for legacy rows) onto defaults. */
function parseStoredConfig(raw: unknown): StoredWebhookConfig {
  const d = defaultStoredConfig();
  if (!raw || typeof raw !== "object") return d;
  const c = raw as Partial<StoredWebhookConfig>;
  return {
    auth: c.auth ?? d.auth,
    response: { ...d.response, ...(c.response ?? {}) },
    options: { ...d.options, ...(c.options ?? {}) },
  };
}

/** Hash plaintext secrets, preserving existing hashes when a secret is left blank. */
function buildStoredConfig(
  incoming: WebhookConfigInput,
  existing?: StoredWebhookConfig,
): StoredWebhookConfig {
  const auth: StoredWebhookConfig["auth"] = { type: incoming.auth.type };
  if (incoming.auth.type === "basic") {
    const username = incoming.auth.basic?.username ?? existing?.auth.basic?.username ?? "";
    const pw = incoming.auth.basic?.password ?? "";
    auth.basic = {
      username,
      passwordHash: pw ? hashSecret(pw) : (existing?.auth.basic?.passwordHash ?? ""),
    };
  } else if (incoming.auth.type === "header") {
    const name = incoming.auth.header?.name ?? existing?.auth.header?.name ?? "";
    const value = incoming.auth.header?.value ?? "";
    auth.header = {
      name,
      valueHash: value ? hashSecret(value) : (existing?.auth.header?.valueHash ?? ""),
    };
  } else if (incoming.auth.type === "jwt") {
    const secret = incoming.auth.jwt?.secret ?? "";
    auth.jwt = { algorithm: "HS256", secret: secret || existing?.auth.jwt?.secret || "" };
  }
  return { auth, response: incoming.response, options: incoming.options };
}

/** Strip every secret so config is safe to return to the client. */
function sanitizeConfig(stored: StoredWebhookConfig) {
  return {
    auth: {
      type: stored.auth.type,
      ...(stored.auth.basic ? { basic: { username: stored.auth.basic.username } } : {}),
      ...(stored.auth.header ? { header: { name: stored.auth.header.name } } : {}),
      ...(stored.auth.jwt
        ? { jwt: { algorithm: "HS256" as const, hasSecret: Boolean(stored.auth.jwt.secret) } }
        : {}),
    },
    response: stored.response,
    options: stored.options,
  };
}

// ---------------------------------------------------------------------------
// Inbound webhook payload assembly
// ---------------------------------------------------------------------------

// The wildcard content-type parser delivers non-JSON bodies as a Buffer. Decode
// to text, then keep parsed JSON as-is or wrap raw text under `{ raw }`.
function normalizeWebhookPayload(body: unknown): unknown {
  if (Buffer.isBuffer(body)) {
    const text = body.toString("utf8");
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }
  if (typeof body === "object" && body !== null) return body;
  return { raw: String(body ?? "") };
}

function buildWebhookPayload(
  req: FastifyRequest,
  options: StoredWebhookConfig["options"],
): { payload: unknown; contentType: string } {
  const contentType = (req.headers["content-type"] as string | undefined) ?? "application/json";
  const body = req.body;
  const empty =
    body === undefined ||
    body === null ||
    (Buffer.isBuffer(body) && body.length === 0) ||
    (typeof body === "string" && body.length === 0);

  let payload: unknown;
  if (empty) {
    payload = {};
  } else if (options.binaryProperty && Buffer.isBuffer(body)) {
    payload = { [options.binaryProperty]: body.toString("base64"), contentType };
  } else if (options.rawBody) {
    payload = {
      raw: Buffer.isBuffer(body)
        ? body.toString("utf8")
        : typeof body === "string"
          ? body
          : JSON.stringify(body),
    };
  } else {
    payload = normalizeWebhookPayload(body);
  }

  const q = req.query as Record<string, unknown> | undefined;
  if (q && Object.keys(q).length) {
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      payload = { ...(payload as Record<string, unknown>), query: q };
    } else {
      payload = { value: payload, query: q };
    }
  }
  return { payload, contentType };
}

function checkWebhookAuth(req: FastifyRequest, auth: StoredWebhookConfig["auth"]): boolean {
  const authHeader = req.headers.authorization;
  switch (auth.type) {
    case "none":
      return true;
    case "basic":
      return verifyBasic(authHeader, auth.basic);
    case "header": {
      const name = (auth.header?.name ?? "").toLowerCase();
      if (!name) return false;
      const value = req.headers[name];
      return verifyHeader(Array.isArray(value) ? value[0] : value, auth.header);
    }
    case "jwt":
      return verifyJwtHS256(authHeader, auth.jwt);
    default:
      return false;
  }
}

function sendWebhookResponse(
  reply: FastifyReply,
  response: StoredWebhookConfig["response"],
  ctx: { eventId: string; receivedAt: string },
): FastifyReply {
  for (const h of response.headers) {
    if (h.name) reply.header(h.name, h.value);
  }
  if (response.noBody) {
    return reply.code(response.code || 204).send();
  }
  reply.code(response.code || 200);
  if (response.body) {
    reply.header("content-type", response.contentType || "text/plain");
    const body = response.body
      .replace(/\{\{\s*eventId\s*\}\}/g, ctx.eventId)
      .replace(/\{\{\s*receivedAt\s*\}\}/g, ctx.receivedAt);
    return reply.send(body);
  }
  reply.header("content-type", "application/json");
  return reply.send(ctx);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const ingestRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const sourceShape = z.object({
    id: z.string().uuid(),
    name: z.string(),
    type: z.enum(["rest", "webhook"]),
    method: z.string(),
    webhookUrl: z.string().nullable(),
    webhookToken: z.string().nullable(),
    config: z.any(),
    createdAt: z.string(),
  });

  app.post(
    "/ingest/sources",
    {
      schema: {
        summary: "Create an ingest source (REST or webhook)",
        tags: ["ingest"],
        body: z.object({
          name: z.string().trim().min(1).max(120),
          type: z.enum(["rest", "webhook"]),
          method: methodSchema.optional(),
          config: webhookConfigInput.optional(),
        }),
        response: {
          201: z.object({ source: sourceShape }),
          401: errorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const apiKey = req.apiKey!;
      const userId = await resolveUserIdForApiKey(req.db, apiKey.id);
      if (!userId) throw NotFound("USER_NOT_FOUND", "User not found for API key.");

      const isWebhook = req.body.type === "webhook";
      const token = isWebhook ? webhookToken() : null;
      const method = isWebhook ? (req.body.method ?? "POST") : "POST";
      const stored = buildStoredConfig(req.body.config ?? webhookConfigInput.parse({}));

      const inserted = await req.db.query<{
        id: string;
        name: string;
        type: "rest" | "webhook";
        webhook_token: string | null;
        webhook_method: string;
        webhook_config: unknown;
        created_at: Date;
      }>(
        `INSERT INTO app.ingest_sources (user_id, name, type, webhook_token, webhook_method, webhook_config)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         RETURNING id, name, type, webhook_token, webhook_method, webhook_config, created_at`,
        [userId, req.body.name, req.body.type, token, method, JSON.stringify(stored)],
      );
      const row = inserted.rows[0]!;

      return reply.code(201).send({
        source: {
          id: row.id,
          name: row.name,
          type: row.type,
          method: row.webhook_method,
          webhookUrl: token ? `${publicBase()}/v1/webhooks/${token}` : null,
          webhookToken: row.webhook_token,
          config: sanitizeConfig(parseStoredConfig(row.webhook_config)),
          createdAt: row.created_at.toISOString(),
        },
      });
    },
  );

  app.get(
    "/ingest/sources",
    {
      schema: {
        summary: "List ingest sources",
        tags: ["ingest"],
        response: {
          200: z.object({ sources: z.array(sourceShape) }),
        },
      },
    },
    async (req) => {
      const apiKey = req.apiKey!;
      const userId = await resolveUserIdForApiKey(req.db, apiKey.id);
      if (!userId) throw NotFound("USER_NOT_FOUND", "User not found for API key.");

      const { rows } = await req.db.query<{
        id: string;
        name: string;
        type: "rest" | "webhook";
        webhook_token: string | null;
        webhook_method: string;
        webhook_config: unknown;
        created_at: Date;
      }>(
        `SELECT id, name, type, webhook_token, webhook_method, webhook_config, created_at
           FROM app.ingest_sources
          WHERE user_id = $1
          ORDER BY created_at DESC`,
        [userId],
      );
      return {
        sources: rows.map((r) => ({
          id: r.id,
          name: r.name,
          type: r.type,
          method: r.webhook_method,
          webhookUrl: r.webhook_token ? `${publicBase()}/v1/webhooks/${r.webhook_token}` : null,
          webhookToken: r.webhook_token,
          config: sanitizeConfig(parseStoredConfig(r.webhook_config)),
          createdAt: r.created_at.toISOString(),
        })),
      };
    },
  );

  app.patch(
    "/ingest/sources/:id",
    {
      schema: {
        summary: "Update an ingest source (name, method, webhook config)",
        tags: ["ingest"],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          name: z.string().trim().min(1).max(120).optional(),
          method: methodSchema.optional(),
          config: webhookConfigInput.optional(),
        }),
        response: {
          200: z.object({ source: sourceShape }),
          404: errorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const apiKey = req.apiKey!;
      const userId = await resolveUserIdForApiKey(req.db, apiKey.id);
      if (!userId) throw NotFound("USER_NOT_FOUND", "User not found for API key.");

      const existingRes = await req.db.query<{
        webhook_config: unknown;
      }>(
        `SELECT webhook_config FROM app.ingest_sources WHERE id = $1 AND user_id = $2`,
        [req.params.id, userId],
      );
      if (!existingRes.rows[0]) throw NotFound("SOURCE_NOT_FOUND", "Ingest source not found.");
      const existing = parseStoredConfig(existingRes.rows[0].webhook_config);

      const stored = req.body.config
        ? buildStoredConfig(req.body.config, existing)
        : existing;

      const updated = await req.db.query<{
        id: string;
        name: string;
        type: "rest" | "webhook";
        webhook_token: string | null;
        webhook_method: string;
        webhook_config: unknown;
        created_at: Date;
      }>(
        `UPDATE app.ingest_sources
            SET name = COALESCE($3, name),
                webhook_method = COALESCE($4, webhook_method),
                webhook_config = $5::jsonb
          WHERE id = $1 AND user_id = $2
          RETURNING id, name, type, webhook_token, webhook_method, webhook_config, created_at`,
        [
          req.params.id,
          userId,
          req.body.name ?? null,
          req.body.method ?? null,
          JSON.stringify(stored),
        ],
      );
      const row = updated.rows[0]!;
      return reply.send({
        source: {
          id: row.id,
          name: row.name,
          type: row.type,
          method: row.webhook_method,
          webhookUrl: row.webhook_token ? `${publicBase()}/v1/webhooks/${row.webhook_token}` : null,
          webhookToken: row.webhook_token,
          config: sanitizeConfig(parseStoredConfig(row.webhook_config)),
          createdAt: row.created_at.toISOString(),
        },
      });
    },
  );

  app.post(
    "/ingest/sources/:id/test",
    {
      schema: {
        summary: "Send a sample event to a source (test the node without external tools)",
        tags: ["ingest"],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ payload: z.unknown().optional() }).default({}),
        response: {
          201: z.object({ eventId: z.string().uuid(), receivedAt: z.string() }),
          404: errorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const apiKey = req.apiKey!;
      const userId = await resolveUserIdForApiKey(req.db, apiKey.id);
      if (!userId) throw NotFound("USER_NOT_FOUND", "User not found for API key.");

      const srcRes = await req.db.query<{ id: string }>(
        `SELECT id FROM app.ingest_sources WHERE id = $1 AND user_id = $2`,
        [req.params.id, userId],
      );
      if (!srcRes.rows[0]) throw NotFound("SOURCE_NOT_FOUND", "Ingest source not found.");

      const payload =
        req.body.payload ?? {
          text: "62yo with chest pain. Father had an MI. Rule out pulmonary embolism.",
          _test: true,
        };

      const inserted = await req.db.query<{ id: string; received_at: Date }>(
        `INSERT INTO app.ingest_events (source_id, user_id, payload, content_type)
         VALUES ($1, $2, $3::jsonb, $4)
         RETURNING id, received_at`,
        [req.params.id, userId, JSON.stringify(payload), "application/json"],
      );
      const row = inserted.rows[0]!;

      void dispatchChannelsForSource(req.params.id, payload, "webhook");

      return reply.code(201).send({
        eventId: row.id,
        receivedAt: row.received_at.toISOString(),
      });
    },
  );

  app.post(
    "/ingest",
    {
      schema: {
        summary: "REST data intake",
        description: "Store a JSON or text payload for pipeline processing.",
        tags: ["ingest"],
        body: z.object({
          payload: z.unknown(),
          contentType: z.string().optional(),
          sourceId: z.string().uuid().optional(),
        }),
        response: {
          201: z.object({ eventId: z.string().uuid(), receivedAt: z.string() }),
          401: errorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const apiKey = req.apiKey!;
      const userId = await resolveUserIdForApiKey(req.db, apiKey.id);
      if (!userId) throw NotFound("USER_NOT_FOUND", "User not found for API key.");

      const inserted = await req.db.query<{ id: string; received_at: Date }>(
        `INSERT INTO app.ingest_events (source_id, user_id, payload, content_type)
         VALUES ($1, $2, $3::jsonb, $4)
         RETURNING id, received_at`,
        [
          req.body.sourceId ?? null,
          userId,
          JSON.stringify(req.body.payload ?? {}),
          req.body.contentType ?? "application/json",
        ],
      );
      const row = inserted.rows[0]!;

      if (req.body.sourceId) {
        void dispatchChannelsForSource(req.body.sourceId, req.body.payload ?? {}, "source");
      }

      return reply.code(201).send({
        eventId: row.id,
        receivedAt: row.received_at.toISOString(),
      });
    },
  );

  app.get(
    "/ingest/events",
    {
      schema: {
        summary: "List recent ingest events",
        tags: ["ingest"],
        querystring: z.object({
          sourceId: z.string().uuid().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(20),
        }),
        response: {
          200: z.object({
            events: z.array(
              z.object({
                id: z.string().uuid(),
                sourceId: z.string().uuid().nullable(),
                payload: z.unknown(),
                contentType: z.string(),
                status: z.string(),
                receivedAt: z.string(),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      const apiKey = req.apiKey!;
      const userId = await resolveUserIdForApiKey(req.db, apiKey.id);
      if (!userId) throw NotFound("USER_NOT_FOUND", "User not found for API key.");

      const params: unknown[] = [userId];
      let sql = `SELECT id, source_id, payload, content_type, status, received_at
                   FROM app.ingest_events
                  WHERE user_id = $1`;
      if (req.query.sourceId) {
        params.push(req.query.sourceId);
        sql += ` AND source_id = $${params.length}`;
      }
      sql += ` ORDER BY received_at DESC LIMIT $${params.length + 1}`;
      params.push(req.query.limit);

      const { rows } = await req.db.query<{
        id: string;
        source_id: string | null;
        payload: unknown;
        content_type: string;
        status: string;
        received_at: Date;
      }>(sql, params);

      return {
        events: rows.map((r) => ({
          id: r.id,
          sourceId: r.source_id,
          payload: r.payload,
          contentType: r.content_type,
          status: r.status,
          receivedAt: r.received_at.toISOString(),
        })),
      };
    },
  );

  // Public inbound webhook receiver. Registered for every HTTP method so a
  // browser GET gets a clear message instead of a bare 404; the configured
  // method, auth, gating, and response shaping are all enforced here.
  app.route({
    method: [...WEBHOOK_METHODS],
    url: "/webhooks/:token",
    schema: {
      summary: "Inbound webhook receiver (public, n8n-style)",
      tags: ["ingest"],
      security: [],
      params: z.object({ token: z.string().min(8) }),
    },
    handler: async (req, reply) => {
      const { token } = req.params as { token: string };
      const sourceRes = await req.db.query<{
        id: string;
        user_id: string;
        webhook_method: string;
        webhook_config: unknown;
      }>(
        `SELECT id, user_id, webhook_method, webhook_config FROM app.ingest_sources
          WHERE webhook_token = $1 AND type = 'webhook'`,
        [token],
      );
      const source = sourceRes.rows[0];
      if (!source) throw NotFound("WEBHOOK_NOT_FOUND", "Unknown webhook token.");

      const method = source.webhook_method || "POST";
      if (method !== "ANY" && req.method !== method) {
        throw new AppError(
          "WEBHOOK_METHOD_NOT_ALLOWED",
          `This webhook expects ${method}. You sent ${req.method}. Send a ${method} request with your payload.`,
          405,
        );
      }

      const config = parseStoredConfig(source.webhook_config);

      if (config.options.ignoreBots && isBot(req.headers["user-agent"] as string | undefined)) {
        return reply.code(200).send({ ignored: true });
      }

      const origin = req.headers.origin as string | undefined;
      const allowedOrigins = config.options.allowedOrigins;
      if (origin && allowedOrigins && allowedOrigins.trim() !== "*") {
        const list = allowedOrigins
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (!list.includes(origin)) {
          throw new AppError(
            "WEBHOOK_ORIGIN_BLOCKED",
            `Origin ${origin} is not allowed to call this webhook.`,
            403,
          );
        }
      }

      if (!ipAllowed(req.ip, config.options.ipWhitelist)) {
        throw new AppError("WEBHOOK_IP_BLOCKED", "Your IP is not allowed to call this webhook.", 403);
      }

      if (!checkWebhookAuth(req, config.auth)) {
        throw new AppError(
          "WEBHOOK_UNAUTHORIZED",
          "Webhook authentication failed.",
          401,
        );
      }

      const { payload, contentType } = buildWebhookPayload(req, config.options);
      const inserted = await req.db.query<{ id: string; received_at: Date }>(
        `INSERT INTO app.ingest_events (source_id, user_id, payload, content_type)
         VALUES ($1, $2, $3::jsonb, $4)
         RETURNING id, received_at`,
        [source.id, source.user_id, JSON.stringify(payload), contentType],
      );
      const row = inserted.rows[0]!;

      // Fire-and-forget: run live channels bound to this source.
      void dispatchChannelsForSource(source.id, payload, "webhook");

      return sendWebhookResponse(reply, config.response, {
        eventId: row.id,
        receivedAt: row.received_at.toISOString(),
      });
    },
  });
};

export default ingestRoutes;
