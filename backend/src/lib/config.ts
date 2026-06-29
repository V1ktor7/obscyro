/**
 * Centralized, env-driven tunables for the production-hardened feature paths.
 * Every value has a safe default so local/dev keeps working without extra env,
 * while operators can tune behavior in production without code changes.
 */

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function floatEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

export const config = {
  /** Twin live SSE recompute cadence (ms). */
  twinSseIntervalMs: intEnv("TWIN_SSE_INTERVAL_MS", 5_000, 1_000, 300_000),
  /** Live-metrics SSE recompute cadence (ms). */
  metricsSseIntervalMs: intEnv("METRICS_SSE_INTERVAL_MS", 5_000, 1_000, 300_000),
  /** SSE heartbeat cadence (ms) to keep proxies from closing idle streams. */
  sseHeartbeatMs: intEnv("SSE_HEARTBEAT_MS", 15_000, 1_000, 120_000),
  /** Client reconnect backoff hint sent via the SSE `retry:` field (ms). */
  sseRetryMs: intEnv("SSE_RETRY_MS", 3_000, 500, 60_000),

  /** Default page size for list endpoints. */
  listDefaultLimit: intEnv("LIST_DEFAULT_LIMIT", 100, 1, 1_000),
  /** Hard ceiling for any list endpoint page size. */
  listMaxLimit: intEnv("LIST_MAX_LIMIT", 500, 1, 5_000),

  /** Upper bound on rows pulled into memory for graph/rollup builds. */
  rollupInstanceCap: intEnv("ROLLUP_INSTANCE_CAP", 50_000, 1_000, 500_000),

  /** Simulation Monte-Carlo run ceiling. */
  simMaxRuns: intEnv("SIM_MAX_RUNS", 200, 1, 1_000),

  /** Base URL of the hybrid ML simulation-service. Empty => ML sim disabled. */
  simServiceUrl: (process.env.SIM_SERVICE_URL ?? "").trim().replace(/\/$/, ""),
  /** Upstream timeout for simulation-service calls (ms). */
  simServiceTimeoutMs: intEnv("SIM_SERVICE_TIMEOUT_MS", 60_000, 1_000, 600_000),
  /** Optional JSON graph spec (model DAG) used when a request omits one. */
  simDefaultGraph: (process.env.SIM_DEFAULT_GRAPH ?? "").trim(),

  /** Data-quality L6 ML/statistical anomaly layer. */
  dqAnomalyEnabled: boolEnv("DQ_ANOMALY_ENABLED", true),
  /** Tukey IQR fence multiplier for L6 anomaly detection. */
  dqIqrK: floatEnv("DQ_IQR_K", 3.0, 1.0, 10.0),
  /** Robust z-score (MAD) threshold for L6 anomaly detection. */
  dqZScoreThreshold: floatEnv("DQ_ZSCORE_THRESHOLD", 5.0, 2.0, 20.0),
  /** Minimum same-type numeric sample size before L6 anomaly checks run. */
  dqAnomalyMinSample: intEnv("DQ_ANOMALY_MIN_SAMPLE", 12, 5, 10_000),
} as const;

/** Clamp a requested page size into the configured bounds. */
export function clampLimit(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return config.listDefaultLimit;
  return Math.min(config.listMaxLimit, Math.max(1, Math.trunc(requested)));
}

/** Clamp a requested offset to a non-negative integer. */
export function clampOffset(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested) || requested < 0) return 0;
  return Math.trunc(requested);
}
