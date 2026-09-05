/**
 * Dashboards — cards over data that already exists in the platform.
 *
 * A card stores no values. It names a dataset and a way of drawing it, and the
 * numbers arrive with the page, so a sync that lands at 4pm is on the board at
 * 4pm. `chartable` is the other half: before a card exists, it says which chart
 * types this project's data can honestly carry, with the columns already
 * chosen and a sentence explaining each one.
 */

import { apiFetch } from "@/lib/auth";

const enc = encodeURIComponent;

export type CardKind = "line" | "bar" | "number" | "table" | "map" | "series" | "compare";
export type SourceKind = "dataset" | "twin" | "ontology" | "simulation" | "model";
export type MapState = "live" | "run" | "scenario";
export type TrajectoryMeasure = "S" | "E" | "I" | "R" | "isolationDemand";
export type Aggregate = "sum" | "avg" | "max" | "min" | "count";
export type ColumnRole = "time" | "quantity" | "category" | "identifier" | "unusable";

export interface Dashboard {
  id: string;
  projectId: string;
  name: string;
  description: string;
  cardCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CardConfig {
  x?: string | null;
  y?: string | null;
  agg?: Aggregate;
  limit?: number;
  /** Map: the twin metric each site is coloured by. */
  metric?: string;
  /** Map: now, a day of a run, or the prediction written onto a branch. */
  state?: MapState;
  runId?: string;
  step?: number;
  scenarioId?: string;
  /** Series and comparison: which trajectory of a run. */
  measure?: TrajectoryMeasure;
  /** Comparison against a simulation: the observed series to check it against. */
  datasetId?: string;
  /** Comparison against a model: how far to project. */
  steps?: number;
}

export interface MapSite {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  /** Null when the source said nothing about this site. Never zero for absent. */
  value: number | null;
  /** Which unit inside the site the number came from. */
  from: string | null;
}

export interface CardData {
  points: { label: string; value: number }[];
  rows: Record<string, unknown>[];
  columns: string[];
  rowsRead: number;
  rowsSkipped: number;
  /** Categories a bar chart could not fit. Said on the card, never hidden. */
  categoriesHidden: number;
  /** For a line: one point in this many was kept. 1 means all of them. */
  sampledEvery: number;

  /** Map cards: the sites, placed. */
  sites: MapSite[];
  /** Placed sites the source said nothing about — drawn empty, never at zero. */
  sitesUnread: number;
  /** Sites with no coordinates, which cannot be drawn at all. */
  sitesUnplaced: number;

  /** Series cards: the p5–p95 envelope the median came out of. */
  band: { label: string; low: number; high: number }[];

  /** Comparison cards: the two series, and how far apart they are. */
  predicted: { label: string; value: number }[];
  real: { label: string; value: number }[];
  overlap: number;
  meanGap: number | null;
  worstGap: { label: string; predicted: number; observed: number } | null;

  /** A sentence the card prints as-is: provenance, coverage, or a caveat. */
  note: string | null;

  error: string | null;
}

export interface Card {
  id: string;
  dashboardId: string;
  position: number;
  title: string;
  kind: CardKind;
  sourceKind: SourceKind;
  sourceId: string;
  config: CardConfig;
  sourceName: string;
  data: CardData;
}

export interface ColumnFit {
  name: string;
  role: ColumnRole;
  filled: number;
  distinct: number;
  reason: string;
}

export interface ChartOffer {
  kind: CardKind;
  label: string;
  x: string | null;
  y: string | null;
  why: string;
}

export interface DatasetOffers {
  datasetId: string;
  name: string;
  rowCount: number;
  columns: ColumnFit[];
  offers: ChartOffer[];
  blocked: string | null;
}

export async function listChartable(env: string): Promise<{ datasets: DatasetOffers[] }> {
  return apiFetch(`/v1/ontology/${enc(env)}/chartable`);
}

export async function listDashboards(env: string): Promise<{ dashboards: Dashboard[] }> {
  return apiFetch(`/v1/ontology/${enc(env)}/dashboards`);
}

export async function createDashboard(
  env: string,
  body: { name: string; description?: string },
): Promise<Dashboard> {
  return apiFetch(`/v1/ontology/${enc(env)}/dashboards`, { method: "POST", body });
}

export async function readDashboard(
  id: string,
): Promise<{ dashboard: Dashboard; cards: Card[] }> {
  return apiFetch(`/v1/dashboards/${enc(id)}`);
}

export async function renameDashboard(
  id: string,
  body: { name: string; description?: string },
): Promise<Dashboard> {
  return apiFetch(`/v1/dashboards/${enc(id)}`, { method: "PATCH", body });
}

export async function deleteDashboard(id: string): Promise<void> {
  await apiFetch(`/v1/dashboards/${enc(id)}`, { method: "DELETE" });
}

/**
 * What a board can be built from, besides tables.
 *
 * Read before a card exists. Offering a map on a project whose twin has no
 * coordinates, or a comparison on a project with no forecaster, is the same
 * mistake `chartable` was written to stop: a menu of things that draw nothing.
 */
export interface DashboardSources {
  metrics: { key: string; label: string; unit: string }[];
  /**
   * Branches carrying predictions, with the numeric properties each one holds.
   *
   * Properties, not metric keys: a metric is computed over instances, while a
   * prediction is a property written onto one. Colouring a map by a metric key
   * that is not among these finds nothing on every site.
   */
  scenarios: { id: string; name: string; predictedUnits: number; properties: string[] }[];
  runs: {
    id: string;
    scenarioId: string;
    scenarioName: string;
    createdAt: string;
    horizonDays: number;
    steps: number[];
  }[];
  forecasters: {
    id: string;
    name: string;
    target: string;
    datasetName: string;
    mase: number | null;
  }[];
  sitesWithCoordinates: number;
}

export async function listDashboardSources(env: string): Promise<DashboardSources> {
  return apiFetch(`/v1/ontology/${enc(env)}/dashboard-sources`);
}

export async function addCard(
  dashboardId: string,
  body: {
    title: string;
    kind: CardKind;
    sourceKind: SourceKind;
    sourceId: string;
    config: CardConfig;
  },
): Promise<Card> {
  return apiFetch(`/v1/dashboards/${enc(dashboardId)}/cards`, { method: "POST", body });
}

export async function deleteCard(dashboardId: string, cardId: string): Promise<void> {
  await apiFetch(`/v1/dashboards/${enc(dashboardId)}/cards/${enc(cardId)}`, {
    method: "DELETE",
  });
}

export async function moveCard(
  dashboardId: string,
  cardId: string,
  position: number,
): Promise<void> {
  await apiFetch(`/v1/dashboards/${enc(dashboardId)}/cards/${enc(cardId)}`, {
    method: "PATCH",
    body: { position },
  });
}
