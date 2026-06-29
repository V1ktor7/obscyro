import type { DbClient } from "../lib/db.js";
import { BadRequest, NotFound } from "../lib/errors.js";
import { withTransaction } from "../lib/transaction.js";

export interface MetricsSnapshot {
  computedAt: string;
  totalInstances: number;
  byType: Array<{
    typeName: string;
    count: number;
    freshnessSeconds: number | null;
    newestUpdatedAt: string | null;
  }>;
  occupancy: Array<{
    typeName: string;
    property: string;
    value: string;
    count: number;
  }>;
}

export interface ScoreBand {
  max: number;
  score: number;
}

export interface ScoreRule {
  key: string;
  bands: ScoreBand[];
}

export interface ScoreSpec {
  rules: ScoreRule[];
}

export interface InstanceScore {
  instanceId: string;
  typeName: string;
  total: number;
  breakdown: Record<string, number>;
}

/**
 * Build a parameterized `properties ->> key = value` filter fragment matching
 * {@link listInstancesForEnv} semantics. Returns the SQL suffix plus the params
 * to append, starting after `$1` (the environment id).
 */
function buildWhereFragment(
  wherePairs: Array<[string, string]> | undefined,
  startIndex: number,
): { sql: string; params: unknown[] } {
  if (!wherePairs?.length) return { sql: "", params: [] };
  const params: unknown[] = [];
  let sql = "";
  let idx = startIndex;
  for (const [key, value] of wherePairs) {
    params.push(key);
    const keyParam = idx++;
    params.push(value);
    const valueParam = idx++;
    sql += ` AND oi.properties ->> $${keyParam} = $${valueParam}`;
  }
  return { sql, params };
}

/**
 * Live operational metrics computed entirely in SQL so it scales past the old
 * 10k in-memory cap. Output shape is identical to the previous implementation:
 * per-type counts/freshness plus status occupancy buckets.
 */
export async function computeMetrics(
  db: DbClient,
  environmentId: string,
  wherePairs?: Array<[string, string]>,
): Promise<MetricsSnapshot> {
  const where = buildWhereFragment(wherePairs, 2);

  const { rows: typeRows } = await db.query<{
    type_name: string;
    count: string;
    newest: Date | null;
  }>(
    `SELECT t.name AS type_name,
            COUNT(*)::text AS count,
            MAX(oi.updated_at) AS newest
       FROM app.ontology_object_instances oi
       JOIN app.ontology_object_types t ON t.id = oi.object_type_id
      WHERE t.environment_id = $1${where.sql}
      GROUP BY t.name
      ORDER BY COUNT(*) DESC`,
    [environmentId, ...where.params],
  );

  const now = Date.now();
  let totalInstances = 0;
  const byType = typeRows.map((r) => {
    const count = Number(r.count);
    totalInstances += count;
    const newest = r.newest ? new Date(r.newest) : null;
    return {
      typeName: r.type_name,
      count,
      newestUpdatedAt: newest?.toISOString() ?? null,
      freshnessSeconds: newest ? Math.round((now - newest.getTime()) / 1000) : null,
    };
  });

  const { rows: occRows } = await db.query<{
    type_name: string;
    value: string;
    count: string;
  }>(
    `SELECT t.name AS type_name,
            COALESCE(oi.properties ->> 'status', oi.properties ->> 'occupancy_status') AS value,
            COUNT(*)::text AS count
       FROM app.ontology_object_instances oi
       JOIN app.ontology_object_types t ON t.id = oi.object_type_id
      WHERE t.environment_id = $1${where.sql}
        AND COALESCE(oi.properties ->> 'status', oi.properties ->> 'occupancy_status') IS NOT NULL
      GROUP BY t.name, value
      ORDER BY t.name, value`,
    [environmentId, ...where.params],
  );

  const occupancy = occRows.map((r) => ({
    typeName: r.type_name,
    property: "status",
    value: r.value,
    count: Number(r.count),
  }));

  return {
    computedAt: new Date().toISOString(),
    totalInstances,
    byType,
    occupancy,
  };
}

function scoreFromBands(value: number, bands: ScoreBand[]): number {
  const sorted = [...bands].sort((a, b) => a.max - b.max);
  for (const band of sorted) {
    if (value <= band.max) return band.score;
  }
  return sorted[sorted.length - 1]?.score ?? 0;
}

export async function scoreInstance(
  db: DbClient,
  environmentId: string,
  instanceId: string,
  spec: ScoreSpec,
): Promise<InstanceScore> {
  const { rows } = await db.query<{
    id: string;
    type_name: string;
    properties: Record<string, unknown>;
  }>(
    `SELECT oi.id, t.name AS type_name, oi.properties
       FROM app.ontology_object_instances oi
       JOIN app.ontology_object_types t ON t.id = oi.object_type_id
      WHERE t.environment_id = $1 AND oi.id = $2`,
    [environmentId, instanceId],
  );
  const row = rows[0];
  if (!row) throw NotFound("OBJECT_NOT_FOUND", "Instance not found in this environment.");

  const breakdown: Record<string, number> = {};
  let total = 0;
  for (const rule of spec.rules) {
    const raw = row.properties[rule.key];
    const num = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(num)) continue;
    const pts = scoreFromBands(num, rule.bands);
    breakdown[rule.key] = pts;
    total += pts;
  }

  return {
    instanceId: row.id,
    typeName: row.type_name,
    total,
    breakdown,
  };
}

