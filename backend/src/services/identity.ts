import type { DbClient } from "../lib/db.js";
import { BadRequest, Conflict, NotFound } from "../lib/errors.js";

/**
 * Identity on object types.
 *
 * Which properties say "this is the same real-world thing". Until now nothing
 * did: `upsertInstanceByIdentity` took the keys as an argument, supplied by
 * whichever channel mapping happened to be running, and a plain insert supplied
 * none. Two pipelines could disagree about what identifies a bed, and the
 * ontology ended up with two `HND Emergency` carrying the same code — which
 * every view that aggregates by site then answers wrongly, plausibly, and
 * without complaint.
 *
 * The constraint itself lives in the database (migration 043, trigger
 * `instance_identity_sync`). This module is what makes it usable: declaring
 * identity on a type that already has duplicates has to *say which ones*, not
 * fail with a constraint name.
 */

/** How many offending groups a refusal lists before it stops naming them. */
const SAMPLE_LIMIT = 20;

export interface DuplicateGroup {
  /** The identifying values, in the order the properties were given. */
  values: string[];
  count: number;
  instanceIds: string[];
}

export interface IdentityReadiness {
  /** Groups of instances that would collide. Empty means the type is ready. */
  duplicates: DuplicateGroup[];
  /** Instances missing at least one of the properties. */
  missing: number;
  /** Total instances of the type. */
  total: number;
  /** Properties named that the type's schema does not declare. */
  unknownProperties: string[];
}

/**
 * The key the trigger will compute, computed the same way here.
 *
 * Kept deliberately identical to the SQL in migration 043 — `lower(btrim(v))`
 * joined as a JSON array. Two spellings of one rule is how they drift, so if
 * this changes the migration changes with it.
 */
export function identityKeyOf(
  properties: Record<string, unknown>,
  identityProperties: string[],
): string | null {
  const parts: string[] = [];
  for (const p of identityProperties) {
    const raw = properties[p];
    if (raw === undefined || raw === null) return null;
    const v = String(raw).trim().toLowerCase();
    if (v === "") return null;
    parts.push(v);
  }
  return JSON.stringify(parts);
}

