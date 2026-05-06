import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { BadRequest } from "../lib/errors.js";
import { normalize } from "../lib/normalize.js";

const normalizeBody = z.object({
  text: z.string(),
  limit: z.coerce.number().int().min(1).max(50).default(5),
});

const matchSchema = z.object({
  code: z.string(),
  term: z.string(),
  conceptName: z.string(),
  confidence: z.number(),
  matchType: z.enum(["exact", "fts", "trigram"]),
});

const normalizeResponse = z.object({
  matches: z.array(matchSchema),
});

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

const normalizeRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/normalize",
    {
      schema: {
        summary: "Normalize raw clinical text to SNOMED concept candidates",
        description:
          "Combines exact, full-text, and trigram fuzzy match against active SNOMED descriptions.",
        tags: ["normalize"],
        body: normalizeBody,
        response: {
          200: normalizeResponse,
          400: errorEnvelope,
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
      const matches = await normalize(req, text, req.body.limit);
      return reply.send({ matches });
    },
  );
};

export default normalizeRoutes;
