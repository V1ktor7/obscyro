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
import { SIM_ROLES, isInUse, type SimRole } from "./property-schema.js";

export type Agg = "count" | "sum" | "mean" | "min" | "max";

export interface MetricFilter {
  property: string;
  /** Compared case-insensitively against the property rendered as text. */
  equals: string;
}

export interface MetricSelector {
  /** Object type name to keep. Null counts every instance in the subtree. */
  ofType?: string | null;
  /**
   * Declared role to keep, which is how a metric counts capacity without
   * knowing its name. `ofType: "Bed"` is one institution's vocabulary;
   * `ofRole: "space"` is a question every institution has already answered on
   * its own types.
   */
  ofRole?: SimRole | null;
  where?: MetricFilter[];
  /**
   * Keep only units of capacity that are already spoken for.
   *
   * The alternative was `where: [{ property: "status", equals: "occupied" }]`,
   * which is the same preset one level down: it hands a null to anyone who
   * writes `occupé`, or stores it under `etat`. The test lives in
   * `property-schema` and is the one the exporter uses, so a bed cannot be
   * occupied for the simulation and free on the map.
   */
  inUse?: boolean;
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
  /**
   * The property saying what the number is about.
   *
   * Eight air quality stations, one reading 7 and the others 14. That is a real
   * spatial difference — and the 7 is an index driven by fine particles while
   * the 14s are driven by ozone. Comparable as indices; not the same thing to
   * do about them, because particles and ozone reach different patients.
   *
   * Not a second metric: a property of the instances this one already reads,
   * named by the institution in its own vocabulary. Nothing here knows what a
   * pollutant is.
   */
  qualifiedBy?: string | null;
}

/** The shape the roll-up already has on hand for every instance in a subtree. */
export interface MetricInstance {
  typeName: string;
  /** Declared on the type. Null for types that play no part in a run. */
  simRole?: SimRole | null;
  properties: Record<string, unknown>;
}

function matches(inst: MetricInstance, sel: MetricSelector): boolean {
  if (sel.ofType && inst.typeName !== sel.ofType) return false;
  if (sel.ofRole && (inst.simRole ?? null) !== sel.ofRole) return false;
  if (sel.inUse && !isInUse(inst.properties)) return false;
  for (const f of sel.where ?? []) {
    const raw = inst.properties[f.property];
    if (raw === undefined || raw === null) return false;
    if (String(raw).trim().toLowerCase() !== f.equals.trim().toLowerCase()) return false;
  }
  return true;
}

/**
 * Is this instance one of the things the metric reads?
 *
 * Not the same question as "did the metric produce a number". A `count`
 * answers 0 over an empty match — a real answer, and the right one — so a
 * non-null result proves nothing about whether the instance was ever looked
 * at. Anything deciding *whether a metric applies here* has to ask about the
 * selector, not about its output.
 */
export function metricReads(def: MetricDef, inst: MetricInstance): boolean {
  if (matches(inst, def.numerator)) return true;
  return def.denominator ? matches(inst, def.denominator) : false;
}

/**
 * One instance's value for a numeric property, or null when it has none.
 *
 * `Number(null)` is 0, and 0 is finite. Without this an emergency room that did
 * not report for an hour, or a station that was offline, was summed as a real
 * zero — a ward with nobody in it, which is the one reading a missing one must
 * never become. Shared with `qualifiersOf` so the number and the label saying
 * what it is about cannot come from different instances.
 */
function numberAt(inst: MetricInstance, property: string): number | null {
  const raw = inst.properties[property];
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
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
    const v = numberAt(inst, prop);
    if (v !== null) nums.push(v);
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

/**
 * What the number is about, read off the instances that made it.
 *
 * An extremum has one author: a `max` is one station's reading, and labelling
 * it with every pollutant in the neighbourhood would name one that had nothing
 * to do with it. A sum or a count is made of all of them, so all of them
 * qualify it. The rule follows what the aggregate actually did.
 */
export function qualifiersOf(
  def: MetricDef,
  instances: readonly MetricInstance[],
): string[] {
  const prop = (def.qualifiedBy ?? "").trim();
  if (!prop) return [];
  const kept = instances.filter((i) => matches(i, def.numerator));
  const label = (inst: MetricInstance): string | null => {
    const raw = inst.properties[prop];
    if (raw === null || raw === undefined) return null;
    const v = String(raw).trim();
    return v === "" ? null : v;
  };

  const agg = def.numerator.agg;
  const on = def.numerator.property;
  if ((agg === "max" || agg === "min") && on) {
    let best: { value: number; inst: MetricInstance } | null = null;
    for (const inst of kept) {
      const v = numberAt(inst, on);
      if (v === null) continue;
      // Strictly better, so a tie keeps the first — the order the aggregate
      // saw them in.
      if (!best || (agg === "max" ? v > best.value : v < best.value)) {
        best = { value: v, inst };
      }
    }
    const one = best ? label(best.inst) : null;
    return one ? [one] : [];
  }

  const seen = new Set<string>();
  for (const inst of kept) {
    const v = label(inst);
    if (v) seen.add(v);
  }
  return Array.from(seen).sort();
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
    // A misspelt role silently matches nothing, and a metric that reads null
    // everywhere looks like missing data rather than a typo.
    if (sel.ofRole && !SIM_ROLES.includes(sel.ofRole)) {
      issues.push({
        field,
        message: `"${sel.ofRole}" is not a role. Declared roles are ${SIM_ROLES.join(", ")}.`,
      });
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
  qualified_by: string | null;
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
    qualifiedBy: r.qualified_by,
    active: r.active,
  };
}

const M_SELECT = `
  SELECT id, organization_id, key, label, object_type, unit, numerator, denominator,
         qualified_by, active
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
            (organization_id, key, label, object_type, unit, numerator, denominator, qualified_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
     ON CONFLICT (organization_id, key) DO UPDATE
        SET label = EXCLUDED.label, object_type = EXCLUDED.object_type,
            unit = EXCLUDED.unit, numerator = EXCLUDED.numerator,
            denominator = EXCLUDED.denominator, qualified_by = EXCLUDED.qualified_by,
            active = TRUE, updated_at = NOW()
     RETURNING id, organization_id, key, label, object_type, unit, numerator, denominator,
               qualified_by, active`,
    [
      organizationId,
      def.key.trim(),
      def.label.trim(),
      def.objectType.trim(),
      def.unit,
      JSON.stringify(def.numerator),
      def.denominator ? JSON.stringify(def.denominator) : null,
      (def.qualifiedBy ?? "").trim() || null,
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

/**
 * The metric an institution gets before it has declared one.
 *
 * It used to name a type called `Bed` and a status reading `occupied`, which is
 * exactly the failure this file's own header describes: a network that models
 * `LitSantePhysique` with a status of `libre` matched neither half and every
 * one of its 190 sites reported null. The seed was reintroducing the preset the
 * rest of the file exists to remove.
 *
 * It now asks the two questions the ontology has already answered — which types
 * play the part of capacity, and which units of it are spoken for — and names
 * nothing. A transit authority whose `Quai` is declared `space` gets platform
 * occupancy from the same definition, without a line of code knowing the word.
 */
export const DEFAULT_OCCUPANCY: MetricDef = {
  key: "occupancy",
  label: "Occupancy",
  objectType: "OrgUnit",
  unit: "percent",
  numerator: { ofRole: "space", inUse: true, agg: "count" },
  denominator: { ofRole: "space", agg: "count" },
};
