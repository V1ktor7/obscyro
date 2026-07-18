import type { DbClient } from "../lib/db.js";

import { NotFound } from "../lib/errors.js";

export interface EnvInstanceRow {
  id: string;
  typeId: string;
  typeName: string;
  properties: Record<string, unknown>;
  provenance: Record<string, unknown>;
  propertySchema: PropertyDef[];
  createdAt: Date;
  updatedAt: Date;
}

export interface EnvLinkRow {
  id: string;
  linkTypeName: string;
  fromInstanceId: string;
  toInstanceId: string;
  fromTypeName: string;
  toTypeName: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EnvironmentType = "reference" | "entity" | "operations";

export interface EnvironmentRow {
  id: string;
  name: string;
  slug: string;
  ownerUserId: string;
  organizationId: string;
  environmentType: EnvironmentType;
  createdAt: Date;
}

export interface PropertyDef {
  key: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  label?: string;
}

/**
 * Property schema for the canonical ClinicalFinding type: the full ConText
 * envelope so the persisted instance carries everything a downstream query
 * (a plain code store cannot) would need.
 */
export const CLINICAL_FINDING_SCHEMA: PropertyDef[] = [
  { key: "span", type: "string", label: "Span" },
  { key: "snomed_code", type: "string", label: "SNOMED code" },
  { key: "display", type: "string", label: "Display" },
  { key: "assertion", type: "string", label: "Assertion" },
  { key: "subject", type: "string", label: "Subject" },
  { key: "temporality", type: "string", label: "Temporality" },
  { key: "certainty", type: "string", label: "Certainty" },
  { key: "trigger", type: "string", label: "Trigger" },
  { key: "confidence", type: "number", label: "Context confidence" },
  { key: "decision", type: "string", label: "Decision" },
  { key: "readable_note", type: "string", label: "Readable note" },
];

export const PATIENT_SCHEMA: PropertyDef[] = [
  { key: "identifier", type: "string", label: "Identifier" },
  { key: "label", type: "string", label: "Label" },
  { key: "external_id", type: "string", label: "External ID" },
];

/**
 * Resolve an environment by slug or UUID, scoped to org membership. Returns
 * null when the environment does not exist or the user is not a member of its org.
 */
export async function findEnvironment(
  db: DbClient,
  userId: string,
  envParam: string,
): Promise<EnvironmentRow | null> {
  const byUuid = UUID_RE.test(envParam);
  const { rows } = await db.query<{
    id: string;
    name: string;
    slug: string;
    owner_user_id: string;
    organization_id: string;
    environment_type: EnvironmentType;
    created_at: Date;
  }>(
    `SELECT e.id, e.name, e.slug, e.owner_user_id, e.organization_id,
            e.environment_type, e.created_at
       FROM app.ontology_environments e
       JOIN app.organization_members om ON om.organization_id = e.organization_id
      WHERE om.user_id = $1 AND ${byUuid ? "e.id = $2" : "e.slug = $2"}`,
    [userId, envParam],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    ownerUserId: row.owner_user_id,
    organizationId: row.organization_id,
    environmentType: row.environment_type,
    createdAt: row.created_at,
  };
}

/** Seed Patient, ClinicalFinding, and has_finding for entity environments. */
export async function seedEntityEnvironmentSchema(
  db: DbClient,
  environmentId: string,
): Promise<void> {
  const findingTypeId = await getOrCreateObjectType(
    db,
    environmentId,
    "ClinicalFinding",
    "Clinical finding extracted from text with its context envelope",
    CLINICAL_FINDING_SCHEMA,
  );
  const patientTypeId = await getOrCreateObjectType(
    db,
    environmentId,
    "Patient",
    "Subject of clinical findings",
    PATIENT_SCHEMA,
  );
  await getOrCreateLinkType(
    db,
    environmentId,
    "has_finding",
    patientTypeId,
    findingTypeId,
    "many_to_many",
  );
}

/** Like {@link findEnvironment} but throws a 404 when not found/accessible. */
export async function resolveEnvironment(
  db: DbClient,
  userId: string,
  envParam: string,
): Promise<EnvironmentRow> {
  const env = await findEnvironment(db, userId, envParam);
  if (!env) {
    throw NotFound("ENV_NOT_FOUND", `Environment "${envParam}" not found.`);
  }
  return env;
}

export async function getOrCreateObjectType(
  db: DbClient,
  environmentId: string,
  name: string,
  description: string | null,
  propertySchema: PropertyDef[],
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO app.ontology_object_types (environment_id, name, description, property_schema)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (environment_id, name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [environmentId, name, description, JSON.stringify(propertySchema)],
  );
  return rows[0]!.id;
}

export async function getOrCreateLinkType(
  db: DbClient,
  environmentId: string,
  name: string,
  fromTypeId: string,
  toTypeId: string,
  cardinality: string,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO app.ontology_link_types (environment_id, name, from_type_id, to_type_id, cardinality)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (environment_id, name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [environmentId, name, fromTypeId, toTypeId, cardinality],
  );
  return rows[0]!.id;
}

export async function insertObjectInstance(
  db: DbClient,
  objectTypeId: string,
  properties: Record<string, unknown>,
  provenance: Record<string, unknown>,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO app.ontology_object_instances (object_type_id, properties, provenance)
     VALUES ($1, $2::jsonb, $3::jsonb)
     RETURNING id`,
    [objectTypeId, JSON.stringify(properties), JSON.stringify(provenance)],
  );
  return rows[0]!.id;
}

export interface FindingInstanceColumns {
  codeSystem?: string | null;
  code?: string | null;
  display?: string | null;
  context?: Record<string, unknown> | null;
}

export async function insertFindingInstance(
  db: DbClient,
  objectTypeId: string,
  properties: Record<string, unknown>,
  provenance: Record<string, unknown>,
  columns: FindingInstanceColumns,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO app.ontology_object_instances (
       object_type_id, properties, provenance, code_system, code, display, context
     )
     VALUES ($1, $2::jsonb, $3::jsonb, $4, $5, $6, $7::jsonb)
     RETURNING id`,
    [
      objectTypeId,
      JSON.stringify(properties),
      JSON.stringify(provenance),
      columns.codeSystem ?? null,
      columns.code ?? null,
      columns.display ?? null,
      columns.context ? JSON.stringify(columns.context) : null,
    ],
  );
  return rows[0]!.id;
}

