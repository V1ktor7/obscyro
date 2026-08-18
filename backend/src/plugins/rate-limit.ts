import rateLimit from "@fastify/rate-limit";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

import { AppError } from "../lib/errors.js";
import { isPublicPath } from "../lib/public-paths.js";
import type { Plan } from "../services/auth.js";

/**
 * Requests per minute, per API key, by plan.
 *
 * Env-tunable because the numbers are a commercial decision, not an engineering
 * one, and changing a price tier should not need a deploy. The defaults are what
 * they have always been.
 *
 * `free` at 100/minute is the one that bites during ontology work: importing a
 * hospital's stretchers is hundreds of writes, and a modelling session is not
 * the abuse this limit exists to stop. The real answer to that is bulk
 * endpoints — see `/ontology/:env/objects/bulk` — and this knob is the release
 * valve while those spread.
 */
function limitEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (raw === "unlimited") return Number.MAX_SAFE_INTEGER;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.trunc(parsed);
}

export const PLAN_LIMITS: Record<Plan, number> = {
  free: limitEnv("RATE_LIMIT_FREE", 100),
  starter: limitEnv("RATE_LIMIT_STARTER", 1000),
  pro: limitEnv("RATE_LIMIT_PRO", 10_000),
  enterprise: Number.MAX_SAFE_INTEGER,
};

const ANONYMOUS_LIMIT = 100;

function routePath(req: FastifyRequest): string {
  return req.routeOptions?.url ?? req.url;
}

const rateLimitPlugin: FastifyPluginAsync = fp(
  async (app) => {
    await app.register(rateLimit, {
      global: true,
      timeWindow: "1 minute",
      hook: "preHandler",
      allowList: (req) => isPublicPath(routePath(req)) || !req.apiKey,
      keyGenerator: (req) => req.apiKey?.id ?? req.ip,
      max: (req) => (req.apiKey ? PLAN_LIMITS[req.apiKey.plan] : ANONYMOUS_LIMIT),
      errorResponseBuilder: (_req, ctx) =>
        new AppError(
          "RATE_LIMITED",
          `Rate limit exceeded. Retry in ${ctx.after}.`,
          429,
          {
            limit: ctx.max,
            ttlSeconds: Math.ceil(ctx.ttl / 1000),
          },
        ),
    });
  },
  {
    name: "obscyro-rate-limit",
    dependencies: ["obscyro-auth-identify"],
  },
);

export default rateLimitPlugin;
