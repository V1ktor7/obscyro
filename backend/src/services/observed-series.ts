/**
 * An observed series, laid over a simulated one.
 *
 * Importing thirty tables is easy and half of it is decoration: a series nobody
 * can put beside a run is a table. What makes an observed curve worth holding is
 * the question it answers — did the model reproduce what happened — and that
 * needs the two on the same axis, step for step.
 *
 * The numbers below are deliberately modest about themselves. Correlation
 * between two curves that both rise and both fall is high almost regardless of
 * whether the model is right, which is why it is reported last and never alone.
 * The offset between the two peaks says something correlation cannot: a model
 * that peaks eleven days late is wrong in a way that a correlation of 0.94
 * happily conceals.
 */

export interface AlignOptions {
  /** Column holding the date. */
  when: string;
  /** Column holding the value. */
  value: string;
  /** The date step 0 is. */
  origin: string;
  /** How many steps the run covers. */
  horizon: number;
}

/**
 * The series on the run's own axis.
 *
 * `null` where the file said nothing, not zero: a day with no reported figure
 * and a day with none of the thing are different, and filling one in as the
 * other is how a reporting gap becomes an apparent lull.
 */
export function alignSeries(
  rows: ReadonlyArray<Record<string, unknown>>,
  opts: AlignOptions,
): Array<number | null> {
  const out: Array<number | null> = Array.from({ length: Math.max(0, opts.horizon) }, () => null);
  const zero = Date.parse(`${opts.origin}T00:00:00Z`);
  if (!Number.isFinite(zero)) return out;

  for (const r of rows) {
    const when = String(r[opts.when] ?? "").trim();
    const at = Date.parse(`${when}T00:00:00Z`);
    if (!Number.isFinite(at)) continue;
    const step = Math.round((at - zero) / 86_400_000);
    if (step < 0 || step >= out.length) continue;
    const raw = String(r[opts.value] ?? "").replace(/\s|,/g, "");
    // A blank cell coerces to zero, and zero is a claim: none of the thing
    // happened that day. Left unknown instead, which is what the file said.
    if (raw === "") continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    // Last write wins for a repeated date. Summing would double a file that
    // lists a day twice, and a series is not a ledger.
    out[step] = n;
  }
  return out;
}

/** A cumulative column read as what happened each step. */
export function asDaily(series: ReadonlyArray<number | null>): Array<number | null> {
  const out: Array<number | null> = [];
  let last: number | null = null;
  for (const v of series) {
    if (v === null || v === undefined) {
      out.push(null);
      // The chain breaks here. Differencing across the hole would attribute
      // several days of arrivals to whichever day the reporting resumed, and
      // that is a spike nobody observed.
      last = null;
      continue;
    }
    // A cumulative total that goes down is a revision, not negative arrivals.
    out.push(last === null ? null : Math.max(0, v - last));
    last = v;
  }
  return out;
}

/**
 * A series read on the log scale.
 *
 * Not a knob to reach for when a result disappoints — a decision about what the
 * measurement *is*. A viral concentration is log-normal and spans orders of
 * magnitude: over one epidemic these files run from 0.0000 to 0.064, so a
 * Pearson correlation on the raw values is decided almost entirely by whichever
 * day happened to be largest, and a single bad sample outranks a whole wave.
 * On the log scale a doubling counts the same wherever it happens, which is how
 * exponential growth is actually compared.
 *
 * Zero and negative values become unknown rather than minus infinity: below the
 * detection limit means "we could not see it", not "there was none".
 */
export function asLog(series: ReadonlyArray<number | null>): Array<number | null> {
  return series.map((v) => (v === null || v === undefined || v <= 0 ? null : Math.log10(v)));
}

