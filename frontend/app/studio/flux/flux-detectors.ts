/**
 * Client-side flux heuristics — gap detector and rate z-score.
 * Always labeled "client heuristic" in the UI.
 */

export interface IngestEventRow {
  id: string;
  sourceId: string | null;
  status: string;
  receivedAt: string;
}

export interface FluxDetection {
  id: string;
  tier: "real" | "heuristic" | "llm";
  severity: "info" | "warn" | "critical";
  title: string;
  detail: string;
  at: string;
  sourceId?: string | null;
  code?: string;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}

function mean(vals: number[]): number {
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function std(vals: number[], mu: number): number {
  if (vals.length < 2) return 1;
  const v = vals.reduce((a, b) => a + (b - mu) ** 2, 0) / (vals.length - 1);
  return Math.sqrt(v) || 1;
}

/** Gap between consecutive events vs recent p95 gap. */
export function detectGaps(
  events: IngestEventRow[],
  sourceId?: string,
): FluxDetection[] {
  const filtered = events
    .filter((e) => !sourceId || e.sourceId === sourceId)
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));

  if (filtered.length < 3) return [];

  const gapsMs: number[] = [];
  for (let i = 1; i < filtered.length; i++) {
    gapsMs.push(
      new Date(filtered[i]!.receivedAt).getTime() -
        new Date(filtered[i - 1]!.receivedAt).getTime(),
    );
  }

  const sorted = [...gapsMs].sort((a, b) => a - b);
  const p95 = percentile(sorted, 0.95);
  const latestGap = gapsMs[gapsMs.length - 1]!;

  if (latestGap <= p95 * 1.5) return [];

  const sev = latestGap > p95 * 3 ? "critical" : "warn";
  const last = filtered[filtered.length - 1]!;

  return [
    {
      id: `gap-${sourceId ?? "all"}-${last.id}`,
      tier: "heuristic",
      severity: sev,
      title: "Ingest gap detector",
      detail: `Latest inter-event gap ${Math.round(latestGap / 1000)}s exceeds recent p95 ${Math.round(p95 / 1000)}s`,
      at: last.receivedAt,
      sourceId: sourceId ?? null,
    },
  ];
}

/** Events-per-minute z-score over sliding windows. */
export function detectRateAnomalies(
  events: IngestEventRow[],
  sourceId?: string,
): FluxDetection[] {
  const filtered = events
    .filter((e) => !sourceId || e.sourceId === sourceId)
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));

  if (filtered.length < 6) return [];

  const windowMs = 60_000;
  const end = new Date(filtered[filtered.length - 1]!.receivedAt).getTime();
  const start = new Date(filtered[0]!.receivedAt).getTime();
  const rates: number[] = [];

  for (let t = start; t <= end; t += windowMs) {
    const count = filtered.filter((e) => {
      const ts = new Date(e.receivedAt).getTime();
      return ts >= t && ts < t + windowMs;
    }).length;
    rates.push(count);
  }

  if (rates.length < 3) return [];

  const mu = mean(rates.slice(0, -1));
  const sigma = std(rates.slice(0, -1), mu);
  const latest = rates[rates.length - 1]!;
  const z = (latest - mu) / sigma;

  if (Math.abs(z) < 2) return [];

  const sev = Math.abs(z) >= 3 ? "critical" : "warn";
  const last = filtered[filtered.length - 1]!;

  return [
    {
      id: `rate-${sourceId ?? "all"}-${last.id}`,
      tier: "heuristic",
      severity: sev,
      title: "Ingest rate z-score",
      detail: `Latest window ${latest} evt/min vs baseline μ=${mu.toFixed(1)} (z=${z.toFixed(1)})`,
      at: last.receivedAt,
      sourceId: sourceId ?? null,
    },
  ];
}

export function deriveSourceStats(
  events: IngestEventRow[],
  sourceId: string,
): { lastEventAt: string | null; eventsPerMin: number | null; status: "ok" | "warn" | "critical" | "idle" } {
  const filtered = events
    .filter((e) => e.sourceId === sourceId)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));

  if (!filtered.length) {
    return { lastEventAt: null, eventsPerMin: null, status: "idle" };
  }

  const lastEventAt = filtered[0]!.receivedAt;
  const ageSec = (Date.now() - new Date(lastEventAt).getTime()) / 1000;

  let eventsPerMin: number | null = null;
  if (filtered.length >= 2) {
    const newest = new Date(filtered[0]!.receivedAt).getTime();
    const oldest = new Date(filtered[filtered.length - 1]!.receivedAt).getTime();
    const spanMin = Math.max((newest - oldest) / 60_000, 0.5);
    eventsPerMin = filtered.length / spanMin;
  }

  let status: "ok" | "warn" | "critical" | "idle" = "ok";
  if (ageSec > 3600) status = "critical";
  else if (ageSec > 900) status = "warn";
  else if (ageSec > 300) status = "warn";

  return { lastEventAt, eventsPerMin, status };
}
