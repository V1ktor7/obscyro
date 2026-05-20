import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { Conflict } from "../lib/errors.js";
import { generateApiKey } from "../services/auth.js";

const useCaseValues = ["developer", "research", "clinical", "other"] as const;

const onboardBody = z.object({
  email: z.string().trim().email().toLowerCase(),
  name: z.string().trim().min(1).max(120),
  company: z.string().trim().max(160).optional().nullable(),
  useCase: z.enum(useCaseValues),
  agreedToTerms: z
    .literal(true)
    .or(z.boolean().refine((v) => v === true, "You must agree to the beta terms")),
});

const onboardResponse = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
    company: z.string().nullable(),
    useCase: z.enum(useCaseValues),
    createdAt: z.string(),
  }),
  apiKey: z.object({
    id: z.string().uuid(),
    rawKey: z.string(),
    prefix: z.string(),
    plan: z.literal("free"),
    monthlyQuota: z.number().int().positive(),
  }),
});

const meResponse = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
    company: z.string().nullable(),
    useCase: z.enum(useCaseValues).nullable(),
    createdAt: z.string(),
  }),
  apiKey: z.object({
    id: z.string().uuid(),
    prefix: z.string(),
    name: z.string(),
    plan: z.enum(["free", "starter", "pro", "enterprise"]),
    monthlyQuota: z.number().int().positive(),
    createdAt: z.string(),
    lastUsedAt: z.string().nullable(),
  }),
  usageThisMonth: z.number().int().nonnegative(),
});

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

interface UserRow {
  id: string;
  email: string;
  name: string;
  company: string | null;
  use_case: (typeof useCaseValues)[number] | null;
  created_at: Date;
}

interface ApiKeyInsertRow {
  id: string;
}

const FREE_QUOTA = 1000;

const onboardRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/onboard",
    {
      schema: {
        summary: "Self-serve onboarding",
        description:
          "Creates a user record and mints a free-plan API key in one call. The raw key is returned exactly once and never stored in plaintext server-side. Subsequent attempts with the same email while an active key exists return 409.",
        tags: ["onboard"],
        security: [],
        body: onboardBody,
        response: {
          201: onboardResponse,
          400: errorEnvelope,
          409: errorEnvelope,
          default: errorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const body = req.body;
      const useCase = body.useCase;
      const company = body.company?.trim() || null;

      const client = req.db;

      const userInsert = await client.query<UserRow>(
        `INSERT INTO app.users (email, name, company, use_case)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET
           name = EXCLUDED.name,
           company = EXCLUDED.company,
           use_case = EXCLUDED.use_case
         RETURNING id, email, name, company, use_case, created_at`,
        [body.email, body.name, company, useCase],
      );
      const user = userInsert.rows[0];
      if (!user) {
        throw new Error("Failed to upsert user");
      }

      const existingActive = await client.query<{ id: string }>(
        `SELECT id
           FROM app.api_keys
          WHERE user_id = $1 AND revoked_at IS NULL
          LIMIT 1`,
        [user.id],
      );
      if (existingActive.rows.length > 0) {
        throw Conflict(
          "EMAIL_ALREADY_HAS_KEY",
          "An account with this email already has an active API key. Sign in by pasting that key.",
        );
      }

      const { rawKey, hash, prefix } = generateApiKey();
      const inserted = await client.query<ApiKeyInsertRow>(
        `INSERT INTO app.api_keys (key_hash, key_prefix, name, owner_email, plan, monthly_quota, user_id)
         VALUES ($1, $2, $3, $4, 'free', $5, $6)
         RETURNING id`,
        [hash, prefix, `${user.name}'s default key`, user.email, FREE_QUOTA, user.id],
      );
      const apiKeyId = inserted.rows[0]?.id;
      if (!apiKeyId) {
        throw new Error("Failed to insert api_key");
      }

      return reply.code(201).send({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          company: user.company,
          useCase: useCase,
          createdAt: user.created_at.toISOString(),
        },
        apiKey: {
          id: apiKeyId,
          rawKey,
          prefix,
          plan: "free" as const,
          monthlyQuota: FREE_QUOTA,
        },
      });
    },
  );

  app.get(
    "/me",
    {
      schema: {
        summary: "Current user + API key context",
        description:
          "Returns the user record, sanitized API key metadata (no raw value), and the running count of usage for the calendar month so far. Requires the bearer key in the Authorization header.",
        tags: ["onboard"],
        response: { 200: meResponse, 401: errorEnvelope, default: errorEnvelope },
      },
    },
    async (req) => {
      const apiKey = req.apiKey!; // auth-enforce guarantees presence

      const userResult = await req.db.query<UserRow>(
        `SELECT u.id, u.email, u.name, u.company, u.use_case, u.created_at
           FROM app.users u
           JOIN app.api_keys k ON k.user_id = u.id
          WHERE k.id = $1
          LIMIT 1`,
        [apiKey.id],
      );
      const userRow = userResult.rows[0];

      const keyResult = await req.db.query<{
        id: string;
        key_prefix: string;
        name: string;
        plan: "free" | "starter" | "pro" | "enterprise";
        monthly_quota: number;
        created_at: Date;
        last_used_at: Date | null;
      }>(
        `SELECT id, key_prefix, name, plan, monthly_quota, created_at, last_used_at
           FROM app.api_keys
          WHERE id = $1`,
        [apiKey.id],
      );
      const keyRow = keyResult.rows[0]!;

      const usageResult = await req.db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM app.api_usage
          WHERE api_key_id = $1
            AND created_at >= date_trunc('month', NOW())`,
        [apiKey.id],
      );
      const usageThisMonth = Number(usageResult.rows[0]?.count ?? "0");

      return {
        user: userRow
          ? {
              id: userRow.id,
              email: userRow.email,
              name: userRow.name,
              company: userRow.company,
              useCase: userRow.use_case,
              createdAt: userRow.created_at.toISOString(),
            }
          : {
              id: apiKey.id,
              email: apiKey.owner_email,
              name: apiKey.name,
              company: null,
              useCase: null,
              createdAt: keyRow.created_at.toISOString(),
            },
        apiKey: {
          id: keyRow.id,
          prefix: keyRow.key_prefix,
          name: keyRow.name,
          plan: keyRow.plan,
          monthlyQuota: keyRow.monthly_quota,
          createdAt: keyRow.created_at.toISOString(),
          lastUsedAt: keyRow.last_used_at ? keyRow.last_used_at.toISOString() : null,
        },
        usageThisMonth,
      };
    },
  );
};

export default onboardRoutes;
