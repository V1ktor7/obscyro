import { clampLimit, clampOffset, config } from "../lib/config.js";
import type { DbClient } from "../lib/db.js";
import { NotFound } from "../lib/errors.js";
import {
  listInstancesForEnv,
  listLinksForEnv,
  type EnvInstanceRow,
  type PropertyDef,
} from "./ontology.js";

export type QualitySeverity = "info" | "warn" | "error";

export interface QualityFinding {
  layer: number;
  severity: QualitySeverity;
  code: string;
  message: string;
  value?: string;
}

export interface ScanSummary {
  byLayer: Record<string, number>;
  bySeverity: Record<string, number>;
  flagCount: number;
}

export interface MlAnomalyInput {
  instance: EnvInstanceRow;
  /** Same-type population used as the statistical baseline. */
  sameType: EnvInstanceRow[];
}

export interface AnomalyVerdict {
  isOutlier: boolean;
  /** Which detector tripped (used in the finding code/message). */
  method: "iqr" | "robust_z" | null;
  /** Robust z-score (MAD-based) for diagnostics. */
  robustZ: number;
  lowerFence: number;
  upperFence: number;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const lo = sorted[base]!;
  const hi = sorted[base + 1] ?? lo;
  return lo + (hi - lo) * rest;
}

/**
 * Pure numeric anomaly detector combining Tukey's IQR fences and a robust
 * (MAD-based) z-score. Either tripping flags the value as an outlier. Pure and
 * deterministic so it is unit-testable without a database.
 */
export function detectNumericAnomaly(
  samples: number[],
  value: number,
  opts: { iqrK: number; zThreshold: number; minSample: number },
): AnomalyVerdict {
  const clean = samples.filter((v) => Number.isFinite(v));
  const verdict: AnomalyVerdict = {
    isOutlier: false,
    method: null,
    robustZ: 0,
    lowerFence: Number.NEGATIVE_INFINITY,
    upperFence: Number.POSITIVE_INFINITY,
  };
  if (clean.length < opts.minSample || !Number.isFinite(value)) return verdict;

  const sorted = [...clean].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  verdict.lowerFence = q1 - opts.iqrK * iqr;
  verdict.upperFence = q3 + opts.iqrK * iqr;

  const med = quantile(sorted, 0.5);
  const deviations = sorted.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  const madRaw = quantile(deviations, 0.5);
  const mad = madRaw || 1e-9;
  verdict.robustZ = (0.6745 * (value - med)) / mad;

  // Require a non-degenerate spread before trusting the fences.
  if (iqr > 0 && (value < verdict.lowerFence || value > verdict.upperFence)) {
    verdict.isOutlier = true;
    verdict.method = "iqr";
  } else if (Math.abs(verdict.robustZ) > opts.zThreshold) {
    verdict.isOutlier = true;
    verdict.method = "robust_z";
  }
  return verdict;
}

/**
 * L6 statistical/ML anomaly layer. Runs each numeric property of the instance
 * against its same-type population using {@link detectNumericAnomaly}. Off when
 * `DQ_ANOMALY_ENABLED=false`.
 */
