import { randomUUID } from "node:crypto";

import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { AppError, BadRequest, NotFound } from "../lib/errors.js";
import {
  CLINICAL_FINDING_SCHEMA,
  PATIENT_SCHEMA,
  getOrCreateLinkType,
  getOrCreateObjectType,
  insertLinkInstance,
  insertObjectInstance,
  resolveEnvironment,
} from "../services/ontology.js";
import { resolveUserIdForApiKey } from "../services/login.js";

const UPSTREAM_TIMEOUT_MS = 20_000;

/** Decisions that are confident enough to auto-persist as findings. */
const PERSISTABLE_DECISIONS = new Set(["accept", "flag"]);

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

const decisionSchema = z.enum(["accept", "flag", "escalate"]);
const destinationSchema = z.enum(["research", "problem_list"]).default("research");

const combinedResultSchema = z.object({
  span: z.string(),
  candidates: z.array(candidateSchema),
  code: z.string().nullable(),
  cosine: z.number(),
  margin: z.number(),
  concept_confidence: z.number(),
  status: conceptStatusSchema,
  context: contextAxesSchema,
  context_confidence: z.number(),
  readable_note: z.string(),
  decision: decisionSchema,
});

const combinedResponse = z.object({
  destination: destinationSchema,
  results: z.array(combinedResultSchema),
});

const extractBody = z.object({
  text: z.string().min(1),
  language: languageSchema,
  destination: destinationSchema,
  persist: z
    .object({
      environment: z.string().trim().min(1),
      objectType: z.string().trim().min(1).default("ClinicalFinding"),
    })
    .optional(),
});

const persistedSchema = z.object({
  environment: z.object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
  }),
  objectType: z.string(),
  objectIds: z.array(z.string().uuid()),
  linkIds: z.array(z.string().uuid()),
  pipelineRunId: z.string().uuid(),
});

const extractResponse = combinedResponse.extend({
  persisted: persistedSchema.optional(),
});

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

type CombinedResult = z.infer<typeof combinedResultSchema>;

/** Pick a single, human-readable trigger across all ConText axes. */
function summarizeTriggers(context: z.infer<typeof contextAxesSchema>): string | null {
  const axes = [
    context.assertion,
    context.certainty,
    context.subject,
    context.temporality,
    context.role,
  ];
  const triggers: string[] = [];
  for (const axis of axes) {
    const t = axis?.trigger;
    if (t && !triggers.includes(t)) triggers.push(t);
  }
  return triggers.length > 0 ? triggers.join("; ") : null;
}

/** Map a combined NLP result to the ClinicalFinding context-envelope properties. */
function toFindingProperties(result: CombinedResult): Record<string, unknown> {
  const chosen =
    result.candidates.find((c) => c.code === result.code) ?? result.candidates[0];
  return {
    span: result.span,
    snomed_code: result.code,
    display: chosen?.display ?? null,
    assertion: result.context.assertion?.value ?? null,
    subject: result.context.subject?.value ?? null,
    temporality: result.context.temporality?.value ?? null,
    certainty: result.context.certainty?.value ?? null,
    trigger: summarizeTriggers(result.context),
    confidence: result.context_confidence,
    decision: result.decision,
    readable_note: result.readable_note,
  };
}

async function requireUserId(req: {
  apiKey?: { id: string } | null;
  db: DbClient;
}): Promise<string> {
  if (!req.apiKey) throw new AppError("INVALID_API_KEY", "API key required.", 401);
  const userId = await resolveUserIdForApiKey(req.db, req.apiKey.id);
  if (!userId) throw NotFound("USER_NOT_FOUND", "User not found for API key.");
  return userId;
}

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

  app.post(
    "/extract",
    {
      schema: {
        summary: "Run the full extraction pipeline (concepts + context + decision)",
        description:
          "Proxies the NLP combined pipeline (NER -> SNOMED resolution -> ConText -> decision) in one call. With `persist`, writes each accepted/flagged result as a ClinicalFinding instance into the owner-scoped ontology environment, linking patient-subject findings to a Patient via `has_finding`, with full provenance.",
        tags: ["extract", "ontology"],
        body: extractBody,
        response: {
          200: extractResponse,
          400: errorEnvelope,
          404: errorEnvelope,
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

      const combined = await proxyToNlp<z.infer<typeof combinedResponse>>("/extract", {
        text,
        language: req.body.language,
        destination: req.body.destination,
      });

      const persist = req.body.persist;
      if (!persist) {
        return reply.send(combined);
      }

      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, persist.environment);

      const findingTypeId = await getOrCreateObjectType(
        req.db,
        env.id,
        persist.objectType,
        "Clinical finding extracted from text with its context envelope",
        CLINICAL_FINDING_SCHEMA,
      );
      const patientTypeId = await getOrCreateObjectType(
        req.db,
        env.id,
        "Patient",
        "Subject of clinical findings",
        PATIENT_SCHEMA,
      );
      const linkTypeId = await getOrCreateLinkType(
        req.db,
        env.id,
        "has_finding",
        patientTypeId,
        findingTypeId,
        "many_to_many",
      );

      const pipelineRunId = randomUUID();
      const nowIso = new Date().toISOString();
      const objectIds: string[] = [];
      const linkIds: string[] = [];
      let patientInstanceId: string | null = null;

      for (const result of combined.results) {
        if (!PERSISTABLE_DECISIONS.has(result.decision)) continue;

        const objectId = await insertObjectInstance(
          req.db,
          findingTypeId,
          toFindingProperties(result),
          {
            source: "extract",
            created_at: nowIso,
            pipeline_run_id: pipelineRunId,
            confidence: result.concept_confidence,
          },
        );
        objectIds.push(objectId);

        if (result.context.subject?.value === "patient") {
          if (!patientInstanceId) {
            patientInstanceId = await insertObjectInstance(
              req.db,
              patientTypeId,
              { label: "Extracted patient", external_id: null },
              { source: "extract", created_at: nowIso, pipeline_run_id: pipelineRunId },
            );
          }
          const linkId = await insertLinkInstance(
            req.db,
            linkTypeId,
            patientInstanceId,
            objectId,
            { source: "extract", pipeline_run_id: pipelineRunId },
          );
          if (linkId) linkIds.push(linkId);
        }
      }

      return reply.send({
        ...combined,
        persisted: {
          environment: { id: env.id, slug: env.slug, name: env.name },
          objectType: persist.objectType,
          objectIds,
          linkIds,
          pipelineRunId,
        },
      });
    },
  );
};

export default extractRoutes;
