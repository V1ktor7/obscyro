import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { IS_A_TYPE_ID } from "../db/ids.js";
import { NotFound } from "../lib/errors.js";
import { getPreferredTerms } from "../lib/preferred-term.js";

type Direction = "parents" | "children" | "ancestors" | "descendants";

const codeParam = z.object({
  code: z.string().regex(/^\d+$/, "code must be a numeric SCTID"),
});

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(10_000).default(100),
  includeNames: z
    .union([z.boolean(), z.literal("true"), z.literal("false")])
    .default(false)
    .transform((v) => v === true || v === "true"),
});

const flatItem = z.object({
  code: z.string(),
  preferredTerm: z.string().nullable().optional(),
});

const treeItem = z.object({
  code: z.string(),
  depth: z.number().int(),
  preferredTerm: z.string().nullable().optional(),
});

const flatResponse = z.object({
  code: z.string(),
  type: z.enum(["parents", "children"]),
  results: z.array(flatItem),
  count: z.number().int(),
  truncated: z.boolean(),
});

const treeResponse = z.object({
  code: z.string(),
  type: z.enum(["ancestors", "descendants"]),
  results: z.array(treeItem),
  count: z.number().int(),
  truncated: z.boolean(),
});

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

interface IdRow {
  id: string;
}
interface IdDepthRow {
  id: string;
  depth: number;
}

async function ensureConceptExists(req: FastifyRequest, code: string): Promise<void> {
  const { rowCount } = await req.db.query(
    "SELECT 1 FROM snomed.concepts WHERE id = $1",
    [code],
  );
  if (!rowCount) {
    throw NotFound("CONCEPT_NOT_FOUND", `Concept ${code} not found.`);
  }
}

async function maybeAttachNames<T extends { code: string }>(
  req: FastifyRequest,
  rows: T[],
  includeNames: boolean,
): Promise<Array<T & { preferredTerm?: string | null }>> {
  if (!includeNames || rows.length === 0) return rows;
  const names = await getPreferredTerms(req, rows.map((r) => r.code));
  return rows.map((r) => ({ ...r, preferredTerm: names.get(r.code) ?? null }));
}

const hierarchyRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Helpers shared across the four routes
  const queryDirect = async (
    req: FastifyRequest,
    direction: "parents" | "children",
    code: string,
    limit: number,
  ) => {
    const sql =
      direction === "children"
        ? `SELECT source_id AS id
             FROM snomed.relationships
            WHERE destination_id = $1
              AND type_id = $2
              AND active = true
            ORDER BY source_id
            LIMIT $3`
        : `SELECT destination_id AS id
             FROM snomed.relationships
            WHERE source_id = $1
              AND type_id = $2
              AND active = true
            ORDER BY destination_id
            LIMIT $3`;
    const { rows } = await req.db.query<IdRow>(sql, [code, IS_A_TYPE_ID, limit + 1]);
    return rows;
  };

  const queryTree = async (
    req: FastifyRequest,
    direction: "ancestors" | "descendants",
    code: string,
    limit: number,
  ) => {
    // For descendants we walk source_id -> destination_id (children of children).
    // For ancestors we walk destination_id -> source_id (parents of parents).
    const sql =
      direction === "descendants"
        ? `WITH RECURSIVE walk(id, depth) AS (
             SELECT source_id, 1
               FROM snomed.relationships
              WHERE destination_id = $1
                AND type_id = $2
                AND active = true
             UNION ALL
             SELECT r.source_id, w.depth + 1
               FROM snomed.relationships r
               JOIN walk w ON r.destination_id = w.id
              WHERE r.type_id = $2
                AND r.active = true
                AND w.depth < 50
           )
           SELECT id, MIN(depth) AS depth
             FROM walk
            GROUP BY id
            ORDER BY depth ASC, id ASC
            LIMIT $3`
        : `WITH RECURSIVE walk(id, depth) AS (
             SELECT destination_id, 1
               FROM snomed.relationships
              WHERE source_id = $1
                AND type_id = $2
                AND active = true
             UNION ALL
             SELECT r.destination_id, w.depth + 1
               FROM snomed.relationships r
               JOIN walk w ON r.source_id = w.id
              WHERE r.type_id = $2
                AND r.active = true
                AND w.depth < 50
           )
           SELECT id, MIN(depth) AS depth
             FROM walk
            GROUP BY id
            ORDER BY depth ASC, id ASC
            LIMIT $3`;

    const { rows } = await req.db.query<IdDepthRow>(sql, [code, IS_A_TYPE_ID, limit + 1]);
    return rows;
  };

  const handleFlat =
    (direction: "parents" | "children") =>
    async (
      req: FastifyRequest<{ Params: { code: string }; Querystring: { limit: number; includeNames: boolean } }>,
    ) => {
      const { code } = req.params;
      const { limit, includeNames } = req.query;
      await ensureConceptExists(req, code);
      const rows = await queryDirect(req, direction, code, limit);
      const truncated = rows.length > limit;
      const sliced = truncated ? rows.slice(0, limit) : rows;
      const enriched = await maybeAttachNames(
        req,
        sliced.map((r) => ({ code: r.id })),
        includeNames,
      );
      return {
        code,
        type: direction,
        results: enriched,
        count: enriched.length,
        truncated,
      };
    };

  const handleTree =
    (direction: "ancestors" | "descendants") =>
    async (
      req: FastifyRequest<{ Params: { code: string }; Querystring: { limit: number; includeNames: boolean } }>,
    ) => {
      const { code } = req.params;
      const { limit, includeNames } = req.query;
      await ensureConceptExists(req, code);
      const rows = await queryTree(req, direction, code, limit);
      const truncated = rows.length > limit;
      const sliced = truncated ? rows.slice(0, limit) : rows;
      const enriched = await maybeAttachNames(
        req,
        sliced.map((r) => ({ code: r.id, depth: Number(r.depth) })),
        includeNames,
      );
      return {
        code,
        type: direction,
        results: enriched,
        count: enriched.length,
        truncated,
      };
    };

  app.get(
    "/concepts/:code/parents",
    {
      schema: {
        summary: "Direct parents (1-hop) via SNOMED is-a relationship",
        tags: ["hierarchy"],
        params: codeParam,
        querystring: querySchema,
        response: { 200: flatResponse, 404: errorEnvelope },
      },
    },
    handleFlat("parents"),
  );

  app.get(
    "/concepts/:code/children",
    {
      schema: {
        summary: "Direct children (1-hop) via SNOMED is-a relationship",
        tags: ["hierarchy"],
        params: codeParam,
        querystring: querySchema,
        response: { 200: flatResponse, 404: errorEnvelope },
      },
    },
    handleFlat("children"),
  );

  app.get(
    "/concepts/:code/ancestors",
    {
      schema: {
        summary: "Transitive ancestors (recursive is-a, with depth)",
        tags: ["hierarchy"],
        params: codeParam,
        querystring: querySchema,
        response: { 200: treeResponse, 404: errorEnvelope },
      },
    },
    handleTree("ancestors"),
  );

  app.get(
    "/concepts/:code/descendants",
    {
      schema: {
        summary: "Transitive descendants (recursive is-a, with depth)",
        tags: ["hierarchy"],
        params: codeParam,
        querystring: querySchema,
        response: { 200: treeResponse, 404: errorEnvelope },
      },
    },
    handleTree("descendants"),
  );
};

export default hierarchyRoutes;
