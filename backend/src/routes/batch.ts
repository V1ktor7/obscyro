import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import pLimit from "p-limit";
import { z } from "zod";

import { normalize, type NormalizeMatch } from "../lib/normalize.js";

const batchBody = z.object({
  texts: z.array(z.string()).min(1).max(1000),
});

const matchSchema = z.object({
  code: z.string(),
  term: z.string(),
  conceptName: z.string(),
  confidence: z.number(),
  matchType: z.enum(["exact", "fts", "trigram"]),
});

const resultSchema = z.object({
  input: z.string(),
  matches: z.array(matchSchema),
  processingTimeMs: z.number(),
});

const batchResponse = z.object({
  results: z.array(resultSchema),
  summaryStats: z.object({
    totalTexts: z.number(),
    totalMatched: z.number(),
    avgConfidence: z.number(),
    totalTimeMs: z.number(),
  }),
});

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

const CONCURRENCY = 20;
const PER_TEXT_LIMIT = 5;

const batchRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/normalize-batch",
    {
      schema: {
        summary: "Bulk normalize up to 1000 texts in parallel",
        description: `Runs the normalize pipeline with concurrency ${CONCURRENCY}; preserves input order.`,
        tags: ["normalize"],
        body: batchBody,
        response: {
          200: batchResponse,
          400: errorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const reqStart = Date.now();
      const limiter = pLimit(CONCURRENCY);
      const trimmed = req.body.texts.map((t) => t.trim());

      const results = await Promise.all(
        trimmed.map((text) =>
          limiter(async () => {
            const t0 = Date.now();
            let matches: NormalizeMatch[] = [];
            if (text.length >= 2) {
              matches = await normalize(req, text, PER_TEXT_LIMIT);
            }
            return {
              input: text,
              matches,
              processingTimeMs: Date.now() - t0,
            };
          }),
        ),
      );

      const matchedConfidences: number[] = [];
      for (const r of results) {
        if (r.matches.length > 0) {
          matchedConfidences.push(r.matches[0].confidence);
        }
      }
      const avgConfidence =
        matchedConfidences.length > 0
          ? Number(
              (
                matchedConfidences.reduce((a, b) => a + b, 0) /
                matchedConfidences.length
              ).toFixed(4),
            )
          : 0;

      return reply.send({
        results,
        summaryStats: {
          totalTexts: trimmed.length,
          totalMatched: matchedConfidences.length,
          avgConfidence,
          totalTimeMs: Date.now() - reqStart,
        },
      });
    },
  );
};

export default batchRoutes;
