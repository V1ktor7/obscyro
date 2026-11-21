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

/**
 * The Claude models the analyst can run on.
 *
 * A list, not any id: the analyst's request is written for these (an effort,
 * a fallback on refusal, the web search tool, strict tools), and a model that
 * takes another request would fail on every question. Anthropic's
 * documentation says all three accept it; only the first has answered the
 * reference questions, so changing model is a change to replay them for.
 */
export const ANALYST_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] as const;
export type AnalystModelId = (typeof ANALYST_MODELS)[number];
export const DEFAULT_ANALYST_MODEL: AnalystModelId = "claude-opus-5-5";

/**
 * The model `ANALYST_MODEL` names.
 *
 * Unset: the default. A value that is not on the list is not replaced by the
 * default: `refused` keeps it, and the analyst is then off and says so. The
 * default is the most expensive of the three, and somebody who set a cheaper
 * one with a slip in its name must not pay for the dearest without knowing.
 */
export function analystModelFrom(raw: string | undefined): { model: AnalystModelId; refused: string | null } {
  const asked = (raw ?? "").trim();
  if (!asked) return { model: DEFAULT_ANALYST_MODEL, refused: null };
  const hit = ANALYST_MODELS.find((m) => m === asked.toLowerCase());
  return hit ? { model: hit, refused: null } : { model: DEFAULT_ANALYST_MODEL, refused: asked };
}

/** Why the analyst cannot be asked: which setting is at fault, and the same in words an administrator can act on. */
export interface AnalystOff {
  reason: "no_key" | "unknown_model";
  says: string;
}

/** Why the analyst cannot be asked on a server set up this way; null when it can. */
export function analystOffBecause(settings: { anthropicApiKey: string; analystModel: { refused: string | null } }): AnalystOff | null {
  if (!settings.anthropicApiKey) {
    return { reason: "no_key", says: "The analyst is not switched on for this server: it needs a Claude API key (ANTHROPIC_API_KEY)." };
  }
  if (settings.analystModel.refused !== null) {
    return {
      reason: "unknown_model",
      says:
        `The analyst is switched off on this server: ANALYST_MODEL is set to "${settings.analystModel.refused}", which is not a model it can run on. ` +
        `An administrator has to set it to one of ${ANALYST_MODELS.join(", ")}, or leave it unset.`,
    };
  }
  return null;
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
  /**
   * Upstream timeout for simulation-service calls (ms).
   *
   * Five minutes, not one. A comparison over Montréal's twin — 241 facilities,
   * 91 steps, three responses, with the per-facility trajectory collected —
   * runs between 35 and 100 seconds, and the old minute cut off the ones that
   * mattered most. The ones it cuts off now are genuinely stuck.
   */
  simServiceTimeoutMs: intEnv("SIM_SERVICE_TIMEOUT_MS", 300_000, 1_000, 900_000),
  /** Optional JSON graph spec (model DAG) used when a request omits one. */
  simDefaultGraph: (process.env.SIM_DEFAULT_GRAPH ?? "").trim(),

  /**
   * Key for the Claude API, which the analyst reads the twin with. Empty =>
   * the analyst is off and says so; nothing else depends on it.
   */
  anthropicApiKey: (process.env.ANTHROPIC_API_KEY ?? "").trim(),
  /**
   * The Claude model the analyst runs on (`ANALYST_MODEL`), one of
   * `ANALYST_MODELS`. Unset => the default. Anything else => the analyst is
   * off and says which value it was given.
   */
  analystModel: analystModelFrom(process.env.ANALYST_MODEL),

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
