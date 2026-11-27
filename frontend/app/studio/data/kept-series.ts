import type { CatchupOffer, CatchupPath, CatchupRequest, CatchupState, CopiesOf, GridStep, SeriesDraft, SeriesLine, SeriesOffer, SeriesStep } from "../series-api";

// ---------------------------------------------------------------------------
// Kept series, as the Data section words them. No screen here.
//
// A line of the list has to say, without a chart, what a model could be shown:
// how far back it goes, how much of it there is, and what is missing from it.
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A day written the same on every machine: "22 Nov 2026".
 *
 * Written by hand rather than by the browser's own formatter, whose order of
 * day and month depends on the data it ships with. The day is the UTC one: a
 * stretch of months does not hang on which side of midnight a reader sits.
 */
export function dayText(iso: string | null): string {
  if (!iso) return "nothing yet";
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const count = (n: number, one: string, many: string = `${one}s`): string => `${n.toLocaleString("en-CA")} ${n === 1 ? one : many}`;

/** How often a series gets a point, in words. */
export function stepText(step: SeriesLine["step"]): string {
  if (step === "change") return "Written down when it changes";
  return step === "hour" ? "Every hour" : step === "day" ? "Every day" : "Every week";
}

/** What a line holds: "12,424 points for 107 units". */
export function holdsText(line: Pick<SeriesLine, "origin" | "entities" | "points">): string {
  if (line.points === 0) return "No point yet";
  const about = line.origin === "twin" ? count(line.entities, "unit") : line.entities <= 1 ? "one entity" : count(line.entities, "entity", "entities");
  return `${count(line.points, "point")} for ${about}`;
}

/** The stretch the points are about, and when keeping started. */
export function coversText(line: Pick<SeriesLine, "firstAt" | "lastAt" | "keptSince" | "points">): string {
  if (line.points === 0 || !line.firstAt || !line.lastAt) return "Nothing is kept yet: the next write of the dataset is read.";
  const kept = line.keptSince ? ` Kept here since ${dayText(line.keptSince)}.` : "";
  return `About ${dayText(line.firstAt)} to ${dayText(line.lastAt)}.${kept}`;
}

/** What is missing or was added afterwards; empty when there is nothing to say. */
export function gapsText(line: Pick<SeriesLine, "emptyPoints" | "replayed">): string[] {
  const out: string[] = [];
  if (line.emptyPoints > 0) out.push(`${count(line.emptyPoints, "point")} written down with no value: a gap that was seen, not a zero.`);
  if (line.replayed > 0) out.push(`${count(line.replayed, "point")} caught up from kept copies.`);
  return out;
}

// --- the form ---------------------------------------------------------------------

export interface SeriesForm {
  label: string;
  datasetId: string;
  timeColumn: string;
  timeZone: string;
  valueColumn: string;
  entityColumns: string[];
  step: SeriesStep;
  unit: string;
}

export const blankSeriesForm = (): SeriesForm => ({ label: "", datasetId: "", timeColumn: "", timeZone: "", valueColumn: "", entityColumns: [], step: "day", unit: "" });

/** The most columns that can name an entity. */
export const ENTITY_COLUMNS_MAX = 4;

/** The columns of the dataset a form points at; none when it points at nothing. */
export function columnsOf(offer: SeriesOffer, datasetId: string): { name: string; type: string }[] {
  return offer.datasets.find((d) => d.id === datasetId)?.columns ?? [];
}

/**
 * What the server is sent for a form, or what to correct first.
 *
 * The server checks the rest: that the dataset is a table of this project,
 * that each column is one it has, and that the time zone is one it knows.
 */
export function draftOfSeries(f: SeriesForm): { draft: SeriesDraft; problems: string[] } {
  const problems: string[] = [];
  if (!f.label.trim()) problems.push("Give the series a name.");
  if (!f.datasetId) problems.push("Pick the dataset it is read from.");
  if (!f.timeColumn) problems.push("Pick the column that says when the value was true.");
  if (!f.valueColumn) problems.push("Pick the column of the value.");
  if (f.timeColumn && f.timeColumn === f.valueColumn) problems.push("The time and the value cannot be the same column.");
  if (f.entityColumns.length > ENTITY_COLUMNS_MAX) problems.push(`An entity is named by ${ENTITY_COLUMNS_MAX} columns at most.`);
  if (f.entityColumns.some((c) => c === f.timeColumn || c === f.valueColumn)) problems.push("The time and the value cannot also name the entity.");
  return {
    draft: {
      label: f.label.trim(),
      datasetId: f.datasetId,
      timeColumn: f.timeColumn,
      timeZone: f.timeZone.trim() || null,
      valueColumn: f.valueColumn,
      entityColumns: f.entityColumns,
      step: f.step,
      unit: f.unit.trim() || null,
    },
    problems,
  };
}

// --- looking at a series ----------------------------------------------------------

/** The stretch a look reads: the last two days by the hour, or the last thirty by the day, ending now. */
export function lookWindow(step: GridStep, now: Date): { from: string; to: string } {
  const hours = step === "hour" ? 48 : 30 * 24;
  // Whole hours, so two looks a minute apart read the same grid.
  const end = new Date(Math.ceil(now.getTime() / 3_600_000) * 3_600_000);
  return { from: new Date(end.getTime() - hours * 3_600_000).toISOString(), to: end.toISOString() };
}

/**
 * How long a value is let hold when a series is looked at, in hours; null for
 * until the next point.
 *
 * A dataset series says how often its source publishes: a value holds for two
 * of those steps, so one publication missed does not break the line and a
 * source that went quiet does not draw a flat one. A measure of the twin is
 * written down when it changes and says nothing of how often its source
 * publishes: nothing bounds it here, and a read that needs a bound gives one.
 */
export function holdHoursOf(step: SeriesLine["step"]): number | null {
  if (step === "change") return null;
  return 2 * (step === "hour" ? 1 : step === "day" ? 24 : 168);
}

/**
 * A line of values as SVG paths in a box of `width` by `height`.
 *
 * A gap breaks the line: two stretches with nothing between them are two
 * paths, never one drawn across what was not read.
 */
export function sparkPaths(values: readonly (number | null)[], width: number, height: number): string[] {
  const known = values.filter((v): v is number => v !== null);
  if (known.length === 0) return [];
  const lo = Math.min(...known);
  const hi = Math.max(...known);
  const x = (i: number) => (values.length === 1 ? width / 2 : (i / (values.length - 1)) * width);
  const y = (v: number) => (hi === lo ? height / 2 : height - ((v - lo) / (hi - lo)) * height);
  const paths: string[] = [];
  let run: string[] = [];
  const close = () => {
    // A lone value between two gaps is still a reading: a dot's worth of line, so it is not lost.
    if (run.length === 1) paths.push(`M${run[0]} h0.01`);
    else if (run.length > 1) paths.push(`M${run.join(" L")}`);
    run = [];
  };
  values.forEach((v, i) => {
    if (v === null) close();
    else run.push(`${x(i).toFixed(2)},${y(v).toFixed(2)}`);
  });
  close();
  return paths;
}

/** The last value of a line that has one, with where it sits; null when the line is all gaps. */
export function lastKnown(values: readonly (number | null)[]): { value: number; stepsAgo: number } | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v !== null && v !== undefined) return { value: v, stepsAgo: values.length - 1 - i };
  }
  return null;
}

