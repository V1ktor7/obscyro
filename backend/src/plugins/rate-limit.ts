import rateLimit from "@fastify/rate-limit";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

import { AppError } from "../lib/errors.js";
import { isPublicPath } from "../lib/public-paths.js";
import type { Plan } from "../services/auth.js";

export const PLAN_LIMITS: Record<Plan, number> = {
  free: 100,
  starter: 1000,
  pro: 10_000,
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
