/**
 * Kept series: the history a model can read.
 *
 * A series is a value followed over time, for one or several entities. The
 * twin's measures are series with nothing to declare; a dataset becomes one
 * when a person says which column is the time, which the value, and which
 * name the entity.
 */

import { apiFetch } from "@/lib/auth";

export type SeriesStep = "hour" | "day" | "week";

export interface SeriesLine {
  key: string;
  label: string;
  origin: "twin" | "dataset";
  /** Where it is read from, in words. */
  from: string;
  /** The source's own step, or "change" for a twin measure: written down when it changes. */
  step: SeriesStep | "change";
  unit: string | null;
  entities: number;
  points: number;
  /** Points written down with no value: absences that were seen. */
  emptyPoints: number;
  /** Points caught up afterwards from a kept copy. */
  replayed: number;
  /** The earliest and latest instants the points are about. */
  firstAt: string | null;
  lastAt: string | null;
  /** When the first point was written down here. */
  keptSince: string | null;
  /** What the last write could not read. */
  note: string | null;
  declared: { datasetId: string; timeColumn: string; timeZone: string | null; valueColumn: string; entityColumns: string[] } | null;
}

export interface SeriesOffer {
  datasets: { id: string; name: string; columns: { name: string; type: string }[] }[];
}

export interface SeriesList {
  series: SeriesLine[];
  offer: SeriesOffer;
  /** Every catch-up from kept copies, by series key: what was caught up and where each one stands. */
  catchups: CatchupState[];
}

/** Where a catch-up from kept copies stands. */
export interface CatchupState {
  key: string;
  datasetId: string;
  datasetName: string;
  /** The pipeline the copies go through; null for a dataset series. */
  pipelineId: string | null;
  pipelineName: string | null;
  /** The pipeline input these copies are read in place of, when they are another dataset's. */
  inPlaceOf: { datasetId: string; datasetName: string } | null;
  /** Copies taken before this instant are the ones read: when the series started being kept. */
  until: string;
  firstCopyAt: string | null;
  copies: number;
  read: number;
  /** Points written down. */
  written: number;
  /** Copies that could not be replayed at all. */
  copiesLeftOut: number;
  /** Rows that made no object or no point. */
  rowsLeftOut: number;
  /** Objects that could not be placed under anything the twin holds. */
  rowsUnattached: number;
  /** The last thing that went wrong, in a sentence. */
  note: string | null;
  done: boolean;
  startedAt: string;
  updatedAt: string;
}

/** A dataset and the copies of it taken before a series started being kept. */
export interface CopiesOf {
  datasetId: string;
  datasetName: string;
  copies: number;
  firstAt: string | null;
  lastAt: string | null;
  columns: string[];
}

export interface CatchupPath {
  /** Null for a dataset series: its copies are read as they are. */
  pipelineId: string | null;
  pipelineName: string | null;
  inputs: CopiesOf[];
}

export interface CatchupOffer {
  key: string;
  origin: "twin" | "dataset";
  until: string | null;
  paths: CatchupPath[];
  /** For a twin measure: other tables of the project that have older copies, readable in place of a pipeline's input. */
  standIns: CopiesOf[];
  /** Why nothing can be caught up, when `paths` is empty. */
  why: string | null;
  begun: CatchupState[];
}

export interface CatchupRequest {
  key: string;
  datasetId: string;
  pipelineId: string | null;
  inPlaceOf: string | null;
}

export interface CatchupBatch {
  state: CatchupState;
  began: boolean;
  /** Copies read by this call, and what it wrote. */
  read: number;
  written: number;
}

export interface SeriesDraft {
  label: string;
  datasetId: string;
  timeColumn: string;
  timeZone: string | null;
  valueColumn: string;
  entityColumns: string[];
  step: SeriesStep;
  unit: string | null;
}

export interface SeriesDeclared {
  series: { key: string; label: string };
  /** What the dataset's latest copy gave; null when the dataset was never written. */
  captured: { key: string; written: number; note: string | null } | null;
}

export type GridStep = "hour" | "day";
export type GridAgg = "mean" | "max" | "last";

export interface GridSeries {
  entity: string;
  label: string;
  /** One value per step; null where nothing was in force. */
  values: (number | null)[];
  firstAt: string | null;
  points: number;
  emptySteps: number;
  replayed: number;
}

export interface GridAnswer {
  key: string;
  label: string;
  origin: "twin" | "dataset";
  unit: string | null;
  step: GridStep;
  agg: GridAgg;
  from: string;
  to: string;
  asOf: string | null;
  /** How long a value was let hold with no newer point, in hours; null for until the next point. */
  holdHours?: number | null;
  /** The start of each step. */
  grid: string[];
  series: GridSeries[];
  howToRead: string;
}

const enc = (s: string): string => encodeURIComponent(s);

export async function fetchSeries(env: string): Promise<SeriesList> {
  return apiFetch(`/v1/ontology/${enc(env)}/series`);
}
export async function declareSeries(env: string, draft: SeriesDraft): Promise<SeriesDeclared> {
  return apiFetch(`/v1/ontology/${enc(env)}/series`, { method: "POST", body: draft });
}
export async function removeSeries(env: string, key: string): Promise<void> {
  await apiFetch(`/v1/ontology/${enc(env)}/series/${enc(key)}`, { method: "DELETE" });
}
export async function readSeriesGrid(
  env: string,
  body: { key: string; from: string; to: string; step: GridStep; agg?: GridAgg; entities?: string[]; asOf?: string | null; holdHours?: number | null },
): Promise<GridAnswer> {
  return apiFetch(`/v1/ontology/${enc(env)}/series/read`, { method: "POST", body });
}

/** What a series could be caught up from: the copies taken before it started being kept. Reads only. */
export async function fetchCatchupOffer(env: string, key: string): Promise<CatchupOffer> {
  return apiFetch(`/v1/ontology/${enc(env)}/series/catchup?key=${enc(key)}`);
}
/** One bounded batch of a catch-up. Call again until `state.done`. */
export async function runCatchup(env: string, body: CatchupRequest): Promise<CatchupBatch> {
  return apiFetch(`/v1/ontology/${enc(env)}/series/catchup`, { method: "POST", body });
}
/** Removes what the catch-ups of a series wrote. Never a point taken live. */
export async function forgetCatchup(env: string, key: string): Promise<{ removed: number }> {
  return apiFetch(`/v1/ontology/${enc(env)}/series/catchup?key=${enc(key)}`, { method: "DELETE" });
}
