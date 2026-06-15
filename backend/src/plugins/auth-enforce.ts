import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

import { AppError } from "../lib/errors.js";
import { isPublicPath } from "../lib/public-paths.js";

function routePath(req: FastifyRequest): string {
  return req.routeOptions?.url ?? req.url;
}

const authEnforcePlugin: FastifyPluginAsync = fp(
  async (app) => {
    app.addHook("preHandler", async (req) => {
      if (isPublicPath(routePath(req))) return;
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
