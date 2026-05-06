import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import {
  ICD10_MAP_REFSET,
  SIMPLE_MAP_REFSETS,
  type TerminologyTarget,
} from "../db/ids.js";
import { BadRequest, NotFound } from "../lib/errors.js";
import { parseMapRule, type MapRuleConditional } from "../lib/map-rule.js";

const translateBody = z.object({
  code: z.string().min(1),
  from: z.literal("snomed").default("snomed"),
  to: z.enum(["icd10", "icdo", "ctv3"]),
  reverse: z.boolean().default(false),
});

const conditionalSchema = z.discriminatedUnion("rule", [
  z.object({ rule: z.literal("IFA"), conceptId: z.string(), description: z.string() }),
  z.object({ rule: z.literal("RAW"), expression: z.string() }),
]);

const extendedTranslationSchema = z.object({
  source: z.string(),
  target: z.string().nullable(),
  mapGroup: z.number().int(),
  mapPriority: z.number().int(),
  mapAdvice: z.string().nullable(),
  mapCategoryId: z.string().nullable(),
  conditional: conditionalSchema.optional(),
});

const simpleTranslationSchema = z.object({
  source: z.string(),
  target: z.string().nullable(),
});

const translateResponse = z.object({
  source: z.literal("snomed"),
  target: z.enum(["icd10", "icdo", "ctv3"]),
  reverse: z.boolean(),
  refsetId: z.string(),
  translations: z.array(z.union([extendedTranslationSchema, simpleTranslationSchema])),
});

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

interface ExtendedRow {
  source: string;
  target: string | null;
  map_group: number;
  map_priority: number;
  map_advice: string | null;
  map_rule: string | null;
  map_category_id: string | null;
}

interface SimpleRow {
  source: string;
  target: string | null;
}

const translateRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/translate",
    {
      schema: {
        summary: "Translate a SNOMED concept to (or from) another terminology",
        description:
          "Forward direction (default) maps a SNOMED concept code to ICD-10 / ICD-O / CTV3. " +
          "Set `reverse=true` to look up which SNOMED concept(s) map to a given target code.",
        tags: ["translate"],
        body: translateBody,
        response: {
          200: translateResponse,
          400: errorEnvelope,
          404: errorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const { code, to, reverse } = req.body;

      if (to === "icd10") {
        const { rows } = reverse
          ? await req.db.query<ExtendedRow>(
              `SELECT referenced_component_id::text AS source,
                      map_target AS target,
                      map_group, map_priority, map_advice, map_rule,
                      map_category_id::text AS map_category_id
                 FROM snomed.extended_map
                WHERE map_target = $1 AND refset_id = $2 AND active = true
                ORDER BY map_group, map_priority`,
              [code, ICD10_MAP_REFSET],
            )
          : await req.db.query<ExtendedRow>(
              `SELECT referenced_component_id::text AS source,
                      map_target AS target,
                      map_group, map_priority, map_advice, map_rule,
                      map_category_id::text AS map_category_id
                 FROM snomed.extended_map
                WHERE referenced_component_id = $1 AND refset_id = $2 AND active = true
                ORDER BY map_group, map_priority`,
              [code, ICD10_MAP_REFSET],
            );

        if (rows.length === 0) {
          throw NotFound(
            "NO_TRANSLATION",
            `No active ICD-10 ${reverse ? "reverse " : ""}mapping found for ${code}.`,
          );
        }

        const translations = rows.map((r) => {
          const conditional: MapRuleConditional | null = parseMapRule(r.map_rule);
          const base = {
            source: r.source,
            target: r.target,
            mapGroup: Number(r.map_group),
            mapPriority: Number(r.map_priority),
            mapAdvice: r.map_advice,
            mapCategoryId: r.map_category_id,
          };
          if (conditional && (conditional.rule === "IFA" || conditional.rule === "RAW")) {
            return { ...base, conditional };
          }
          return base;
        });

        return reply.send({
          source: "snomed" as const,
          target: to,
          reverse,
          refsetId: ICD10_MAP_REFSET,
          translations,
        });
      }

      // simple_map path (icdo, ctv3)
      const refsetId = SIMPLE_MAP_REFSETS[to as Exclude<TerminologyTarget, "icd10">];
      if (!refsetId) {
        throw BadRequest("UNSUPPORTED_TARGET", `Target terminology '${to}' is not configured.`);
      }
      const { rows } = reverse
        ? await req.db.query<SimpleRow>(
            `SELECT referenced_component_id::text AS source, map_target AS target
               FROM snomed.simple_map
              WHERE map_target = $1 AND refset_id = $2 AND active = true`,
            [code, refsetId],
          )
        : await req.db.query<SimpleRow>(
            `SELECT referenced_component_id::text AS source, map_target AS target
               FROM snomed.simple_map
              WHERE referenced_component_id = $1 AND refset_id = $2 AND active = true`,
            [code, refsetId],
          );

      if (rows.length === 0) {
        throw NotFound(
          "NO_TRANSLATION",
          `No active ${to} ${reverse ? "reverse " : ""}mapping found for ${code}.`,
        );
      }

      return reply.send({
        source: "snomed" as const,
        target: to,
        reverse,
        refsetId,
        translations: rows.map((r) => ({ source: r.source, target: r.target })),
      });
    },
  );
};

export default translateRoutes;
