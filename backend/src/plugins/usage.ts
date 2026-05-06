import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

import { pool } from "../db/pool.js";

const usagePlugin: FastifyPluginAsync = fp(
  async (app) => {
    app.addHook("onResponse", async (req, reply) => {
      const apiKey = req.apiKey;
      if (!apiKey) return;

      const endpoint = req.routeOptions?.url ?? req.url;
      const statusCode = reply.statusCode;
      const elapsed = reply.elapsedTime;
      const durationMs = Math.max(0, Math.round(typeof elapsed === "number" ? elapsed : 0));

      setImmediate(() => {
        pool
          .query(
            `INSERT INTO app.api_usage (api_key_id, endpoint, status_code, duration_ms)
             VALUES ($1, $2, $3, $4)`,
            [apiKey.id, endpoint, statusCode, durationMs],
          )
          .catch((err) => {
            req.log.warn({ err }, "usage log failed");
          });
      });
    });
  },
  {
    name: "obscyro-usage",
    dependencies: ["obscyro-auth-identify"],
  },
);

export default usagePlugin;