export interface ScoreSpecRecord {
  id: string;
  name: string;
  spec: ScoreSpec;
  isDefault: boolean;
  createdAt: string;
}

function isScoreSpec(value: unknown): value is ScoreSpec {
  if (!value || typeof value !== "object") return false;
  const rules = (value as { rules?: unknown }).rules;
  if (!Array.isArray(rules)) return false;
  return rules.every(
    (r) =>
      r &&
      typeof r === "object" &&
      typeof (r as { key?: unknown }).key === "string" &&
      Array.isArray((r as { bands?: unknown }).bands),
  );
}

/** List the persisted score specs for an environment. */
export async function listScoreSpecs(
  db: DbClient,
  environmentId: string,
): Promise<ScoreSpecRecord[]> {
  const { rows } = await db.query<{
    id: string;
    name: string;
    spec: ScoreSpec;
    is_default: boolean;
    created_at: Date;
  }>(
    `SELECT id, name, spec, is_default, created_at
       FROM app.metric_definition
      WHERE environment_id = $1 AND kind = 'score'
      ORDER BY is_default DESC, name ASC`,
    [environmentId],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    spec: r.spec,
    isDefault: r.is_default,
    createdAt: r.created_at.toISOString(),
  }));
}

/**
 * Create or update a named per-environment score spec. When `isDefault` is set,
 * it atomically becomes the single default for the environment.
 */
export async function upsertScoreSpec(
  db: DbClient,
  environmentId: string,
  userId: string,
  organizationId: string,
  input: { name: string; spec: ScoreSpec; isDefault?: boolean },
): Promise<ScoreSpecRecord> {
  if (!isScoreSpec(input.spec)) {
    throw BadRequest("INVALID_SCORE_SPEC", "Score spec must have a rules[] array of { key, bands }.");
  }
  return withTransaction(async (tx) => {
    if (input.isDefault) {
      await tx.query(
        `UPDATE app.metric_definition SET is_default = FALSE
          WHERE environment_id = $1 AND kind = 'score' AND name <> $2`,
        [environmentId, input.name],
      );
    }
    const { rows } = await tx.query<{
      id: string;
      name: string;
      spec: ScoreSpec;
      is_default: boolean;
      created_at: Date;
    }>(
      `INSERT INTO app.metric_definition
         (environment_id, name, kind, spec, is_default, owner_user_id, organization_id)
       VALUES ($1, $2, 'score', $3::jsonb, $4, $5, $6)
       ON CONFLICT (environment_id, name)
       DO UPDATE SET spec = EXCLUDED.spec, is_default = EXCLUDED.is_default
       RETURNING id, name, spec, is_default, created_at`,
      [
        environmentId,
        input.name,
        JSON.stringify(input.spec),
        input.isDefault ?? false,
        userId,
        organizationId,
      ],
    );
    const r = rows[0]!;
    return {
      id: r.id,
      name: r.name,
      spec: r.spec,
      isDefault: r.is_default,
      createdAt: r.created_at.toISOString(),
    };
  });
}

export async function deleteScoreSpec(
  db: DbClient,
  environmentId: string,
  name: string,
): Promise<void> {
  const { rowCount } = await db.query(
    `DELETE FROM app.metric_definition
      WHERE environment_id = $1 AND kind = 'score' AND name = $2`,
    [environmentId, name],
  );
  if (!rowCount) throw NotFound("SCORE_SPEC_NOT_FOUND", "Score spec not found.");
}

/**
 * Resolve the score spec to apply: an explicitly named spec, else the
 * environment default, else the built-in NEWS2 demo spec.
 */
export async function resolveScoreSpec(
  db: DbClient,
  environmentId: string,
  definition?: string,
): Promise<ScoreSpec> {
  if (definition) {
    const { rows } = await db.query<{ spec: ScoreSpec }>(
      `SELECT spec FROM app.metric_definition
        WHERE environment_id = $1 AND name = $2 AND kind = 'score'`,
      [environmentId, definition],
    );
    if (!rows[0]) {
      throw NotFound("SCORE_SPEC_NOT_FOUND", `Score spec "${definition}" not found.`);
    }
    return rows[0].spec;
  }
  const { rows } = await db.query<{ spec: ScoreSpec }>(
    `SELECT spec FROM app.metric_definition
      WHERE environment_id = $1 AND kind = 'score' AND is_default
      LIMIT 1`,
    [environmentId],
  );
  return rows[0]?.spec ?? DEFAULT_SCORE_SPEC;
}

/** Default NEWS2-style spec for respiratory rate + SpO2 demo scoring. */
export const DEFAULT_SCORE_SPEC: ScoreSpec = {
  rules: [
    {
      key: "respiratory_rate",
      bands: [
        { max: 8, score: 3 },
        { max: 11, score: 1 },
        { max: 20, score: 0 },
        { max: 24, score: 2 },
        { max: 999, score: 3 },
      ],
    },
    {
      key: "spo2",
      bands: [
        { max: 91, score: 3 },
        { max: 93, score: 2 },
        { max: 95, score: 1 },
        { max: 100, score: 0 },
      ],
    },
  ],
};
