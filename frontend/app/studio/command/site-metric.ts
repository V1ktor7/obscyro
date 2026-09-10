import type { TwinAlertOp } from "@/lib/platform-api";

/**
 * What a site's badge is allowed to say.
 *
 * The map used to paint one thing: occupancy, banded at 85 and 100. Those two
 * numbers were written into the component, and they only ever meant something
 * for that one metric. Air quality runs 1 to 50+, a wastewater index sits
 * around 1, and inventing a second and third pair of numbers would put three
 * different definitions of "bad" in the product — none of them the one the
 * alert uses.
 *
 * So the band comes from the alert rule instead. A site is `over` exactly when
 * the rule that watches that metric would fire on it. The colour and the alert
 * then say the same thing by construction, and the threshold is defined once,
 * in the place a person can edit it.
 */
export type MetricBand = "absent" | "calm" | "near" | "over" | "unbanded";

export interface BandRule {
  op: TwinAlertOp;
  threshold: number;
}

/**
 * How close counts as close.
 *
 * 0.15 of the threshold, which reproduces the map's previous behaviour exactly:
 * occupancy fired at 100 and turned amber at 85. Keeping that number means the
 * one metric anybody has looked at does not change appearance the day this
 * ships.
 */
const NEAR = 0.15;

/** True when `value` satisfies the rule — the same test the alert engine makes. */
export function wouldFire(value: number, rule: BandRule): boolean {
  switch (rule.op) {
    case ">":
      return value > rule.threshold;
    case ">=":
      return value >= rule.threshold;
    case "<":
      return value < rule.threshold;
    case "<=":
      return value <= rule.threshold;
    case "==":
      return value === rule.threshold;
    default:
      return false;
  }
}

export function bandFor(
  value: number | null | undefined,
  rule: BandRule | null | undefined,
): MetricBand {
  // A site with no reading keeps its own tint. Painting it green would say the
  // place is fine when what is true is that nobody knows.
  if (value === null || value === undefined || !Number.isFinite(value)) return "absent";
  // No rule, no threshold, nothing to be near or over. Saying so is better than
  // inventing a scale for a metric the institution has not thresholded.
  if (!rule) return "unbanded";
  if (wouldFire(value, rule)) return "over";
  // Equality has no approach: a value is the threshold or it is not.
  if (rule.op === "==") return "calm";

  const margin = Math.abs(rule.threshold) * NEAR;
  const highIsBad = rule.op === ">" || rule.op === ">=";
  if (highIsBad ? value >= rule.threshold - margin : value <= rule.threshold + margin) {
    return "near";
  }
  return "calm";
}

/** The rule that watches a metric, or null when nobody watches it. */
export function ruleForMetric(
  rules: { metric: string; op: TwinAlertOp; threshold: number }[],
  metric: string,
): BandRule | null {
  // More than one rule can watch the same metric at different severities. The
  // badge follows the one that fires first, so the colour never lags the
  // earliest alert a viewer could already be reading.
  const watching = rules.filter((r) => r.metric === metric);
  if (watching.length === 0) return null;
  const highIsBad = watching[0]!.op === ">" || watching[0]!.op === ">=";
  return watching.reduce((best, r) =>
    (highIsBad ? r.threshold < best.threshold : r.threshold > best.threshold) ? r : best,
  );
}

const COLOURS: Record<MetricBand, string> = {
  absent: "#c5cbd3",
  calm: "#059669",
  near: "#d97706",
  over: "#e11d48",
  // Deliberately not on the green–amber–red axis: a metric nobody thresholded
  // has no good or bad, and borrowing that axis would imply a judgement the
  // data does not carry.
  unbanded: "#5b7fa6",
};

export function bandColour(band: MetricBand): string {
  return COLOURS[band];
}

/** The value a site carries for a metric, or null when it carries none. */
export function siteValue(
  site: { metrics?: { values?: Record<string, number | null> } },
  metric: string,
): number | null {
  const v = site.metrics?.values?.[metric];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** The reading as a reader would write it, unit included. */
export function formatValue(value: number | null, unit?: string): string {
  if (value === null) return "—";
  if (unit === "percent") return `${Math.round(value)}%`;
  if (unit === "ratio") return value.toFixed(2);
  return Math.abs(value) >= 100 ? String(Math.round(value)) : String(Math.round(value * 100) / 100);
}
