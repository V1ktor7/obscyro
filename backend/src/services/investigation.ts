import { ANALYST_MODEL, type LoopEvent, type LoopResult, type Step } from "./analyst.js";
import { MAX_SEARCHES, type EventsFinding, type EventsProposal } from "./analyst-events.js";
import type { HealthEvent } from "./health-events.js";
import { compareOp, type TwinAlertOp, type TwinAlertRuleRow, type TwinAlertSeverity } from "./twin.js";
import { dayOn, type ReadingsBetween } from "./twin-history.js";

// ---------------------------------------------------------------------------
// An investigation: what was published around a unit, set beside what the
// twin measured there.
//
// A person looks at the series of one measure at one unit and asks what was
// going on around it. Two things answer, and they are kept apart:
//
//   the program   reads the series the twin kept, marks the stretches where the
//                 measure sat beyond its alert threshold (episodes), reads the
//                 calendar of validated events and the nearest units, and,
//                 once events are found, sets each one beside the series: the
//                 episode it goes with, how many days apart, the mean of the
//                 days before and after, and the reasons to doubt the pairing.
//
//   the model     searches the project's allowed web sources for events, as
//                 the event finder does (`analyst-events.ts`), from the
//                 sentence the person sent and nothing else.
//
// The model never sees the series. It has no tool that reads the twin in this
// exchange, and what the program read is not put in its messages: nothing of
// the organisation's can end up in a web search. The comparison is arithmetic
// done here, on readings that were kept and on dates a source published.
//
// Every piece of work is a step, written to the stream as it ends and kept in
// the journal: the program's are numbered p1, p2, …, the search's s1, s2, ….
//
// What it says is a coincidence in time. An event that starts two days before
// an episode is published on one side and measured on the other; the link
// between them is a supposition, and the result says so.
// ---------------------------------------------------------------------------

/** An event that starts more than this many days before an episode is not said to go with it. */
export const LEAD_MAX_DAYS = 7;
/** Days averaged on each side of an event's first day. */
export const AROUND_DAYS = 3;
/** Two stretches beyond the threshold closer than this are one episode: a dip of a few hours is not the end of it. */
export const EPISODE_GAP_HOURS = 24;
/** How many of the nearest units are read beside the one investigated. */
export const NEIGHBOURS = 3;
/** The longest span one investigation reads. */
export const SPAN_MAX_DAYS = 366;

const DAY_MS = 86_400_000;
const dayMs = (day: string): number => Date.parse(`${day}T00:00:00Z`);
/** Whole days from `a` to `b`: positive when `b` is later. */
export const daysFrom = (a: string, b: string): number => Math.round((dayMs(b) - dayMs(a)) / DAY_MS);
export const addDays = (day: string, n: number): string => new Date(dayMs(day) + n * DAY_MS).toISOString().slice(0, 10);
const iso = (ms: number): string => new Date(ms).toISOString();
const mean = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0) / values.length;

// ---------------------------------------------------------------------------
// The series.
// ---------------------------------------------------------------------------

/** One reading of the series: from `at`, the measure had this value, until the next reading. */
export interface SeriesPoint {
  at: string;
  /** Null: the measure had no value from then on. A gap is not a zero. */
  value: number | null;
}

/**
 * The readings kept over a span, as a staircase.
 *
 * A reading stands at the time its source says it was true, or failing that at
 * the time it was written down: the same rule the unit's sheet draws its
 * history by. The reading in force when the span begins is its first point.
 */
export function seriesOf(kept: Pick<ReadingsBetween, "opening" | "readings">, from: Date): SeriesPoint[] {
  const start = from.getTime();
  const points: SeriesPoint[] = [];
  if (kept.opening) points.push({ at: iso(start), value: kept.opening.value });
  for (const r of kept.readings) {
    points.push({ at: iso(Math.max(start, Date.parse(r.observedAt ?? r.recordedAt))), value: r.value });
  }
  // Two readings at the same instant keep the order they were written in.
  return points
    .map((p, i) => ({ p, i }))
    .sort((a, b) => Date.parse(a.p.at) - Date.parse(b.p.at) || a.i - b.i)
    .map((x) => x.p);
}

