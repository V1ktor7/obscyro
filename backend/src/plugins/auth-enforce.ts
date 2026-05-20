import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

import { AppError } from "../lib/errors.js";

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

const authEnforcePlugin: FastifyPluginAsync = fp(
  async (app) => {
    app.addHook("preHandler", async (req) => {
      if (isPublic(routePath(req))) return;
      if (!req.apiKey) {
        throw new AppError(
          "INVALID_API_KEY",
          "Missing or invalid API key. Send `Authorization: Bearer obs_live_...`.",
          401,
        );
      }
    });
  },
  {
    name: "obscyro-auth-enforce",
    dependencies: ["obscyro-auth-identify"],
  },
);

export default authEnforcePlugin;
