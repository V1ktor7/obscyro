/**
 * Turning clicks into a polygon, and metres into something readable.
 *
 * Kept apart from the map component because none of it needs a map: a ring is
 * arithmetic on an array, and "3 048 000 m²" is a formatting decision. Both are
 * worth testing, and neither is testable through Mapbox.
 *
 * Deliberately hand-rolled rather than pulling in mapbox-gl-draw. The map
 * already switches basemaps at runtime, and `setStyle` drops every source and
 * layer on the map — a drawing library then has to be torn down and rebuilt on
 * `style.load`, which is exactly the seam this view already manages for its
 * flow arcs. One mechanism is better than two.
 */

export interface GeoJsonPolygon {
  type: "Polygon";
  coordinates: [number, number][][];
}

/** Two positions close enough to be the same click, in degrees (~1 m). */
const SAME_POINT_DEG = 1e-5;

function samePoint(a: [number, number], b: [number, number]): boolean {
  return Math.abs(a[0] - b[0]) < SAME_POINT_DEG && Math.abs(a[1] - b[1]) < SAME_POINT_DEG;
}

/**
 * The vertices, minus any the user placed twice.
 *
 * Double-clicking to finish a shape lands two clicks in the same spot, and a
 * repeated vertex makes a zero-length segment that PostGIS is entitled to
 * reject. Dropping it here is cheaper than explaining the error.
 */
export function dedupePoints(points: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && samePoint(last, p)) continue;
    out.push(p);
  }
  // A ring the user closed by clicking the first vertex again.
  while (out.length > 1 && samePoint(out[0]!, out[out.length - 1]!)) out.pop();
  return out;
}

/**
 * A closed GeoJSON polygon, or null if there isn't one yet.
 *
 * GeoJSON requires the ring to return to its first position; the drawing UI
 * never asks anyone to click the same spot twice, so the closing point is
 * added here.
 */
export function polygonFrom(points: [number, number][]): GeoJsonPolygon | null {
  const ring = dedupePoints(points);
  if (ring.length < 3) return null;
  return { type: "Polygon", coordinates: [[...ring, ring[0]!]] };
}

/** How many more clicks before the shape can be saved. */
export function pointsStillNeeded(points: [number, number][]): number {
  return Math.max(0, 3 - dedupePoints(points).length);
}

/**
 * Area, in the unit a person would use for it.
 *
 * A hospital catchment is square kilometres, a building footprint is square
 * metres, and a campus is hectares. Rendering all three in m² is technically
 * right and useless — 3048000 m² is not a number anyone reads.
 */
export function formatArea(m2: number): string {
  if (!Number.isFinite(m2) || m2 <= 0) return "—";
  if (m2 < 10_000) return `${Math.round(m2).toLocaleString()} m²`;
  if (m2 < 1_000_000) return `${(m2 / 10_000).toFixed(1)} ha`;
  return `${(m2 / 1_000_000).toFixed(m2 < 10_000_000 ? 2 : 1)} km²`;
}

/** Distance, likewise. Metres under a kilometre, kilometres above. */
export function formatMetres(m: number): string {
  if (!Number.isFinite(m) || m < 0) return "—";
  if (m < 1_000) return `${Math.round(m)} m`;
  return `${(m / 1_000).toFixed(m < 10_000 ? 2 : 1)} km`;
}

/**
 * The bounding box of a drawn ring, for flying the camera to a saved shape.
 *
 * Returns null for an empty ring rather than a degenerate box at [0, 0] — the
 * Gulf of Guinea is a long way from anywhere this product is used, and a camera
 * that flies there is a bug that looks like a feature.
 */
export function ringBounds(
  points: [number, number][],
): { west: number; south: number; east: number; north: number } | null {
  if (points.length === 0) return null;
  let west = points[0]![0];
  let east = points[0]![0];
  let south = points[0]![1];
  let north = points[0]![1];
  for (const [lng, lat] of points) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return { west, south, east, north };
}

/**
 * Every position in a GeoJSON geometry, whatever its nesting.
 *
 * Points, lines, polygons and their Multi- forms differ only in how deep the
 * coordinates array goes, so this walks it rather than switching on `type`.
 */
export function flattenCoordinates(coords: unknown): [number, number][] {
  if (!Array.isArray(coords)) return [];
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    return [[coords[0], coords[1]]];
  }
  return coords.flatMap((c) => flattenCoordinates(c));
}
