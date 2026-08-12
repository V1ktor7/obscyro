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
  nlp: z.object({
    configured: z.boolean(),
    ok: z.boolean(),
    latencyMs: z.number().optional(),
    modelLoaded: z.boolean().optional(),
    snomedEmbeddingRows: z.number().nullable().optional(),
    populate: z
      .object({
        state: z.string(),
        inserted: z.number(),
        target: z.number(),
        error: z.string().nullable(),
      })
      .optional(),
    thresholds: z.record(z.number()).optional(),
    error: z.string().optional(),
  }),
  /**
   * The simulation service, over the private network.
   *
   * Worth probing rather than assuming: the backend reaches it by an internal
   * hostname that resolves only from inside Railway, so a wrong name or port is
   * invisible from a developer's machine and from every test. The first symptom
   * would otherwise be a 503 the moment somebody runs a crisis comparison.
   * `crises` lists what the engine can run, which also proves the reply came
   * from a service that has the crisis layer rather than an older image.
   */
  simulation: z.object({
    configured: z.boolean(),
    ok: z.boolean(),
    latencyMs: z.number().optional(),
    crises: z.array(z.string()).optional(),
    error: z.string().optional(),
  }),
});

const NLP_PROBE_TIMEOUT_MS = 3_000;

type SimHealth = z.infer<typeof readiness>["simulation"];

/** Probe the simulation service's crisis catalogue. Never throws. */
async function probeSimulation(): Promise<SimHealth> {
  const base = process.env.SIM_SERVICE_URL?.replace(/\/$/, "");
  if (!base) return { configured: false, ok: false, error: "SIM_SERVICE_URL is not set." };

  const start = process.hrtime.bigint();
  try {
    const res = await fetch(`${base}/crisis/catalogue`, {
      signal: AbortSignal.timeout(NLP_PROBE_TIMEOUT_MS),
    });
    const latencyMs = Number(
      (Number(process.hrtime.bigint() - start) / 1_000_000).toFixed(2),
    );
    if (!res.ok) {
      return {
        configured: true,
        ok: false,
        latencyMs,
        error: `Simulation service returned HTTP ${res.status}.`,
      };
    }
    const body = (await res.json().catch(() => ({}))) as { scenarios?: string[] };
    return { configured: true, ok: true, latencyMs, crises: body.scenarios ?? [] };
  } catch {
    return { configured: true, ok: false, error: "Simulation service is unreachable." };
  }
}

type NlpHealth = z.infer<typeof readiness>["nlp"];

/** Probe the NLP service's /health. Never throws. */
async function probeNlp(): Promise<NlpHealth> {
  const base = process.env.NLP_SERVICE_URL?.replace(/\/$/, "");
  if (!base) return { configured: false, ok: false, error: "NLP_SERVICE_URL is not set." };

  const start = process.hrtime.bigint();
  try {
    const res = await fetch(`${base}/health`, {
      signal: AbortSignal.timeout(NLP_PROBE_TIMEOUT_MS),
    });
    const latencyMs = Number(Number(process.hrtime.bigint() - start) / 1_000_000);
    if (!res.ok) {
      return {
        configured: true,
        ok: false,
        latencyMs: Number(latencyMs.toFixed(2)),
        error: `Extraction service returned HTTP ${res.status}.`,
      };
    }
    const body = (await res.json().catch(() => ({}))) as {
      model_loaded?: boolean;
      snomed_embedding_rows?: number | null;
      populate?: { state?: string; inserted?: number; target?: number; error?: string | null };
      thresholds?: Record<string, number>;
    };
    return {
      configured: true,
      ok: true,
      latencyMs: Number(latencyMs.toFixed(2)),
      ...(typeof body.model_loaded === "boolean" ? { modelLoaded: body.model_loaded } : {}),
      ...(body.snomed_embedding_rows !== undefined
        ? { snomedEmbeddingRows: body.snomed_embedding_rows }
        : {}),
      ...(body.thresholds ? { thresholds: body.thresholds } : {}),
      ...(body.populate && typeof body.populate.state === "string"
        ? {
            populate: {
              state: body.populate.state,
              inserted: body.populate.inserted ?? 0,
              target: body.populate.target ?? 0,
              error: body.populate.error ?? null,
            },
          }
        : {}),
    };
  } catch {
    return { configured: true, ok: false, error: "Extraction service is unreachable." };
  }
}

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
      const nlpPromise = probeNlp();
      const simPromise = probeSimulation();
      const start = process.hrtime.bigint();
      try {
        await req.db.query("SELECT 1");
        const latencyMs = Number(process.hrtime.bigint() - start) / 1_000_000;
        const [nlp, simulation] = await Promise.all([nlpPromise, simPromise]);
        return reply.send({
          // A configured-but-unreachable dependency degrades a feature, not the
          // API: extraction jobs queue and retry, and a crisis comparison
          // returns 503 while everything else keeps serving.
          status:
            (nlp.configured && !nlp.ok) || (simulation.configured && !simulation.ok)
              ? ("degraded" as const)
              : ("ok" as const),
          database: { ok: true, latencyMs: Number(latencyMs.toFixed(2)) },
          nlp,
          simulation,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(503).send({
          status: "degraded" as const,
          database: { ok: false, error: message },
          nlp: await nlpPromise,
          simulation: await simPromise,
        });
      }
    },
  );
};

export default healthRoutes;
