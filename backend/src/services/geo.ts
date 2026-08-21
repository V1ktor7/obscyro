import type { DbClient } from "../lib/db.js";
import { BadRequest, NotFound } from "../lib/errors.js";

/**
 * Geometry on ontology instances.
 *
 * A polygon already fits in a JSONB property — `object` is a legal property
 * type — but nothing can be asked of it. The questions a health network
 * actually has are queries, not values: which catchment areas overlap, which
 * site is nearest, who is covered by nobody. Postgres cannot intersect a
 * polygon stored as JSON, so this is a `geography` column with a GiST index.
 *
 * `geography` rather than `geometry` on purpose: distance between two hospitals
 * has to come back in metres. With `geometry` on lat/lon it comes back in
 * degrees, which is not a distance — a degree of longitude is 78 km in
 * Montréal and 111 km at the equator.
 *
 * Everything here degrades rather than throws when PostGIS is not installed.
 * The migration is conditional for the same reason: the API boots by running
 * migrations first, so a hard requirement on an extension the host may not
 * offer would take the whole product down to add a feature.
 */

/**
 * A GeoJSON geometry, loosely typed on purpose.
 *
 * `coordinates` is optional because a GeometryCollection carries `geometries`
 * instead, and PostGIS validates the shape far better than a hand-written
 * guard would — one that disagreed with it at the edges would be worse than
 * none.
 */
export type GeoJsonGeometry = {
  type: string;
  coordinates?: unknown;
};

export interface InstanceGeometry {
  instanceId: string;
  instanceName: string;
  objectType: string;
  kind: string;
  geometry: GeoJsonGeometry;
  /** Square metres. Zero for points and lines. */
  areaM2: number;
  /**
   * The instance's own declared properties, carried with the shape.
   *
   * A map that colours its polygons needs to know what colour, and the only
   * honest source is what the institution declared on the object — not a
   * palette compiled into the client. Shipping the properties here is what
   * lets a territory be recoloured or retagged by editing the ontology.
   */
  properties: Record<string, unknown>;
}

export interface GeometryOverlap {
  aId: string;
  aName: string;
  bId: string;
  bName: string;
  /** Square metres shared by the two shapes. */
  sharedM2: number;
  /** Share of the smaller of the two, 0–1. The asymmetry matters: a small
   *  clinic wholly inside a hospital's catchment is fully covered, while the
   *  hospital is barely affected. */
  sharedOfSmaller: number;
}

let cached: boolean | null = null;

/**
 * Is PostGIS installed?
 *
 * Cached because it only changes when a migration runs, and every spatial route
 * asks. Resettable so a test can exercise both paths.
 */
