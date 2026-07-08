/**
 * LLM triage preview stub — deterministic recommendations keyed on detection
 * metadata. Replace with a real model call when available.
 */

export interface TriageContext {
  sourceName?: string;
  recentEventCount?: number;
  env?: string;
}

export interface TriageRecommendation {
  text: string;
  confidence: number;
}

export interface DetectionLike {
  id: string;
  tier: "real" | "heuristic" | "llm";
  severity: "info" | "warn" | "critical";
  title: string;
  detail: string;
  code?: string;
}

export async function getRecommendation(
  detection: DetectionLike,
  ctx: TriageContext,
): Promise<TriageRecommendation> {
  await new Promise((r) => setTimeout(r, 120));

  const base = detection.severity === "critical" ? 0.82 : detection.severity === "warn" ? 0.68 : 0.55;

  if (detection.code === "STALE_SOURCE" || detection.title.toLowerCase().includes("stale")) {
    return {
      text: `Verify connectivity for ${ctx.sourceName ?? "the source"} and replay buffered payloads once the webhook is restored.`,
      confidence: base + 0.08,
    };
  }
  if (detection.code === "FLATLINE" || detection.title.toLowerCase().includes("flatline")) {
    return {
      text: "Check upstream ETL job schedule; flatline often indicates a paused export or credential expiry.",
      confidence: base + 0.05,
    };
  }
  if (detection.tier === "heuristic" && detection.title.includes("gap")) {
    return {
      text: "Inspect recent deploys or network blips; if gap exceeds SLA, escalate to integration owner.",
      confidence: base,
    };
  }
  if (detection.tier === "heuristic" && detection.title.includes("rate")) {
    return {
      text: "Compare current ingest rate to baseline; sudden spikes may indicate duplicate webhooks or bulk backfill.",
      confidence: base - 0.03,
    };
  }
  if (detection.title.toLowerCase().includes("occupancy") || detection.title.toLowerCase().includes("alert")) {
    return {
      text: "Cross-check twin occupancy against ward census; acknowledge or assign if sustained above warn threshold.",
      confidence: base + 0.04,
    };
  }

  return {
    text: "Review detection context in Data Quality and twin alerts; no automated action recommended yet.",
    confidence: Math.max(0.4, base - 0.1),
  };
}