export function mlAnomalyHook(input: MlAnomalyInput): QualityFinding[] {
  if (!config.dqAnomalyEnabled) return [];
  const { instance, sameType } = input;
  const findings: QualityFinding[] = [];
  for (const prop of instance.propertySchema) {
    if (prop.type !== "number") continue;
    const value = instance.properties[prop.key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const samples = sameType
      .map((i) => i.properties[prop.key])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const verdict = detectNumericAnomaly(samples, value, {
      iqrK: config.dqIqrK,
      zThreshold: config.dqZScoreThreshold,
      minSample: config.dqAnomalyMinSample,
    });
    if (!verdict.isOutlier) continue;
    const bounds =
      verdict.method === "iqr"
        ? `outside IQR fence [${verdict.lowerFence.toFixed(2)}, ${verdict.upperFence.toFixed(2)}]`
        : `robust z=${verdict.robustZ.toFixed(2)}`;
    findings.push({
      layer: 6,
      severity: "warn",
      code: "ML_ANOMALY",
      message: `${prop.key} is anomalous vs. ${prop.key} population (${bounds})`,
      value: String(value),
    });
  }
  return findings;
}

const SNOMED_KEYS = new Set(["snomed_code", "code"]);
const DEFAULT_NUMERIC_BOUNDS: Record<string, { min?: number; max?: number }> = {
  confidence: { min: 0, max: 1 },
  respiratory_rate: { min: 0, max: 80 },
  spo2: { min: 0, max: 100 },
  heart_rate: { min: 0, max: 300 },
};

const ORDERING_RULES: Array<{ before: string; after: string; code: string }> = [
  { before: "admit_date", after: "discharge_date", code: "DATE_ORDER" },
  { before: "admitted_at", after: "discharged_at", code: "DATE_ORDER" },
];

async function snomedExists(db: DbClient, code: string): Promise<boolean> {
  const num = code.replace(/\D/g, "");
  if (!num) return false;
  const { rows } = await db.query<{ ok: number }>(
    `SELECT 1 AS ok FROM snomed.concepts WHERE id = $1::bigint AND active = true LIMIT 1`,
    [num],
  );
  return rows.length > 0;
}

function matchesSchemaType(value: unknown, type: PropertyDef["type"]): boolean {
  if (value === null || value === undefined) return true;
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return typeof value === "object" && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    default:
      return true;
  }
}

function validateL1(
  inst: EnvInstanceRow,
  db: DbClient,
  findings: QualityFinding[],
): Promise<void> {
  return (async () => {
    for (const prop of inst.propertySchema) {
      const val = inst.properties[prop.key];
      if (val === undefined || val === null) continue;
      if (!matchesSchemaType(val, prop.type)) {
        findings.push({
          layer: 1,
          severity: "error",
          code: "TYPE_MISMATCH",
          message: `Property "${prop.key}" expected ${prop.type}`,
          value: String(val),
        });
      }
    }
    for (const key of SNOMED_KEYS) {
      const val = inst.properties[key];
      if (val == null || val === "") continue;
      const code = String(val);
      const ok = await snomedExists(db, code);
      if (!ok) {
        findings.push({
          layer: 1,
          severity: "error",
          code: "SNOMED_NOT_FOUND",
          message: `SNOMED code "${code}" not found in concept table`,
          value: code,
        });
      }
    }
  })();
}

function validateL2(inst: EnvInstanceRow, findings: QualityFinding[]): void {
  for (const [key, val] of Object.entries(inst.properties)) {
    if (val === null || val === undefined) continue;
    const bounds = DEFAULT_NUMERIC_BOUNDS[key];
    if (typeof val === "number" && bounds) {
      if (bounds.min != null && val < bounds.min) {
        findings.push({
          layer: 2,
          severity: "warn",
          code: "OUT_OF_RANGE",
          message: `${key} below minimum ${bounds.min}`,
          value: String(val),
        });
      }
      if (bounds.max != null && val > bounds.max) {
        findings.push({
          layer: 2,
          severity: "warn",
          code: "OUT_OF_RANGE",
          message: `${key} above maximum ${bounds.max}`,
          value: String(val),
        });
      }
    }
    if (typeof val === "number" && val < 0 && !key.includes("delta")) {
      findings.push({
        layer: 2,
        severity: "warn",
        code: "NEGATIVE_VALUE",
        message: `${key} must be non-negative`,
        value: String(val),
      });
    }
    if (
      (key.endsWith("_date") || key.endsWith("_at")) &&
      typeof val === "string" &&
      val.length > 0 &&
      Number.isNaN(Date.parse(val))
    ) {
      findings.push({
        layer: 2,
        severity: "error",
        code: "INVALID_DATE",
        message: `${key} is not a valid date`,
        value: val,
      });
    }
  }
}

