// ---------------------------------------------------------------------------
// The contract of an imported forecasting model, and the rule every model has
// to beat.
//
// The platform does not train this kind of model. It shows one the history it
// keeps and takes back a forecast. So that any model can be plugged in, there
// is one format, written here and versioned:
//
//   what a model is sent    for each target series, its history on a regular
//                           grid, gaps included; companion series of the past;
//                           companion series known ahead, given over the
//                           horizon too; the step; the horizon.
//   what a model sends back for each series and each step of the horizon, a
//                           low, a likely and a high value. Nothing else.
//
// Nothing in a request names a place or a person: a series travels under an
// opaque label ("s1"), and only this side knows which unit it is. A model
// hosted elsewhere receives counts and rates, and nothing to tie them to.
//
// An answer that does not keep the contract is refused with its reason, never
// repaired: a forecast with a value missing, a range out of order or a value
// the measure cannot take is not a forecast.
//
// The reference is "the same hour, a week before" (a day before, when there is
// less than a week of history). It is built in, calls no model and can always
// be computed. A model is shown only while it does better than that.
//
// No database here: everything in this file is checked without one.
// ---------------------------------------------------------------------------

/** The version of the format. A model says which one it speaks; another one is refused. */
export const CONTRACT_VERSION = 1;

export const FORECAST_STEPS = ["hour", "day"] as const;
export type ForecastStep = (typeof FORECAST_STEPS)[number];
export const STEP_MS: Record<ForecastStep, number> = { hour: 3_600_000, day: 86_400_000 };

/** The most steps a model is asked to forecast, and the most history it is shown. */
export const HORIZON_MAX = 336;
export const HISTORY_MAX = 2_160;
/** The most series one request carries. */
export const SERIES_MAX = 300;

export type Cell = number | null;

export interface RequestSeries {
  /** An opaque label, given back as it was sent. Never a name, never an identifier of the twin. */
  id: string;
  /** One value per step of the history, oldest first. A gap is null: never a zero, never filled in. */
  target: Cell[];
  /** Companion series known up to the origin: as long as `target`. */
  past?: Record<string, Cell[]>;
  /** Companion series known ahead: the history, then the horizon. */
  known?: Record<string, Cell[]>;
}

export interface ForecastRequest {
  contract: typeof CONTRACT_VERSION;
  step: ForecastStep;
  /** The start of the first step of the history. */
  historyStart: string;
  /** The start of the first step to forecast: the end of the history. */
  origin: string;
  /** How many steps of history each series carries. */
  history: number;
  /** How many steps to forecast. */
  horizon: number;
  series: RequestSeries[];
}

export interface ResponseSeries {
  id: string;
  low: number[];
  likely: number[];
  high: number[];
}

export interface ForecastResponse {
  contract: typeof CONTRACT_VERSION;
  /** What answered, in its own words. Kept with every forecast, never interpreted. */
  model?: { name?: string; version?: string };
  series: ResponseSeries[];
}

/** What a measure can be. A forecast outside it is refused, not clipped. */
export interface Bounds {
  min: number | null;
  max: number | null;
}

/**
 * The values a measure can take, from its unit.
 *
 * A count, a duration and a rate are never below zero. An occupancy can pass
 * 100 %: stretchers in corridors are what the measure is there to show, so
 * there is no ceiling. A plain number has no bound this side can know.
 */
export function boundsOf(unit: string | null | undefined): Bounds {
  return unit === "percent" || unit === "ratio" || unit === "count" || unit === "hours" ? { min: 0, max: null } : { min: null, max: null };
}

