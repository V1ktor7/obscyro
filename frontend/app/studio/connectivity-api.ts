/**
 * Connectivity — Source → Sync → Dataset.
 *
 * A Source is a connection (where, which credentials). A Sync is the operation
 * (what, how often, snapshot | incremental | stream) with its own run history.
 */

import { apiFetch } from "@/lib/auth";

export type ConnectorKind =
  | "webhook"
  | "rest"
  | "file_upload"
  | "http_poll"
  | "postgres"
  | "hl7v2";

export type SyncMode = "stream" | "snapshot" | "incremental";

export interface Connector {
  kind: ConnectorKind;
  label: string;
  direction: "push" | "pull";
  modes: string[];
  description: string;
  implemented: boolean;
}

export interface Source {
  id: string;
  name: string;
  connector: string;
  status: string;
  webhookUrl: string | null;
  lastError: string | null;
  syncCount: number;
  createdAt: string;
}

export interface Sync {
  id: string;
  projectId: string;
  sourceId: string;
  datasetId: string;
  name: string;
  mode: SyncMode;
  intervalSeconds: number | null;
  incrementalColumn: string | null;
  watermark: string | null;
  status: string;
  lastRunAt: string | null;
  lastError: string | null;
}

export interface SyncRun {
  id: string;
  status: string;
  rowsRead: number;
  rowsWritten: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

export async function listConnectors(): Promise<{ connectors: Connector[] }> {
  return apiFetch("/v1/connectors");
}

export async function listSources(env: string): Promise<{ sources: Source[] }> {
  return apiFetch(`/v1/ontology/${enc(env)}/sources`);
}

export async function createSource(
  env: string,
  body: { name: string; connector: ConnectorKind; config?: Record<string, unknown> },
): Promise<Source> {
  return apiFetch(`/v1/ontology/${enc(env)}/sources`, { method: "POST", body });
}

export async function listSyncs(env: string): Promise<{ syncs: Sync[] }> {
  return apiFetch(`/v1/ontology/${enc(env)}/syncs`);
}

export async function createSync(
  env: string,
  body: {
    name: string;
    sourceId: string;
    datasetId: string;
    mode: SyncMode;
    intervalSeconds?: number | null;
    incrementalColumn?: string | null;
  },
): Promise<Sync> {
  return apiFetch(`/v1/ontology/${enc(env)}/syncs`, { method: "POST", body });
}

export async function runSync(
  id: string,
): Promise<{ rowsRead: number; rowsWritten: number; error: string | null }> {
  return apiFetch(`/v1/syncs/${id}/run`, { method: "POST", body: {} });
}

export async function listSyncRuns(id: string, limit = 20): Promise<{ runs: SyncRun[] }> {
  return apiFetch(`/v1/syncs/${id}/runs?limit=${limit}`);
}