function validateL3(
  inst: EnvInstanceRow,
  linkCount: number,
  findings: QualityFinding[],
): void {
  for (const rule of ORDERING_RULES) {
    const a = inst.properties[rule.before];
    const b = inst.properties[rule.after];
    if (a == null || b == null) continue;
    const da = Date.parse(String(a));
    const db = Date.parse(String(b));
    if (!Number.isNaN(da) && !Number.isNaN(db) && db < da) {
      findings.push({
        layer: 3,
        severity: "error",
        code: rule.code,
        message: `${rule.after} must be on or after ${rule.before}`,
        value: `${a} / ${b}`,
      });
    }
  }
  const requiresLink = inst.typeName === "ClinicalFinding";
  if (requiresLink && linkCount === 0) {
    findings.push({
      layer: 3,
      severity: "warn",
      code: "ORPHAN_INSTANCE",
      message: `${inst.typeName} has no links`,
    });
  }
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function mad(values: number[], med: number): number {
  if (!values.length) return 0;
  const deviations = values.map((v) => Math.abs(v - med));
  return median(deviations) || 1e-9;
}

function validateL4(
  inst: EnvInstanceRow,
  allOfType: EnvInstanceRow[],
  findings: QualityFinding[],
): void {
  for (const prop of inst.propertySchema) {
    if (prop.type !== "number") continue;
    const values = allOfType
      .map((i) => i.properties[prop.key])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (values.length < 5) continue;
    const med = median(values);
    const m = mad(values, med);
    const val = inst.properties[prop.key];
    if (typeof val !== "number") continue;
    const z = (0.6745 * (val - med)) / m;
    if (Math.abs(z) > 3.5) {
      findings.push({
        layer: 4,
        severity: "info",
        code: "STATISTICAL_OUTLIER",
        message: `${prop.key} is a statistical outlier (robust z=${z.toFixed(2)})`,
        value: String(val),
      });
    }
  }
}

function validateL5(
  inst: EnvInstanceRow,
  allOfType: EnvInstanceRow[],
  findings: QualityFinding[],
): void {
  const source = String(inst.provenance?.source ?? "unknown");
  const sameSource = allOfType.filter(
    (i) => String(i.provenance?.source ?? "unknown") === source,
  );
  if (sameSource.length >= 3) {
    const ages = sameSource.map((i) => Date.now() - i.updatedAt.getTime());
    const maxAge = Math.max(...ages);
    if (maxAge > 7 * 24 * 3600 * 1000) {
      findings.push({
        layer: 5,
        severity: "info",
        code: "STALE_SOURCE",
        message: `Source "${source}" has instances older than 7 days`,
      });
    }
  }

  const propStr = JSON.stringify(inst.properties);
  const streak = allOfType.filter((i) => JSON.stringify(i.properties) === propStr);
  if (streak.length >= 3 && streak.some((s) => s.id === inst.id)) {
    findings.push({
      layer: 5,
      severity: "warn",
      code: "FLATLINE_STREAK",
      message: "Identical properties repeated across instances",
      value: propStr.slice(0, 120),
    });
  }
}

export async function validateInstanceLayers(
  db: DbClient,
  inst: EnvInstanceRow,
  allInstances: EnvInstanceRow[],
  linkCounts: Map<string, number>,
  maxLayer = 5,
): Promise<QualityFinding[]> {
  const findings: QualityFinding[] = [];
  if (maxLayer >= 1) await validateL1(inst, db, findings);
  if (maxLayer >= 2) validateL2(inst, findings);
  if (maxLayer >= 3) {
    validateL3(inst, linkCounts.get(inst.id) ?? 0, findings);
  }
  if (maxLayer >= 4) {
    const sameType = allInstances.filter((i) => i.typeName === inst.typeName);
    validateL4(inst, sameType, findings);
  }
  if (maxLayer >= 5) {
    const sameType = allInstances.filter((i) => i.typeName === inst.typeName);
    validateL5(inst, sameType, findings);
  }
  if (maxLayer >= 6) {
    const sameType = allInstances.filter((i) => i.typeName === inst.typeName);
    findings.push(...mlAnomalyHook({ instance: inst, sameType }));
  }
  return findings;
}

export async function upsertFlag(
  db: DbClient,
  environmentId: string,
  instanceId: string,
  finding: QualityFinding,
): Promise<void> {
  // Durable lifecycle: if a human already reviewed/dismissed this exact
  // (instance, layer, code), do not re-open it on the next scan. Re-detected
  // open findings are refreshed in place via the partial unique index.
  await db.query(
    `INSERT INTO app.data_quality_flag
       (environment_id, instance_id, layer, severity, code, message, observed_value, status)
     SELECT $1, $2, $3, $4, $5, $6, $7, 'open'
      WHERE NOT EXISTS (
        SELECT 1 FROM app.data_quality_flag
         WHERE instance_id = $2 AND layer = $3 AND code = $5
           AND status IN ('reviewed', 'dismissed')
      )
     ON CONFLICT (instance_id, layer, code) WHERE status = 'open'
     DO UPDATE SET severity = EXCLUDED.severity,
                   message = EXCLUDED.message,
                   observed_value = EXCLUDED.observed_value,
                   created_at = NOW()`,
    [
      environmentId,
      instanceId,
      finding.layer,
      finding.severity,
      finding.code,
      finding.message,
      finding.value ?? null,
    ],
  );
}

interface ScanState {
  lastScannedAt: Date;
  lastFullAt: Date | null;
}

async function getScanState(db: DbClient, environmentId: string): Promise<ScanState> {
  const { rows } = await db.query<{ last_scanned_at: Date; last_full_at: Date | null }>(
    `SELECT last_scanned_at, last_full_at
       FROM app.data_quality_scan_state WHERE environment_id = $1`,
    [environmentId],
  );
  return {
    lastScannedAt: rows[0]?.last_scanned_at ?? new Date(0),
    lastFullAt: rows[0]?.last_full_at ?? null,
  };
}

async function recordScanState(
  db: DbClient,
  environmentId: string,
  highWater: Date,
  wasFull: boolean,
): Promise<void> {
  await db.query(
    `INSERT INTO app.data_quality_scan_state (environment_id, last_scanned_at, last_full_at, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (environment_id)
     DO UPDATE SET last_scanned_at = GREATEST(app.data_quality_scan_state.last_scanned_at, EXCLUDED.last_scanned_at),
                   last_full_at = COALESCE(EXCLUDED.last_full_at, app.data_quality_scan_state.last_full_at),
                   updated_at = NOW()`,
    [environmentId, highWater, wasFull ? highWater : null],
  );
}

export interface ScanResult {
  findings: QualityFinding[];
  summary: ScanSummary;
  /** Instances actually evaluated this pass (full population when not incremental). */
  scannedCount: number;
  incremental: boolean;
}

export async function scanEnvironment(
  db: DbClient,
  environmentId: string,
  opts?: {
    wherePairs?: Array<[string, string]>;
    maxLayer?: number;
    incremental?: boolean;
  },
): Promise<ScanResult> {
  // Full population is always loaded so statistical layers (L4–L6) have a stable
  // baseline; when incremental we only EMIT flags for instances changed since the
  // last scan, which keeps re-scans cheap on large, mostly-static environments.
  const instances = await listInstancesForEnv(db, environmentId, {
    wherePairs: opts?.wherePairs,
    limit: config.rollupInstanceCap,
  });
  const links = await listLinksForEnv(db, environmentId);
  const linkCounts = new Map<string, number>();
  for (const l of links) {
    linkCounts.set(l.fromInstanceId, (linkCounts.get(l.fromInstanceId) ?? 0) + 1);
    linkCounts.set(l.toInstanceId, (linkCounts.get(l.toInstanceId) ?? 0) + 1);
  }

  const incremental = opts?.incremental ?? false;
  const state = incremental ? await getScanState(db, environmentId) : null;
  const targets = state
    ? instances.filter((i) => i.updatedAt > state.lastScannedAt)
    : instances;

  const allFindings: QualityFinding[] = [];
  const maxLayer = opts?.maxLayer ?? (config.dqAnomalyEnabled ? 6 : 5);

  for (const inst of targets) {
    const findings = await validateInstanceLayers(
      db,
      inst,
      instances,
      linkCounts,
      maxLayer,
    );
    for (const f of findings) {
      await upsertFlag(db, environmentId, inst.id, f);
      allFindings.push(f);
    }
  }

  // Advance the high-water mark to the newest instance we saw so the next
  // incremental scan can skip everything up to here.
  const highWater = instances.reduce<Date>(
    (max, i) => (i.updatedAt > max ? i.updatedAt : max),
    state?.lastScannedAt ?? new Date(0),
  );
  if (instances.length > 0) {
    await recordScanState(db, environmentId, highWater, !incremental);
  }

  const summary: ScanSummary = {
    byLayer: {},
    bySeverity: {},
    flagCount: allFindings.length,
  };
  for (const f of allFindings) {
    summary.byLayer[String(f.layer)] = (summary.byLayer[String(f.layer)] ?? 0) + 1;
    summary.bySeverity[f.severity] = (summary.bySeverity[f.severity] ?? 0) + 1;
  }

  return { findings: allFindings, summary, scannedCount: targets.length, incremental };
}

/** L1–L3 only — for optional write-path hook. */
export async function scanInstanceOnWrite(
  db: DbClient,
  environmentId: string,
  instanceId: string,
): Promise<void> {
  const instances = await listInstancesForEnv(db, environmentId, {
    limit: config.rollupInstanceCap,
  });
  const inst = instances.find((i) => i.id === instanceId);
  if (!inst) return;
  const links = await listLinksForEnv(db, environmentId);
  const linkCounts = new Map<string, number>();
  for (const l of links) {
    linkCounts.set(l.fromInstanceId, (linkCounts.get(l.fromInstanceId) ?? 0) + 1);
    linkCounts.set(l.toInstanceId, (linkCounts.get(l.toInstanceId) ?? 0) + 1);
  }
  const findings = await validateInstanceLayers(db, inst, instances, linkCounts, 3);
  for (const f of findings) {
    await upsertFlag(db, environmentId, instanceId, f);
  }
}

export async function updateFlagStatus(
  db: DbClient,
  environmentId: string,
  flagId: string,
  status: "open" | "reviewed" | "dismissed",
): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE app.data_quality_flag SET status = $3 WHERE id = $1 AND environment_id = $2`,
    [flagId, environmentId, status],
  );
  if (!rowCount) {
    throw NotFound("FLAG_NOT_FOUND", "Quality flag not found.");
  }
}

export type FlagStatus = "open" | "reviewed" | "dismissed";

export async function listFlags(
  db: DbClient,
  environmentId: string,
  opts?: {
    status?: string;
    layer?: number;
    severity?: QualitySeverity;
    limit?: number;
    offset?: number;
  },
): Promise<
  Array<{
    id: string;
    instanceId: string;
    layer: number;
    severity: QualitySeverity;
    code: string;
    message: string;
    observedValue: string | null;
    status: FlagStatus;
    createdAt: string;
  }>
> {
  const params: unknown[] = [environmentId];
  let sql = `SELECT id, instance_id, layer, severity, code, message, observed_value, status, created_at
               FROM app.data_quality_flag
              WHERE environment_id = $1`;
  if (opts?.status) {
    params.push(opts.status);
    sql += ` AND status = $${params.length}`;
  }
  if (opts?.layer != null) {
    params.push(opts.layer);
    sql += ` AND layer = $${params.length}`;
  }
  if (opts?.severity) {
    params.push(opts.severity);
    sql += ` AND severity = $${params.length}`;
  }
  const limit = clampLimit(opts?.limit);
  const offset = clampOffset(opts?.offset);
  params.push(limit);
  sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
  params.push(offset);
  sql += ` OFFSET $${params.length}`;

  const { rows } = await db.query<{
    id: string;
    instance_id: string;
    layer: number;
    severity: QualitySeverity;
    code: string;
    message: string;
    observed_value: string | null;
    status: FlagStatus;
    created_at: Date;
  }>(sql, params);

  return rows.map((r) => ({
    id: r.id,
    instanceId: r.instance_id,
    layer: r.layer,
    severity: r.severity,
    code: r.code,
    message: r.message,
    observedValue: r.observed_value,
    status: r.status,
    createdAt: r.created_at.toISOString(),
  }));
}
