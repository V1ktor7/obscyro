/**
 * Datasets — the data spine.
 *
 * A project is an environment (they collapsed in migration 032), so datasets
 * are addressed directly under /ontology/:env.
 *
 * A dataset is either a `table` (versioned snapshots, for uploads and derived
 * outputs) or a `stream` (append-only with a retention window, for live feeds).
 */

import { apiFetch } from "@/lib/auth";

export interface ColumnDef {
  name: string;
  type: "string" | "number" | "boolean" | "object";
  nullable: boolean;
}

export interface Dataset {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  kind: "table" | "stream";
  description: string | null;
  path: string;
  columnSchema: ColumnDef[];
  rowCount: number;
  retentionDays: number;
  sourceId: string | null;
  lastWrittenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReferenceEdge {
  type: string;
  id: string;
  kind: string;
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

export async function listDatasets(env: string): Promise<{ datasets: Dataset[] }> {
  return apiFetch(`/v1/ontology/${enc(env)}/datasets`);
}

export async function createDataset(
  env: string,
  body: {
    name: string;
    kind?: "table" | "stream";
    description?: string;
    retentionDays?: number;
  },
): Promise<Dataset> {
  return apiFetch(`/v1/ontology/${enc(env)}/datasets`, { method: "POST", body });
}

export async function getDataset(
  id: string,
  limit = 50,
): Promise<{
  dataset: Dataset;
  preview: Record<string, unknown>[];
  references: { upstream: ReferenceEdge[]; downstream: ReferenceEdge[] };
}> {
  return apiFetch(`/v1/datasets/${id}?limit=${limit}`);
}

/** Load rows: a new immutable version for tables, an append for streams. */
export async function loadRows(
  id: string,
  rows: Record<string, unknown>[],
  note?: string,
): Promise<{ kind: "table" | "stream"; version?: number; rowCount: number }> {
  return apiFetch(`/v1/datasets/${id}/rows`, {
    method: "POST",
    body: { rows, ...(note ? { note } : {}) },
  });
}
