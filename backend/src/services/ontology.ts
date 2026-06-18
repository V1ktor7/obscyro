import type { DbClient } from "../lib/db.js";

import { NotFound } from "../lib/errors.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EnvironmentRow {
  id: string;
  name: string;
  slug: string;
  ownerUserId: string;
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
  { key: "label", type: "string", label: "Label" },
  { key: "external_id", type: "string", label: "External ID" },
];

/**
 * Resolve an environment by slug or UUID, always scoped to the owner. Returns
 * null when the environment does not exist or is not owned by `userId`.
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
    created_at: Date;
  }>(
    `SELECT id, name, slug, owner_user_id, created_at
       FROM app.ontology_environments
      WHERE owner_user_id = $1 AND ${byUuid ? "id = $2" : "slug = $2"}`,
    [userId, envParam],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    ownerUserId: row.owner_user_id,
    createdAt: row.created_at,
  };
}

/** Like {@link findEnvironment} but throws a 404 when not found/owned. */
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
