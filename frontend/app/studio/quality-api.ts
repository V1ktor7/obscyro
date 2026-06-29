import { apiFetch } from "@/lib/auth";

export type QualitySeverity = "info" | "warn" | "error";
export type FlagStatus = "open" | "reviewed" | "dismissed";

export interface QualityFlag {
  id: string;
  instanceId: string;
  layer: number;
  severity: QualitySeverity;
  code: string;
  message: string;
  observedValue: string | null;
  status: FlagStatus;
  createdAt: string;
}

export interface ScanSummary {
  byLayer: Record<string, number>;
  bySeverity: Record<string, number>;
  flagCount: number;
}

export interface LayerMeta {
  layer: number;
  label: string;
  description: string;
  disabled?: boolean;
}

export const LAYER_META: LayerMeta[] = [
  { layer: 1, label: "Format / type", description: "Schema type match, SNOMED validity" },
  { layer: 2, label: "Range / rule", description: "Numeric bounds, dates, non-negative values" },
  { layer: 3, label: "Cross-field / referential", description: "Date ordering, orphan detection" },
  { layer: 4, label: "Statistical", description: "Robust z-score outliers per type" },
  { layer: 5, label: "Temporal", description: "Source freshness, flatline streaks" },
  { layer: 6, label: "ML anomaly", description: "IQR + robust z-score numeric outliers" },
];

function enc(env: string): string {
  return encodeURIComponent(env);
}

export async function runQualityScan(
  env: string,
  where?: string,
  opts?: { incremental?: boolean },
): Promise<{ summary: ScanSummary; flagCount: number; scannedCount: number; incremental: boolean }> {
  const qs = new URLSearchParams();
  if (where?.trim()) qs.set("where", where.trim());
  if (opts?.incremental) qs.set("incremental", "true");
  const q = qs.toString();
  return apiFetch(`/v1/ontology/${enc(env)}/quality/scan${q ? `?${q}` : ""}`, { method: "POST" });
}

export async function listQualityFlags(
  env: string,
  opts?: { status?: FlagStatus; layer?: number; severity?: QualitySeverity },
): Promise<{ flags: QualityFlag[] }> {
  const qs = new URLSearchParams();
  if (opts?.status) qs.set("status", opts.status);
  if (opts?.layer != null) qs.set("layer", String(opts.layer));
  if (opts?.severity) qs.set("severity", opts.severity);
  const q = qs.toString();
  return apiFetch(`/v1/ontology/${enc(env)}/quality/flags${q ? `?${q}` : ""}`);
}

export async function updateQualityFlag(
  env: string,
  flagId: string,
  status: FlagStatus,
): Promise<{ ok: true }> {
  return apiFetch(`/v1/ontology/${enc(env)}/quality/flags/${flagId}`, {
    method: "PATCH",
    body: { status },
  });
}
