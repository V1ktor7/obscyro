import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { createHash } from "node:crypto";
import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { AppError, BadRequest, NotFound } from "../lib/errors.js";
import { proxyToNlp } from "../lib/nlp.js";
import { persistExtractResults } from "../services/persist-extract.js";
import {
  CLINICAL_FINDING_SCHEMA,
  PATIENT_SCHEMA,
  getOrCreateLinkType,
  getOrCreateObjectType,
  resolveEnvironment,
} from "../services/ontology.js";
import { resolveUserIdForApiKey } from "../services/login.js";

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
      patient: z
        .object({
          identifier: z.string().optional(),
        })
        .optional(),
      qualityScanOnWrite: z.boolean().optional(),
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
  patient: z
    .object({
      id: z.string().uuid(),
      identifier: z.string(),
      created: z.boolean(),
    })
    .nullable(),
  linked: z.boolean(),
  reason: z.enum(["no_patient_identifier"]).optional(),
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

async function requireUserId(req: {
  apiKey?: { id: string } | null;
  db: DbClient;
}): Promise<string> {
  if (!req.apiKey) throw new AppError("INVALID_API_KEY", "API key required.", 401);
  const userId = await resolveUserIdForApiKey(req.db, req.apiKey.id);
  if (!userId) throw NotFound("USER_NOT_FOUND", "User not found for API key.");
  return userId;
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
          "Proxies the NLP combined pipeline (NER -> SNOMED resolution -> ConText -> decision) in one call. With `persist`, writes each accepted/flagged result as a ClinicalFinding instance into the owner-scoped ontology environment. When `persist.patient.identifier` is provided, resolves or creates a Patient by that identifier only and links via `has_finding`; without an identifier, findings are stored as unlinked with `provenance.unlinked=true`.",
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

      const persisted = await persistExtractResults({
        environmentId: env.id,
        environmentSlug: env.slug,
        environmentName: env.name,
        objectTypeName: persist.objectType,
        findingTypeId,
        patientTypeId,
        linkTypeId,
        patientIdentifier: persist.patient?.identifier,
        inputHash: createHash("sha256").update(text).digest("hex"),
        results: combined.results,
        qualityScanOnWrite: persist.qualityScanOnWrite,
      });

      return reply.send({
        ...combined,
        persisted,
      });
    },
  );

  const persistGraphBody = z.object({
    inputHash: z.string().trim().min(1),
    results: z.array(combinedResultSchema).min(1),
    persist: z.object({
      environment: z.string().trim().min(1),
      objectType: z.string().trim().min(1).default("ClinicalFinding"),
      patient: z
        .object({
          identifier: z.string().optional(),
        })
        .optional(),
      qualityScanOnWrite: z.boolean().optional(),
    }),
  });

  const persistGraphResponse = z.object({
    persisted: persistedSchema,
  });

  app.post(
    "/extract/persist",
    {
      schema: {
        summary: "Persist pre-computed extraction results into an ontology environment",
        description:
          "Writes graph/decision results directly via the hardened persist path (no NLP re-run). Requires `inputHash` (sha256 of upstream content) — raw clinical text is never stored.",
        tags: ["extract", "ontology"],
        body: persistGraphBody,
        response: {
          200: persistGraphResponse,
          400: errorEnvelope,
          404: errorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const { persist, results, inputHash } = req.body;
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

      const persisted = await persistExtractResults({
        environmentId: env.id,
        environmentSlug: env.slug,
        environmentName: env.name,
        objectTypeName: persist.objectType,
        findingTypeId,
        patientTypeId,
        linkTypeId,
        patientIdentifier: persist.patient?.identifier,
        inputHash,
        results,
        qualityScanOnWrite: persist.qualityScanOnWrite,
      });

      return reply.send({ persisted });
    },
  );
};

export default extractRoutes;
