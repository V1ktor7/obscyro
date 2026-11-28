import type { Backtest, Companion, ForecastModel, ModelDraft, ModelOffer, ModelSource, Score, Standing, Verification } from "../forecast-models-api";

// ---------------------------------------------------------------------------
// Imported models, as the Models section words them. No screen here.
//
// A model goes through the same steps, in the same order, before anything of
// it reaches a map: imported, its contract checked on a sample, replayed on the
// past, put on trial, and shown only while a rule fixed in advance says so.
// The sentences below say where a model is on that road, and why.
// ---------------------------------------------------------------------------

/** The two rules a model has to beat, as the server names them. */
export const RULE_WEEK = "the same hour a week before";
export const RULE_HELD = "the last value holds";

/** What the twin does not hold: no model can be shown it, and the screen says so. */
export const NOT_IN_THE_TWIN = "Ward beds, staff and calls to 811 are not in the twin. No model can be shown them, and a forecast made without them does not see them.";

// --- the road a model travels -------------------------------------------------------------

export type RoadStep = "imported" | "verified" | "tried" | "on_trial" | "shown";
export const ROAD: readonly { id: RoadStep; label: string }[] = [
  { id: "imported", label: "Imported" },
  { id: "verified", label: "Contract checked" },
  { id: "tried", label: "Replayed on the past" },
  { id: "on_trial", label: "On trial" },
  { id: "shown", label: "Shown" },
];

/** How far a model has come: every step up to its state is done, and "shown" only when the rule says so. */
export function roadOf(model: Pick<ForecastModel, "state" | "standing">): { id: RoadStep; label: string; done: boolean }[] {
  const reached = ROAD.findIndex((s) => s.id === model.state);
  const shown = model.state === "on_trial" && model.standing?.shown === true;
  return ROAD.map((s, i) => ({ ...s, done: s.id === "shown" ? shown : i <= reached }));
}

/** Where a model comes from, in a few words. */
export function sourceText(model: Pick<ForecastModel, "source" | "serviceModel" | "endpointUrl">): string {
  if (model.source === "reference") return `The reference rule, “${RULE_WEEK}”. Built in: no model is called.`;
  if (model.source === "service") return `An open model, “${model.serviceModel}”, served by the model service.`;
  let host = "an address";
  try {
    host = new URL(model.endpointUrl ?? "").host;
  } catch {
    // An address that cannot be read is said as such, and never shown whole: it could hold a key.
  }
  return `A model hosted at ${host}, which speaks the contract.`;
}

/** What a model forecasts, for where, how far, and from how much history. */
export function shapeText(model: Pick<ForecastModel, "metric" | "units" | "step" | "historySteps" | "horizonSteps">, measureLabel: string | null): string {
  const steps = (n: number) => (model.step === "hour" ? (n % 24 === 0 && n >= 48 ? `${n / 24} days` : `${n} hours`) : `${n} days`);
  const where = model.units ? `${model.units.length} unit${model.units.length === 1 ? "" : "s"}` : "every unit that carries it";
  return `${measureLabel ?? model.metric}, for ${where}: the next ${steps(model.horizonSteps)}, by the ${model.step}, from ${steps(model.historySteps)} of history.`;
}

// --- errors, in the measure's own words ---------------------------------------------------

/** The unit an error is counted in: an occupancy is off by points, not by percent of itself. */
export function errorUnit(unit: string | null | undefined): string {
  if (unit === "percent") return "points";
  if (unit === "hours") return "hours";
  return "";
}

const num = (v: number): string => v.toLocaleString("en-CA", { maximumFractionDigits: 1 });

/** "6.2 points" */
export function errorText(v: number | null, unit: string | null | undefined): string {
  if (v === null) return "nothing to compare";
  const u = errorUnit(unit);
  return u ? `${num(v)} ${u}` : num(v);
}

export interface ErrorLine {
  who: string;
  value: string;
  /** True for the lowest of the three: the one to beat, or the one that won. */
  best: boolean;
}

/** The three errors side by side, the model first, with the lowest marked. Empty when nothing was compared. */
export function errorLines(score: Score, unit: string | null | undefined, modelLabel: string): ErrorLine[] {
  if (score.n === 0 || score.model === null || score.reference === null || score.held === null) return [];
  const low = Math.min(score.model, score.reference, score.held);
  return [
    { who: modelLabel, value: errorText(score.model, unit), best: score.model === low },
    { who: `“${RULE_HELD}”`, value: errorText(score.held, unit), best: score.held === low },
    { who: `“${RULE_WEEK}”`, value: errorText(score.reference, unit), best: score.reference === low },
  ];
}

