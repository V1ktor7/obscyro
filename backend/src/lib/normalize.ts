import type { FastifyRequest } from "fastify";

import { getPreferredTerms } from "./preferred-term.js";

export type MatchType = "exact" | "fts" | "trigram";

export interface NormalizeMatch {
  code: string;
  term: string;
  conceptName: string;
  confidence: number;
  matchType: MatchType;
}

interface RawMatchRow {
  concept_id: string;
  term: string;
  score: number | string;
  match_type: MatchType;
}

const MATCH_TYPE_RANK: Record<MatchType, number> = {
  exact: 3,
  fts: 2,
  trigram: 1,
};

/**
 * Core text → SNOMED match function used by both /v1/normalize and /v1/normalize-batch.
 *
 * Strategy (single round-trip):
 *   1. Exact case-insensitive `lower(term) = lower(text)` (confidence = 1.0).
 *   2. Postgres full-text search ranked by ts_rank against `to_tsvector('english', term)`.
 *   3. Trigram similarity using pg_trgm operator `%` and ranked by `similarity()`.
 * Results are unioned, deduped per concept_id (best score wins) and joined
 * to a preferred-term lookup for `conceptName`.
 *
 * Only descriptions of active concepts are returned.
 */
export async function normalize(
  req: FastifyRequest,
  text: string,
  limit: number,
): Promise<NormalizeMatch[]> {
  const safeLimit = Math.max(1, Math.min(limit, 50));

  // pg_trgm threshold is per-session; SET LOCAL would require an explicit txn.
  // Instead we pass a similarity floor inline so we get index acceleration via `%`.
  const { rows } = await req.db.query<RawMatchRow>(
    `WITH q AS (SELECT $1::text AS text)
     , exact_matches AS (
         SELECT d.concept_id, d.term, 1.0::float8 AS score, 'exact'::text AS match_type
         FROM snomed.descriptions d
         JOIN snomed.concepts c ON c.id = d.concept_id
         CROSS JOIN q
         WHERE d.active = true AND c.active = true
           AND lower(d.term) = lower(q.text)
         LIMIT 50
     )
     , fts_matches AS (
         SELECT d.concept_id, d.term,
                ts_rank(to_tsvector('english', d.term), plainto_tsquery('english', q.text))::float8 AS score,
                'fts'::text AS match_type
         FROM snomed.descriptions d
         JOIN snomed.concepts c ON c.id = d.concept_id
         CROSS JOIN q
         WHERE d.active = true AND c.active = true
           AND to_tsvector('english', d.term) @@ plainto_tsquery('english', q.text)
         ORDER BY score DESC
         LIMIT $2 * 5
     )
     , trgm_matches AS (
         SELECT d.concept_id, d.term,
                similarity(d.term, q.text)::float8 AS score,
                'trigram'::text AS match_type
         FROM snomed.descriptions d
         JOIN snomed.concepts c ON c.id = d.concept_id
         CROSS JOIN q
         WHERE d.active = true AND c.active = true
           AND d.term % q.text
         ORDER BY similarity(d.term, q.text) DESC
         LIMIT $2 * 5
     )
     , unioned AS (
         SELECT * FROM exact_matches
         UNION ALL
         SELECT * FROM fts_matches
         UNION ALL
         SELECT * FROM trgm_matches
     )
     SELECT DISTINCT ON (concept_id) concept_id, term, score, match_type
     FROM unioned
     ORDER BY concept_id,
              CASE match_type
                WHEN 'exact' THEN 3
                WHEN 'fts' THEN 2
                ELSE 1
              END DESC,
              score DESC`,
    [text, safeLimit],
  );

  if (rows.length === 0) return [];

  const enriched = rows
    .map((r) => ({
      concept_id: r.concept_id,
      term: r.term,
      score: typeof r.score === "string" ? Number(r.score) : r.score,
      match_type: r.match_type,
    }))
    .sort((a, b) => {
      const rank = MATCH_TYPE_RANK[b.match_type] - MATCH_TYPE_RANK[a.match_type];
      if (rank !== 0) return rank;
      return b.score - a.score;
    })
    .slice(0, safeLimit);

  const preferredMap = await getPreferredTerms(
    req,
    enriched.map((r) => r.concept_id),
  );

  return enriched.map((r) => ({
    code: r.concept_id,
    term: r.term,
    conceptName: preferredMap.get(r.concept_id) ?? r.term,
    confidence: clamp01(r.score),
    matchType: r.match_type,
  }));
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return Number(n.toFixed(4));
}
