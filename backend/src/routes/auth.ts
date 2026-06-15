import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { AppError, NotFound } from "../lib/errors.js";
import { generateApiKey } from "../services/auth.js";
import { listUserKeys, resolveUserIdForApiKey, verifyUserLogin } from "../services/login.js";

const FREE_QUOTA = 1000;

const loginBody = z.object({
  email: z.string().trim().email().toLowerCase(),
  code: z.string().min(1),
});

const keySummary = z.object({
  id: z.string().uuid(),
  prefix: z.string(),
  name: z.string(),
  plan: z.enum(["free", "starter", "pro", "enterprise"]),
  monthlyQuota: z.number().int().positive(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});

const loginResponse = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
    company: z.string().nullable(),
    useCase: z.string().nullable(),
    createdAt: z.string(),
  }),
  keys: z.array(keySummary),
});

const createKeyResponse = z.object({
  key: z.object({
    id: z.string().uuid(),
    rawKey: z.string(),
    prefix: z.string(),
    name: z.string(),
    plan: z.literal("free"),
    monthlyQuota: z.number().int().positive(),
  }),
});

const keysListResponse = z.object({
  keys: z.array(keySummary),
});

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

function mapKey(row: {
  id: string;
  key_prefix: string;
  name: string;
  plan: string;
  monthly_quota: number;
  created_at: Date;
  last_used_at: Date | null;
}) {
  return {
    id: row.id,
    prefix: row.key_prefix,
    name: row.name,
    plan: row.plan as "free" | "starter" | "pro" | "enterprise",
    monthlyQuota: row.monthly_quota,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at ? row.last_used_at.toISOString() : null,
  };
}

async function mintKeyForUser(
  db: DbClient,
  userId: string,
  userEmail: string,
  userName: string,
  keyName: string,
) {
  const { rawKey, hash, prefix } = generateApiKey();
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO app.api_keys (key_hash, key_prefix, name, owner_email, plan, monthly_quota, user_id)
     VALUES ($1, $2, $3, $4, 'free', $5, $6)
     RETURNING id`,
    [hash, prefix, keyName, userEmail, FREE_QUOTA, userId],
  );
  const id = inserted.rows[0]?.id;
  if (!id) throw new AppError("KEY_CREATE_FAILED", "Failed to create API key.", 500);
  return {
    id,
    rawKey,
    prefix,
    name: keyName,
    plan: "free" as const,
    monthlyQuota: FREE_QUOTA,
  };
}

const authRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/login",
    {
      schema: {
        summary: "Platform login (email + access code)",
        description:
          "Verifies credentials and returns the user profile plus active API key metadata (prefix only, never full secrets).",
        tags: ["auth"],
        security: [],
        body: loginBody,
        response: { 200: loginResponse, 401: errorEnvelope },
      },
    },
    async (req) => {
      const user = await verifyUserLogin(req.db, req.body.email, req.body.code);
      const keys = await listUserKeys(req.db, user.id);
      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          company: user.company,
          useCase: user.use_case,
          createdAt: user.created_at.toISOString(),
        },
        keys: keys.map(mapKey),
      };
    },
  );

  app.get(
    "/keys",
    {
      schema: {
        summary: "List API keys for the authenticated user",
        tags: ["auth"],
        response: { 200: keysListResponse, 401: errorEnvelope },
      },
    },
    async (req) => {
      const apiKey = req.apiKey!;
      const userId = await resolveUserIdForApiKey(req.db, apiKey.id);
      if (!userId) {
        throw new AppError("INVALID_API_KEY", "API key is not linked to a user.", 401);
      }
      const keys = await listUserKeys(req.db, userId);
      return { keys: keys.map(mapKey) };
    },
  );

  app.post(
    "/keys/mint",
    {
      schema: {
        summary: "Create API key using email + access code (login flow)",
        tags: ["auth"],
        security: [],
        body: z.object({
          email: z.string().trim().email().toLowerCase(),
          code: z.string().min(1),
          name: z.string().trim().min(1).max(80),
        }),
        response: { 201: createKeyResponse, 401: errorEnvelope },
      },
    },
    async (req, reply) => {
      const user = await verifyUserLogin(req.db, req.body.email, req.body.code);
      const key = await mintKeyForUser(
        req.db,
        user.id,
        user.email,
        user.name,
        req.body.name,
      );
      return reply.code(201).send({ key });
    },
  );

  app.post(
    "/keys",
    {
      schema: {
        summary: "Create a new API key (bearer auth)",
        tags: ["auth"],
        body: z.object({
          name: z.string().trim().min(1).max(80),
        }),
        response: { 201: createKeyResponse, 401: errorEnvelope },
      },
    },
    async (req, reply) => {
      if (!req.apiKey) {
        throw new AppError("INVALID_API_KEY", "Bearer auth required.", 401);
      }
      const userId = await resolveUserIdForApiKey(req.db, req.apiKey.id);
      if (!userId) {
        throw new AppError("INVALID_API_KEY", "API key is not linked to a user.", 401);
      }
      const u = await req.db.query<{ email: string; name: string }>(
        `SELECT email, name FROM app.users WHERE id = $1`,
        [userId],
      );
      const key = await mintKeyForUser(
        req.db,
        userId,
        u.rows[0]?.email ?? req.apiKey.owner_email,
        u.rows[0]?.name ?? "User",
        req.body.name,
      );
      return reply.code(201).send({ key });
    },
  );

  app.delete(
    "/keys/:id",
    {
      schema: {
        summary: "Revoke an API key",
        tags: ["auth"],
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ ok: z.literal(true) }), 401: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req) => {
      const apiKey = req.apiKey!;
      const userId = await resolveUserIdForApiKey(req.db, apiKey.id);
      if (!userId) {
        throw new AppError("INVALID_API_KEY", "API key is not linked to a user.", 401);
      }

      const result = await req.db.query(
        `UPDATE app.api_keys
            SET revoked_at = NOW()
          WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [req.params.id, userId],
      );
      if (result.rowCount === 0) {
        throw NotFound("KEY_NOT_FOUND", "API key not found or already revoked.");
      }
      return { ok: true as const };
    },
  );
};

export default authRoutes;