/** The steps of the horizon a table shows: 1, 6, 12, 24, 48, 72 and the last, where the horizon reaches them. */
export function horizonPicks(horizon: number): number[] {
  const picks = [1, 6, 12, 24, 48, 72, 168, 336].filter((h) => h <= horizon);
  return picks[picks.length - 1] === horizon ? picks : [...picks, horizon];
}

export interface HorizonRow {
  step: number;
  n: number;
  model: string;
  held: string;
  reference: string;
  /** Whether the model does strictly better than both rules at this step; null when nothing was compared. */
  beats: boolean | null;
}

/** How the three errors grow as the forecast looks further. */
export function horizonRows(byHorizon: readonly Score[], unit: string | null | undefined): HorizonRow[] {
  return horizonPicks(byHorizon.length).map((h) => {
    const s = byHorizon[h - 1]!;
    const compared = s.n > 0 && s.model !== null && s.held !== null && s.reference !== null;
    return {
      step: h,
      n: s.n,
      model: errorText(s.model, unit),
      held: errorText(s.held, unit),
      reference: errorText(s.reference, unit),
      beats: compared ? s.model! < Math.min(s.held!, s.reference!) : null,
    };
  });
}

/** What a replay says, in order: how much was compared, what stopped it, and the verdict. */
export function backtestText(b: Backtest): string[] {
  const out: string[] = [];
  const asked = b.origins.filter((o) => o.series > 0).length;
  out.push(
    b.overall.n === 0
      ? `Replayed over ${b.days} day${b.days === 1 ? "" : "s"}: nothing could be compared.`
      : `Replayed over ${b.days} day${b.days === 1 ? "" : "s"}: ${asked} forecast${asked === 1 ? "" : "s"} made with what was known then, ${b.overall.n.toLocaleString("en-CA")} steps held against what was measured since.`,
  );
  if (b.stopped) out.push(b.stopped);
  out.push(b.verdict.why);
  return out;
}

/** What the display rule says of a model on trial, in order. */
export function standingText(s: Standing): string[] {
  const out = [
    s.forecasts === 0
      ? "No forecast has been frozen yet."
      : `${s.forecasts.toLocaleString("en-CA")} forecast${s.forecasts === 1 ? "" : "s"} frozen over the last ${s.windowDays} days, made at ${s.origins} origin${s.origins === 1 ? "" : "s"}.`,
  ];
  out.push(s.shown ? `Shown. ${s.why}` : `Not shown. ${s.why}`);
  return out;
}

/** What left the server when a contract was checked, in a sentence. */
export function sentText(v: Verification): string {
  if (v.sent.series === 0) return "Nothing was sent.";
  const companions = v.sent.companions.length ? `, with the companion series ${v.sent.companions.join(", ")}` : "";
  const size = v.sent.bytes >= 1024 ? `${Math.round(v.sent.bytes / 1024).toLocaleString("en-CA")} kB` : `${v.sent.bytes} bytes`;
  return `${v.sent.series} series under opaque labels, ${v.sent.history} steps of history each${companions}: ${size}. No unit is named.`;
}

// --- the form -----------------------------------------------------------------------------------

export interface ModelForm {
  label: string;
  source: ModelSource;
  serviceModel: string;
  endpointUrl: string;
  endpointKeyEnv: string;
  metric: string;
  step: "hour" | "day";
  /** How far it forecasts, and how much history it is shown, in steps. */
  horizonSteps: string;
  historySteps: string;
  minHistoryDays: string;
  holdHours: string;
  companions: Companion[];
  timeZone: string;
}

export const blankModelForm = (): ModelForm => ({
  label: "",
  source: "reference",
  serviceModel: "chronos-2",
  endpointUrl: "",
  endpointKeyEnv: "",
  metric: "",
  step: "hour",
  horizonSteps: "72",
  historySteps: "336",
  minHistoryDays: "14",
  holdHours: "3",
  companions: [],
  timeZone: "",
});

/** A name a model can receive a companion under, from what it is: `air_quality`, `quebec_influenza`. */
export function companionName(text: string, taken: readonly string[]): string {
  const base =
    text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^[_0-9]+|_+$/g, "")
      .slice(0, 36) || "series";
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) if (!taken.includes(`${base}_${n}`)) return `${base}_${n}`;
}

