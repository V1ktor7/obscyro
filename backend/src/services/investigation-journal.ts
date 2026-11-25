import { z } from "zod";

import type { DbClient } from "../lib/db.js";

// ---------------------------------------------------------------------------
// Investigations, read again.
//
// An investigation is kept whole in the analyst's journal
// (`app.analyst_exchange`, kind `investigation`): the sentence sent, every
// step of the program and of the search, and what was delivered. These two
// reads give it back as it was written. Nothing is recomputed: what a person
// reads again is what they saw, not what the series says today.
// ---------------------------------------------------------------------------

/** What the list of past investigations says of each. */
export const investigationLine = z.object({
  id: z.string(),
  askedAt: z.string(),
  request: z.string(),
  status: z.string(),
  message: z.string().nullable(),
  unit: z.object({ id: z.string(), name: z.string() }).nullable(),
  metric: z.string().nullable(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  candidates: z.number(),
  episodes: z.number(),
});
export type InvestigationLine = z.infer<typeof investigationLine>;

/**
 * The project's investigations, newest first.
 *
 * The unit, the measure and the span are read from the first step, which
 * every investigation has whether or not it was answered.
 */
export async function listInvestigations(db: DbClient, projectId: string, unitId: string | null, limit: number): Promise<InvestigationLine[]> {
  const { rows } = await db.query<{
    id: string;
    created_at: Date;
    question: string;
    status: string;
    message: string | null;
    unit_id: string | null;
    unit_name: string | null;
    metric: string | null;
    from_at: string | null;
    to_at: string | null;
    candidates: number;
    episodes: number;
  }>(
    `SELECT id, created_at, question, status, message,
            steps->0->'input'->>'unit_id' AS unit_id,
            steps->0->'input'->>'unit' AS unit_name,
            steps->0->'input'->>'measure' AS metric,
            steps->0->'input'->>'from' AS from_at,
            steps->0->'input'->>'to' AS to_at,
            COALESCE(jsonb_array_length(answer->'candidates'), 0)::int AS candidates,
            COALESCE(jsonb_array_length(answer->'investigation'->'episodes'), 0)::int AS episodes
       FROM app.analyst_exchange
      WHERE project_id = $1 AND kind = 'investigation'
        AND ($2::text IS NULL OR steps->0->'input'->>'unit_id' = $2)
      ORDER BY created_at DESC
      LIMIT $3`,
    [projectId, unitId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    askedAt: r.created_at.toISOString(),
    request: r.question,
    status: r.status,
    message: r.message,
    unit: r.unit_id ? { id: r.unit_id, name: r.unit_name ?? "" } : null,
    metric: r.metric,
    from: r.from_at,
    to: r.to_at,
    candidates: r.candidates,
    episodes: r.episodes,
  }));
}

/** One investigation as the journal kept it, shaped like the last line of its stream. Null when the project has none by that id. */
export async function readInvestigation(db: DbClient, projectId: string, id: string) {
  const { rows } = await db.query<{
    id: string;
    created_at: Date;
    question: string;
    status: string;
    answer: unknown;
    steps: unknown;
    struck: unknown;
    verified: boolean;
    message: string | null;
    model: string;
    usage: unknown;
  }>(
    `SELECT id, created_at, question, status, answer, steps, struck, verified, message, model, usage
       FROM app.analyst_exchange
      WHERE id = $1 AND project_id = $2 AND kind = 'investigation'`,
    [id, projectId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    exchangeId: r.id,
    askedAt: r.created_at.toISOString(),
    request: r.question,
    result: { status: r.status, answer: r.answer, verified: r.verified, struck: r.struck, steps: r.steps, message: r.message, model: r.model, usage: r.usage },
  };
}