// --- catching up from kept copies --------------------------------------------------

/** "1,523 copies, taken from 25 Aug 2026 to 23 Nov 2026". */
export function copiesText(c: Pick<CopiesOf, "copies" | "firstAt" | "lastAt">): string {
  if (c.copies === 0) return "no older copy";
  return `${count(c.copies, "copy", "copies")}${takenText(c)}`;
}

/** ", taken from 25 Aug 2026 to 23 Nov 2026", or nothing when the dates are not known. */
function takenText(c: Pick<CopiesOf, "firstAt" | "lastAt">): string {
  if (!c.firstAt || !c.lastAt) return "";
  return dayText(c.firstAt) === dayText(c.lastAt) ? `, taken on ${dayText(c.firstAt)}` : `, taken from ${dayText(c.firstAt)} to ${dayText(c.lastAt)}`;
}

/**
 * What a catch-up of a twin measure can read through one pipeline.
 *
 * `own`: the datasets the pipeline reads, that have older copies.
 * `others`: the project's other tables that have some, which can be read in
 * place of one of the pipeline's inputs when the source changed file.
 */
export function sourcesOf(path: CatchupPath, standIns: readonly CopiesOf[]): { own: CopiesOf[]; others: CopiesOf[] } {
  const inputs = new Set(path.inputs.map((i) => i.datasetId));
  return { own: path.inputs.filter((i) => i.copies > 0), others: standIns.filter((s) => !inputs.has(s.datasetId)) };
}

