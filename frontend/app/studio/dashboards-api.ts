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

export type CardKind = "line" | "bar" | "number" | "table";
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
}

export interface CardData {
  points: { label: string; value: number }[];
  rows: Record<string, unknown>[];
  columns: string[];
  rowsRead: number;
  rowsSkipped: number;
  /** Categories a bar chart could not fit. Said on the card, never hidden. */
  categoriesHidden: number;
  error: string | null;
}

export interface Card {
  id: string;
  dashboardId: string;
  position: number;
  title: string;
  kind: CardKind;
  sourceKind: "dataset" | "twin" | "ontology";
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

export async function addCard(
  dashboardId: string,
  body: {
    title: string;
    kind: CardKind;
    sourceKind: "dataset";
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