export type Checked = { ok: true; response: ForecastResponse } | { ok: false; why: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * An answer held against the request it answers, or the reason it is refused.
 *
 * The first thing wrong is said, in words a person who plugged the model in
 * can act on. Nothing is repaired: a range out of order is not sorted, a value
 * below zero is not raised to zero.
 */
export function checkForecast(request: Pick<ForecastRequest, "horizon" | "series">, answer: unknown, bounds: Bounds = { min: null, max: null }): Checked {
  const no = (why: string): Checked => ({ ok: false, why });
  if (!isObject(answer)) return no("The model did not answer with an object.");
  if (answer.contract !== CONTRACT_VERSION) {
    return no(`The model answers in version ${JSON.stringify(answer.contract ?? null)} of the contract; this platform speaks version ${CONTRACT_VERSION}.`);
  }
  if (!Array.isArray(answer.series)) return no("The answer has no list of series.");
  const asked = new Set(request.series.map((s) => s.id));
  const seen = new Set<string>();
  const series: ResponseSeries[] = [];
  for (const raw of answer.series as unknown[]) {
    if (!isObject(raw) || typeof raw.id !== "string") return no("A series of the answer has no label.");
    const id = raw.id;
    if (!asked.has(id)) return no(`The answer holds a series called “${id}”, which was not sent.`);
    if (seen.has(id)) return no(`The answer holds the series “${id}” twice.`);
    seen.add(id);
    const bands: Record<"low" | "likely" | "high", number[]> = { low: [], likely: [], high: [] };
    for (const band of ["low", "likely", "high"] as const) {
      const values = raw[band];
      if (!Array.isArray(values)) return no(`Series “${id}” has no ${band} values.`);
      if (values.length !== request.horizon) {
        return no(`Series “${id}” has ${values.length} ${band} value${values.length === 1 ? "" : "s"}, where the horizon is ${request.horizon} step${request.horizon === 1 ? "" : "s"}.`);
      }
      const bad = values.findIndex((v) => !isNumber(v));
      if (bad >= 0) return no(`Series “${id}”: the ${band} value of step ${bad + 1} is not a number.`);
      bands[band] = values as number[];
    }
    for (let h = 0; h < request.horizon; h++) {
      const [low, likely, high] = [bands.low[h]!, bands.likely[h]!, bands.high[h]!];
      if (low > likely || likely > high) {
        return no(`Series “${id}”, step ${h + 1}: the range is out of order (low ${low}, likely ${likely}, high ${high}).`);
      }
      if (bounds.min !== null && low < bounds.min) return no(`Series “${id}”, step ${h + 1}: ${low} is below ${bounds.min}, which this measure cannot be.`);
      if (bounds.max !== null && high > bounds.max) return no(`Series “${id}”, step ${h + 1}: ${high} is above ${bounds.max}, which this measure cannot be.`);
    }
    series.push({ id, ...bands });
  }
  const missing = request.series.find((s) => !seen.has(s.id));
  if (missing) return no(`The answer has no forecast for the series “${missing.id}”: ${seen.size} of ${request.series.length} came back.`);
  const said = isObject(answer.model) ? answer.model : null;
  return {
    ok: true,
    response: {
      contract: CONTRACT_VERSION,
      ...(said ? { model: { ...(typeof said.name === "string" ? { name: said.name } : {}), ...(typeof said.version === "string" ? { version: said.version } : {}) } } : {}),
      series,
    },
  };
}

/** A request held against the contract before it leaves: what this side must never send wrong. */
export function checkRequest(request: ForecastRequest): string | null {
  if (request.horizon < 1 || request.horizon > HORIZON_MAX) return `A horizon is 1 to ${HORIZON_MAX} steps.`;
  if (request.history < 1 || request.history > HISTORY_MAX) return `A history is 1 to ${HISTORY_MAX} steps.`;
  if (request.series.length === 0) return "There is no series to forecast.";
  if (request.series.length > SERIES_MAX) return `One request carries ${SERIES_MAX} series at most.`;
  for (const s of request.series) {
    if (s.target.length !== request.history) return `Series “${s.id}” carries ${s.target.length} values of history, where ${request.history} were announced.`;
    for (const [name, values] of Object.entries(s.past ?? {})) {
      if (values.length !== request.history) return `Series “${s.id}”: the companion “${name}” does not cover the history.`;
    }
    for (const [name, values] of Object.entries(s.known ?? {})) {
      if (values.length !== request.history + request.horizon) return `Series “${s.id}”: the companion “${name}” does not cover the history and the horizon.`;
    }
  }
  return null;
}

// --- the reference --------------------------------------------------------------------

/** One week and one day, in steps of the grid. */
export const seasonOf = (step: ForecastStep): { week: number; day: number } => (step === "hour" ? { week: 168, day: 24 } : { week: 7, day: 1 });

/** How many weeks (then days) back the reference looks for a value at the same hour. */
export const REFERENCE_WEEKS = 4;
export const REFERENCE_DAYS = 7;

export interface ReferenceSeries {
  id: string;
  /** Null where no earlier value at that hour was kept: the reference says nothing rather than something made up. */
  low: Cell[];
  likely: Cell[];
  high: Cell[];
  /** Which rule gave each step: the week before, the day before, or nothing. */
  rule: ("week" | "day" | null)[];
}

/**
 * The reference for one series: the same hour, a week before.
 *
 * For a step of the horizon, the value kept at the same hour one week earlier;
 * when that hour was a gap, two weeks earlier, and so on for four weeks. When
 * no week gives a value (less than a week of history, or a silent source), the
 * same hour the day before, up to seven days back. When nothing does, the step
 * has no reference.
 *
 * A horizon longer than a week is filled the same way: the same hour of the
 * last week that was kept.
 *
 * The range is not a model's: it is the lowest and the highest value kept at
 * that hour over those four weeks (or seven days). With a single value, the
 * range is that value.
 */
export function referenceOf(target: readonly Cell[], horizon: number, step: ForecastStep): Omit<ReferenceSeries, "id"> {
  const { week, day } = seasonOf(step);
  const n = target.length;
  const out: Omit<ReferenceSeries, "id"> = { low: [], likely: [], high: [], rule: [] };
  // The values kept at the same hour over the `most` periods before, most recent first.
  const sameHour = (h: number, period: number, most: number): number[] => {
    const found: number[] = [];
    // A step h ahead of the origin sits at index n + h: the first lag that falls inside the history.
    const first = Math.max(1, Math.ceil((h + 1) / period));
    for (let k = first; k < first + most; k++) {
      const at = n + h - k * period;
      if (at < 0) break;
      const v = target[at];
      if (v !== null && v !== undefined) found.push(v);
    }
    return found;
  };
  for (let h = 0; h < horizon; h++) {
    let found = sameHour(h, week, REFERENCE_WEEKS);
    let rule: "week" | "day" | null = found.length ? "week" : null;
    if (!found.length && day !== week) {
      found = sameHour(h, day, REFERENCE_DAYS);
      rule = found.length ? "day" : null;
    }
    if (!found.length) {
      out.low.push(null);
      out.likely.push(null);
      out.high.push(null);
      out.rule.push(null);
      continue;
    }
    out.likely.push(found[0]!);
    out.low.push(Math.min(...found));
    out.high.push(Math.max(...found));
    out.rule.push(rule);
  }
  return out;
}

/** The reference for every series of a request. Built in: no model is called. */
export function referenceForecast(request: Pick<ForecastRequest, "series" | "horizon" | "step">): ReferenceSeries[] {
  return request.series.map((s) => ({ id: s.id, ...referenceOf(s.target, request.horizon, request.step) }));
}

// --- scoring ------------------------------------------------------------------------------

export interface Score {
  /** Steps where the forecast, the reference and what was measured all have a value. */
  n: number;
  /** Mean absolute error of the model's likely value, in the measure's own unit. Null when nothing could be compared. */
  model: number | null;
  /** The reference's, over the very same steps. */
  reference: number | null;
  /** The share of measured values that fell inside the model's range, 0 to 1. */
  inside: number | null;
}

export interface Tally {
  n: number;
  model: number;
  reference: number;
  inside: number;
}

export const emptyTally = (): Tally => ({ n: 0, model: 0, reference: 0, inside: 0 });

/**
 * One forecast added to a tally, step by step of the horizon.
 *
 * A step counts only when the model, the reference and the measure all have a
 * value: the two errors are then over the very same steps, and neither is
 * flattered by a gap the other had to answer for.
 */
export function tallyInto(
  byHorizon: Tally[],
  forecast: { low: readonly Cell[]; likely: readonly Cell[]; high: readonly Cell[] },
  reference: { likely: readonly Cell[] },
  measured: readonly Cell[],
): void {
  for (let h = 0; h < byHorizon.length; h++) {
    const [f, r, m] = [forecast.likely[h], reference.likely[h], measured[h]];
    if (f === null || f === undefined || r === null || r === undefined || m === null || m === undefined) continue;
    const t = byHorizon[h]!;
    t.n += 1;
    t.model += Math.abs(f - m);
    t.reference += Math.abs(r - m);
    const [low, high] = [forecast.low[h], forecast.high[h]];
    if (low !== null && low !== undefined && high !== null && high !== undefined && m >= low && m <= high) t.inside += 1;
  }
}

const round = (v: number): number => Math.round(v * 1000) / 1000;

export function scoreOf(tallies: readonly Tally[]): Score {
  const sum = tallies.reduce((a, t) => ({ n: a.n + t.n, model: a.model + t.model, reference: a.reference + t.reference, inside: a.inside + t.inside }), emptyTally());
  if (sum.n === 0) return { n: 0, model: null, reference: null, inside: null };
  return { n: sum.n, model: round(sum.model / sum.n), reference: round(sum.reference / sum.n), inside: round(sum.inside / sum.n) };
}

/**
 * Whether a model does better than the reference, and the sentence that says so.
 *
 * Strictly better: a model that only ties the rule a person could apply by
 * hand has not earned its place on a screen. With nothing compared, nothing is
 * concluded.
 */
export function beatsReference(score: Score): { beats: boolean | null; why: string } {
  if (score.n === 0 || score.model === null || score.reference === null) {
    return { beats: null, why: "Nothing could be compared yet: no step has a forecast, a reference and a measure." };
  }
  if (score.model < score.reference) {
    return { beats: true, why: `Its error is ${score.model} against ${score.reference} for the reference, over ${score.n.toLocaleString("en-CA")} steps.` };
  }
  return { beats: false, why: `Its error is ${score.model}, which is not under the reference's ${score.reference}, over ${score.n.toLocaleString("en-CA")} steps.` };
}
