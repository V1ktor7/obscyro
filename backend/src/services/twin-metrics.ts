/**
 * User-defined twin metrics.
 *
 * Occupancy used to be two string literals in the roll-up: count instances
 * whose type is named `Bed`, count those whose `status` property reads
 * `occupied`, divide. In a platform whose argument is that each institution
 * names its own types, that hands a `null` to anyone who models `Lit`, or
 * `Civière`, or writes `occupé`.
 *
 * A metric is instead a definition over the instances in a unit's subtree: an
 * aggregate, optionally divided by a second aggregate. That covers occupied
 * beds over total beds, admitted patients over beds, available staff, and the
 * mean of any numeric property — without the engine knowing what a bed is.
 *
 * Roll-up needs no separate pass. A parent's metric is evaluated over its whole
 * subtree, so a hospital's occupancy is its wards' occupied beds over its
 * wards' total beds — the right number by construction, rather than an average
 * of averages computed afterwards.
 */

import type { DbClient } from "../lib/db.js";
import { AppError } from "../lib/errors.js";

export type Agg = "count" | "sum" | "mean" | "min" | "max";

export interface MetricFilter {
  property: string;
  /** Compared case-insensitively against the property rendered as text. */
  equals: string;
}

export interface MetricSelector {
  /** Object type name to keep. Null counts every instance in the subtree. */
  ofType?: string | null;
  where?: MetricFilter[];
  agg: Agg;
  /** The numeric property to aggregate. Required for everything but `count`. */
  property?: string | null;
}

export type MetricUnit = "percent" | "ratio" | "count" | "number";

export interface MetricDef {
  key: string;
  label: string;
  /** The object type this metric is reported for, e.g. "OrgUnit". */
  objectType: string;
  unit: MetricUnit;
  numerator: MetricSelector;
  /** Omitted for a plain aggregate: "available staff" is a count, not a ratio. */
  denominator?: MetricSelector | null;
}

/** The shape the roll-up already has on hand for every instance in a subtree. */
export interface MetricInstance {
  typeName: string;
  properties: Record<string, unknown>;
}

function matches(inst: MetricInstance, sel: MetricSelector): boolean {
  if (sel.ofType && inst.typeName !== sel.ofType) return false;
  for (const f of sel.where ?? []) {
    const raw = inst.properties[f.property];
    if (raw === undefined || raw === null) return false;
    if (String(raw).trim().toLowerCase() !== f.equals.trim().toLowerCase()) return false;
  }
  return true;
}

/**
 * Aggregate one selector over a subtree.
 *
 * `count` returns 0 for an empty match — none is a real answer. The others
 * return null, because the mean of nothing is not zero.
 */
export function aggregate(
  instances: readonly MetricInstance[],
  sel: MetricSelector,
): number | null {
  const kept = instances.filter((i) => matches(i, sel));
  if (sel.agg === "count") return kept.length;

  const prop = sel.property;
  if (!prop) return null;
  const nums: number[] = [];
  for (const inst of kept) {
    const v = Number(inst.properties[prop]);
    if (Number.isFinite(v)) nums.push(v);
  }
  if (nums.length === 0) return null;

  switch (sel.agg) {
    case "sum":
      return nums.reduce((a, b) => a + b, 0);
    case "mean":
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case "min":
      return Math.min(...nums);
    case "max":
      return Math.max(...nums);
    default:
      return null;
  }
}

/**
 * Evaluate a metric over a unit's subtree.
 *
 * A null denominator means "no basis to compare against", which is not the same
 * as zero — a ward with no beds has no occupancy, it does not have 0%.
 */
export function evaluateMetric(
  def: MetricDef,
  instances: readonly MetricInstance[],
): number | null {
  const num = aggregate(instances, def.numerator);
  if (num === null) return null;
  if (!def.denominator) return num;

  const den = aggregate(instances, def.denominator);
  if (den === null || den === 0) return null;
  const ratio = num / den;
  return def.unit === "percent" ? ratio * 100 : ratio;
}

export interface MetricIssue {
  field: string;
  message: string;
}