export async function createPipelineRun(
  db: DbClient,
  environmentId: string,
  inputHash: string,
  source = "rest",
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO app.ontology_pipeline_run (environment_id, source, input_hash, status)
     VALUES ($1, $2, $3, 'running')
     RETURNING id`,
    [environmentId, source, inputHash],
  );
  return rows[0]!.id;
}

export async function finishPipelineRun(
  db: DbClient,
  runId: string,
  status: "succeeded" | "failed",
  stats?: Record<string, unknown>,
): Promise<void> {
  await db.query(
    `UPDATE app.ontology_pipeline_run
        SET status = $2,
            finished_at = NOW(),
            stats = COALESCE($3::jsonb, stats)
      WHERE id = $1`,
    [runId, status, stats ? JSON.stringify(stats) : null],
  );
}

export async function insertFailedPipelineRun(
  db: DbClient,
  environmentId: string,
  inputHash: string,
  source = "rest",
): Promise<void> {
  await db.query(
    `INSERT INTO app.ontology_pipeline_run (environment_id, source, input_hash, status, finished_at)
     VALUES ($1, $2, $3, 'failed', NOW())`,
    [environmentId, source, inputHash],
  );
}

export async function insertLinkInstance(
  db: DbClient,
  linkTypeId: string,
  fromInstanceId: string,
  toInstanceId: string,
  provenance: Record<string, unknown>,
): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO app.ontology_link_instances (link_type_id, from_instance_id, to_instance_id, provenance)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (link_type_id, from_instance_id, to_instance_id) DO NOTHING
     RETURNING id`,
    [linkTypeId, fromInstanceId, toInstanceId, JSON.stringify(provenance)],
  );
  return rows[0]?.id ?? null;
}

