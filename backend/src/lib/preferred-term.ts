import type { FastifyRequest } from "fastify";

import { FSN_TYPE_ID, SYNONYM_TYPE_ID } from "../db/ids.js";

interface PreferredTermRow {
  concept_id: string;
  term: string;
}

/**
 * Resolves the "preferred" display term for a set of concept ids.
 * Without the SNOMED Language Reference Set we approximate as:
 *   1. Shortest active synonym (type_id = SYNONYM_TYPE_ID)
 *   2. Otherwise the FSN (type_id = FSN_TYPE_ID)
 *
 * Returns a Map<conceptId, term>. Missing ids are absent from the map.
 */
export async function getPreferredTerms(
  req: FastifyRequest,
  conceptIds: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (conceptIds.length === 0) return out;

  const { rows } = await req.db.query<PreferredTermRow>(
    `WITH ranked AS (
       SELECT
         d.concept_id,
         d.term,
         ROW_NUMBER() OVER (
           PARTITION BY d.concept_id
           ORDER BY (d.type_id = $2) DESC, length(d.term) ASC, d.term ASC
         ) AS rn
       FROM snomed.descriptions d
       WHERE d.concept_id = ANY($1::bigint[])
         AND d.active = true
         AND d.type_id IN ($2, $3)
     )
     SELECT concept_id, term
     FROM ranked
     WHERE rn = 1`,
    [conceptIds, SYNONYM_TYPE_ID, FSN_TYPE_ID],
  );

  for (const row of rows) {
    out.set(row.concept_id, row.term);
  }
  return out;
}

export async function getPreferredTerm(
  req: FastifyRequest,
  conceptId: string,
): Promise<string | undefined> {
  const map = await getPreferredTerms(req, [conceptId]);
  return map.get(conceptId);
}
