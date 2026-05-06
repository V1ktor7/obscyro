import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { Pool, QueryResult, QueryResultRow } from "pg";

import { pool } from "../db/pool.js";

declare module "fastify" {
  interface FastifyInstance {
    pg: Pool;
  }
  interface FastifyRequest {
    dbQueryCount: number;
    db: {
      query: <R extends QueryResultRow = QueryResultRow>(
        sql: string,
        params?: unknown[],
      ) => Promise<QueryResult<R>>;
    };
  }
}

const pgPlugin: FastifyPluginAsync = fp(async (app) => {
  app.decorate("pg", pool);
  app.decorateRequest("dbQueryCount", 0);
  // Initialized in onRequest below; declare for the type system.
  app.decorateRequest("db", null as unknown as never);

  app.addHook("onRequest", async (req) => {
    req.dbQueryCount = 0;
    req.db = {
      query: async <R extends QueryResultRow = QueryResultRow>(
        sql: string,
        params?: unknown[],
      ): Promise<QueryResult<R>> => {
        req.dbQueryCount += 1;
        return pool.query<R>(sql, params);
      },
    };
  });

  app.addHook("onClose", async () => {
    await pool.end();
  });
}, {
  name: "obscyro-pg",
});

export default pgPlugin;
