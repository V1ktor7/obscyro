import type { DbClient } from "../lib/db.js";
import { BadRequest, NotFound } from "../lib/errors.js";
import { buildMapProperties, type MappingRule } from "./channel-runner.js";

import { addReference, previewRows } from "./datasets.js";
import { upsertInstanceByIdentity, type PropertyDef } from "./ontology.js";
/**
 * A binding maps columns to scalar properties only — link rules belong to the
 * Map step, not here. Narrower than MappingRule so the API contract is exact.
 */
export interface ColumnMapRule {
  from: string;
  to: string;
  coerce?: "string" | "number" | "boolean" | "date";
  onMissing?: "skip" | "null" | "flag";
}


// ---------------------------------------------------------------------------
// Ontology output + the lineage graph.
//
// Binding a dataset to an object type is the last edge of the chain. On
// materialize the rows are transformed with the same buildMapProperties used
// by the Map step (so coercion behaves identically) and written with
// upsertInstanceByIdentity — a re-run updates rather than duplicates.
//
// The graph is assembled from resource_reference plus the bindings, so it is a
// read of what already happened rather than a separate model to maintain.
// ---------------------------------------------------------------------------

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

interface DsRow {
  id: string;
  project_id: string;
  object_type_id: string;
  object_type_name: string;
  dataset_id: string;
  dataset_name: string;
  identity_properties: string[];
  column_mapping: ColumnMapRule[];
  writeback: boolean;
  last_synced_at: Date | null;
  last_status: string | null;
  last_error: string | null;
}

const DS_SELECT = `
  SELECT b.id, b.project_id, b.object_type_id, t.name AS object_type_name,
         b.dataset_id, d.name AS dataset_name, b.identity_properties,
         b.column_mapping, b.writeback, b.last_synced_at, b.last_status, b.last_error
    FROM app.object_type_datasource b
    JOIN app.ontology_object_types t ON t.id = b.object_type_id
    JOIN app.dataset d ON d.id = b.dataset_id`;

function out(r: DsRow): Datasource {
  return {
    id: r.id,
    projectId: r.project_id,
    objectTypeId: r.object_type_id,
    objectTypeName: r.object_type_name,
    datasetId: r.dataset_id,
    datasetName: r.dataset_name,
    identityProperties: r.identity_properties ?? [],
    columnMapping: r.column_mapping ?? [],
    writeback: r.writeback,
    lastSyncedAt: r.last_synced_at ? r.last_synced_at.toISOString() : null,
    lastStatus: r.last_status,
    lastError: r.last_error,
  };
}

export async function listDatasources(db: DbClient, projectId: string): Promise<Datasource[]> {
  const { rows } = await db.query<DsRow>(
    `${DS_SELECT} WHERE b.project_id = $1 ORDER BY b.created_at ASC`,
    [projectId],
  );
  return rows.map(out);
}

