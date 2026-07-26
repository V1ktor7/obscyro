/**
 * Projects and datasets — the data spine.
 *
 * A dataset is either a `table` (versioned snapshots, for uploads and derived
 * outputs) or a `stream` (append-only with a retention window, for live feeds).
 */

import { apiFetch } from "@/lib/auth";

export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  datasetCount: number;
  createdAt: string;
}

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

export async function listProjects(env: string): Promise<{ projects: Project[] }> {
  return apiFetch(`/v1/ontology/${enc(env)}/projects`);
}

export async function createProject(
  env: string,
  body: { name: string; description?: string },
): Promise<Project> {
  return apiFetch(`/v1/ontology/${enc(env)}/projects`, { method: "POST", body });
}

export async function listDatasets(
  env: string,
  projectId: string,
): Promise<{ datasets: Dataset[] }> {
  return apiFetch(`/v1/ontology/${enc(env)}/projects/${projectId}/datasets`);
}

export async function createDataset(
  env: string,
  projectId: string,
  body: {
    name: string;
    kind?: "table" | "stream";
    description?: string;
    retentionDays?: number;
  },
): Promise<Dataset> {
  return apiFetch(`/v1/ontology/${enc(env)}/projects/${projectId}/datasets`, {
    method: "POST",
    body,
  });
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
