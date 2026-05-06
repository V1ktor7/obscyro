import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { definitionStatusName, FSN_TYPE_ID, SYNONYM_TYPE_ID } from "../db/ids.js";
import { NotFound } from "../lib/errors.js";

const codeParam = z.object({
  code: z.string().regex(/^\d+$/, "code must be a numeric SCTID"),
});

const conceptResponse = z.object({
  code: z.string(),
  active: z.boolean(),
  effectiveTime: z.number().int(),
  definitionStatus: z.string(),
  preferredTerm: z.string().nullable(),
});

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

interface ConceptRow {
  id: string;
  active: boolean;
  effective_time: number;
  definition_status_id: string;
}

interface PreferredRow {
  term: string;
}

const conceptsRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/concepts/:code",
    {
      exposeHeadRoute: false,
      schema: {
        summary: "Look up a SNOMED concept by code",
        description:
          "Validates a SNOMED concept id and returns its metadata plus the preferred display term.",
        tags: ["concepts"],
        params: codeParam,
        response: {
          200: conceptResponse,
          404: errorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const { code } = req.params;

      const [conceptRes, preferredRes] = await Promise.all([
        req.db.query<ConceptRow>(
          `SELECT id, active, effective_time, definition_status_id
             FROM snomed.concepts
            WHERE id = $1`,
          [code],
        ),
        req.db.query<PreferredRow>(
          `SELECT term
             FROM snomed.descriptions
            WHERE concept_id = $1
              AND active = true
              AND type_id IN ($2, $3)
            ORDER BY (type_id = $2) DESC, length(term) ASC, term ASC
            LIMIT 1`,
          [code, SYNONYM_TYPE_ID, FSN_TYPE_ID],
        ),
      ]);

      const concept = conceptRes.rows[0];
      if (!concept) {
        throw NotFound("CONCEPT_NOT_FOUND", `Concept ${code} not found.`);
      }

      const preferredTerm = preferredRes.rows[0]?.term ?? null;

      return reply.send({
        code: concept.id,
        active: concept.active,
        effectiveTime: Number(concept.effective_time),
        definitionStatus: definitionStatusName(concept.definition_status_id),
        preferredTerm,
      });
    },
  );

  app.head(
    "/concepts/:code",
    {
      schema: {
        summary: "Existence check for a SNOMED concept",
        description:
          "Returns 200 if the concept exists or 404 if not. Body is intentionally empty.",
        tags: ["concepts"],
        params: codeParam,
        response: {
          200: z.null(),
          404: z.null(),
        },
      },
    },
    async (req, reply) => {
      const { code } = req.params;
      const { rowCount } = await req.db.query(
        "SELECT 1 FROM snomed.concepts WHERE id = $1",
        [code],
      );
      reply.code(rowCount && rowCount > 0 ? 200 : 404).send(null);
    },
  );
};

export default conceptsRoutes;