/** The columns of a pipeline's input that a dataset read in its place does not have. What they fed will be empty. */
export function missingColumns(input: Pick<CopiesOf, "columns">, standIn: Pick<CopiesOf, "columns">): string[] {
  const has = new Set(standIn.columns);
  return input.columns.filter((c) => !has.has(c));
}

/** What the panel has picked: through which pipeline, the copies of which dataset, in place of which input. */
export interface CatchupPick {
  pipelineId: string | null;
  datasetId: string;
  inPlaceOf: string | null;
}

/**
 * The input of a pipeline a dataset is first proposed in place of: the one it
 * shares the most columns with. Only a first proposal, shown in a list the
 * person changes: the screen names the columns that are missing either way.
 */
export function standsFor(path: Pick<CatchupPath, "inputs">, source: Pick<CopiesOf, "columns">): string | null {
  let best: { id: string; shared: number } | null = null;
  for (const input of path.inputs) {
    const shared = input.columns.length - missingColumns(input, source).length;
    if (!best || shared > best.shared) best = { id: input.datasetId, shared };
  }
  return best?.id ?? null;
}

/**
 * Whether a dataset looks like an earlier form of a pipeline's input: most of
 * its own columns are also the input's. The emergency file the source used to
 * publish has nine columns, eight of which the file it publishes now still
 * has; an air quality file shares none with either.
 */
export function resembles(input: Pick<CopiesOf, "columns">, source: Pick<CopiesOf, "columns">): boolean {
  const has = new Set(input.columns);
  const shared = source.columns.filter((c) => has.has(c)).length;
  return shared * 2 > source.columns.length;
}

/**
 * The first thing an offer lets a person catch up, or null when it offers nothing.
 *
 * The dataset with the most older copies, among those the pipeline reads
 * today and those that resemble one of its inputs, proposed in its place:
 * that is where the past is. At equal count, the pipeline's own input comes
 * first. A dataset that resembles no input is never proposed: it stays in the
 * list, for a person who knows better.
 */
export function firstPick(offer: Pick<CatchupOffer, "paths" | "standIns">): CatchupPick | null {
  let best: { pick: CatchupPick; copies: number } | null = null;
  for (const path of offer.paths) {
    const { own, others } = sourcesOf(path, offer.standIns);
    for (const s of own) {
      if (!best || s.copies > best.copies) best = { pick: { pipelineId: path.pipelineId, datasetId: s.datasetId, inPlaceOf: null }, copies: s.copies };
    }
    for (const s of others) {
      const inPlaceOf = standsFor(path, s);
      const input = path.inputs.find((i) => i.datasetId === inPlaceOf);
      if (!input || !resembles(input, s)) continue;
      if (!best || s.copies > best.copies) best = { pick: { pipelineId: path.pipelineId, datasetId: s.datasetId, inPlaceOf: input.datasetId }, copies: s.copies };
    }
  }
  return best?.pick ?? null;
}

