/**
 * Map layers: data added by a person, read on the twin's hexes.
 *
 * A layer is not a new kind of thing. It is a numeric property on instances
 * the twin already places — a site with coordinates, or a catchment that
 * carries a head count — whose declaration says "show me on the map, and when
 * two of me meet, combine us this way". Adding data writes that property;
 * reading layers reads it back with where each value sits.
 *
 * Three steps, kept apart so the pure parts can be tested without a database:
 *
 *  - match: which column of the file names which instances, by counting how
 *    many of its values a property of a located type actually holds;
 *  - write: one transaction that declares the property and merges the values,
 *    and removes the values of a previous load the new file no longer has;
 *  - read: every declared layer, as points and catchment values.
 */

import type { DbClient } from "../lib/db.js";
import { config } from "../lib/config.js";
import { BadRequest, Conflict, NotFound } from "../lib/errors.js";
import { getOrCreateObjectType, listInstancesForEnv, type EnvInstanceRow } from "./ontology.js";
import type { LayerAggregate, LayerDecl, PropertyDef } from "./property-schema.js";

// ---------------------------------------------------------------------------
// Pure helpers.
// ---------------------------------------------------------------------------

/**
 * One spelling for a key, so a file and the twin agree on it.
 *
 * Case, accents, spacing and leading zeros are how the same code differs
 * between a ministry's spreadsheet and an ontology: "0611" in one and 611 in
 * the other, "Hôpital Fleury" and "HOPITAL FLEURY". None of those differences
 * names a different place.
 */
export function normalizeKey(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") return null;
  let s = String(v)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
  if (!s || s.length > 200) return null;
  if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, "");
  if (/^\d+$/.test(s)) s = s.replace(/^0+(?=\d)/, "");
  return s;
}