/** List object instances in an environment with optional type/where filters. */
export async function listInstancesForEnv(
  db: DbClient,
  environmentId: string,
  opts?: { type?: string; wherePairs?: Array<[string, string]>; limit?: number },
): Promise<EnvInstanceRow[]> {
  const params: unknown[] = [environmentId];
  let sql = `SELECT oi.id, oi.object_type_id, t.name AS type_name,
                    oi.properties, oi.provenance, t.property_schema,
                    oi.created_at, oi.updated_at
               FROM app.ontology_object_instances oi
               JOIN app.ontology_object_types t ON t.id = oi.object_type_id
              WHERE t.environment_id = $1`;
  if (opts?.type) {
    params.push(opts.type);
    sql += ` AND t.name = $${params.length}`;
  }
  for (const [key, value] of opts?.wherePairs ?? []) {
    params.push(key);
    const keyParam = params.length;
    params.push(value);
    const valueParam = params.length;
    sql += ` AND oi.properties ->> $${keyParam} = $${valueParam}`;
  }
  params.push(opts?.limit ?? 5000);
  sql += ` ORDER BY oi.created_at DESC LIMIT $${params.length}`;

  const { rows } = await db.query<{
    id: string;
    object_type_id: string;
    type_name: string;
    properties: Record<string, unknown>;
    provenance: Record<string, unknown>;
    property_schema: PropertyDef[];
    created_at: Date;
    updated_at: Date;
  }>(sql, params);

  return rows.map((r) => ({
    id: r.id,
    typeId: r.object_type_id,
    typeName: r.type_name,
    properties: r.properties,
    provenance: r.provenance,
    propertySchema: r.property_schema ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/** List link instances within an environment. */
export async function listLinksForEnv(
  db: DbClient,
  environmentId: string,
): Promise<EnvLinkRow[]> {
  const { rows } = await db.query<{
    id: string;
    link_type_name: string;
    from_instance_id: string;
    to_instance_id: string;
    from_type_name: string;
    to_type_name: string;
  }>(
    `SELECT li.id, lt.name AS link_type_name,
            li.from_instance_id, li.to_instance_id,
            ft.name AS from_type_name, tt.name AS to_type_name
       FROM app.ontology_link_instances li
       JOIN app.ontology_link_types lt ON lt.id = li.link_type_id
       JOIN app.ontology_object_instances fi ON fi.id = li.from_instance_id
       JOIN app.ontology_object_types ft ON ft.id = fi.object_type_id
       JOIN app.ontology_object_instances ti ON ti.id = li.to_instance_id
       JOIN app.ontology_object_types tt ON tt.id = ti.object_type_id
      WHERE lt.environment_id = $1`,
    [environmentId],
  );
  return rows.map((r) => ({
    id: r.id,
    linkTypeName: r.link_type_name,
    fromInstanceId: r.from_instance_id,
    toInstanceId: r.to_instance_id,
    fromTypeName: r.from_type_name,
    toTypeName: r.to_type_name,
  }));
}

/** Count instances in an environment (for simulation read-only guard tests). */
export async function countInstancesForEnv(
  db: DbClient,
  environmentId: string,
): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM app.ontology_object_instances oi
       JOIN app.ontology_object_types t ON t.id = oi.object_type_id
      WHERE t.environment_id = $1`,
    [environmentId],
  );
  return Number(rows[0]?.count ?? 0);
}

/**
 * Copy an environment's ontology into another: object types (merged by name,
 * nature filled in when the target lacks one), instances, link types, and
 * link instances. Used to consolidate domain-split environments into one
 * "world" environment. Instance copies record their origin in provenance.
 */
export async function importEnvironment(
  db: DbClient,
  targetEnvId: string,
  sourceEnvId: string,
): Promise<{ types: number; instances: number; linkTypes: number; links: number }> {
  const srcTypes = await db.query<{
    id: string;
    name: string;
    description: string | null;
    nature: "physical" | "conceptual" | null;
    property_schema: PropertyDef[];
  }>(
    `SELECT id, name, description, nature, property_schema
       FROM app.ontology_object_types
      WHERE environment_id = $1`,
    [sourceEnvId],
  );

  const typeMap = new Map<string, string>();
  for (const t of srcTypes.rows) {
    const targetTypeId = await getOrCreateObjectType(
      db,
      targetEnvId,
      t.name,
      t.description,
      t.property_schema ?? [],
    );
    if (t.nature) {
      await db.query(
        `UPDATE app.ontology_object_types SET nature = COALESCE(nature, $2) WHERE id = $1`,
        [targetTypeId, t.nature],
      );
    }
    typeMap.set(t.id, targetTypeId);
  }

  const srcInstances = await db.query<{
    id: string;
    object_type_id: string;
    properties: Record<string, unknown>;
    provenance: Record<string, unknown>;
  }>(
    `SELECT oi.id, oi.object_type_id, oi.properties, oi.provenance
       FROM app.ontology_object_instances oi
       JOIN app.ontology_object_types t ON t.id = oi.object_type_id
      WHERE t.environment_id = $1
      ORDER BY oi.created_at ASC
      LIMIT 10000`,
    [sourceEnvId],
  );

  const instanceMap = new Map<string, string>();
  for (const inst of srcInstances.rows) {
    const targetTypeId = typeMap.get(inst.object_type_id);
    if (!targetTypeId) continue;
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO app.ontology_object_instances (object_type_id, properties, provenance)
       VALUES ($1, $2::jsonb, $3::jsonb)
       RETURNING id`,
      [
        targetTypeId,
        JSON.stringify(inst.properties ?? {}),
        JSON.stringify({
          ...(inst.provenance ?? {}),
          importedFromEnvironment: sourceEnvId,
          importedFromInstance: inst.id,
        }),
      ],
    );
    instanceMap.set(inst.id, rows[0]!.id);
  }

  const srcLinkTypes = await db.query<{
    id: string;
    name: string;
    from_type_id: string;
    to_type_id: string;
    cardinality: string;
  }>(
    `SELECT id, name, from_type_id, to_type_id, cardinality
       FROM app.ontology_link_types
      WHERE environment_id = $1`,
    [sourceEnvId],
  );

  const linkTypeMap = new Map<string, string>();
  for (const lt of srcLinkTypes.rows) {
    const fromType = typeMap.get(lt.from_type_id);
    const toType = typeMap.get(lt.to_type_id);
    if (!fromType || !toType) continue;
    const targetLinkTypeId = await getOrCreateLinkType(
      db,
      targetEnvId,
      lt.name,
      fromType,
      toType,
      lt.cardinality,
    );
    linkTypeMap.set(lt.id, targetLinkTypeId);
  }

  const srcLinks = await db.query<{
    link_type_id: string;
    from_instance_id: string;
    to_instance_id: string;
    provenance: Record<string, unknown>;
  }>(
    `SELECT li.link_type_id, li.from_instance_id, li.to_instance_id, li.provenance
       FROM app.ontology_link_instances li
       JOIN app.ontology_link_types lt ON lt.id = li.link_type_id
      WHERE lt.environment_id = $1
      LIMIT 20000`,
    [sourceEnvId],
  );

  let links = 0;
  for (const li of srcLinks.rows) {
    const linkTypeId = linkTypeMap.get(li.link_type_id);
    const fromId = instanceMap.get(li.from_instance_id);
    const toId = instanceMap.get(li.to_instance_id);
    if (!linkTypeId || !fromId || !toId) continue;
    const inserted = await db.query(
      `INSERT INTO app.ontology_link_instances (link_type_id, from_instance_id, to_instance_id, provenance)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (link_type_id, from_instance_id, to_instance_id) DO NOTHING`,
      [linkTypeId, fromId, toId, JSON.stringify(li.provenance ?? {})],
    );
    links += inserted.rowCount ?? 0;
  }

  return {
    types: typeMap.size,
    instances: instanceMap.size,
    linkTypes: linkTypeMap.size,
    links,
  };
}
