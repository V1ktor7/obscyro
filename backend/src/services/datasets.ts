import type { DbClient } from "../lib/db.js";
import { BadRequest, NotFound } from "../lib/errors.js";

// ---------------------------------------------------------------------------
// Datasets — the layer between a source and the ontology.
//
// Two kinds, deliberately different:
//   table  — versioned snapshots. Loading data creates a new immutable
//            version, so rollback and time travel are possible.
//   stream — append-only log bounded by retention. Appends are cheap and
//            single-statement so live ingestion keeps its current latency;
//            downstream work is event-triggered, never scheduled.
// ---------------------------------------------------------------------------

export type DatasetKind = "table" | "stream";

export interface ColumnDef {
  name: string;
  type: "string" | "number" | "boolean" | "object";
  nullable: boolean;
}

export interface DatasetRow {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  kind: DatasetKind;
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

interface DatasetDbRow {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  kind: DatasetKind;
  description: string | null;
  path: string;
  column_schema: ColumnDef[];
  row_count: string;
  retention_days: number;
  source_id: string | null;
  last_written_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function out(r: DatasetDbRow): DatasetRow {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    slug: r.slug,
    kind: r.kind,
    description: r.description,
    path: r.path,
    columnSchema: r.column_schema ?? [],
    rowCount: Number(r.row_count),
    retentionDays: r.retention_days,
    sourceId: r.source_id,
    lastWrittenAt: r.last_written_at ? r.last_written_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "dataset"
  );
}

/**
 * Infer a column schema from sample rows. Types widen to `string` on conflict
 * and a column is nullable if any sampled row omits it — conservative, because
 * a wrong "not null" is worse than a loose one.
 */
export function inferSchema(rows: Record<string, unknown>[]): ColumnDef[] {
  const seen = new Map<string, { type: ColumnDef["type"]; missing: boolean }>();
  const keys = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) keys.add(k);

  for (const key of keys) {
    let type: ColumnDef["type"] | null = null;
    let nullable = false;
    for (const r of rows) {
      const v = r[key];
      if (v === undefined || v === null || v === "") {
        nullable = true;
        continue;
      }
      const t: ColumnDef["type"] =
        typeof v === "number"
          ? "number"
          : typeof v === "boolean"
            ? "boolean"
            : typeof v === "object"
              ? "object"
              : // numeric-looking strings stay strings unless every value parses
                Number.isFinite(Number(v)) && String(v).trim() !== ""
                ? "number"
                : "string";
      type = type === null || type === t ? t : "string";
    }
    seen.set(key, { type: type ?? "string", missing: nullable });
  }

  return Array.from(seen.entries()).map(([name, v]) => ({
    name,
    type: v.type,
    nullable: v.missing,
  }));
}

const DATASET_SELECT = `
  SELECT id, project_id, name, slug, kind, description, path, column_schema,
         row_count, retention_days, source_id, last_written_at, created_at, updated_at
    FROM app.dataset`;

export async function listDatasets(db: DbClient, projectId: string): Promise<DatasetRow[]> {
  const { rows } = await db.query<DatasetDbRow>(
    `${DATASET_SELECT} WHERE project_id = $1 ORDER BY created_at DESC`,
    [projectId],
  );
  return rows.map(out);
}

export async function getDataset(db: DbClient, id: string): Promise<DatasetRow> {
  const { rows } = await db.query<DatasetDbRow>(`${DATASET_SELECT} WHERE id = $1`, [id]);
  const r = rows[0];
  if (!r) throw NotFound("DATASET_NOT_FOUND", "Dataset not found.");
  return out(r);
}

export async function createDataset(
  db: DbClient,
  input: {
    projectId: string;
    name: string;
    kind?: DatasetKind;
    description?: string;
    retentionDays?: number;
    sourceId?: string | null;
    createdBy?: string | null;
  },
): Promise<DatasetRow> {
  const slug = slugify(input.name);
  const { rows } = await db.query<DatasetDbRow>(
    `INSERT INTO app.dataset (project_id, name, slug, kind, description, retention_days, source_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (project_id, slug) DO UPDATE SET updated_at = now()
     RETURNING id, project_id, name, slug, kind, description, path, column_schema,
               row_count, retention_days, source_id, last_written_at, created_at, updated_at`,
    [
      input.projectId,
      input.name,
      slug,
      input.kind ?? "table",
      input.description ?? null,
      input.retentionDays ?? 30,
      input.sourceId ?? null,
      input.createdBy ?? null,
    ],
  );
  return out(rows[0]!);
}

/**
 * Append rows to a stream dataset. Single round trip — this sits on the live
 * ingestion path, so it must not become a multi-statement transaction.
 */
export async function appendToStream(
  db: DbClient,
  datasetId: string,
  rows: Record<string, unknown>[],
): Promise<{ appended: number }> {
  if (rows.length === 0) return { appended: 0 };
  const ds = await getDataset(db, datasetId);
  if (ds.kind !== "stream") {
    throw BadRequest("NOT_A_STREAM", "Append is only valid on stream datasets.");
  }

  await db.query(
    `INSERT INTO app.dataset_row (dataset_id, data)
     SELECT $1, value FROM jsonb_array_elements($2::jsonb) AS value`,
    [datasetId, JSON.stringify(rows)],
  );

  // Learn the schema from the first payloads so a stream is previewable
  // without a separate profiling pass.
  const schema = ds.columnSchema.length === 0 ? inferSchema(rows) : ds.columnSchema;
  await db.query(
    `UPDATE app.dataset
        SET row_count = row_count + $2,
            last_written_at = now(),
            column_schema = $3::jsonb,
            updated_at = now()
      WHERE id = $1`,
    [datasetId, rows.length, JSON.stringify(schema)],
  );
  return { appended: rows.length };
}

