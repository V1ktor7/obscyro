import type { DbClient } from "../lib/db.js";
import { NotFound } from "../lib/errors.js";
import { listInstancesForEnv, type EnvInstanceRow } from "./ontology.js";

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

export async function computeMetrics(
  db: DbClient,
  environmentId: string,
  wherePairs?: Array<[string, string]>,
): Promise<MetricsSnapshot> {
  const instances = await listInstancesForEnv(db, environmentId, {
    wherePairs,
    limit: 10_000,
  });
  const now = Date.now();
  const byTypeMap = new Map<
    string,
    { count: number; newest: Date | null }
  >();

  for (const inst of instances) {
    const cur = byTypeMap.get(inst.typeName) ?? { count: 0, newest: null };
    cur.count++;
    if (!cur.newest || inst.updatedAt > cur.newest) cur.newest = inst.updatedAt;
    byTypeMap.set(inst.typeName, cur);
  }

  const byType = [...byTypeMap.entries()].map(([typeName, v]) => ({
    typeName,
    count: v.count,
    newestUpdatedAt: v.newest?.toISOString() ?? null,
    freshnessSeconds: v.newest
      ? Math.round((now - v.newest.getTime()) / 1000)
      : null,
  }));

  const occupancy = computeOccupancy(instances);

  return {
    computedAt: new Date().toISOString(),
    totalInstances: instances.length,
    byType,
    occupancy,
  };
}

function computeOccupancy(
  instances: EnvInstanceRow[],
): MetricsSnapshot["occupancy"] {
  const counts = new Map<string, number>();
  for (const inst of instances) {
    const status = inst.properties.status ?? inst.properties.occupancy_status;
    if (status == null) continue;
    const value = String(status);
    const key = `${inst.typeName}\0${value}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => {
    const [typeName, value] = key.split("\0");
    return { typeName: typeName!, property: "status", value: value!, count };
  });
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
