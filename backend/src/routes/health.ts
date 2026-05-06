import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

const liveness = z.object({ status: z.literal("ok") });

const readiness = z.object({
  status: z.enum(["ok", "degraded"]),
  database: z.object({
    ok: z.boolean(),
    latencyMs: z.number().optional(),
    error: z.string().optional(),
  }),
});

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/health",
    {
      schema: {
        summary: "Liveness probe",
        description: "Returns ok if the API process is running.",
        tags: ["health"],
        security: [],
        response: { 200: liveness },
      },
    },
    async () => ({ status: "ok" as const }),
  );

  app.get(
    "/v1/health",
    {
      schema: {
        summary: "Readiness probe",
        description: "Returns ok only when the database is reachable.",
        tags: ["health"],
        security: [],
        response: { 200: readiness, 503: readiness, default: errorEnvelope },
      },
    },
    async (req, reply) => {
      const start = process.hrtime.bigint();
      try {
        await req.db.query("SELECT 1");
        const latencyMs = Number(process.hrtime.bigint() - start) / 1_000_000;
        return reply.send({
          status: "ok" as const,
          database: { ok: true, latencyMs: Number(latencyMs.toFixed(2)) },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(503).send({
          status: "degraded" as const,
          database: { ok: false, error: message },
        });
      }
    },
  );
};

export default healthRoutes;
