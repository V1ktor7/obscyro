import type { FreshnessBasis } from "@/lib/platform-api";

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
  if (severity === "critical") return "bg-danger";
  if (severity === "warn") return "bg-warn";
  if (severity === "info") return "bg-brand";
  return "bg-ok";
}

export function severityBadgeTone(
  severity: TwinAlertSeverity,
): "danger" | "warn" | "neutral" {
  if (severity === "critical") return "danger";
  if (severity === "warn") return "warn";
  return "neutral";
}

export function kindIconName(kind: string): TwinKindIcon {
  const k = kind.toLowerCase();
  if (k === "hospital") return "Hospital";
  if (k === "lab") return "FlaskConical";
  if (k === "ward") return "BedDouble";
  if (k === "department") return "Layers";
  return "Building2";
}

/**
 * Format a value against the unit its definition declares.
 *
 * The twin no longer knows what its metrics mean — a percentage, a count and a
 * mean waiting time all arrive as bare numbers in `values`, so the definition
 * has to say how to render them.
 */
/** A duration held in decimal hours, in hours and minutes: `5 h 59`. */
export function formatHours(hours: number): string {
  const minutes = Math.max(0, Math.round(hours * 60));
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}

export function formatMetricValue(
  value: number | null | undefined,
  unit: "percent" | "ratio" | "count" | "number" | "hours",
): string {
  if (value == null) return EMPTY;
  if (unit === "hours") return formatHours(value);
  if (unit === "percent") return `${Math.round(value)}%`;
  if (unit === "ratio") return value.toFixed(2);
  if (unit === "count") return String(Math.round(value));
  return value.toFixed(1);
}

export function formatTwinMetric(
  metrics: TwinUnitMetrics | undefined,
  key: string,
  unit?: "percent" | "ratio" | "count" | "number" | "hours",
): string {
  if (!metrics) return EMPTY;
  // A user-defined metric wins, and is rendered with the unit it declares.
  if (metrics.values && key in metrics.values) {
    return formatMetricValue(metrics.values[key], unit ?? "number");
  }
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

/**
 * The number behind a measure, or null when the unit carries none.
 *
 * The same reading the alert rules make on the server (`metricValue` in
 * `backend/src/services/twin.ts`): a list that ranks units on a measure and a
 * rule that thresholds it have to be looking at the same number.
 */
export function twinMetricNumber(metrics: TwinUnitMetrics | undefined, key: string): number | null {
  if (!metrics) return null;
  const finite = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  if (metrics.values && key in metrics.values) return finite(metrics.values[key]);
  if (key === "occupancyPct") return finite(metrics.occupancyPct);
  if (key === "linkedInstanceCount") return finite(metrics.linkedInstanceCount);
  if (key === "freshnessSeconds") return finite(metrics.freshnessSeconds);
  if (key.startsWith("count:")) return finite(metrics.instanceCountByType[key.slice("count:".length)] ?? 0);
  if (key.startsWith("mean:")) return finite(metrics.numericMeans[key.slice("mean:".length)]);
  return finite(metrics.numericMeans[key]);
}

export function formatFreshness(seconds: number | null): string {
  if (seconds == null) return EMPTY;
  if (seconds < 0) return "ahead of us";
  if (seconds < 60) return seconds + "s ago";
  if (seconds < 3600) return Math.round(seconds / 60) + "m ago";
  return Math.round(seconds / 3600) + "h ago";
}

/**
 * The age of a reading, including when the number is only a floor.
 *
 * A unit fed by two sources where one has gone quiet has an age that is a lower
 * bound, not an answer. Printing "2h ago" and hiding the caveat in a tooltip
 * gives a reader a number they will repeat without it, so the qualifier is in
 * the text.
 */
export function formatReadingAge(seconds: number | null, basis: FreshnessBasis): string {
  if (seconds == null) return "unknown";
  const age = formatFreshness(seconds);
  return basis === "partial" ? `≥ ${age}` : age;
}

/**
 * What an age is the age of: everything under a unit, or what one measure
 * reads. The two can differ at the same unit, so the reason given for a floor
 * or an unknown names the right one.
 */
export type AgeOf = "unit" | "measure";

/**
 * Why there is no age, in a sentence.
 *
 * "—" and "unknown" are not the same thing on a screen somebody decides from.
 * The first reads as a rendering gap; the second is a statement about the data,
 * and each of these reasons is fixed in a different place.
 */
export function explainFreshness(basis: FreshnessBasis, of: AgeOf = "unit"): string {
  switch (basis) {
    case "observed":
      return "Age of the reading, from the timestamp the source published.";
    case "undeclared":
      return of === "measure"
        ? "Unknown — no property of what this measure reads is declared as carrying the time of the reading."
        : "Unknown — no property on this type is declared as carrying the time of the reading.";
    case "unreadable":
      return "Unknown — the declared timestamp property carries nothing readable.";
    case "zone-unknown":
      return "Unknown — the timestamp names a wall clock and no zone is declared for it.";
    case "partial":
      return of === "measure"
        ? "At least this old — one of the sources this measure reads published no readable time."
        : "At least this old — one of the sources feeding this unit published no readable time.";
    case "empty":
      return of === "measure" ? "Nothing this measure reads is linked to this unit." : "Nothing is linked to this unit.";
  }
}

export function truncateId(id: string, len = 8): string {
  return id.length > len ? id.slice(0, len) + "..." : id;
}
