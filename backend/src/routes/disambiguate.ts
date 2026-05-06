import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { TEXT_DEFINITION_TYPE_ID } from "../db/ids.js";
import { NotFound } from "../lib/errors.js";
import { normalize } from "../lib/normalize.js";
import { getPreferredTerms } from "../lib/preferred-term.js";

const disambiguateBody = z.object({
  text: z.string().min(1),
  context: z.string().min(1),
  candidateCodes: z.array(z.string().regex(/^\d+$/)).max(50).optional(),
});

const candidateSchema = z.object({
  code: z.string(),
  preferredTerm: z.string().nullable(),
  confidence: z.number(),
  contextSimilarity: z.number(),
  signal: z.enum(["definition", "fsn"]),
});

const disambiguateResponse = z.object({
  winner: candidateSchema,
  alternatives: z.array(candidateSchema),
  reasoning: z.string(),
});

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

interface CandidateInfo {
  code: string;
  preferredTerm: string | null;
  initialConfidence: number;
  signalText: string;
  signalSource: "definition" | "fsn";
}

interface SimRow {
  concept_id: string;
  score: number | string;
}

interface SignalRow {
  concept_id: string;
  signal_text: string;
  signal_source: "definition" | "fsn";
}

async function loadSignals(
  req: FastifyRequest,
  conceptIds: string[],
): Promise<Map<string, { signal: string; source: "definition" | "fsn" }>> {
  if (conceptIds.length === 0) return new Map();

  const { rows } = await req.db.query<SignalRow>(
    `WITH defs AS (
       SELECT DISTINCT ON (concept_id)
              concept_id, term AS signal_text, 'definition'::text AS signal_source
         FROM snomed.text_definitions
        WHERE concept_id = ANY($1::bigint[])
          AND active = true
          AND type_id = $2
        ORDER BY concept_id, length(term) DESC
     ),
     fsn AS (
       SELECT DISTINCT ON (concept_id)
              concept_id, term AS signal_text, 'fsn'::text AS signal_source
         FROM snomed.descriptions
        WHERE concept_id = ANY($1::bigint[])
          AND active = true
          AND type_id = 900000000000003001
        ORDER BY concept_id, length(term) ASC
     )
     SELECT * FROM defs
     UNION ALL
     SELECT f.* FROM fsn f
      WHERE NOT EXISTS (SELECT 1 FROM defs d WHERE d.concept_id = f.concept_id)`,
    [conceptIds, TEXT_DEFINITION_TYPE_ID],
  );

  const out = new Map<string, { signal: string; source: "definition" | "fsn" }>();
  for (const r of rows) {
    out.set(r.concept_id, { signal: r.signal_text, source: r.signal_source });
  }
  return out;
}

async function scoreCandidates(
  req: FastifyRequest,
  candidates: CandidateInfo[],
  context: string,
): Promise<Map<string, number>> {
  if (candidates.length === 0) return new Map();
  const ids = candidates.map((c) => c.code);
  const signals = candidates.map((c) => c.signalText);

  const { rows } = await req.db.query<SimRow>(
    `SELECT u.concept_id, similarity(u.signal, $2)::float8 AS score
       FROM unnest($1::text[], $3::text[]) AS u(concept_id, signal)`,
    [ids, context, signals],
  );

  const out = new Map<string, number>();
  for (const r of rows) {
    out.set(r.concept_id, typeof r.score === "string" ? Number(r.score) : r.score);
  }
  return out;
}

const disambiguateRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/disambiguate",
    {
      schema: {
        summary: "Pick the most likely SNOMED concept given clinical context",
        description:
          "v1 algorithm: build candidates via /normalize (or accept a pre-filtered list), " +
          "fetch each candidate's text definition (or FSN fallback), and rank by " +
          "trigram similarity to the supplied context.",
        tags: ["normalize"],
        body: disambiguateBody,
        response: {
          200: disambiguateResponse,
          404: errorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const { text, context, candidateCodes } = req.body;

      // 1. Build candidate set
      let prelim: { code: string; initialConfidence: number }[];
      if (candidateCodes && candidateCodes.length > 0) {
        prelim = candidateCodes.map((c) => ({ code: c, initialConfidence: 0 }));
      } else {
        const matches = await normalize(req, text.trim(), 10);
        prelim = matches.map((m) => ({ code: m.code, initialConfidence: m.confidence }));
      }
      if (prelim.length === 0) {
        throw NotFound(
          "NO_CANDIDATES",
          `No candidate concepts could be derived from text "${text}".`,
        );
      }

      // 2. Fetch preferred terms + signal text in parallel
      const [preferredMap, signalMap] = await Promise.all([
        getPreferredTerms(req, prelim.map((p) => p.code)),
        loadSignals(req, prelim.map((p) => p.code)),
      ]);

      const candidates: CandidateInfo[] = prelim.map((p) => {
        const sig = signalMap.get(p.code);
        return {
          code: p.code,
          preferredTerm: preferredMap.get(p.code) ?? null,
          initialConfidence: p.initialConfidence,
          signalText: sig?.signal ?? preferredMap.get(p.code) ?? "",
          signalSource: sig?.source ?? "fsn",
        };
      });

      // 3. Score against context
      const simMap = await scoreCandidates(req, candidates, context);

      const ranked = candidates
        .map((c) => ({
          code: c.code,
          preferredTerm: c.preferredTerm,
          confidence: clamp01((c.initialConfidence + (simMap.get(c.code) ?? 0)) / 2),
          contextSimilarity: clamp01(simMap.get(c.code) ?? 0),
          signal: c.signalSource,
        }))
        .sort((a, b) => b.contextSimilarity - a.contextSimilarity || b.confidence - a.confidence);

      const [winner, ...alternatives] = ranked;
      const next = alternatives[0];
      const gap = next ? winner.contextSimilarity - next.contextSimilarity : winner.contextSimilarity;
      const winnerName = winner.preferredTerm ?? winner.code;
      const reasoning =
        next
          ? `"${text}" in the supplied context most likely refers to ${winnerName} (${winner.code}); ` +
            `context similarity ${winner.contextSimilarity.toFixed(2)} vs next best ` +
            `${next.preferredTerm ?? next.code} at ${next.contextSimilarity.toFixed(2)} ` +
            `(margin ${gap.toFixed(2)}).`
          : `"${text}" matched a single candidate ${winnerName} (${winner.code}) with ` +
            `context similarity ${winner.contextSimilarity.toFixed(2)}.`;

      return reply.send({
        winner,
        alternatives,
        reasoning,
      });
    },
  );
};

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return Number(n.toFixed(4));
}

export default disambiguateRoutes;
