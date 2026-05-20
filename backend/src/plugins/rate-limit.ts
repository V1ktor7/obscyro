import rateLimit from "@fastify/rate-limit";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

import { AppError } from "../lib/errors.js";
import type { Plan } from "../services/auth.js";

export const PLAN_LIMITS: Record<Plan, number> = {
  free: 100,
  starter: 1000,
  pro: 10_000,
  enterprise: Number.MAX_SAFE_INTEGER,
};

const ANONYMOUS_LIMIT = 100;

const PUBLIC_PATH_PATTERNS: RegExp[] = [
  /^\/health\/?$/,
  /^\/v1\/health\/?$/,
  /^\/v1\/onboard\/?$/,
  /^\/documentation(\/.*)?$/,
];

function routePath(req: FastifyRequest): string {
  return req.routeOptions?.url ?? req.url;
}

function isPublic(path: string): boolean {
  return PUBLIC_PATH_PATTERNS.some((re) => re.test(path));
}

const rateLimitPlugin: FastifyPluginAsync = fp(
  async (app) => {
    await app.register(rateLimit, {
      global: true,
      timeWindow: "1 minute",
      hook: "preHandler",
      // Allow public paths and unauthenticated traffic; the latter falls
      // through to auth-enforce which returns 401.
      allowList: (req) => isPublic(routePath(req)) || !req.apiKey,
      keyGenerator: (req) => req.apiKey?.id ?? req.ip,
      max: (req) => (req.apiKey ? PLAN_LIMITS[req.apiKey.plan] : ANONYMOUS_LIMIT),
      // @fastify/rate-limit throws this object verbatim, so we throw an
      // AppError that our error-handler renders into the standard envelope
      // with status 429.
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
