import crypto from "node:crypto";

import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { NotFound } from "../lib/errors.js";
import { resolveUserIdForApiKey } from "../services/login.js";

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

function webhookToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

// The wildcard content-type parser delivers non-JSON bodies as a Buffer. Decode
// to text, then keep parsed JSON as-is or wrap raw text under `{ raw }` so any
// content type (xml, csv, plain text, binary) is preserved rather than dropped.
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

const ingestRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/ingest/sources",
    {
      schema: {
        summary: "Create an ingest source (REST or webhook)",
        tags: ["ingest"],
        body: z.object({
          name: z.string().trim().min(1).max(120),
          type: z.enum(["rest", "webhook"]),
        }),
        response: {
          201: z.object({
            source: z.object({
              id: z.string().uuid(),
              name: z.string(),
              type: z.enum(["rest", "webhook"]),
              webhookUrl: z.string().nullable(),
              webhookToken: z.string().nullable(),
              createdAt: z.string(),
            }),
          }),
          401: errorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const apiKey = req.apiKey!;
      const userId = await resolveUserIdForApiKey(req.db, apiKey.id);
      if (!userId) throw NotFound("USER_NOT_FOUND", "User not found for API key.");

      const token = req.body.type === "webhook" ? webhookToken() : null;
      const inserted = await req.db.query<{
        id: string;
        name: string;
        type: "rest" | "webhook";
        webhook_token: string | null;
        created_at: Date;
      }>(
        `INSERT INTO app.ingest_sources (user_id, name, type, webhook_token)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, type, webhook_token, created_at`,
        [userId, req.body.name, req.body.type, token],
      );
      const row = inserted.rows[0]!;
      const base = process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
      const webhookUrl = token ? `${base.replace(/\/$/, "")}/v1/webhooks/${token}` : null;

      return reply.code(201).send({
        source: {
          id: row.id,
          name: row.name,
          type: row.type,
          webhookUrl,
          webhookToken: row.webhook_token,
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
          200: z.object({
            sources: z.array(
              z.object({
                id: z.string().uuid(),
                name: z.string(),
                type: z.enum(["rest", "webhook"]),
                webhookUrl: z.string().nullable(),
                createdAt: z.string(),
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

      const { rows } = await req.db.query<{
        id: string;
        name: string;
        type: "rest" | "webhook";
        webhook_token: string | null;
        created_at: Date;
      }>(
        `SELECT id, name, type, webhook_token, created_at
           FROM app.ingest_sources
          WHERE user_id = $1
          ORDER BY created_at DESC`,
        [userId],
      );
      const base = process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
      return {
        sources: rows.map((r) => ({
          id: r.id,
          name: r.name,
          type: r.type,
          webhookUrl: r.webhook_token
            ? `${base.replace(/\/$/, "")}/v1/webhooks/${r.webhook_token}`
            : null,
          createdAt: r.created_at.toISOString(),
        })),
      };
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

  app.post(
    "/webhooks/:token",
    {
      schema: {
        summary: "Inbound webhook receiver (public)",
        tags: ["ingest"],
        security: [],
        params: z.object({ token: z.string().min(8) }),
        response: {
          201: z.object({ eventId: z.string().uuid(), receivedAt: z.string() }),
          404: errorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const sourceRes = await req.db.query<{
        id: string;
        user_id: string;
      }>(
        `SELECT id, user_id FROM app.ingest_sources
          WHERE webhook_token = $1 AND type = 'webhook'`,
        [req.params.token],
      );
      const source = sourceRes.rows[0];
      if (!source) throw NotFound("WEBHOOK_NOT_FOUND", "Unknown webhook token.");

      const contentType = req.headers["content-type"] ?? "application/json";
      const payload = normalizeWebhookPayload(req.body);

      const inserted = await req.db.query<{ id: string; received_at: Date }>(
        `INSERT INTO app.ingest_events (source_id, user_id, payload, content_type)
         VALUES ($1, $2, $3::jsonb, $4)
         RETURNING id, received_at`,
        [
          source.id,
          source.user_id,
          JSON.stringify(payload),
          contentType,
        ],
      );
      const row = inserted.rows[0]!;
      return reply.code(201).send({
        eventId: row.id,
        receivedAt: row.received_at.toISOString(),
      });
    },
  );
};

export default ingestRoutes;
