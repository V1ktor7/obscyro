import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { AppError, BadRequest } from "../lib/errors.js";

const UPSTREAM_TIMEOUT_MS = 20_000;

const languageSchema = z.enum(["en", "fr", "auto"]).default("auto");

const conceptsBody = z.object({
  text: z.string().min(1),
  language: languageSchema,
});

const contextsBody = z.object({
  text: z.string().min(1),
  language: languageSchema,
  concepts: z
    .array(
      z.object({
        span: z.string(),
        code: z.string().nullable().optional(),
      }),
    )
    .min(1),
});

const candidateSchema = z.object({
  code: z.string(),
  display: z.string(),
  cosine: z.number(),
});

const conceptStatusSchema = z.enum(["resolved", "flag", "unresolved"]);

const conceptsResponse = z.object({
  concepts: z.array(
    z.object({
      span: z.string(),
      candidates: z.array(candidateSchema),
      code: z.string().nullable(),
      cosine: z.number(),
      margin: z.number(),
      concept_confidence: z.number(),
      status: conceptStatusSchema,
    }),
  ),
});

const axisSchema = z
  .object({
    value: z.string(),
    confidence: z.number(),
    trigger: z.string().nullable().optional(),
  })
  .nullable();

const contextAxesSchema = z.object({
  assertion: axisSchema,
  subject: axisSchema,
  temporality: axisSchema,
  certainty: axisSchema,
  role: axisSchema,
});

const contextsResponse = z.object({
  contexts: z.array(
    z.object({
      code: z.string().nullable(),
      span: z.string(),
      context: contextAxesSchema,
      context_confidence: z.number(),
      readable_note: z.string(),
    }),
  ),
});

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

async function proxyToNlp<T>(path: string, body: unknown): Promise<T> {
  const base = process.env.NLP_SERVICE_URL?.replace(/\/$/, "");
  if (!base) {
    throw new AppError(
      "NLP_UNAVAILABLE",
      "Extraction service is not configured. Set `NLP_SERVICE_URL`.",
      503,
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    let data: unknown = null;
    try {
      data = await upstream.json();
    } catch {
      data = null;
    }

    if (!upstream.ok) {
      throw new AppError(
        "NLP_UPSTREAM_ERROR",
        "Extraction service returned an error.",
        502,
        data ?? undefined,
      );
    }

    return data as T;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      "NLP_UNAVAILABLE",
      "Extraction service is unreachable.",
      503,
    );
  } finally {
    clearTimeout(timer);
  }
}

const extractRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/extract/concepts",
    {
      schema: {
        summary: "Extract SNOMED concept candidates from clinical text",
        description:
          "Detects clinical phrases (NER), embeds them, and resolves each span to SNOMED concept candidates via pgvector cosine search with a margin-based status.",
        tags: ["extract"],
        body: conceptsBody,
        response: {
          200: conceptsResponse,
          400: errorEnvelope,
          502: errorEnvelope,
          503: errorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const text = req.body.text.trim();
      if (text.length < 2) {
        throw BadRequest(
          "INVALID_INPUT",
          "`text` must be at least 2 characters after trimming.",
        );
      }
      const data = await proxyToNlp<z.infer<typeof conceptsResponse>>(
        "/extract/concepts",
        {
          text,
          language: req.body.language,
        },
      );
      return reply.send(data);
    },
  );

  app.post(
    "/extract/contexts",
    {
      schema: {
        summary: "Resolve clinical context for concept spans",
        description:
          "Applies rule-based ConText analysis (assertion, subject, temporality, certainty, role) to the provided spans, returning auditable triggers per axis.",
        tags: ["extract"],
        body: contextsBody,
        response: {
          200: contextsResponse,
          400: errorEnvelope,
          502: errorEnvelope,
          503: errorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const text = req.body.text.trim();
      if (text.length < 2) {
        throw BadRequest(
          "INVALID_INPUT",
          "`text` must be at least 2 characters after trimming.",
        );
      }
      const data = await proxyToNlp<z.infer<typeof contextsResponse>>(
        "/extract/contexts",
        {
          text,
          language: req.body.language,
          concepts: req.body.concepts,
        },
      );
      return reply.send(data);
    },
  );
};

export default extractRoutes;