export interface DayValue {
  day: string;
  /** Null when the measure had no value that day. */
  value: number | null;
  /** Readings with a value dated that day; zero when the day rests on the value in force when it began. */
  readings: number;
}

/**
 * One value a day, from `firstDay` to `lastDay`, on the clock of `zone`.
 *
 * A day's value is the mean of the readings dated that day. A day with none
 * keeps the value in force when it began, since a value holds until the next
 * reading. Nothing is filled in before the first reading.
 */
export function dailyOf(points: readonly SeriesPoint[], zone: string, firstDay: string, lastDay: string): DayValue[] {
  const valued = new Map<string, number[]>();
  // The last reading of each day, valued or not: what the next day begins with.
  const closing = new Map<string, number | null>();
  for (const p of points) {
    const day = dayOn(new Date(p.at), zone);
    if (p.value !== null) valued.set(day, [...(valued.get(day) ?? []), p.value]);
    closing.set(day, p.value);
  }
  const read = [...closing.keys()].sort();
  const out: DayValue[] = [];
  let carried: number | null = null;
  let k = 0;
  for (let day = firstDay; day <= lastDay; day = addDays(day, 1)) {
    while (k < read.length && read[k]! < day) carried = closing.get(read[k++]!) ?? null;
    const own = valued.get(day);
    out.push(own?.length ? { day, value: mean(own), readings: own.length } : { day, value: carried, readings: 0 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Episodes: where the measure sat beyond its alert threshold.
// ---------------------------------------------------------------------------

/** The threshold an episode is counted against: an alert rule of the project, never a figure made up here. */
export interface AlertLine {
  ruleId: string;
  op: TwinAlertOp;
  threshold: number;
  severity: TwinAlertSeverity;
}

const RANK: Record<TwinAlertSeverity, number> = { info: 0, warn: 1, critical: 2 };

/**
 * The alert rule a unit's episodes are counted against, when one covers the
 * measure: the least severe, which is where an alert begins.
 */
export function lineFor(rules: readonly TwinAlertRuleRow[], metric: string, unitKind: string | null): AlertLine | null {
  const fits = rules.filter((r) => r.metric === metric && (!r.unitKind || r.unitKind === unitKind));
  const first = [...fits].sort((a, b) => RANK[a.severity] - RANK[b.severity])[0];
  return first ? { ruleId: first.id, op: first.op, threshold: first.threshold, severity: first.severity } : null;
}

export interface SeriesEpisode {
  /** "e1", "e2", …, oldest first. */
  id: string;
  startsAt: string;
  /** Null when the measure is still beyond the threshold where the span ends. */
  endsAt: string | null;
  startDay: string;
  /** The day it ends, or the last day of the span when it has not ended. */
  endDay: string;
  /** The value furthest beyond the threshold, and when. */
  peak: number;
  peakAt: string;
  /** Readings beyond the threshold it is made of. */
  readings: number;
  /** Neighbouring units that were in an episode of their own over the same days. */
  sharedWith: string[];
}

/**
 * The stretches of a series beyond a threshold.
 *
 * An episode starts at the first reading beyond the threshold and ends at the
 * first reading back within it, or with no value. Two stretches less than
 * `EPISODE_GAP_HOURS` apart are one.
 */
export function episodesOf(points: readonly SeriesPoint[], line: Pick<AlertLine, "op" | "threshold">, to: Date, zone: string): SeriesEpisode[] {
  interface Stretch {
    start: number;
    end: number | null;
    peak: number;
    peakAt: number;
    readings: number;
  }
  const further = (a: number, b: number): boolean => Math.abs(a - line.threshold) > Math.abs(b - line.threshold);
  const stretches: Stretch[] = [];
  let open: Stretch | null = null;
  for (const p of points) {
    const t = Date.parse(p.at);
    if (p.value !== null && compareOp(line.op, p.value, line.threshold)) {
      if (!open) {
        open = { start: t, end: null, peak: p.value, peakAt: t, readings: 0 };
        stretches.push(open);
      }
      open.readings += 1;
      if (further(p.value, open.peak)) {
        open.peak = p.value;
        open.peakAt = t;
      }
    } else if (open) {
      open.end = t;
      open = null;
    }
  }

  const merged: Stretch[] = [];
  for (const s of stretches) {
    const prior = merged[merged.length - 1];
    if (prior && prior.end !== null && s.start - prior.end < EPISODE_GAP_HOURS * 3_600_000) {
      prior.end = s.end;
      prior.readings += s.readings;
      if (further(s.peak, prior.peak)) {
        prior.peak = s.peak;
        prior.peakAt = s.peakAt;
      }
    } else {
      merged.push({ ...s });
    }
  }

  return merged.map((s, i) => ({
    id: `e${i + 1}`,
    startsAt: iso(s.start),
    endsAt: s.end === null ? null : iso(s.end),
    startDay: dayOn(new Date(s.start), zone),
    endDay: dayOn(new Date(s.end ?? to.getTime()), zone),
    peak: s.peak,
    peakAt: iso(s.peakAt),
    readings: s.readings,
    sharedWith: [],
  }));
}

// ---------------------------------------------------------------------------
// Neighbours: is the episode peculiar to this unit?
// ---------------------------------------------------------------------------

/** A unit with a place on the map, as the network page holds it. */
export interface PlacedUnit {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  /** True when the unit has a value for the measure investigated. */
  measures: boolean;
}

export interface Neighbour {
  id: string;
  name: string;
  km: number;
}

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance, in kilometres. */
export function kmBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const h =
    Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The nearest units that report the same measure.
 *
 * `placed` is false when the unit investigated has no coordinates: its
 * neighbours cannot be named, and nothing is guessed in their place.
 */
export function nearestTo(unitId: string, units: readonly PlacedUnit[], n: number = NEIGHBOURS): { placed: boolean; units: Neighbour[] } {
  const self = units.find((u) => u.id === unitId);
  if (!self || self.latitude === null || self.longitude === null) return { placed: false, units: [] };
  const here = { latitude: self.latitude, longitude: self.longitude };
  const seen = new Set<string>([unitId]);
  const others: Neighbour[] = [];
  for (const u of units) {
    if (seen.has(u.id) || !u.measures || u.latitude === null || u.longitude === null) continue;
    seen.add(u.id);
    others.push({ id: u.id, name: u.name, km: Math.round(kmBetween(here, { latitude: u.latitude, longitude: u.longitude }) * 10) / 10 });
  }
  return { placed: true, units: others.sort((a, b) => a.km - b.km).slice(0, n) };
}

export interface NeighbourReading extends Neighbour {
  /** Readings with a value kept for it over the span. */
  readings: number;
  episodes: Pick<SeriesEpisode, "startsAt" | "endsAt" | "startDay" | "endDay" | "peak">[];
}

/** Names, on each episode, the neighbours that were in an episode of their own over the same days. */
export function shareEpisodes(episodes: readonly SeriesEpisode[], neighbours: readonly NeighbourReading[]): SeriesEpisode[] {
  return episodes.map((e) => ({
    ...e,
    sharedWith: neighbours.filter((n) => n.episodes.some((o) => o.startDay <= e.endDay && o.endDay >= e.startDay)).map((n) => n.name),
  }));
}

// ---------------------------------------------------------------------------
// An event beside the series.
// ---------------------------------------------------------------------------

export interface EventToPlace {
  /** A candidate of the search ("c1"), or a validated event of the calendar ("h:<id>"). */
  ref: string;
  from: "candidate" | "calendar";
  title: string;
  startsOn: string | null;
  endsOn: string | null;
}

/** The mean of the days on one side of an event, and how many days it is made of. */
export interface Around {
  mean: number | null;
  days: number;
}

/** A reason, found by the program, not to read too much into a pairing. */
export type Doubt =
  /** No date: it cannot be placed on the series. */
  | { kind: "no_date" }
  /** It starts before the span that was read, or after it. */
  | { kind: "outside_span"; side: "before" | "after" }
  /** No day with a value before it: the change cannot be measured. */
  | { kind: "nothing_before" }
  | { kind: "nothing_after" }
  /** The episode had begun this many days before the event. */
  | { kind: "starts_after"; days: number }
  /** Other events go with the same episode: the series cannot tell them apart. */
  | { kind: "shared"; with: string[] };

export interface Comparison extends EventToPlace {
  /** The episode it goes with, when there is one. */
  episode: string | null;
  /** The episode's first day minus the event's: positive when the event starts first. Null without an episode. */
  leadDays: number | null;
  /** Null when the event cannot be placed on the series. */
  before: Around | null;
  after: Around | null;
  /** The mean after minus the mean before; null when either side has no day. */
  delta: number | null;
  doubts: Doubt[];
}

function goesWith(startDay: string, episodes: readonly SeriesEpisode[]): { episode: SeriesEpisode; lead: number } | null {
  let best: { episode: SeriesEpisode; lead: number } | null = null;
  for (const episode of episodes) {
    const lead = daysFrom(startDay, episode.startDay);
    const inside = lead < 0 && startDay <= episode.endDay;
    const ahead = lead >= 0 && lead <= LEAD_MAX_DAYS;
    if (!inside && !ahead) continue;
    // The nearest wins; at the same distance, the one the event comes before.
    const nearer = !best || Math.abs(lead) < Math.abs(best.lead) || (Math.abs(lead) === Math.abs(best.lead) && lead >= 0 && best.lead < 0);
    if (nearer) best = { episode, lead };
  }
  return best;
}

/**
 * Each event set beside the series.
 *
 * An event goes with an episode when it starts at most `LEAD_MAX_DAYS` before
 * the episode does, or during it. The means are those of the `AROUND_DAYS`
 * days before its first day and of the `AROUND_DAYS` days from it. Nothing
 * here weighs a cause: it says what coincides, and what weakens the reading.
 */
export function compareEvents(
  events: readonly EventToPlace[],
  days: readonly DayValue[],
  episodes: readonly SeriesEpisode[],
  span: { fromDay: string; toDay: string },
): Comparison[] {
  const valueOn = new Map(days.map((d) => [d.day, d.value]));
  const around = (first: string, count: number): Around => {
    const values: number[] = [];
    for (let i = 0; i < count; i++) {
      const v = valueOn.get(addDays(first, i));
      if (v !== null && v !== undefined) values.push(v);
    }
    return { mean: values.length ? mean(values) : null, days: values.length };
  };

  const placed = events.map((e): Comparison => {
    const none = { episode: null, leadDays: null, before: null, after: null, delta: null };
    if (!e.startsOn) return { ...e, ...none, doubts: [{ kind: "no_date" }] };
    if (e.startsOn < span.fromDay) return { ...e, ...none, doubts: [{ kind: "outside_span", side: "before" }] };
    if (e.startsOn > span.toDay) return { ...e, ...none, doubts: [{ kind: "outside_span", side: "after" }] };

    const before = around(addDays(e.startsOn, -AROUND_DAYS), AROUND_DAYS);
    const after = around(e.startsOn, AROUND_DAYS);
    const pair = goesWith(e.startsOn, episodes);
    const doubts: Doubt[] = [];
    if (pair && pair.lead < 0) doubts.push({ kind: "starts_after", days: -pair.lead });
    if (before.days === 0) doubts.push({ kind: "nothing_before" });
    if (after.days === 0) doubts.push({ kind: "nothing_after" });
    return {
      ...e,
      episode: pair?.episode.id ?? null,
      leadDays: pair ? pair.lead : null,
      before,
      after,
      delta: before.mean !== null && after.mean !== null ? after.mean - before.mean : null,
      doubts,
    };
  });

  return placed.map((c) => {
    if (c.episode === null) return c;
    const others = placed.filter((o) => o.ref !== c.ref && o.episode === c.episode).map((o) => o.ref);
    return others.length ? { ...c, doubts: [...c.doubts, { kind: "shared", with: others }] } : c;
  });
}

// ---------------------------------------------------------------------------
// The investigation, start to end.
// ---------------------------------------------------------------------------

export interface InvestigationInput {
  unit: { id: string; name: string; kind: string | null };
  metric: string;
  from: Date;
  to: Date;
  /** The clock days are counted on. */
  zone: string;
  /** What the person sent, word for word: the only thing the search is given. */
  request: string;
  /** The project's allowed web sources. */
  domains: string[];
}

/** What the program reads. Passed in, so a test can hand it readings and the route the database. */
export interface InvestigationReads {
  series(unitId: string): Promise<ReadingsBetween>;
  rules(): Promise<TwinAlertRuleRow[]>;
  calendar(fromDay: string, toDay: string): Promise<HealthEvent[]>;
  placed(): Promise<PlacedUnit[]>;
}

type SearchResult = LoopResult<EventsProposal, EventsFinding>;
/** The event finder, run on the person's sentence. It is handed nothing the program read. */
export type Search = (onEvent: (e: LoopEvent<EventsProposal, EventsFinding>) => void) => Promise<SearchResult>;

export interface Investigated {
  unit: { id: string; name: string };
  metric: string;
  from: string;
  to: string;
  zone: string;
  series: {
    /** Readings kept over the span, and how many of them hold a value. */
    readings: number;
    valued: number;
    low: number | null;
    high: number | null;
    /** The first day of the span that has a value. */
    firstDay: string | null;
    /** When the first reading of this measure at this unit was kept, in the whole history. */
    since: string | null;
    cut: boolean;
  };
  /** Null when no alert rule covers the measure: there are then no episodes. */
  line: AlertLine | null;
  episodes: SeriesEpisode[];
  neighbours: NeighbourReading[];
  /** Validated events of the calendar that fall in the span. */
  calendar: { id: string; title: string; startsOn: string; endsOn: string | null; url: string }[];
  compared: Comparison[];
  /** What the comparison cannot say, written by the program. */
  limits: string[];
}

/** What the person receives: the search's candidates, and what the program measured beside them. */
export interface Investigation extends EventsProposal {
  investigation: Investigated;
}

export type InvestigationResult = LoopResult<Investigation, EventsFinding>;
export type InvestigationEvent = LoopEvent<Investigation, EventsFinding>;

const NOT_A_CAUSE =
  "An event that goes with an episode coincides with it in time: one is published by a source, the other measured by the twin. " +
  "Nothing here establishes that one caused the other.";

/**
 * Read the series, search for events, set each one beside the series.
 *
 * Steps are written to `onEvent` as they end. The search runs only when the
 * span holds a value: without a series there is nothing to compare with, and
 * no search is paid for.
 */
export async function investigate(
  input: InvestigationInput,
  reads: InvestigationReads,
  search: Search,
  onEvent: (e: InvestigationEvent) => void,
): Promise<InvestigationResult> {
  const steps: Step[] = [];
  const say = (message: string) => onEvent({ type: "status", message });

  /** One piece of the program's work, timed, written down and sent. A failure is a step too. */
  async function step<T>(tool: string, stepInput: unknown, work: () => Promise<{ output: unknown; record?: unknown; value: T }>): Promise<T | null> {
    const started = Date.now();
    const id = `p${steps.filter((s) => s.id.startsWith("p")).length + 1}`;
    let made: Step;
    let value: T | null = null;
    try {
      const done = await work();
      value = done.value;
      made = { id, tool, input: stepInput, ok: true, output: done.output, ms: Date.now() - started, ...(done.record === undefined ? {} : { record: done.record }) };
    } catch (err) {
      made = { id, tool, input: stepInput, ok: false, output: { error: err instanceof Error ? err.message : "The read failed." }, ms: Date.now() - started };
    }
    steps.push(made);
    onEvent({ type: "step", step: made });
    return value;
  }

  const fromDay = dayOn(input.from, input.zone);
  const toDay = dayOn(input.to, input.zone);
  // The unit's id travels with the first step: the journal lists the investigations of a unit by it, answered or not.
  const span = { unit: input.unit.name, unit_id: input.unit.id, measure: input.metric, from: input.from.toISOString(), to: input.to.toISOString() };

  // 1. The series, and where it sat beyond the alert threshold.
  say("Reading the series the twin kept");
  const read = await step("twin_series", span, async () => {
    const kept = await reads.series(input.unit.id);
    const points = seriesOf(kept, input.from);
    const values = points.flatMap((p) => (p.value === null ? [] : [p.value]));
    const line = lineFor(await reads.rules(), input.metric, input.unit.kind);
    const episodes = line ? episodesOf(points, line, input.to, input.zone) : [];
    const firstValued = points.find((p) => p.value !== null);
    const caught = kept.readings.filter((r) => r.replayed).length;
    const series = {
      readings: kept.readings.length,
      valued: values.length,
      low: values.length ? Math.min(...values) : null,
      high: values.length ? Math.max(...values) : null,
      firstDay: firstValued ? dayOn(new Date(firstValued.at), input.zone) : null,
      since: kept.since,
      cut: kept.cut,
      // Readings caught up afterwards from kept copies (D12). Listed only when there are some.
      ...(caught > 0 ? { caughtUp: caught } : {}),
    } as { readings: number; valued: number; low: number | null; high: number | null; firstDay: string | null; since: string | null; cut: boolean; caughtUp?: number };
    return {
      output: {
        ...series,
        alert_threshold: line ? { op: line.op, threshold: line.threshold, severity: line.severity } : null,
        episodes: episodes.map((e) => ({ id: e.id, starts: e.startsAt, ends: e.endsAt, peak: e.peak })),
      },
      // The staircase itself: shown and kept in the journal, so the comparison can be read again.
      record: { points },
      value: { points, series, line, episodes },
    };
  });
  if (!read) throw new Error("The series could not be read.");

  if (read.series.valued === 0) {
    const message =
      read.series.since === null
        ? "Nothing was ever kept for this measure at this unit, so there is no series to set events beside. No search was made."
        : `Nothing was kept for this measure at this unit over the span you gave: its history starts on ${dayOn(new Date(read.series.since), input.zone)}. No search was made. Pick a span that reaches it.`;
    const empty: InvestigationResult = {
      status: "incomplete",
      answer: null,
      verified: false,
      struck: [],
      steps,
      message,
      model: ANALYST_MODEL,
      usage: { requests: 0, inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, byRequest: [] },
    };
    onEvent({ type: "done", result: empty });
    return empty;
  }

  // 2. What a person already validated for these days.
  say("Reading the calendar of validated events");
  const calendar = await step("calendar_events", { from: fromDay, to: toDay }, async () => {
    const events = await reads.calendar(fromDay, toDay);
    const listed = events.map((e) => ({ id: e.id, title: e.title, startsOn: e.startsOn, endsOn: e.endsOn, url: e.sourceUrl }));
    return { output: { events: listed.length }, record: { events: listed }, value: listed };
  });

  // 3. The nearest units: an episode they share is not peculiar to this one.
  say("Reading the nearest units");
  const line = read.line;
  const around = await step("nearest_units", { unit: input.unit.name, measure: input.metric, nearest: NEIGHBOURS }, async () => {
    if (!line || read.episodes.length === 0) {
      const why = line ? "The series has no episode over the span, so there is nothing to look for at the neighbours." : "No alert rule covers this measure, so no episode can be looked for at the neighbours.";
      return { output: { neighbours: [], why }, value: { placed: true, neighbours: [] as NeighbourReading[] } };
    }
    const near = nearestTo(input.unit.id, await reads.placed());
    const neighbours: NeighbourReading[] = [];
    for (const n of near.units) {
      const points = seriesOf(await reads.series(n.id), input.from);
      neighbours.push({
        ...n,
        readings: points.filter((p) => p.value !== null).length,
        episodes: episodesOf(points, line, input.to, input.zone).map((e) => ({ startsAt: e.startsAt, endsAt: e.endsAt, startDay: e.startDay, endDay: e.endDay, peak: e.peak })),
      });
    }
    return {
      output: {
        placed: near.placed,
        neighbours: neighbours.map((n) => ({ name: n.name, km: n.km, readings: n.readings, episodes: n.episodes.length })),
      },
      value: { placed: near.placed, neighbours },
    };
  });
  const episodes = shareEpisodes(read.episodes, around?.neighbours ?? []);

  // 4. What leaves for the web, said before it leaves.
  await step("search_brief", {}, async () => ({
    output: {
      sent: { request: input.request, sources: input.domains, searches_allowed: MAX_SEARCHES },
      kept_here: ["the series", "the alert threshold", "the calendar", "the neighbours"],
    },
    value: true,
  }));

  // 5. The search. Its own steps and status lines pass through; its last line is ours to write.
  const before = steps.length;
  const found = await search((e) => {
    if (e.type !== "done") onEvent(e);
  });
  steps.splice(before, 0, ...found.steps);
  if (found.status !== "answered" || !found.answer) {
    const unanswered: InvestigationResult = { ...found, answer: null, steps };
    onEvent({ type: "done", result: unanswered });
    return unanswered;
  }
  const proposal = found.answer;

  // 6. Each event beside the series.
  say("Setting each event beside the series");
  const events: EventToPlace[] = [
    ...proposal.candidates.map((c): EventToPlace => ({ ref: c.id, from: "candidate", title: c.title, startsOn: c.startDate, endsOn: c.endDate })),
    ...(calendar ?? []).map((e): EventToPlace => ({ ref: `h:${e.id}`, from: "calendar", title: e.title, startsOn: e.startsOn, endsOn: e.endsOn })),
  ];
  const compared =
    (await step("events_beside_series", { events: events.length, episodes: episodes.length, days_around: AROUND_DAYS, lead_max_days: LEAD_MAX_DAYS }, async () => {
      const out = compareEvents(events, dailyOf(read.points, input.zone, fromDay, toDay), episodes, { fromDay, toDay });
      return {
        output: {
          compared: out.map((c) => ({
            event: c.ref,
            episode: c.episode,
            lead_days: c.leadDays,
            mean_before: c.before?.mean ?? null,
            mean_after: c.after?.mean ?? null,
            doubts: c.doubts.map((d) => d.kind),
          })),
        },
        value: out,
      };
    })) ?? [];

  // 7. What the check of the search's delivery took out.
  await step("search_check", {}, async () => ({
    output: {
      candidates: proposal.candidates.length,
      without_a_date: proposal.candidates.filter((c) => c.startDate === null).length,
      dates_removed: proposal.candidates.reduce((n, c) => n + c.datesRemoved.length, 0),
      quotations_replaced: proposal.candidates.filter((c) => c.quoteReplaced).length,
      struck: found.struck.length,
      verified: found.verified,
    },
    value: true,
  }));

  const limits = [NOT_A_CAUSE];
  if (!line) {
    limits.push(
      `No alert rule covers this measure at this unit, so no stretch of the series is marked as an episode. Each event is set beside the mean of the ${AROUND_DAYS} days before and after it, and nothing else.`,
    );
  }
  if (read.series.firstDay !== null && read.series.firstDay > fromDay) {
    limits.push(`The series starts on ${read.series.firstDay}. Nothing is known of the days of the span before it.`);
  }
  if (read.series.cut) limits.push("The span holds more readings than were read: the oldest are left out of the series.");
  const caughtUp = read.series.caughtUp ?? 0;
  if (caughtUp > 0) {
    limits.push(
      `${caughtUp} of the ${read.series.readings} readings of the series ${caughtUp === 1 ? "was" : "were"} caught up afterwards from kept copies of the source, with the measure as it is defined today: the twin did not show ${caughtUp === 1 ? "it" : "them"} at the time.`,
    );
  }
  if (calendar === null) limits.push("The calendar could not be read, so the events already validated are missing from the comparison.");
  if (around === null) limits.push("The nearest units could not be read, so no episode is said to be shared.");
  else if (!around.placed) limits.push("This unit has no place on the map, so its neighbours could not be named.");

  const result: InvestigationResult = {
    ...found,
    answer: {
      ...proposal,
      investigation: {
        unit: { id: input.unit.id, name: input.unit.name },
        metric: input.metric,
        from: input.from.toISOString(),
        to: input.to.toISOString(),
        zone: input.zone,
        series: read.series,
        line,
        episodes,
        neighbours: around?.neighbours ?? [],
        calendar: calendar ?? [],
        compared,
        limits,
      },
    },
    steps,
  };
  onEvent({ type: "done", result });
  return result;
}
