import type { DbClient } from "../lib/db.js";
import { BadRequest, NotFound } from "../lib/errors.js";

// ---------------------------------------------------------------------------
// Causal simulation lab.
//
// Signals are hourly time series derived from live environment data:
//   type:<ObjectType>.count      instances created per hour
//   type:<ObjectType>.<prop>     hourly mean of a numeric property
//   channel:<slug>.runs|saved|flagged   data-channel run stats per hour
//
// The causality scan computes best-lag Pearson correlations between every
// signal pair (lag 1..maxLag, so direction follows time precedence) and
// upserts them as edges. Models are one-step ridge ARX regressors trained on
// the same series; forecasts iterate the model forward, and event injection
// perturbs a feature's future values to produce the simulated trajectory.
// ---------------------------------------------------------------------------

export interface SignalInfo {
  signal: string;
  kind: "type_count" | "type_property" | "channel";
  label: string;
  entity: string; // object type name or channel slug the signal belongs to
}

export interface CausalityEdge {
  fromSignal: string;
  toSignal: string;
  lagHours: number;
  strength: number;
  confidence: number;
  sampleCount: number;
  computedAt: string;
}

export interface ModelFeature {
  signal: string;
  lag: number;
}

export interface ModelSpec {
  targetSignal: string;
  features: ModelFeature[];
  arLags: number[];
  horizonHours: number;
  windowHours: number;
  weights: number[];
  means: number[];
  stds: number[];
  targetMean: number;
  targetStd: number;
}

export interface ModelMetrics {
  mae: number;
  mape: number | null;
  baselineMae: number;
  improvement: number;
  samples: number;
}

// --- signal discovery -------------------------------------------------------

