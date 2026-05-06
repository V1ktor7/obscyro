import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

import { type ApiKeyRow, verifyApiKey } from "../services/auth.js";

declare module "fastify" {
  interface FastifyRequest {
    apiKey: ApiKeyRow | null;
  }
}

const BEARER_PREFIX = "Bearer ";

const authIdentifyPlugin: FastifyPluginAsync = fp(
  async (app) => {
    app.decorateRequest("apiKey", null);

    app.addHook("onRequest", async (req) => {
      const header = req.headers.authorization;
      if (!header || !header.startsWith(BEARER_PREFIX)) return;
      const token = header.slice(BEARER_PREFIX.length).trim();
      if (!token) return;
      try {
        req.apiKey = await verifyApiKey(token);
      } catch (err) {
        req.log.warn({ err }, "verifyApiKey threw; treating as anonymous");
        req.apiKey = null;
      }
    });
  },
  {
    name: "obscyro-auth-identify",
    dependencies: ["obscyro-pg"],
  },
);

export default authIdentifyPlugin;
