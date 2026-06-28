import type { TwinAlertSeverity, TwinUnitMetrics } from "@/lib/platform-api";

export type TwinKindIcon =
  | "Building2"
  | "Hospital"
  | "FlaskConical"
  | "BedDouble"
  | "Layers";

export interface TwinAlertRowProps {
  id: string;
  severity: TwinAlertSeverity;
  message: string;
  recommendation?: string;
  metric?: string;
  value?: number;
}

export const DISPLAY_METRIC_OPTIONS = [
  { key: "occupancyPct", label: "Occupancy %" },
  { key: "linkedInstanceCount", label: "Linked instances" },
  { key: "freshnessSeconds", label: "Freshness (s)" },
  { key: "count:Patient", label: "Patients" },
  { key: "count:Bed", label: "Beds" },
] as const;

const EMPTY = "-";

export function severityDotClass(severity: TwinAlertSeverity | null): string {
  if (severity === "critical") return "bg-rose-500";
  if (severity === "warn") return "bg-amber-500";
  if (severity === "info") return "bg-sky-500";
  return "bg-emerald-500";
}

export function severityBadgeTone(
  severity: TwinAlertSeverity,
): "danger" | "warning" | "default" {
  if (severity === "critical") return "danger";
  if (severity === "warn") return "warning";
  return "default";
}

export function kindIconName(kind: string): TwinKindIcon {
  const k = kind.toLowerCase();
  if (k === "hospital") return "Hospital";
  if (k === "lab") return "FlaskConical";
  if (k === "ward") return "BedDouble";
  if (k === "department") return "Layers";
  return "Building2";
}

export function formatTwinMetric(
  metrics: TwinUnitMetrics | undefined,
  key: string,
): string {
  if (!metrics) return EMPTY;
  if (key === "occupancyPct") {
    return metrics.occupancyPct != null
      ? String(Math.round(metrics.occupancyPct)) + "%"
      : EMPTY;
  }
  if (key === "linkedInstanceCount") {
    return String(metrics.linkedInstanceCount);
  }
  if (key === "freshnessSeconds") {
    if (metrics.freshnessSeconds == null) return EMPTY;
    const s = metrics.freshnessSeconds;
    if (s < 60) return s + "s";
    if (s < 3600) return Math.round(s / 60) + "m";
    return Math.round(s / 3600) + "h";
  }
  if (key.startsWith("count:")) {
    const type = key.slice("count:".length);
    return String(metrics.instanceCountByType[type] ?? 0);
  }
  if (key.startsWith("mean:")) {
    const prop = key.slice("mean:".length);
    const val = metrics.numericMeans[prop];
    return val != null ? val.toFixed(1) : EMPTY;
  }
  const direct = metrics.numericMeans[key];
  return direct != null ? direct.toFixed(1) : EMPTY;
}

export function formatFreshness(seconds: number | null): string {
  if (seconds == null) return EMPTY;
  if (seconds < 60) return seconds + "s ago";
  if (seconds < 3600) return Math.round(seconds / 60) + "m ago";
  return Math.round(seconds / 3600) + "h ago";
}

export function truncateId(id: string, len = 8): string {
  return id.length > len ? id.slice(0, len) + "..." : id;
}