export async function listSignals(db: DbClient, environmentId: string): Promise<SignalInfo[]> {
  const signals: SignalInfo[] = [];

  const types = await db.query<{ id: string; name: string }>(
    `SELECT id, name FROM app.ontology_object_types WHERE environment_id = $1 ORDER BY name`,
    [environmentId],
  );
  for (const t of types.rows) {
    signals.push({
      signal: `type:${t.name}.count`,
      kind: "type_count",
      label: `${t.name} · created/h`,
      entity: t.name,
    });
    // Numeric properties observed on recent instances of this type.
    const sample = await db.query<{ properties: Record<string, unknown> }>(
      `SELECT properties FROM app.ontology_object_instances
        WHERE object_type_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [t.id],
    );
    const numericKeys = new Set<string>();
    for (const row of sample.rows) {
      for (const [k, v] of Object.entries(row.properties ?? {})) {
        if (typeof v === "number" && Number.isFinite(v)) numericKeys.add(k);
        else if (typeof v === "string" && v !== "" && !Number.isNaN(Number(v))) numericKeys.add(k);
      }
    }
    for (const key of Array.from(numericKeys).sort().slice(0, 8)) {
      signals.push({
        signal: `type:${t.name}.${key}`,
        kind: "type_property",
        label: `${t.name} · avg ${key}/h`,
        entity: t.name,
      });
    }
  }

  const channels = await db.query<{ slug: string; name: string }>(
    `SELECT slug, name FROM app.data_channel WHERE environment_id = $1 ORDER BY name`,
    [environmentId],
  );
  for (const c of channels.rows) {
    signals.push(
      { signal: `channel:${c.slug}.runs`, kind: "channel", label: `${c.name} · runs/h`, entity: c.slug },
      { signal: `channel:${c.slug}.saved`, kind: "channel", label: `${c.name} · saved/h`, entity: c.slug },
      { signal: `channel:${c.slug}.flagged`, kind: "channel", label: `${c.name} · flagged/h`, entity: c.slug },
    );
  }
  return signals;
}

// --- series building ---------------------------------------------------------

function hourFloor(d: Date): number {
  return Math.floor(d.getTime() / 3_600_000);
}

/** Build aligned hourly series (oldest→newest) for the given signals. */
export async function buildSeries(
  db: DbClient,
  environmentId: string,
  signals: string[],
  windowHours: number,
): Promise<{ hours: string[]; series: Map<string, number[]> }> {
  const endHour = hourFloor(new Date());
  const startHour = endHour - windowHours + 1;
  const hours: string[] = [];
  for (let h = startHour; h <= endHour; h++) {
    hours.push(new Date(h * 3_600_000).toISOString());
  }

  const series = new Map<string, number[]>();
  const channelCache = new Map<string, { runs: number[]; saved: number[]; flagged: number[] }>();

  for (const signal of signals) {
    const buckets = new Map<number, number>();
    const isCount = /^type:[^.]+\.count$/.test(signal);

    if (signal.startsWith("type:")) {
      const body = signal.slice(5);
      const dot = body.lastIndexOf(".");
      const typeName = body.slice(0, dot);
      const prop = body.slice(dot + 1);
      if (prop === "count") {
        const { rows } = await db.query<{ h: Date; v: string }>(
          `SELECT date_trunc('hour', oi.created_at) AS h, COUNT(*) AS v
             FROM app.ontology_object_instances oi
             JOIN app.ontology_object_types t ON t.id = oi.object_type_id
            WHERE t.environment_id = $1 AND t.name = $2
              AND oi.created_at >= NOW() - make_interval(hours => $3)
            GROUP BY 1`,
          [environmentId, typeName, windowHours],
        );
        for (const r of rows) buckets.set(hourFloor(r.h), Number(r.v));
      } else {
        const { rows } = await db.query<{ h: Date; v: string }>(
          `SELECT date_trunc('hour', oi.created_at) AS h,
                  AVG((oi.properties->>$4)::numeric) AS v
             FROM app.ontology_object_instances oi
             JOIN app.ontology_object_types t ON t.id = oi.object_type_id
            WHERE t.environment_id = $1 AND t.name = $2
              AND oi.created_at >= NOW() - make_interval(hours => $3)
              AND oi.properties->>$4 ~ '^-?[0-9]+(\\.[0-9]+)?$'
            GROUP BY 1`,
          [environmentId, typeName, windowHours, prop],
        );
        for (const r of rows) buckets.set(hourFloor(r.h), Number(r.v));
      }
    } else if (signal.startsWith("channel:")) {
      const body = signal.slice(8);
      const dot = body.lastIndexOf(".");
      const slug = body.slice(0, dot);
      const metric = body.slice(dot + 1) as "runs" | "saved" | "flagged";
      if (!channelCache.has(slug)) {
        const { rows } = await db.query<{
          h: Date;
          runs: string;
          saved: string;
          flagged: string;
        }>(
          `SELECT date_trunc('hour', r.created_at) AS h,
                  COUNT(*) AS runs,
                  COALESCE(SUM(r.saved_count), 0) AS saved,
                  COALESCE(SUM(r.flagged_count), 0) AS flagged
             FROM app.data_channel_run r
             JOIN app.data_channel c ON c.id = r.channel_id
            WHERE c.environment_id = $1 AND c.slug = $2
              AND r.created_at >= NOW() - make_interval(hours => $3)
            GROUP BY 1`,
          [environmentId, slug, windowHours],
        );
        const runs: number[] = new Array(windowHours).fill(0);
        const saved: number[] = new Array(windowHours).fill(0);
        const flagged: number[] = new Array(windowHours).fill(0);
        for (const r of rows) {
          const idx = hourFloor(r.h) - startHour;
          if (idx >= 0 && idx < windowHours) {
            runs[idx] = Number(r.runs);
            saved[idx] = Number(r.saved);
            flagged[idx] = Number(r.flagged);
          }
        }
        channelCache.set(slug, { runs, saved, flagged });
      }
      series.set(signal, [...channelCache.get(slug)![metric]]);
      continue;
    } else {
      throw BadRequest("UNKNOWN_SIGNAL", `Signal "${signal}" is not recognized.`);
    }

    const values: number[] = new Array(windowHours).fill(NaN);
    for (const [h, v] of buckets) {
      const idx = h - startHour;
      if (idx >= 0 && idx < windowHours) values[idx] = v;
    }
    if (isCount) {
      for (let i = 0; i < values.length; i++) if (Number.isNaN(values[i])) values[i] = 0;
    } else {
      // forward-fill sparse property means; lead-fill with first known value
      let last = NaN;
      for (let i = 0; i < values.length; i++) {
        if (!Number.isNaN(values[i])) last = values[i];
        else if (!Number.isNaN(last)) values[i] = last;
      }
      let first = values.find((v) => !Number.isNaN(v)) ?? 0;
      for (let i = 0; i < values.length; i++) if (Number.isNaN(values[i])) values[i] = first;
    }
    series.set(signal, values);
  }

  return { hours, series };
}

// --- statistics --------------------------------------------------------------

function pearson(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 3) return 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i];
    sy += y[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return 0;
  return cov / Math.sqrt(vx * vy);
}

/** Standard normal CDF via Abramowitz–Stegun erf approximation. */
function phi(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const erf =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t) *
      Math.exp((-z * z) / 2);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

function correlationConfidence(r: number, n: number): number {
  if (n <= 3 || Math.abs(r) >= 1) return 0;
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  const p = 2 * (1 - phi(Math.abs(t)));
  return Math.max(0, Math.min(0.99, 1 - p));
}

export interface ScanResult {
  edges: CausalityEdge[];
  signalCount: number;
  windowHours: number;
}

const MIN_STRENGTH = 0.3;
const MIN_CONFIDENCE = 0.6;
const MIN_SAMPLES = 24;

export async function scanCausality(
  db: DbClient,
  environmentId: string,
  opts: { windowHours?: number; maxLagHours?: number },
): Promise<ScanResult> {
  const windowHours = Math.min(Math.max(opts.windowHours ?? 24 * 14, 48), 24 * 90);
  const maxLag = Math.min(Math.max(opts.maxLagHours ?? 12, 1), 48);

  const infos = await listSignals(db, environmentId);
  const names = infos.map((s) => s.signal);
  const { series } = await buildSeries(db, environmentId, names, windowHours);

  // Drop flat signals — they correlate with nothing meaningfully.
  const active = names.filter((n) => {
    const v = series.get(n)!;
    return new Set(v.map((x) => Math.round(x * 1e6))).size > 2;
  });

  const edges: CausalityEdge[] = [];
  const computedAt = new Date().toISOString();
  for (const from of active) {
    for (const to of active) {
      if (from === to) continue;
      const x = series.get(from)!;
      const y = series.get(to)!;
      let best: { lag: number; r: number; n: number } | null = null;
      for (let lag = 1; lag <= maxLag; lag++) {
        const n = x.length - lag;
        if (n < MIN_SAMPLES) break;
        const r = pearson(x.slice(0, n), y.slice(lag));
        if (!best || Math.abs(r) > Math.abs(best.r)) best = { lag, r, n };
      }
      if (!best) continue;
      const strength = Math.abs(best.r);
      const confidence = correlationConfidence(best.r, best.n);
      if (strength < MIN_STRENGTH || confidence < MIN_CONFIDENCE) continue;
      edges.push({
        fromSignal: from,
        toSignal: to,
        lagHours: best.lag,
        strength: Number(strength.toFixed(4)),
        confidence: Number(confidence.toFixed(4)),
        sampleCount: best.n,
        computedAt,
      });
    }
  }

  // Keep the stronger direction when both A→B and B→A survive.
  const byPair = new Map<string, CausalityEdge>();
  for (const e of edges) {
    const key = [e.fromSignal, e.toSignal].sort().join("::");
    const cur = byPair.get(key);
    if (!cur || e.strength > cur.strength) byPair.set(key, e);
  }
  const kept = Array.from(byPair.values()).sort((a, b) => b.strength - a.strength);

  await db.query(`DELETE FROM app.causality_edge WHERE environment_id = $1`, [environmentId]);
  for (const e of kept) {
    await db.query(
      `INSERT INTO app.causality_edge
              (environment_id, from_signal, to_signal, lag_hours, strength, confidence, sample_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (environment_id, from_signal, to_signal) DO UPDATE
          SET lag_hours = EXCLUDED.lag_hours, strength = EXCLUDED.strength,
              confidence = EXCLUDED.confidence, sample_count = EXCLUDED.sample_count,
              computed_at = NOW()`,
      [environmentId, e.fromSignal, e.toSignal, e.lagHours, e.strength, e.confidence, e.sampleCount],
    );
  }

  return { edges: kept, signalCount: active.length, windowHours };
}

export async function listCausalityEdges(
  db: DbClient,
  environmentId: string,
): Promise<CausalityEdge[]> {
  const { rows } = await db.query<{
    from_signal: string;
    to_signal: string;
    lag_hours: number;
    strength: number;
    confidence: number;
    sample_count: number;
    computed_at: Date;
  }>(
    `SELECT from_signal, to_signal, lag_hours, strength, confidence, sample_count, computed_at
       FROM app.causality_edge
      WHERE environment_id = $1
      ORDER BY strength DESC`,
    [environmentId],
  );
  return rows.map((r) => ({
    fromSignal: r.from_signal,
    toSignal: r.to_signal,
    lagHours: r.lag_hours,
    strength: r.strength,
    confidence: r.confidence,
    sampleCount: r.sample_count,
    computedAt: r.computed_at.toISOString(),
  }));
}

// --- ridge ARX ---------------------------------------------------------------

/** Solve (A + λI) w = b for small dense systems via Gaussian elimination. */
function ridgeSolve(A: number[][], b: number[], lambda: number): number[] {
  const n = b.length;
  const m = A.map((row, i) => {
    const r = [...row];
    r[i] += lambda;
    return [...r, b[i]];
  });
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const pv = m[col][col];
    if (Math.abs(pv) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col] / pv;
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[n] / row[i]));
}

const AR_LAGS = [1, 2, 3];
const RIDGE_LAMBDA = 1.0;

function buildRow(
  t: number,
  target: number[],
  features: { values: number[]; lag: number }[],
): number[] {
  const row: number[] = [1]; // intercept
  for (const lag of AR_LAGS) row.push(target[t - lag]);
  for (const f of features) row.push(f.values[t - f.lag]);
  return row;
}

export interface TrainResult {
  spec: ModelSpec;
  metrics: ModelMetrics;
}

export async function trainModel(
  db: DbClient,
  environmentId: string,
  opts: {
    targetSignal: string;
    features: ModelFeature[];
    horizonHours?: number;
    windowHours?: number;
  },
): Promise<TrainResult> {
  const windowHours = Math.min(Math.max(opts.windowHours ?? 24 * 14, 72), 24 * 90);
  const horizonHours = Math.min(Math.max(opts.horizonHours ?? 48, 6), 24 * 7);
  const features = opts.features
    .filter((f) => f.signal !== opts.targetSignal)
    .slice(0, 10)
    .map((f) => ({ signal: f.signal, lag: Math.min(Math.max(f.lag || 1, 1), 48) }));

  const signalNames = [opts.targetSignal, ...features.map((f) => f.signal)];
  const { series } = await buildSeries(db, environmentId, signalNames, windowHours);
  const target = series.get(opts.targetSignal)!;
  const featSeries = features.map((f) => ({ values: series.get(f.signal)!, lag: f.lag }));

  const maxLag = Math.max(...AR_LAGS, ...features.map((f) => f.lag), 1);
  const n = target.length;
  if (n - maxLag < 48) {
    throw BadRequest(
      "NOT_ENOUGH_DATA",
      `Need at least ${maxLag + 48} hours of data; the window has ${n} usable hours.`,
    );
  }

  // Standardize using training-region statistics.
  const rows: number[][] = [];
  const ys: number[] = [];
  for (let t = maxLag; t < n; t++) {
    rows.push(buildRow(t, target, featSeries));
    ys.push(target[t]);
  }
  const dim = rows[0].length;
  const split = Math.floor(rows.length * 0.8);

  const means = new Array(dim).fill(0);
  const stds = new Array(dim).fill(1);
  for (let c = 1; c < dim; c++) {
    let s = 0;
    for (let r = 0; r < split; r++) s += rows[r][c];
    means[c] = s / split;
    let v = 0;
    for (let r = 0; r < split; r++) v += (rows[r][c] - means[c]) ** 2;
    stds[c] = Math.sqrt(v / split) || 1;
  }
  let ty = 0;
  for (let r = 0; r < split; r++) ty += ys[r];
  const targetMean = ty / split;
  let tv = 0;
  for (let r = 0; r < split; r++) tv += (ys[r] - targetMean) ** 2;
  const targetStd = Math.sqrt(tv / split) || 1;

  const norm = (row: number[]) => row.map((v, c) => (c === 0 ? 1 : (v - means[c]) / stds[c]));

  // Normal equations on the training split.
  const A: number[][] = Array.from({ length: dim }, () => new Array(dim).fill(0));
  const b: number[] = new Array(dim).fill(0);
  for (let r = 0; r < split; r++) {
    const x = norm(rows[r]);
    const yn = (ys[r] - targetMean) / targetStd;
    for (let i = 0; i < dim; i++) {
      b[i] += x[i] * yn;
      for (let j = 0; j < dim; j++) A[i][j] += x[i] * x[j];
    }
  }
  const weights = ridgeSolve(A, b, RIDGE_LAMBDA);

  const predict = (row: number[]) => {
    const x = norm(row);
    let yn = 0;
    for (let i = 0; i < dim; i++) yn += weights[i] * x[i];
    return yn * targetStd + targetMean;
  };

  // Backtest on the held-out tail (one-step, teacher forcing).
  let absErr = 0;
  let absPct = 0;
  let pctCount = 0;
  let baseErr = 0;
  const testCount = rows.length - split;
  for (let r = split; r < rows.length; r++) {
    const pred = predict(rows[r]);
    const actual = ys[r];
    absErr += Math.abs(pred - actual);
    baseErr += Math.abs(rows[r][1] - actual); // rows[r][1] = target lag-1 (persistence)
    if (Math.abs(actual) > 1e-9) {
      absPct += Math.abs((pred - actual) / actual);
      pctCount++;
    }
  }
  const mae = absErr / testCount;
  const baselineMae = baseErr / testCount;
  const metrics: ModelMetrics = {
    mae: Number(mae.toFixed(4)),
    mape: pctCount > 0 ? Number(((absPct / pctCount) * 100).toFixed(2)) : null,
    baselineMae: Number(baselineMae.toFixed(4)),
    improvement: baselineMae > 0 ? Number((1 - mae / baselineMae).toFixed(4)) : 0,
    samples: rows.length,
  };

  return {
    spec: {
      targetSignal: opts.targetSignal,
      features,
      arLags: AR_LAGS,
      horizonHours,
      windowHours,
      weights,
      means,
      stds,
      targetMean,
      targetStd,
    },
    metrics,
  };
}

// --- forecast + event simulation ----------------------------------------------

export interface ForecastEvent {
  signal: string;
  delta: number;
  startHours: number;
  durationHours: number;
}

export interface ForecastResult {
  pastHours: string[];
  observed: number[];
  backtest: (number | null)[];
  futureHours: string[];
  forecast: number[];
  simulated: number[] | null;
}

export async function forecastModel(
  db: DbClient,
  environmentId: string,
  spec: ModelSpec,
  event: ForecastEvent | null,
): Promise<ForecastResult> {
  if (event && !spec.features.some((f) => f.signal === event.signal)) {
    throw BadRequest(
      "EVENT_SIGNAL_NOT_IN_MODEL",
      `Event signal "${event.signal}" is not a feature of this model — the model cannot react to it.`,
    );
  }

  const signalNames = [spec.targetSignal, ...spec.features.map((f) => f.signal)];
  const { hours, series } = await buildSeries(db, environmentId, signalNames, spec.windowHours);
  const target = series.get(spec.targetSignal)!;
  const featSeries = spec.features.map((f) => ({ values: series.get(f.signal)!, lag: f.lag }));
  const dim = 1 + spec.arLags.length + spec.features.length;
  const maxLag = Math.max(...spec.arLags, ...spec.features.map((f) => f.lag), 1);
  const n = target.length;

  const predictRow = (row: number[]) => {
    let yn = 0;
    for (let i = 0; i < dim; i++) {
      const x = i === 0 ? 1 : (row[i] - spec.means[i]) / spec.stds[i];
      yn += spec.weights[i] * x;
    }
    return yn * spec.targetStd + spec.targetMean;
  };

  const rowAt = (t: number, tgt: number[], feats: { values: number[]; lag: number }[]) => {
    const row: number[] = [1];
    for (const lag of spec.arLags) row.push(tgt[t - lag]);
    for (const f of feats) row.push(f.values[t - f.lag]);
    return row;
  };

  // Backtest line over the observed window (teacher forcing).
  const backtest: (number | null)[] = new Array(n).fill(null);
  for (let t = maxLag; t < n; t++) {
    backtest[t] = Number(predictRow(rowAt(t, target, featSeries)).toFixed(4));
  }

  // Future feature values: hold each feature at its mean over the last 24h.
  const H = spec.horizonHours;
  const futureFeatureBase = spec.features.map((f) => {
    const v = series.get(f.signal)!;
    const tail = v.slice(-24);
    return tail.reduce((a, b) => a + b, 0) / Math.max(tail.length, 1);
  });

  const runForward = (eventApplied: ForecastEvent | null): number[] => {
    const tgt = [...target];
    const feats = spec.features.map((f, i) => {
      const base = series.get(f.signal)!;
      const future: number[] = [];
      for (let s = 0; s < H; s++) {
        let v = futureFeatureBase[i];
        if (
          eventApplied &&
          eventApplied.signal === f.signal &&
          s >= eventApplied.startHours &&
          s < eventApplied.startHours + eventApplied.durationHours
        ) {
          v = Math.max(0, v + eventApplied.delta);
        }
        future.push(v);
      }
      return { values: [...base, ...future], lag: f.lag };
    });
    const out: number[] = [];
    for (let s = 0; s < H; s++) {
      const t = n + s;
      const pred = predictRow(rowAt(t, tgt, feats));
      tgt.push(pred);
      out.push(Number(pred.toFixed(4)));
    }
    return out;
  };

  const forecast = runForward(null);
  const simulated = event ? runForward(event) : null;

  const lastHourMs = new Date(hours[hours.length - 1]).getTime();
  const futureHours: string[] = [];
  for (let s = 1; s <= H; s++) futureHours.push(new Date(lastHourMs + s * 3_600_000).toISOString());

  return {
    pastHours: hours,
    observed: target.map((v) => Number(v.toFixed(4))),
    backtest,
    futureHours,
    forecast,
    simulated,
  };
}

// --- model registry helpers ----------------------------------------------------

export async function nextModelVersion(
  db: DbClient,
  environmentId: string,
  name: string,
): Promise<string> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM app.simulation_model
      WHERE environment_id = $1 AND name = $2`,
    [environmentId, name],
  );
  return `v${Number(rows[0]?.count ?? 0) + 1}`;
}

export async function getLabModel(
  db: DbClient,
  environmentId: string,
  modelId: string,
): Promise<{ id: string; name: string; version: string; spec: ModelSpec; metrics: ModelMetrics }> {
  const { rows } = await db.query<{
    id: string;
    name: string;
    version: string;
    spec: ModelSpec;
    metrics: ModelMetrics;
  }>(
    `SELECT id, name, version, spec, metrics FROM app.simulation_model
      WHERE environment_id = $1 AND id = $2 AND model_type = 'causal_arx'`,
    [environmentId, modelId],
  );
  const row = rows[0];
  if (!row || !row.spec?.targetSignal) {
    throw NotFound("MODEL_NOT_FOUND", "Trained model not found in this environment.");
  }
  return row;
}