/** Reject a definition that cannot produce a number before it is stored. */
export function validateMetric(def: MetricDef): MetricIssue[] {
  const issues: MetricIssue[] = [];
  if (!def.key.trim()) issues.push({ field: "key", message: "A key is required." });
  if (!def.label.trim()) issues.push({ field: "label", message: "A label is required." });
  if (!def.objectType.trim()) {
    issues.push({ field: "objectType", message: "An object type is required." });
  }

  const check = (sel: MetricSelector | null | undefined, field: string) => {
    if (!sel) return;
    if (sel.agg !== "count" && !sel.property) {
      issues.push({ field, message: `${sel.agg} needs a numeric property to aggregate.` });
    }
    for (const f of sel.where ?? []) {
      if (!f.property.trim()) {
        issues.push({ field, message: "A filter needs a property name." });
      }
    }
  };
  check(def.numerator, "numerator");
  check(def.denominator, "denominator");

  if ((def.unit === "percent" || def.unit === "ratio") && !def.denominator) {
    issues.push({
      field: "denominator",
      message: `A ${def.unit} needs something to divide by.`,
    });
  }
  return issues;
}

/**
 * The definition occupancy had when it was hard-coded.
 *
 * Seeded rather than special-cased, so an institution can rename the type,
 * change the status value, or redefine occupancy as admitted patients over
 * beds — and the twin, the alert rules and the scenarios all follow.
 */
export interface StoredMetric extends MetricDef {
  id: string;
  organizationId: string;
  active: boolean;
}

interface MetricRow {
  id: string;
  organization_id: string;
  key: string;
  label: string;
  object_type: string;
  unit: MetricUnit;
  numerator: MetricSelector;
  denominator: MetricSelector | null;
  active: boolean;
}

function toMetric(r: MetricRow): StoredMetric {
  return {
    id: r.id,
    organizationId: r.organization_id,
    key: r.key,
    label: r.label,
    objectType: r.object_type,
    unit: r.unit,
    numerator: r.numerator,
    denominator: r.denominator,
    active: r.active,
  };
}

const M_SELECT = `
  SELECT id, organization_id, key, label, object_type, unit, numerator, denominator, active
    FROM app.twin_metric`;

export async function listTwinMetrics(
  db: DbClient,
  organizationId: string,
): Promise<StoredMetric[]> {
  const { rows } = await db.query<MetricRow>(
    `${M_SELECT} WHERE organization_id = $1 AND active ORDER BY label ASC`,
    [organizationId],
  );
  return rows.map(toMetric);
}

export async function upsertTwinMetric(
  db: DbClient,
  organizationId: string,
  def: MetricDef,
): Promise<StoredMetric> {
  const issues = validateMetric(def);
  if (issues.length > 0) {
    throw new AppError("METRIC_INVALID", issues[0]!.message, 400, { issues });
  }
  const { rows } = await db.query<MetricRow>(
    `INSERT INTO app.twin_metric
            (organization_id, key, label, object_type, unit, numerator, denominator)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
     ON CONFLICT (organization_id, key) DO UPDATE
        SET label = EXCLUDED.label, object_type = EXCLUDED.object_type,
            unit = EXCLUDED.unit, numerator = EXCLUDED.numerator,
            denominator = EXCLUDED.denominator, active = TRUE, updated_at = NOW()
     RETURNING id, organization_id, key, label, object_type, unit, numerator, denominator, active`,
    [
      organizationId,
      def.key.trim(),
      def.label.trim(),
      def.objectType.trim(),
      def.unit,
      JSON.stringify(def.numerator),
      def.denominator ? JSON.stringify(def.denominator) : null,
    ],
  );
  return toMetric(rows[0]!);
}

/** Soft delete: an alert rule may still name this key, and history should read. */
export async function deactivateTwinMetric(
  db: DbClient,
  organizationId: string,
  key: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE app.twin_metric SET active = FALSE, updated_at = NOW()
      WHERE organization_id = $1 AND key = $2 AND active`,
    [organizationId, key],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Metrics for an organization, seeding the occupancy default on first read.
 *
 * Seeding here rather than in a migration means an environment that never had
 * beds does not carry a definition it cannot compute — and one that does gets
 * the number it had before this change, editable from that point on.
 */
export async function metricsForRollup(
  db: DbClient,
  organizationId: string,
): Promise<StoredMetric[]> {
  const existing = await listTwinMetrics(db, organizationId);
  if (existing.length > 0) return existing;
  const seeded = await upsertTwinMetric(db, organizationId, DEFAULT_OCCUPANCY);
  return [seeded];
}

export const DEFAULT_OCCUPANCY: MetricDef = {
  key: "occupancy",
  label: "Occupancy",
  objectType: "OrgUnit",
  unit: "percent",
  numerator: {
    ofType: "Bed",
    where: [{ property: "status", equals: "occupied" }],
    agg: "count",
  },
  denominator: { ofType: "Bed", agg: "count" },
};