function normalizeProps(props: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of props) {
    const t = p.trim();
    if (t === "" || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * What stands between this type and this identity.
 *
 * Read-only, and worth calling before offering the change in an interface: the
 * answer to "why can't I set this" is a list of the objects that already
 * collide, which is also the list of things to go and merge.
 */
export async function identityReadiness(
  db: DbClient,
  objectTypeId: string,
  identityProperties: string[],
): Promise<IdentityReadiness> {
  const props = normalizeProps(identityProperties);
  if (props.length === 0) {
    throw BadRequest("IDENTITY_EMPTY", "Name at least one property.");
  }

  const { rows: typeRows } = await db.query<{ property_schema: unknown }>(
    `SELECT property_schema FROM app.ontology_object_types WHERE id = $1`,
    [objectTypeId],
  );
  if (typeRows.length === 0) throw NotFound("TYPE_NOT_FOUND", "No such object type.");

  const declared = new Set(
    (Array.isArray(typeRows[0]!.property_schema) ? typeRows[0]!.property_schema : [])
      .map((p) => (p as { key?: unknown }).key)
      .filter((k): k is string => typeof k === "string"),
  );
  const unknownProperties = props.filter((p) => !declared.has(p));

  // The same normalisation the trigger applies, so this counts what the
  // database would actually reject rather than something adjacent to it.
  const keyExpr = `to_jsonb(ARRAY[${props
    .map((_, i) => `lower(btrim(properties ->> $${i + 2}))`)
    .join(", ")}])::text`;
  const presentExpr = props
    .map((_, i) => `btrim(COALESCE(properties ->> $${i + 2}, '')) <> ''`)
    .join(" AND ");
  const params = [objectTypeId, ...props];

  const { rows: counts } = await db.query<{ total: string; missing: string }>(
    `SELECT count(*)::text AS total,
            count(*) FILTER (WHERE NOT (${presentExpr}))::text AS missing
       FROM app.ontology_object_instances
      WHERE object_type_id = $1`,
    params,
  );

  const { rows: dupes } = await db.query<{
    key: string;
    n: string;
    ids: string[];
    vals: string[];
  }>(
    `SELECT ${keyExpr} AS key,
            count(*)::text AS n,
            (array_agg(id ORDER BY created_at))[1:5] AS ids,
            (array_agg(${props.map((_, i) => `properties ->> $${i + 2}`).join(" || ' · ' || ")}
                       ORDER BY created_at))[1:1] AS vals
       FROM app.ontology_object_instances
      WHERE object_type_id = $1 AND ${presentExpr}
      GROUP BY 1
     HAVING count(*) > 1
      ORDER BY count(*) DESC
      LIMIT ${SAMPLE_LIMIT}`,
    params,
  );

  return {
    duplicates: dupes.map((r) => ({
      values: [r.vals[0] ?? ""],
      count: Number(r.n),
      instanceIds: r.ids,
    })),
    missing: Number(counts[0]?.missing ?? 0),
    total: Number(counts[0]?.total ?? 0),
    unknownProperties,
  };
}

/**
 * Declare the identity, and make the existing rows obey it.
 *
 * Refuses rather than half-applies. A type whose instances already collide
 * cannot be given an identity without deciding what to do about them, and that
 * decision is not one this function gets to make quietly.
 */
export async function setIdentityProperties(
  db: DbClient,
  objectTypeId: string,
  identityProperties: string[],
): Promise<{ identityProperties: string[]; indexed: number }> {
  const props = normalizeProps(identityProperties);
  const readiness = await identityReadiness(db, objectTypeId, props);

  if (readiness.duplicates.length > 0) {
    const total = readiness.duplicates.reduce((a, g) => a + g.count, 0);
    throw Conflict(
      "IDENTITY_DUPLICATES",
      `${readiness.duplicates.length} value(s) are shared by ${total} instances, so ` +
        `they cannot identify anything yet. Merge or correct them first.`,
      { duplicates: readiness.duplicates },
    );
  }
  if (readiness.missing > 0) {
    throw Conflict(
      "IDENTITY_INCOMPLETE",
      `${readiness.missing} of ${readiness.total} instances are missing one of these ` +
        `properties. An object without them could not be identified, and every later ` +
        `write to it would be refused.`,
      { missing: readiness.missing, total: readiness.total },
    );
  }

  // FOR UPDATE so a concurrent declaration on the same type serialises behind
  // this one rather than both backfilling into the same keys.
  await db.query(`SELECT id FROM app.ontology_object_types WHERE id = $1 FOR UPDATE`, [
    objectTypeId,
  ]);
  await db.query(
    `UPDATE app.ontology_object_types SET identity_properties = $2 WHERE id = $1`,
    [objectTypeId, props],
  );

  const keyExpr = `to_jsonb(ARRAY[${props
    .map((_, i) => `lower(btrim(properties ->> $${i + 2}))`)
    .join(", ")}])::text`;
  const { rowCount } = await db.query(
    `INSERT INTO app.instance_identity (object_type_id, identity_key, instance_id)
     SELECT object_type_id, ${keyExpr}, id
       FROM app.ontology_object_instances
      WHERE object_type_id = $1
     ON CONFLICT (instance_id) DO UPDATE
        SET object_type_id = EXCLUDED.object_type_id,
            identity_key   = EXCLUDED.identity_key`,
    [objectTypeId, ...props],
  );

  return { identityProperties: props, indexed: rowCount ?? 0 };
}

/** Drop the identity. The rows go with it; nothing else is touched. */
export async function clearIdentityProperties(
  db: DbClient,
  objectTypeId: string,
): Promise<void> {
  await db.query(
    `UPDATE app.ontology_object_types SET identity_properties = '{}' WHERE id = $1`,
    [objectTypeId],
  );
  await db.query(
    `DELETE FROM app.instance_identity WHERE object_type_id = $1`,
    [objectTypeId],
  );
}

/**
 * Turn the database's refusal into something a person can act on.
 *
 * `duplicate key value violates unique constraint "instance_identity_pkey"`
 * names a table nobody using the product has heard of. The interesting part —
 * which object, which value — is in the detail, and only if you know to look.
 */
export function describeIdentityViolation(err: unknown): string | null {
  const e = err as { code?: string; constraint?: string; detail?: string; message?: string };
  if (e?.code === "23505" && /instance_identity/.test(e.constraint ?? e.message ?? "")) {
    return (
      "An instance of this type already carries these identifying values. " +
      "Identity is declared on the type, so the same values cannot describe two objects."
    );
  }
  // The trigger raises this when an identifying property is absent.
  if (e?.code === "23502" && /identifie le type/.test(e.message ?? "")) {
    return e.message ?? null;
  }
  return null;
}