export async function spatialAvailable(db: DbClient): Promise<boolean> {
  if (cached !== null) return cached;
  try {
    const { rows } = await db.query<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_extension WHERE extname = 'postgis'
       ) AND EXISTS (
         SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'app' AND table_name = 'instance_geometry'
       ) AS ok`,
    );
    cached = rows[0]?.ok === true;
  } catch {
    cached = false;
  }
  return cached;
}

/** For tests, and for the moment after a migration installs the extension. */
export function resetSpatialCache(): void {
  cached = null;
}

function assertAvailable(available: boolean): void {
  if (!available) {
    throw BadRequest(
      "SPATIAL_UNAVAILABLE",
      "PostGIS is not installed on this database, so shapes cannot be stored or queried. " +
        "Everything else keeps working.",
    );
  }
}

/**
 * Attach a shape to an instance, replacing whatever it had.
 *
 * The GeoJSON is validated by PostGIS itself rather than here: a hand-written
 * ring check would be a worse version of what the extension already does, and
 * would disagree with it at the edges.
 */
export async function setInstanceGeometry(
  db: DbClient,
  environmentId: string,
  instanceId: string,
  kind: string,
  geometry: GeoJsonGeometry,
): Promise<InstanceGeometry> {
  assertAvailable(await spatialAvailable(db));

  const { rows: owned } = await db.query<{ id: string }>(
    `SELECT oi.id
       FROM app.ontology_object_instances oi
       JOIN app.ontology_object_types t ON t.id = oi.object_type_id
      WHERE oi.id = $2
        AND t.organization_id = (SELECT organization_id FROM app.project WHERE id = $1)`,
    [environmentId, instanceId],
  );
  if (owned.length === 0) {
    throw NotFound("INSTANCE_NOT_FOUND", "No such instance in this organization.");
  }

  try {
    await db.query(
      // GeoJSON is WGS84 by definition, so ST_GeomFromGeoJSON already yields
      // SRID 4326 and the cast to geography is direct. A round trip through
      // WKT would only cost precision.
      `INSERT INTO app.instance_geometry (instance_id, kind, geom)
       VALUES ($1, $2, ST_GeomFromGeoJSON($3::text)::geography)
       ON CONFLICT (instance_id) DO UPDATE
          SET kind = EXCLUDED.kind, geom = EXCLUDED.geom, updated_at = NOW()`,
      [instanceId, kind, JSON.stringify(geometry)],
    );
  } catch (err) {
    throw BadRequest(
      "GEOMETRY_INVALID",
      `PostGIS rejected that shape: ${(err as Error).message}`,
    );
  }

  const one = await listGeometries(db, environmentId, instanceId);
  return one[0]!;
}

export async function deleteInstanceGeometry(
  db: DbClient,
  instanceId: string,
): Promise<boolean> {
  if (!(await spatialAvailable(db))) return false;
  const { rowCount } = await db.query(
    `DELETE FROM app.instance_geometry WHERE instance_id = $1`,
    [instanceId],
  );
  return (rowCount ?? 0) > 0;
}

/** Every shape in the organization, or one instance's. */
export async function listGeometries(
  db: DbClient,
  environmentId: string,
  instanceId?: string,
): Promise<InstanceGeometry[]> {
  if (!(await spatialAvailable(db))) return [];
  const { rows } = await db.query<{
    instance_id: string;
    instance_name: string | null;
    object_type: string;
    kind: string;
    geojson: string;
    area_m2: string;
    properties: Record<string, unknown> | null;
  }>(
    `SELECT g.instance_id,
            COALESCE(oi.properties ->> 'name', oi.properties ->> 'label') AS instance_name,
            t.name AS object_type,
            g.kind,
            ST_AsGeoJSON(g.geom) AS geojson,
            ST_Area(g.geom)::text AS area_m2,
            oi.properties
       FROM app.instance_geometry g
       JOIN app.ontology_object_instances oi ON oi.id = g.instance_id
       JOIN app.ontology_object_types t ON t.id = oi.object_type_id
      WHERE t.organization_id = (SELECT organization_id FROM app.project WHERE id = $1)
        AND ($2::uuid IS NULL OR g.instance_id = $2::uuid)
      ORDER BY t.name, instance_name`,
    [environmentId, instanceId ?? null],
  );
  return rows.map((r) => ({
    instanceId: r.instance_id,
    instanceName: r.instance_name ?? "unnamed",
    objectType: r.object_type,
    kind: r.kind,
    geometry: JSON.parse(r.geojson) as GeoJsonGeometry,
    areaM2: Number(r.area_m2),
    properties: r.properties ?? {},
  }));
}

/**
 * Which shapes overlap which.
 *
 * The pairing is `a.instance_id < b.instance_id` so each pair is reported once:
 * "A overlaps B" and "B overlaps A" are the same finding, and listing both
 * doubles a coverage report for no reason.
 */
export async function overlaps(
  db: DbClient,
  environmentId: string,
  kind?: string,
): Promise<GeometryOverlap[]> {
  if (!(await spatialAvailable(db))) return [];
  const { rows } = await db.query<{
    a_id: string;
    a_name: string | null;
    b_id: string;
    b_name: string | null;
    shared_m2: string;
    shared_of_smaller: string;
  }>(
    `WITH mine AS (
       SELECT g.instance_id,
              COALESCE(oi.properties ->> 'name', oi.properties ->> 'label') AS name,
              g.geom,
              ST_Area(g.geom) AS area
         FROM app.instance_geometry g
         JOIN app.ontology_object_instances oi ON oi.id = g.instance_id
         JOIN app.ontology_object_types t ON t.id = oi.object_type_id
        WHERE t.organization_id = (SELECT organization_id FROM app.project WHERE id = $1)
          AND ($2::text IS NULL OR g.kind = $2::text)
     )
     SELECT a.instance_id AS a_id, a.name AS a_name,
            b.instance_id AS b_id, b.name AS b_name,
            ST_Area(ST_Intersection(a.geom::geometry, b.geom::geometry)::geography)::text AS shared_m2,
            CASE WHEN LEAST(a.area, b.area) > 0
                 THEN (ST_Area(ST_Intersection(a.geom::geometry, b.geom::geometry)::geography)
                       / LEAST(a.area, b.area))::text
                 ELSE '0' END AS shared_of_smaller
       FROM mine a
       JOIN mine b
         ON a.instance_id < b.instance_id
        AND ST_Intersects(a.geom, b.geom)
      ORDER BY shared_m2 DESC
      LIMIT 500`,
    [environmentId, kind ?? null],
  );
  return rows
    .map((r) => ({
      aId: r.a_id,
      aName: r.a_name ?? "unnamed",
      bId: r.b_id,
      bName: r.b_name ?? "unnamed",
      sharedM2: Number(r.shared_m2),
      sharedOfSmaller: Number(r.shared_of_smaller),
    }))
    // A shared edge is a touch, not an overlap. PostGIS reports it as an
    // intersection of zero area, and a report full of those hides the real ones.
    .filter((o) => o.sharedM2 > 0);
}

export interface NearestSite {
  instanceId: string;
  name: string;
  objectType: string;
  metres: number;
}

/**
 * The shapes nearest a point, in metres.
 *
 * `<->` on a geography uses the GiST index, so this stays a nearest-neighbour
 * lookup rather than a full scan as the network grows.
 */
export async function nearest(
  db: DbClient,
  environmentId: string,
  longitude: number,
  latitude: number,
  limit = 5,
): Promise<NearestSite[]> {
  if (!(await spatialAvailable(db))) return [];
  const { rows } = await db.query<{
    instance_id: string;
    name: string | null;
    object_type: string;
    metres: string;
  }>(
    `SELECT g.instance_id,
            COALESCE(oi.properties ->> 'name', oi.properties ->> 'label') AS name,
            t.name AS object_type,
            ST_Distance(g.geom, ST_MakePoint($2, $3)::geography)::text AS metres
       FROM app.instance_geometry g
       JOIN app.ontology_object_instances oi ON oi.id = g.instance_id
       JOIN app.ontology_object_types t ON t.id = oi.object_type_id
      WHERE t.organization_id = (SELECT organization_id FROM app.project WHERE id = $1)
      ORDER BY g.geom <-> ST_MakePoint($2, $3)::geography
      LIMIT $4`,
    [environmentId, longitude, latitude, Math.min(Math.max(1, limit), 50)],
  );
  return rows.map((r) => ({
    instanceId: r.instance_id,
    name: r.name ?? "unnamed",
    objectType: r.object_type,
    metres: Number(r.metres),
  }));
}

/**
 * Points inside no shape at all.
 *
 * The coverage question, asked of the sites the twin already knows: a site
 * whose coordinates fall in nobody's catchment is either unserved or unmodelled,
 * and both are worth seeing. It reads coordinates from instance properties, the
 * same place the network map does.
 */
export async function uncovered(
  db: DbClient,
  environmentId: string,
  kind?: string,
): Promise<{ instanceId: string; name: string; objectType: string }[]> {
  if (!(await spatialAvailable(db))) return [];
  const { rows } = await db.query<{
    id: string;
    name: string | null;
    object_type: string;
  }>(
    `WITH sites AS (
       SELECT oi.id,
              COALESCE(oi.properties ->> 'name', oi.properties ->> 'label') AS name,
              t.name AS object_type,
              ST_MakePoint(
                (oi.properties ->> 'longitude')::float8,
                (oi.properties ->> 'latitude')::float8
              )::geography AS pt
         FROM app.ontology_object_instances oi
         JOIN app.ontology_object_types t ON t.id = oi.object_type_id
        WHERE t.organization_id = (SELECT organization_id FROM app.project WHERE id = $1)
          AND oi.properties ->> 'latitude' ~ '^-?[0-9]+(\\.[0-9]+)?$'
          AND oi.properties ->> 'longitude' ~ '^-?[0-9]+(\\.[0-9]+)?$'
     ),
     shapes AS (
       SELECT g.geom
         FROM app.instance_geometry g
         JOIN app.ontology_object_instances oi ON oi.id = g.instance_id
         JOIN app.ontology_object_types t ON t.id = oi.object_type_id
        WHERE t.organization_id = (SELECT organization_id FROM app.project WHERE id = $1)
          AND ($2::text IS NULL OR g.kind = $2::text)
     )
     SELECT s.id, s.name, s.object_type
       FROM sites s
      WHERE NOT EXISTS (
        SELECT 1 FROM shapes sh WHERE ST_Covers(sh.geom, s.pt)
      )
      ORDER BY s.object_type, s.name
      LIMIT 500`,
    [environmentId, kind ?? null],
  );
  return rows.map((r) => ({
    instanceId: r.id,
    name: r.name ?? "unnamed",
    objectType: r.object_type,
  }));
}
