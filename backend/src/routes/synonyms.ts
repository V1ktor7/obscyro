import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { FSN_TYPE_ID, SYNONYM_TYPE_ID, TEXT_DEFINITION_TYPE_ID } from "../db/ids.js";
import { NotFound } from "../lib/errors.js";

const codeParam = z.object({
  code: z.string().regex(/^\d+$/, "code must be a numeric SCTID"),
});

const synonymsResponse = z.object({
  code: z.string(),
  fsn: z.string().nullable(),
  synonyms: z.array(z.string()),
  definition: z.string().optional(),
});

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

interface DescriptionRow {
  type_id: string;
  term: string;
}

const synonymsRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/concepts/:code/synonyms",
    {
      schema: {
        summary: "All names of a concept (FSN, synonyms, definition)",
        tags: ["concepts"],
        params: codeParam,
        response: {
          200: synonymsResponse,
          404: errorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const { code } = req.params;

      const { rows } = await req.db.query<DescriptionRow>(
        `SELECT type_id, term
           FROM snomed.descriptions
          WHERE concept_id = $1 AND active = true
            AND type_id IN ($2, $3)
          UNION ALL
         SELECT type_id, term
           FROM snomed.text_definitions
          WHERE concept_id = $1 AND active = true`,
        [code, FSN_TYPE_ID, SYNONYM_TYPE_ID],
      );

      if (rows.length === 0) {
        throw NotFound("CONCEPT_NOT_FOUND", `No active descriptions found for ${code}.`);
      }

      let fsn: string | null = null;
      const synonyms: string[] = [];
      let definition: string | undefined;

      for (const row of rows) {
        switch (row.type_id) {
          case FSN_TYPE_ID:
            // Prefer the shortest FSN if multiple are returned (rare).
            if (!fsn || row.term.length < fsn.length) fsn = row.term;
            break;
          case SYNONYM_TYPE_ID:
            synonyms.push(row.term);
            break;
          case TEXT_DEFINITION_TYPE_ID:
            // Keep the longest text definition (most descriptive) when multiple exist.
            if (!definition || row.term.length > definition.length) {
              definition = row.term;
            }
            break;
          default:
            break;
        }
      }

      synonyms.sort((a, b) => a.length - b.length || a.localeCompare(b));

      return reply.send({
        code,
        fsn,
        synonyms,
        ...(definition ? { definition } : {}),
      });
    },
  );
};

export default synonymsRoutes;