/** What a pick will do, said before anything is read. Null when the pick does not hold together. */
export function planOf(offer: CatchupOffer, pick: CatchupPick): { request: CatchupRequest; copies: number; said: string[] } | null {
  const path = offer.paths.find((p) => p.pipelineId === pick.pipelineId);
  if (!path) return null;
  const { own, others } = sourcesOf(path, offer.standIns);
  const source = pick.inPlaceOf ? others.find((s) => s.datasetId === pick.datasetId) : own.find((s) => s.datasetId === pick.datasetId);
  if (!source || source.copies === 0) return null;
  const input = pick.inPlaceOf ? path.inputs.find((i) => i.datasetId === pick.inPlaceOf) : null;
  if (pick.inPlaceOf && !input) return null;

  const before = offer.until ? `: all from before this series started being kept, on ${dayText(offer.until)}` : "";
  const said = [`${count(source.copies, "copy", "copies")} of “${source.datasetName}”${takenText(source)}${before}.`];
  if (offer.origin === "dataset") {
    said.push("Each copy is read the way a write of the dataset is read today: only what changed from one copy to the next is written down.");
  } else {
    said.push(
      `Each copy goes through “${path.pipelineName}” as it is today${input ? `, in place of “${input.datasetName}”` : ""}, and is measured as the measure is defined today, over today's units. Nothing is written in the ontology.`,
    );
    if (input) {
      const missing = missingColumns(input, source);
      if (missing.length > 0) {
        said.push(`“${source.datasetName}” does not have ${missing.length === 1 ? "the column" : "the columns"} ${missing.join(", ")} that “${input.datasetName}” has: what the pipeline makes from ${missing.length === 1 ? "it" : "them"} will be empty.`);
      }
    }
  }
  said.push("What is written down is marked as caught up, and carries the time its source gave and the time its copy was taken. A row that cannot be placed is left out and counted.");
  return { request: { key: offer.key, datasetId: source.datasetId, pipelineId: path.pipelineId, inPlaceOf: input ? input.datasetId : null }, copies: source.copies, said };
}

/** What a catch-up left out, each as a sentence; empty when it read everything. */
export function leftOutText(c: Pick<CatchupState, "copiesLeftOut" | "rowsLeftOut" | "rowsUnattached" | "note">): string[] {
  const out: string[] = [];
  if (c.copiesLeftOut > 0) out.push(`${count(c.copiesLeftOut, "copy", "copies")} could not be replayed.${c.note ? ` ${c.note}` : ""}`);
  if (c.rowsLeftOut > 0) out.push(`${count(c.rowsLeftOut, "row")} could not be read into a point.`);
  if (c.rowsUnattached > 0) out.push(`${count(c.rowsUnattached, "row")} named a place the twin does not hold, and ${c.rowsUnattached === 1 ? "was" : "were"} left out rather than placed by guess.`);
  return out;
}

/** Where a catch-up stands, as one sentence of the list. */
export function catchupText(c: CatchupState): string {
  const through = c.pipelineName ? `, through “${c.pipelineName}”${c.inPlaceOf ? ` in place of “${c.inPlaceOf.datasetName}”` : ""}` : "";
  const from = `“${c.datasetName}”${through}`;
  if (!c.done) return `Catch-up stopped at ${c.read.toLocaleString("en-CA")} of ${count(c.copies, "copy", "copies")} of ${from}. Resume it to read the rest.`;
  // When the copies were taken, not how far back the points go: a copy can be left out.
  const since = c.firstCopyAt ? `, the oldest taken on ${dayText(c.firstCopyAt)}` : "";
  return `Caught up from ${count(c.copies, "copy", "copies")} of ${from}${since}: ${count(c.written, "point")} written down.`;
}

/**
 * How a catch-up is paced from the screen. The API limits how many requests a
 * key makes in a minute, and the rest of the Studio shares that key: a batch
 * is not asked for the instant the one before ends.
 */
export const catchupPacing = { betweenMs: 2000, slowDownMs: 30_000 };

/**
 * How long to wait when the API says it is asked too fast; null for any other
 * failure. The API says for how long (`ttlSeconds`), and a second is added.
 */
export function slowDownOf(error: unknown): number | null {
  const e = error as { status?: number; code?: string; details?: unknown } | null;
  if (!e || (e.status !== 429 && e.code !== "RATE_LIMITED")) return null;
  const ttl = (e.details as { ttlSeconds?: unknown } | undefined)?.ttlSeconds;
  return typeof ttl === "number" && Number.isFinite(ttl) && ttl > 0 ? (ttl + 1) * 1000 : catchupPacing.slowDownMs;
}

/** A catch-up while it runs: "312 of 1,523 copies read · 4,210 points written down". */
export function progressText(c: Pick<CatchupState, "read" | "copies" | "written">): string {
  return `${c.read.toLocaleString("en-CA")} of ${count(c.copies, "copy", "copies")} read · ${count(c.written, "point")} written down`;
}