/**
 * Values improbably far from the rest of the series, as unknown.
 *
 * A single sample a hundred times the neighbouring week is a plant event or a
 * pipetting error, and Pearson has no defence against it: one such point can
 * set the sign of a whole episode. Removed rather than winsorised, because
 * pulling it to a threshold would keep a number nobody measured.
 *
 * The cut is in median-absolute-deviations, which is itself resistant — using a
 * standard deviation would let the outlier widen the very band meant to catch
 * it.
 */
export function withoutOutliers(
  series: ReadonlyArray<number | null>,
  mads = 6,
): { series: Array<number | null>; removed: number } {
  const seen = series.filter((v): v is number => v !== null && v !== undefined);
  if (seen.length < 8) return { series: series.slice(), removed: 0 };
  const sorted = seen.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const devs = seen.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  const mad = devs[Math.floor(devs.length / 2)]!;
  // A series with no spread has no outliers, only repetition.
  if (mad <= 0) return { series: series.slice(), removed: 0 };
  let removed = 0;
  const out = series.map((v) => {
    if (v === null || v === undefined) return null;
    if (Math.abs(v - median) / mad > mads) {
      removed++;
      return null;
    }
    return v;
  });
  return { series: out, removed };
}

export interface Peak {
  step: number;
  value: number;
}

export interface Fit {
  /** Steps where both series have a value. Everything below rests on this. */
  n: number;
  meanAbsoluteError: number | null;
  peakSimulated: Peak | null;
  peakObserved: Peak | null;
  /**
   * Simulated peak minus observed peak, in steps.
   *
   * The number to read first. A model that peaks eleven days late is wrong in a
   * way a high correlation hides completely.
   */
  peakOffset: number | null;
  /**
   * Pearson correlation over the overlapping steps.
   *
   * Reported last and never alone. Two curves that both rise and both fall
   * correlate strongly whether or not the model is right, so this says the
   * shapes are not unrelated — not that the model is good.
   */
  correlation: number | null;
}

function peakOf(series: ReadonlyArray<number | null>): Peak | null {
  let best: Peak | null = null;
  series.forEach((v, step) => {
    if (v === null) return;
    if (!best || v > best.value) best = { step, value: v };
  });
  return best;
}

export function compareSeries(
  simulated: ReadonlyArray<number | null>,
  observed: ReadonlyArray<number | null>,
): Fit {
  const pairs: Array<[number, number]> = [];
  const len = Math.min(simulated.length, observed.length);
  for (let i = 0; i < len; i++) {
    const a = simulated[i];
    const b = observed[i];
    if (a === null || a === undefined || b === null || b === undefined) continue;
    pairs.push([a, b]);
  }

  const peakSimulated = peakOf(simulated);
  const peakObserved = peakOf(observed);
  const fit: Fit = {
    n: pairs.length,
    meanAbsoluteError: null,
    peakSimulated,
    peakObserved,
    peakOffset:
      peakSimulated && peakObserved ? peakSimulated.step - peakObserved.step : null,
    correlation: null,
  };
  if (pairs.length === 0) return fit;

  fit.meanAbsoluteError =
    pairs.reduce((acc, [a, b]) => acc + Math.abs(a - b), 0) / pairs.length;

  // Two points always correlate perfectly and three nearly always do. Reported
  // as unknown rather than as 1.0, which reads as a model that nailed it.
  if (pairs.length < 4) return fit;

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const sa = pairs.map((p) => p[0]);
  const sb = pairs.map((p) => p[1]);
  const ma = mean(sa);
  const mb = mean(sb);
  let num = 0;
  let da = 0;
  let dbb = 0;
  for (let i = 0; i < pairs.length; i++) {
    const x = sa[i]! - ma;
    const y = sb[i]! - mb;
    num += x * y;
    da += x * x;
    dbb += y * y;
  }
  // A flat series has no variance to share. Undefined rather than zero, which
  // would read as "unrelated" when the truth is "nothing to relate".
  if (da === 0 || dbb === 0) return fit;
  fit.correlation = num / Math.sqrt(da * dbb);
  return fit;
}