/**
 * Load rows into a table dataset as a new immutable version. The previous
 * version's rows stay addressable, which is what makes rollback possible.
 */
export async function loadTableVersion(
  db: DbClient,
  datasetId: string,
  rows: Record<string, unknown>[],
  opts?: { note?: string; createdBy?: string | null },
): Promise<{ version: number; rowCount: number; columnSchema: ColumnDef[] }> {
  const ds = await getDataset(db, datasetId);
  if (ds.kind !== "table") {
    throw BadRequest("NOT_A_TABLE", "Versioned load is only valid on table datasets.");
  }
  const schema = inferSchema(rows);

  const next = await db.query<{ v: number }>(
    `SELECT COALESCE(MAX(version), 0) + 1 AS v FROM app.dataset_version WHERE dataset_id = $1`,
    [datasetId],
  );
  const version = next.rows[0]!.v;

  const ver = await db.query<{ id: string }>(
    `INSERT INTO app.dataset_version (dataset_id, version, kind, row_count, column_schema, note, created_by)
     VALUES ($1, $2, 'snapshot', $3, $4::jsonb, $5, $6)
     RETURNING id`,
    [datasetId, version, rows.length, JSON.stringify(schema), opts?.note ?? null, opts?.createdBy ?? null],
  );
  const versionId = ver.rows[0]!.id;

  if (rows.length > 0) {
    await db.query(
      `INSERT INTO app.dataset_row (dataset_id, version_id, data)
       SELECT $1, $2, value FROM jsonb_array_elements($3::jsonb) AS value`,
      [datasetId, versionId, JSON.stringify(rows)],
    );
  }

  await db.query(
    `UPDATE app.dataset
        SET row_count = $2, column_schema = $3::jsonb, last_written_at = now(), updated_at = now()
      WHERE id = $1`,
    [datasetId, rows.length, JSON.stringify(schema)],
  );
  return { version, rowCount: rows.length, columnSchema: schema };
}

/** Preview rows: latest version for a table, most recent appends for a stream. */
export async function previewRows(
  db: DbClient,
  datasetId: string,
  limit = 50,
): Promise<Record<string, unknown>[]> {
  const ds = await getDataset(db, datasetId);
  if (ds.kind === "stream") {
    const { rows } = await db.query<{ data: Record<string, unknown> }>(
      `SELECT data FROM app.dataset_row
        WHERE dataset_id = $1
        ORDER BY ingested_at DESC, id DESC
        LIMIT $2`,
      [datasetId, limit],
    );
    return rows.map((r) => r.data);
  }
  const { rows } = await db.query<{ data: Record<string, unknown> }>(
    `SELECT r.data
       FROM app.dataset_row r
       JOIN app.dataset_version v ON v.id = r.version_id
      WHERE r.dataset_id = $1
        AND v.version = (SELECT MAX(version) FROM app.dataset_version WHERE dataset_id = $1)
      ORDER BY r.id ASC
      LIMIT $2`,
    [datasetId, limit],
  );
  return rows.map((r) => r.data);
}

/** Drop stream rows past their retention window. Safe to call repeatedly. */
export async function pruneStreams(db: DbClient): Promise<number> {
  const { rowCount } = await db.query(
    `DELETE FROM app.dataset_row r
      USING app.dataset d
      WHERE r.dataset_id = d.id
        AND d.kind = 'stream'
        AND r.ingested_at < now() - make_interval(days => d.retention_days)`,
  );
  return rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// Reference graph
// ---------------------------------------------------------------------------

export type ResourceType =
  | "source"
  | "dataset"
  | "pipeline"
  | "channel"
  | "object_type"
  | "model";

export async function addReference(
  db: DbClient,
  ref: {
    fromType: ResourceType;
    fromId: string;
    toType: ResourceType;
    toId: string;
    kind?: "reads" | "writes" | "derives";
  },
): Promise<void> {
  await db
    .query(
      `INSERT INTO app.resource_reference (from_type, from_id, to_type, to_id, kind)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [ref.fromType, ref.fromId, ref.toType, ref.toId, ref.kind ?? "reads"],
    )
    .catch(() => undefined);
}

export interface ReferenceEdge {
  type: ResourceType;
  id: string;
  kind: string;
}

/** Upstream and downstream neighbours — powers the References panel. */
export async function getReferences(
  db: DbClient,
  type: ResourceType,
  id: string,
): Promise<{ upstream: ReferenceEdge[]; downstream: ReferenceEdge[] }> {
  const up = await db.query<{ from_type: ResourceType; from_id: string; kind: string }>(
    `SELECT from_type, from_id, kind FROM app.resource_reference
      WHERE to_type = $1 AND to_id = $2`,
    [type, id],
  );
  const down = await db.query<{ to_type: ResourceType; to_id: string; kind: string }>(
    `SELECT to_type, to_id, kind FROM app.resource_reference
      WHERE from_type = $1 AND from_id = $2`,
    [type, id],
  );
  return {
    upstream: up.rows.map((r) => ({ type: r.from_type, id: r.from_id, kind: r.kind })),
    downstream: down.rows.map((r) => ({ type: r.to_type, id: r.to_id, kind: r.kind })),
  };
}