export async function createDatasource(
  db: DbClient,
  input: {
    projectId: string;
    objectTypeName: string;
    datasetId: string;
    identityProperties: string[];
    columnMapping: ColumnMapRule[];
    createdBy?: string | null;
  },
): Promise<Datasource> {
  if (input.identityProperties.length === 0) {
    throw BadRequest(
      "IDENTITY_REQUIRED",
      "Pick at least one property as the key, otherwise every run duplicates the rows instead of updating them.",
    );
  }

  const t = await db.query<{ id: string; org: string }>(
    `SELECT t.id, t.organization_id AS org
       FROM app.ontology_object_types t
       JOIN app.project p ON p.organization_id = t.organization_id
      WHERE p.id = $1 AND t.name = $2`,
    [input.projectId, input.objectTypeName],
  );
  const objectTypeId = t.rows[0]?.id;
  if (!objectTypeId) {
    throw NotFound("TYPE_NOT_FOUND", `Object type "${input.objectTypeName}" not found.`);
  }

  // A stream-backed type cannot accept edits: the next materialize would
  // silently overwrite them (the same constraint Foundry documents).
  const kindRes = await db.query<{ kind: string }>(
    `SELECT kind FROM app.dataset WHERE id = $1`,
    [input.datasetId],
  );
  const writeback = kindRes.rows[0]?.kind === "table";

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO app.object_type_datasource
            (project_id, object_type_id, dataset_id, identity_properties,
             column_mapping, writeback, created_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
     ON CONFLICT (object_type_id, dataset_id) DO UPDATE
        SET identity_properties = EXCLUDED.identity_properties,
            column_mapping = EXCLUDED.column_mapping,
            updated_at = now()
     RETURNING id`,
    [
      input.projectId,
      objectTypeId,
      input.datasetId,
      input.identityProperties,
      JSON.stringify(input.columnMapping),
      writeback,
      input.createdBy ?? null,
    ],
  );

  // The edge that finally reaches the ontology.
  await addReference(db, {
    fromType: "dataset",
    fromId: input.datasetId,
    toType: "object_type",
    toId: objectTypeId,
    kind: "derives",
  });

  const created = await db.query<DsRow>(`${DS_SELECT} WHERE b.id = $1`, [rows[0]!.id]);
  return out(created.rows[0]!);
}

export interface MaterializeResult {
  read: number;
  written: number;
  skipped: number;
  issues: { row: number; reason: string }[];
}

/**
 * Read the bound dataset and upsert instances. Rows whose mapping produces an
 * issue (bad coercion, missing required property) are skipped and reported
 * rather than written half-formed.
 */
export async function materialize(
  db: DbClient,
  datasourceId: string,
  limit = 5000,
): Promise<MaterializeResult> {
  const { rows: bRows } = await db.query<DsRow>(`${DS_SELECT} WHERE b.id = $1`, [datasourceId]);
  const b = bRows[0];
  if (!b) throw NotFound("DATASOURCE_NOT_FOUND", "Datasource binding not found.");
  const binding = out(b);

  const schemaRes = await db.query<{ property_schema: PropertyDef[] }>(
    `SELECT property_schema FROM app.ontology_object_types WHERE id = $1`,
    [binding.objectTypeId],
  );
  const schema = schemaRes.rows[0]?.property_schema ?? [];

  const rows = await previewRows(db, binding.datasetId, limit);
  const scalarRules: MappingRule[] = binding.columnMapping.filter((r) => r.from && r.to);

  let written = 0;
  let skipped = 0;
  const issues: { row: number; reason: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const { properties, issues: rowIssues, missingRequired } = buildMapProperties(
      rows[i]!,
      scalarRules,
      schema,
    );
    if (rowIssues.length > 0 || missingRequired.length > 0) {
      skipped++;
      if (issues.length < 20) {
        issues.push({
          row: i,
          reason:
            rowIssues.map((x) => `${x.field}: ${x.reason}`).join("; ") ||
            `missing required: ${missingRequired.join(", ")}`,
        });
      }
      continue;
    }
    await upsertInstanceByIdentity(
      db,
      binding.objectTypeId,
      binding.identityProperties,
      properties,
      { source: "ontology-output", datasourceId },
    );
    written++;
  }

  await db.query(
    `UPDATE app.object_type_datasource
        SET last_synced_at = now(), last_status = $2, last_error = $3, updated_at = now()
      WHERE id = $1`,
    [
      datasourceId,
      skipped > 0 ? "partial" : "ok",
      skipped > 0 ? `${skipped} row(s) skipped` : null,
    ],
  );

  return { read: rows.length, written, skipped, issues };
}

// ---------------------------------------------------------------------------
// The graph
// ---------------------------------------------------------------------------

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

/**
 * The whole project as one graph: sources, datasets and object types, with the
 * edges that already exist in resource_reference. Nothing is inferred — an
 * edge appears because something recorded it.
 */
export async function getProjectGraph(
  db: DbClient,
  projectId: string,
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const nodes: GraphNode[] = [];

  const sources = await db.query<{
    id: string;
    name: string;
    type: string;
    status: string;
    sync_count: string;
  }>(
    `SELECT s.id, s.name, s.type, s.status,
            (SELECT COUNT(*) FROM app.sync y WHERE y.source_id = s.id) AS sync_count
       FROM app.ingest_sources s WHERE s.project_id = $1`,
    [projectId],
  );
  for (const s of sources.rows) {
    nodes.push({
      id: s.id,
      type: "source",
      name: s.name,
      subtitle: s.type,
      status: Number(s.sync_count) === 0 ? "warn" : s.status === "error" ? "warn" : "ok",
      count: null,
    });
  }

  const datasets = await db.query<{
    id: string;
    name: string;
    kind: string;
    row_count: string;
    last_written_at: Date | null;
  }>(
    `SELECT id, name, kind, row_count, last_written_at FROM app.dataset WHERE project_id = $1`,
    [projectId],
  );
  for (const d of datasets.rows) {
    nodes.push({
      id: d.id,
      type: "dataset",
      name: d.name,
      subtitle: d.kind,
      status: Number(d.row_count) > 0 ? "ok" : "idle",
      count: Number(d.row_count),
    });
  }

  // Object types resolve org-wide but are filed in a project; show the ones
  // filed here so the graph matches the workspace you are looking at.
  const types = await db.query<{ id: string; name: string; n: string }>(
    `SELECT t.id, t.name,
            (SELECT COUNT(*) FROM app.ontology_object_instances i
              WHERE i.object_type_id = t.id) AS n
       FROM app.ontology_object_types t WHERE t.project_id = $1`,
    [projectId],
  );
  for (const t of types.rows) {
    nodes.push({
      id: t.id,
      type: "object_type",
      name: t.name,
      subtitle: "object type",
      status: Number(t.n) > 0 ? "ok" : "idle",
      count: Number(t.n),
    });
  }

  const known = new Set(nodes.map((n) => n.id));
  const refs = await db.query<{ from_id: string; to_id: string; kind: string }>(
    `SELECT from_id, to_id, kind FROM app.resource_reference`,
  );
  const edges = refs.rows
    .filter((r) => known.has(r.from_id) && known.has(r.to_id))
    .map((r) => ({ from: r.from_id, to: r.to_id, kind: r.kind }));

  return { nodes, edges };
}
