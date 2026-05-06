import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

declare module "fastify" {
  interface FastifyRequest {
    startedAtNs: bigint;
  }
}

const requestLogPlugin: FastifyPluginAsync = fp(async (app) => {
  app.decorateRequest("startedAtNs", 0n);

  app.addHook("onRequest", async (req) => {
    req.startedAtNs = process.hrtime.bigint();
  });

  app.addHook("onResponse", async (req, reply) => {
    const elapsedNs = process.hrtime.bigint() - req.startedAtNs;
    const durationMs = Number(elapsedNs) / 1_000_000;
    req.log.info(
      {
        method: req.method,
        path: req.routeOptions?.url ?? req.url,
        statusCode: reply.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
        dbQueryCount: req.dbQueryCount ?? 0,
      },
      "request completed",
    );
  });
}, {
  name: "obscyro-request-log",
  dependencies: ["obscyro-pg"],
});

export default requestLogPlugin;
