import type { GridStep, SeriesDraft, SeriesLine, SeriesOffer, SeriesStep } from "../series-api";

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
