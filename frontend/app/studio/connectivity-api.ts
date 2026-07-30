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
  /** Still runs for existing sources, but not offered for new ones. */
  deprecated?: boolean;
}

/**
 * A REST source, configured the way the n8n HTTP node is: the call itself,
 * then the three things that decide whether any rows come back — where the
 * array lives, how to authenticate, and how to ask for the next page.
 */
export interface RestConfig {
  url: string;
  method?: "GET" | "POST";
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: string;
  auth?: { kind: "none" | "bearer" | "header" | "query"; name?: string; token?: string };
  recordPath?: string;
  flatten?: boolean;
  format?: "json" | "csv" | "auto";
  pagination?: {
    kind: "none" | "page" | "offset" | "cursor";
    param?: string;
    sizeParam?: string;
    pageSize?: number;
    cursorPath?: string;
    cursorParam?: string;
    maxPages?: number;
  };
}

export interface RestTestResult {
  ok: boolean;
  rowCount: number;
  pages: number;
  truncated: boolean;
  columns: string[];
  sample: Record<string, unknown>[];
  error: string | null;
}

/** Run one capped fetch so a config can be checked before it is saved. */
export async function testRestConnector(config: RestConfig): Promise<RestTestResult> {
  return apiFetch("/v1/connectors/rest/test", { method: "POST", body: config });
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
  /** Connector settings; stored credentials come back as a marker, never in clear. */
  config: Record<string, unknown>;
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

// --- Lineage graph + ontology output ---------------------------------------

export interface GraphNode {
  id: string;
  type: "source" | "dataset" | "object_type";
  name: string;
  subtitle: string;
  status: "ok" | "warn" | "idle";
  count: number | null;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: string;
}

export interface ColumnMapRule {
  from: string;
  to: string;
  coerce?: "string" | "number" | "boolean" | "date";
}

export interface Datasource {
  id: string;
  projectId: string;
  objectTypeId: string;
  objectTypeName: string;
  datasetId: string;
  datasetName: string;
  identityProperties: string[];
  columnMapping: ColumnMapRule[];
  writeback: boolean;
  lastSyncedAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
}

export async function getGraph(
  env: string,
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  return apiFetch(`/v1/ontology/${enc(env)}/graph`);
}

export async function listDatasources(env: string): Promise<{ datasources: Datasource[] }> {
  return apiFetch(`/v1/ontology/${enc(env)}/datasources`);
}

export async function createDatasource(
  env: string,
  body: {
    objectTypeName: string;
    datasetId: string;
    identityProperties: string[];
    columnMapping: ColumnMapRule[];
  },
): Promise<Datasource> {
  return apiFetch(`/v1/ontology/${enc(env)}/datasources`, { method: "POST", body });
}

export async function materialize(
  id: string,
): Promise<{ read: number; written: number; skipped: number; issues: { row: number; reason: string }[] }> {
  return apiFetch(`/v1/datasources/${id}/materialize`, { method: "POST", body: {} });
}