export function coordOf(properties: Record<string, unknown>): [number, number] | null {
  const lat = Number(properties.latitude ?? properties.lat);
  const lon = Number(properties.longitude ?? properties.lon ?? properties.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return [lat, lon];
}

const COORD_KEYS = new Set(["latitude", "lat", "longitude", "lon", "lng"]);

export function combine(values: number[], agg: LayerAggregate): number {
  if (agg === "count") return values.length;
  if (values.length === 0) return 0;
  if (agg === "max") return Math.max(...values);
  const sum = values.reduce((a, b) => a + b, 0);
  return agg === "mean" ? sum / values.length : sum;
}

/** Rows that name the same instance, combined the way the layer declares. */
export function groupByKey(
  rows: { match?: string | null; value: number }[],
  agg: LayerAggregate,
): Map<string, number> {
  const byKey = new Map<string, number[]>();
  for (const r of rows) {
    const k = normalizeKey(r.match);
    if (k === null || !Number.isFinite(r.value)) continue;
    const list = byKey.get(k) ?? [];
    list.push(r.value);
    byKey.set(k, list);
  }
  return new Map(Array.from(byKey, ([k, vs]) => [k, combine(vs, agg)]));
}

/** The property key a layer is stored under. */
export function layerKey(label: string): string {
  const s = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return s ? `layer_${s}` : "layer_value";
}

export type LayerTarget = "site" | "catchment";

/** An instance a file's rows could land on, and where it sits. */
export interface Placeable {
  id: string;
  typeName: string;
  properties: Record<string, unknown>;
  target: LayerTarget;
}

/**
 * The instances a layer can sit on.
 *
 * A site is anything with coordinates. A catchment is an instance of a type
 * that declares a head count (`scales_incidence`) — the same rule the export
 * uses to find populations, so a value written on one lands on the cells the
 * map gives that catchment.
 */
export function placeables(rows: Pick<EnvInstanceRow, "id" | "typeName" | "properties" | "propertySchema">[]): Placeable[] {
  const out: Placeable[] = [];
  for (const r of rows) {
    if (coordOf(r.properties)) {
      out.push({ id: r.id, typeName: r.typeName, properties: r.properties, target: "site" });
    } else if ((r.propertySchema ?? []).some((p) => p.mechanic === "scales_incidence")) {
      out.push({ id: r.id, typeName: r.typeName, properties: r.properties, target: "catchment" });
    }
  }
  return out;
}

export interface MatchColumn {
  name: string;
  values: string[];
}

export interface MatchCandidate {
  column: string;
  target: LayerTarget;
  type: string;
  property: string;
  /** Distinct values of the column found on that property. */
  matched: number;
  /** Distinct values the column has. */
  distinct: number;
  /** Instances the matched values reach. */
  instances: number;
  /** Values found nowhere, as the file wrote them. */
  unmatched: string[];
  unmatchedTruncated: boolean;
  /** A few instances it reaches, by name, so a person can recognise them. */
  examples: string[];
}

const UNMATCHED_CAP = 2000;

/**
 * Which column names which instances, best first.
 *
 * Counted, never guessed from the column's name: a column called `code` that
 * matches nothing is worse than one called `numero` that matches everything.
 * Ties go to the property whose values are most nearly unique, because a key
 * that names one place per value is what a join needs.
 */
export function rankMatches(columns: MatchColumn[], places: Placeable[], limit = 8): MatchCandidate[] {
  // (type, property) -> normalised value -> instances
  const index = new Map<string, { type: string; property: string; target: LayerTarget; byValue: Map<string, Placeable[]> }>();
  for (const p of places) {
    for (const [k, v] of Object.entries(p.properties)) {
      if (COORD_KEYS.has(k.toLowerCase())) continue;
      if (typeof v !== "string" && typeof v !== "number") continue;
      const norm = normalizeKey(v);
      if (norm === null) continue;
      const id = `${p.typeName}\u0000${k}`;
      let entry = index.get(id);
      if (!entry) {
        entry = { type: p.typeName, property: k, target: p.target, byValue: new Map() };
        index.set(id, entry);
      }
      const list = entry.byValue.get(norm) ?? [];
      list.push(p);
      entry.byValue.set(norm, list);
    }
  }

  const out: (MatchCandidate & { uniqueness: number })[] = [];
  for (const col of columns) {
    const raw = new Map<string, string>();
    for (const v of col.values) {
      const n = normalizeKey(v);
      if (n !== null && !raw.has(n)) raw.set(n, v);
    }
    if (raw.size === 0) continue;
    for (const entry of index.values()) {
      let matched = 0;
      const reached = new Set<string>();
      const examples: string[] = [];
      const unmatched: string[] = [];
      for (const [n, original] of raw) {
        const hits = entry.byValue.get(n);
        if (hits) {
          matched++;
          for (const h of hits) {
            if (!reached.has(h.id) && examples.length < 3)
              examples.push(String(h.properties.name ?? h.properties.nom ?? h.properties.code ?? h.id.slice(0, 8)));
            reached.add(h.id);
          }
        } else if (unmatched.length < UNMATCHED_CAP) {
          unmatched.push(original);
        }
      }
      if (matched === 0) continue;
      out.push({
        column: col.name,
        target: entry.target,
        type: entry.type,
        property: entry.property,
        matched,
        distinct: raw.size,
        instances: reached.size,
        unmatched,
        unmatchedTruncated: raw.size - matched > unmatched.length,
        examples,
        uniqueness: entry.byValue.size / Math.max(1, Array.from(entry.byValue.values()).reduce((a, l) => a + l.length, 0)),
      });
    }
  }
  return out
    .sort((a, b) => b.matched - a.matched || b.uniqueness - a.uniqueness || a.column.localeCompare(b.column))
    .slice(0, limit)
    .map(({ uniqueness: _u, ...c }) => c);
}

/** A property definition for a layer, kept or replaced in a type's schema. */
export function withLayerProperty(
  schema: PropertyDef[],
  def: PropertyDef,
): { schema: PropertyDef[]; replaced: boolean } {
  const at = schema.findIndex((p) => p.key === def.key);
  if (at < 0) return { schema: [...schema, def], replaced: false };
  if (!schema[at]!.layer) {
    throw Conflict(
      "PROPERTY_EXISTS",
      `"${def.key}" is already a property of this type that was not added as a layer. Name the layer differently.`,
    );
  }
  const next = schema.slice();
  next[at] = def;
  return { schema: next, replaced: true };
}

// ---------------------------------------------------------------------------
// Database.
// ---------------------------------------------------------------------------

async function loadPlaceables(db: DbClient, environmentId: string): Promise<Placeable[]> {
  const rows = await listInstancesForEnv(db, environmentId, { limit: config.rollupInstanceCap });
  return placeables(rows);
}

export async function matchColumns(
  db: DbClient,
  environmentId: string,
  columns: MatchColumn[],
): Promise<{ candidates: MatchCandidate[]; placeable: number }> {
  const places = await loadPlaceables(db, environmentId);
  return { candidates: rankMatches(columns, places), placeable: places.length };
}

export interface LayerWrite {
  label: string;
  unit?: string;
  layer: LayerDecl;
  target: { mode: "match"; type: string; property: string } | { mode: "points"; typeName: string };
  rows: { match?: string | null; lat?: number | null; lon?: number | null; name?: string | null; value: number }[];
}

export interface LayerWriteResult {
  key: string;
  type: string;
  /** Instances that now carry a value. */
  written: number;
  /** Distinct keys in the file that named no instance. */
  unmatched: string[];
  /** Instances that carried a value from a previous load and no longer do. */
  cleared: number;
  replaced: boolean;
}

export async function writeLayer(db: DbClient, environmentId: string, w: LayerWrite): Promise<LayerWriteResult> {
  const key = layerKey(w.label);
  const def: PropertyDef = {
    key,
    type: "number",
    label: w.label,
    ...(w.unit ? { unit: w.unit } : {}),
    layer: w.layer,
  };

  if (w.target.mode === "points") {
    return writePoints(db, environmentId, w, def);
  }

  const { type, property } = w.target;
  await db.query("BEGIN");
  try {
    const t = await db.query<{ id: string; property_schema: PropertyDef[] | null }>(
      `SELECT id, property_schema FROM app.ontology_object_types
        WHERE organization_id = (SELECT organization_id FROM app.project WHERE id = $1) AND name = $2
        FOR UPDATE`,
      [environmentId, type],
    );
    const typeRow = t.rows[0];
    if (!typeRow) throw NotFound("TYPE_NOT_FOUND", `There is no type "${type}" for the values to land on.`);
    const { schema, replaced } = withLayerProperty(typeRow.property_schema ?? [], def);
    await db.query(`UPDATE app.ontology_object_types SET property_schema = $2::jsonb WHERE id = $1`, [
      typeRow.id,
      JSON.stringify(schema),
    ]);

    const instances = await db.query<{ id: string; v: string | null }>(
      `SELECT id, properties ->> $2 AS v FROM app.ontology_object_instances WHERE object_type_id = $1`,
      [typeRow.id, property],
    );
    const byKey = groupByKey(w.rows, w.layer.aggregate);
    const values: { id: string; value: number }[] = [];
    const used = new Set<string>();
    for (const inst of instances.rows) {
      const k = normalizeKey(inst.v);
      if (k === null || !byKey.has(k)) continue;
      values.push({ id: inst.id, value: byKey.get(k)! });
      used.add(k);
    }
    const unmatched = Array.from(byKey.keys()).filter((k) => !used.has(k));
    if (values.length === 0) {
      throw BadRequest(
        "NOTHING_MATCHED",
        `None of the file's values was found in "${property}" on ${type}, so the layer would be empty.`,
      );
    }
    await db.query(
      `UPDATE app.ontology_object_instances oi
          SET properties = oi.properties || jsonb_build_object($1::text, v.value), updated_at = NOW()
         FROM jsonb_to_recordset($2::jsonb) AS v(id uuid, value double precision)
        WHERE oi.id = v.id`,
      [key, JSON.stringify(values)],
    );
    // A reload replaces the layer. A site the new file no longer mentions
    // keeps no value from the old one: a stale 300 beds reads exactly like
    // a current one.
    const cleared = await db.query(
      `UPDATE app.ontology_object_instances
          SET properties = properties - $2::text, updated_at = NOW()
        WHERE object_type_id = $1 AND properties ? $2::text AND NOT (id = ANY($3::uuid[]))`,
      [typeRow.id, key, values.map((v) => v.id)],
    );
    await db.query("COMMIT");
    return { key, type, written: values.length, unmatched, cleared: cleared.rowCount ?? 0, replaced };
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

async function writePoints(
  db: DbClient,
  environmentId: string,
  w: LayerWrite,
  def: PropertyDef,
): Promise<LayerWriteResult> {
  const typeName = (w.target as { typeName: string }).typeName.trim();
  const located = w.rows.filter(
    (r) =>
      Number.isFinite(r.lat) && Number.isFinite(r.lon) && Math.abs(r.lat!) <= 90 && Math.abs(r.lon!) <= 180 && Number.isFinite(r.value),
  );
  if (located.length === 0) throw BadRequest("NO_COORDINATES", "No row has a usable latitude and longitude.");
  await db.query("BEGIN");
  try {
    const exists = await db.query(
      `SELECT 1 FROM app.ontology_object_types
        WHERE organization_id = (SELECT organization_id FROM app.project WHERE id = $1) AND name = $2`,
      [environmentId, typeName],
    );
    if (exists.rowCount) {
      // Points are new instances, so loading twice would place every one
      // twice. A new name is a new layer; the old one is removed in Ontology.
      throw Conflict("TYPE_EXISTS", `A type named "${typeName}" already exists. Give this layer another name.`);
    }
    const schema: PropertyDef[] = [
      { key: "name", type: "string" },
      { key: "latitude", type: "number" },
      { key: "longitude", type: "number" },
      def,
    ];
    const typeId = await getOrCreateObjectType(db, environmentId, typeName, `Added as a map layer from ${w.layer.source?.file ?? "a file"}.`, schema);
    await db.query(
      `INSERT INTO app.ontology_object_instances (object_type_id, properties)
       SELECT $1, jsonb_build_object('name', p.name, 'latitude', p.lat, 'longitude', p.lon, $2::text, p.value)
         FROM jsonb_to_recordset($3::jsonb) AS p(name text, lat double precision, lon double precision, value double precision)`,
      [
        typeId,
        def.key,
        JSON.stringify(
          located.map((r, i) => ({ name: r.name?.trim() || `${typeName} ${i + 1}`, lat: r.lat, lon: r.lon, value: r.value })),
        ),
      ],
    );
    await db.query("COMMIT");
    return { key: def.key, type: typeName, written: located.length, unmatched: [], cleared: 0, replaced: false };
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

export interface LayerRead {
  type: string;
  key: string;
  label: string;
  unit: string | null;
  layer: LayerDecl;
  /** [lat, lon, value] for each site that carries it. */
  points: [number, number, number][];
  /** [population id as the export names it, value] for each catchment. */
  catchments: [string, number][];
  /** Instances carrying a value that the map cannot place. */
  unplaced: number;
}

export async function readLayers(db: DbClient, environmentId: string): Promise<LayerRead[]> {
  const rows = await listInstancesForEnv(db, environmentId, { limit: config.rollupInstanceCap });
  const declared = new Map<string, Map<string, PropertyDef>>();
  for (const r of rows) {
    if (declared.has(r.typeName)) continue;
    const m = new Map<string, PropertyDef>();
    for (const p of r.propertySchema ?? []) if (p.layer) m.set(p.key, p);
    declared.set(r.typeName, m);
  }
  const out = new Map<string, LayerRead>();
  for (const r of rows) {
    const defs = declared.get(r.typeName);
    if (!defs || defs.size === 0) continue;
    const isCatchment = (r.propertySchema ?? []).some((p) => p.mechanic === "scales_incidence");
    const at = coordOf(r.properties);
    for (const [key, def] of defs) {
      const v = Number(r.properties[key]);
      if (r.properties[key] === undefined || r.properties[key] === null || !Number.isFinite(v)) continue;
      const id = `${r.typeName}\u0000${key}`;
      let layer = out.get(id);
      if (!layer) {
        layer = {
          type: r.typeName,
          key,
          label: def.label ?? key,
          unit: def.unit ?? null,
          layer: def.layer!,
          points: [],
          catchments: [],
          unplaced: 0,
        };
        out.set(id, layer);
      }
      if (at) layer.points.push([at[0], at[1], v]);
      else if (isCatchment) layer.catchments.push([`pop:${r.id}`, v]);
      else layer.unplaced++;
    }
  }
  return Array.from(out.values()).sort((a, b) => a.label.localeCompare(b.label));
}
