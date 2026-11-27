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
  body: { key: string; from: string; to: string; step: GridStep; agg?: GridAgg; entities?: string[]; asOf?: string | null },
): Promise<GridAnswer> {
  return apiFetch(`/v1/ontology/${enc(env)}/series/read`, { method: "POST", body });
}