/** The companions a form can add, from what the project keeps: other measures, declared series, the calendar. */
export function companionChoices(offer: ModelOffer, metric: string): { value: string; label: string; kind: "past" | "known"; entities: string[] }[] {
  return [
    ...offer.measures.filter((m) => m.key !== metric).map((m) => ({ value: `twin:${m.key}`, label: `${m.label} (a measure of the twin, at the same unit)`, kind: "past" as const, entities: [] })),
    ...offer.series.map((s) => ({ value: s.key, label: `${s.label} (a kept series)`, kind: "past" as const, entities: s.entities })),
    ...offer.calendar.map((c) => ({ value: c, label: c === "calendar:hour" ? "The hour of the day (known ahead)" : "The day of the week (known ahead)", kind: "known" as const, entities: [] })),
  ];
}

/** Where a form's request would go, said before anything is imported. */
export function leavesText(f: Pick<ModelForm, "source" | "endpointUrl">, offer: Pick<ModelOffer, "service">): string {
  if (f.source === "reference") return "Nothing leaves this server: the reference is computed here.";
  const what = "Counts and rates under opaque labels (s1, s2…) leave this server. No unit's name or identifier does, and nothing about a person.";
  if (f.source === "service") return offer.service.configured ? `${what} They go to the model service.` : `${what} They would go to the model service, which is not configured: this model cannot be called yet.`;
  let host = "the address you give";
  try {
    host = new URL(f.endpointUrl).host || host;
  } catch {
    // Not an address yet.
  }
  return `${what} They go to ${host}, outside this platform.`;
}

const whole = (s: string): number | null => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);

/**
 * What the server is sent for a form, or what to correct first.
 *
 * The server checks the rest: that the measure and the companions are things
 * the project keeps, that the address is public, and that the key's variable
 * carries the right prefix.
 */
export function draftOfModel(f: ModelForm, offer: Pick<ModelOffer, "keyPrefix" | "limits">): { draft: ModelDraft; problems: string[] } {
  const problems: string[] = [];
  if (!f.label.trim()) problems.push("Give the model a name.");
  if (!f.metric) problems.push("Pick the measure it forecasts.");
  if (f.source === "service" && !f.serviceModel.trim()) problems.push("Name the open model the model service serves.");
  if (f.source === "endpoint") {
    if (!/^https:\/\//.test(f.endpointUrl.trim())) problems.push("Give the model's address, starting with https://.");
    const keyEnv = f.endpointKeyEnv.trim();
    if (keyEnv && !keyEnv.startsWith(offer.keyPrefix)) problems.push(`The key is named by a variable that starts with ${offer.keyPrefix}. Give that name, never the key itself.`);
  }
  const horizon = whole(f.horizonSteps);
  const history = whole(f.historySteps);
  const minDays = whole(f.minHistoryDays);
  if (horizon === null || horizon < 1 || horizon > offer.limits.horizonMax) problems.push(`A horizon is 1 to ${offer.limits.horizonMax} steps.`);
  const floor = f.step === "hour" ? 24 : 7;
  if (history === null || history < floor || history > offer.limits.historyMax) problems.push(`A history is ${floor} to ${offer.limits.historyMax.toLocaleString("en-CA")} steps.`);
  if (minDays === null || minDays < 1 || minDays > 365) problems.push("The history a unit needs is 1 to 365 days.");
  const hold = f.holdHours.trim() === "" ? null : Number(f.holdHours);
  if (hold !== null && !(Number.isFinite(hold) && hold > 0)) problems.push("How long a value holds is a number of hours, or nothing.");
  if (f.companions.some((c) => c.kind === "known") && !f.timeZone.trim()) problems.push("The hour of the day is an hour somewhere: give the time zone, such as America/Toronto.");
  if (f.companions.some((c) => c.kind === "past" && !c.series.startsWith("twin:") && !c.entity)) problems.push("Say which entity of each kept series to show the model.");
  return {
    draft: {
      label: f.label.trim(),
      source: f.source,
      serviceModel: f.source === "service" ? f.serviceModel.trim() : null,
      endpointUrl: f.source === "endpoint" ? f.endpointUrl.trim() : null,
      endpointKeyEnv: f.source === "endpoint" && f.endpointKeyEnv.trim() ? f.endpointKeyEnv.trim() : null,
      metric: f.metric,
      units: null,
      step: f.step,
      historySteps: history ?? 0,
      horizonSteps: horizon ?? 0,
      holdHours: hold,
      minHistoryDays: minDays ?? 14,
      companions: f.companions,
      timeZone: f.timeZone.trim() || null,
    },
    problems,
  };
}
