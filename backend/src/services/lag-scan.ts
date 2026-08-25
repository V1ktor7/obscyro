/**
 * Which signal leads which, and by how long — with the reasons to disbelieve it
 * computed in the same pass.
 *
 * Searching a hundred signals against a dozen lags is a machine for producing
 * confident nonsense, and it produces it in a form that looks exactly like a
 * discovery. Three things go wrong at once, so all three are answered here.
 *
 * **The series are not independent observations.** An epidemic curve is smooth:
 * today's hospital count is nearly yesterday's. Ninety daily points may carry
 * ten independent ones, and a correlation of 0.7 that would be overwhelming on
 * ninety samples is unremarkable on ten. This is the error that matters most
 * and the one almost nothing implements, so `effectiveSize` is computed first
 * and every verdict rests on it rather than on the raw count.
 *
 * **Many tests were run.** Twenty signals across fourteen lags is 280 chances
 * for noise to look like a lead. The threshold is raised accordingly.
 *
 * **The lag was chosen by looking.** Picking the lag that maximises correlation
 * and then reporting that correlation is circular. A holdout keeps a stretch of
 * the series out of the search so the lead can be checked on data it was not
 * fitted to.
 */

export interface LagPoint {
  /** Steps the signal leads the target by. Positive means it comes first. */
  lag: number;
  correlation: number;
  /** Overlapping steps at this lag. */
  n: number;
}

function pearson(a: readonly number[], b: readonly number[]): number | null {
  const n = a.length;
  if (n < 4) return null;
  const mean = (xs: readonly number[]) => xs.reduce((x, y) => x + y, 0) / xs.length;
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]! - ma;
    const y = b[i]! - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (da === 0 || db === 0) return null;
  return num / Math.sqrt(da * db);
}

/** Steps where both series have a value, the signal shifted forward by `lag`. */
function pairsAt(
  signal: ReadonlyArray<number | null>,
  target: ReadonlyArray<number | null>,
  lag: number,
): { a: number[]; b: number[] } {
  const a: number[] = [];
  const b: number[] = [];
  for (let t = 0; t < target.length; t++) {
    const s = signal[t - lag];
    const y = target[t];
    if (s === null || s === undefined || y === null || y === undefined) continue;
    a.push(s);
    b.push(y);
  }
  return { a, b };
}

export function crossCorrelate(
  signal: ReadonlyArray<number | null>,
  target: ReadonlyArray<number | null>,
  maxLag: number,
): LagPoint[] {
  const out: LagPoint[] = [];
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const { a, b } = pairsAt(signal, target, lag);
    const r = pearson(a, b);
    if (r === null) continue;
    out.push({ lag, correlation: r, n: a.length });
  }
  return out;
}

/**
 * How many independent observations two smooth series really carry.
 *
 * The Bartlett adjustment: `n × (1 − r₁ᵃr₁ᵇ) / (1 + r₁ᵃr₁ᵇ)`, where r₁ is each
 * series' correlation with itself one step back. Two curves that barely move
 * day to day have r₁ near one, and the effective count collapses — which is the
 * honest description of an epidemic curve, and the reason a correlation of 0.9
 * between two such curves is nearly uninformative.
 */
export function effectiveSize(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 4) return n;
  const auto = (xs: readonly number[]) => pearson(xs.slice(0, -1), xs.slice(1)) ?? 0;
  const ra = auto(a.slice(0, n));
  const rb = auto(b.slice(0, n));
  const p = ra * rb;
  // Anti-correlated series would inflate the count past what was observed,
  // which is not a claim worth making. Capped at the raw count, floored at the
  // four points a correlation needs to exist at all.
  if (p <= 0) return n;
  return Math.max(4, Math.min(n, Math.round((n * (1 - p)) / (1 + p))));
}

export interface Lead {
  /** Steps the signal leads by, where the correlation peaked. */
  lag: number;
  correlation: number;
  n: number;
  /** Independent observations behind that correlation. Read this, not `n`. */
  effectiveN: number;
  /** How many (signal, lag) combinations were tried to find this one. */
  testsRun: number;
  /**
   * Whether the correlation survives the effective size and the multiplicity.
   *
   * A rough two-sided t-test on `effectiveN − 2` degrees of freedom against a
   * threshold divided by `testsRun`. Deliberately coarse: it is a filter for
   * findings that cannot possibly be real, not a p-value to publish.
   */
  survives: boolean;
  /** The same correlation, measured on the stretch held out of the search. */
  holdoutCorrelation: number | null;
}

/** Student's t critical value at 5%, two-sided, by degrees of freedom. */
function tCritical(df: number, alpha: number): number {
  // A small table with a normal-approximation tail. Interpolating a full
  // distribution here would be precision this verdict does not have.
  const table: Record<number, number> = { 2: 4.303, 4: 2.776, 8: 2.306, 16: 2.12, 32: 2.037, 64: 2.0 };
  const base = df <= 2 ? 4.303 : df >= 64 ? 1.96 : (table[Object.keys(table).map(Number).reverse().find((k) => k <= df) ?? 2] ?? 2.5);
  // Bonferroni: a stricter alpha needs a larger critical value. The 1.6 factor
  // per decade is an approximation of the normal tail, good enough to separate
  // "cannot be real" from "worth a second look".
  const decades = Math.max(0, -Math.log10(alpha / 0.05));
  return base + 0.62 * decades * decades + 1.1 * decades;
}

export function findLead(
  signal: ReadonlyArray<number | null>,
  target: ReadonlyArray<number | null>,
  opts: { maxLag: number; testsRun?: number; holdoutFraction?: number },
): Lead | null {
  const holdout = Math.min(0.5, Math.max(0, opts.holdoutFraction ?? 0.3));
  const cut = Math.floor(target.length * (1 - holdout));
  // The lag is searched on the first stretch only. Choosing the lag that
  // maximises correlation and then reporting that same correlation is circular,
  // and the number it produces is always flattering.
  const searchSignal = signal.slice(0, cut);
  const searchTarget = target.slice(0, cut);

  const scan = crossCorrelate(
    holdout > 0 ? searchSignal : signal,
    holdout > 0 ? searchTarget : target,
    opts.maxLag,
  );
  if (scan.length === 0) return null;

  let best = scan[0]!;
  for (const p of scan) if (Math.abs(p.correlation) > Math.abs(best.correlation)) best = p;

  const { a, b } = pairsAt(
    holdout > 0 ? searchSignal : signal,
    holdout > 0 ? searchTarget : target,
    best.lag,
  );
  const effectiveN = effectiveSize(a, b);
  const testsRun = opts.testsRun ?? scan.length;

  const df = Math.max(1, effectiveN - 2);
  const t = Math.abs(best.correlation) * Math.sqrt(df / Math.max(1e-9, 1 - best.correlation ** 2));
  const survives = t > tCritical(df, 0.05 / Math.max(1, testsRun));

  let holdoutCorrelation: number | null = null;
  if (holdout > 0 && cut < target.length) {
    const rest = pairsAt(signal.slice(cut), target.slice(cut), best.lag);
    holdoutCorrelation = pearson(rest.a, rest.b);
  }

  return {
    lag: best.lag,
    correlation: best.correlation,
    n: best.n,
    effectiveN,
    testsRun,
    survives,
    holdoutCorrelation,
  };
}
