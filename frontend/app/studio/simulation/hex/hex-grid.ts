/**
 * The hexes every layer and every stamp lands on.
 *
 * One shared grid is the point: a stretcher reading, a catchment's head count
 * and a measure drawn on the map all resolve to the same cells, so any two of
 * them can be shown together without a join nobody would know how to write.
 *
 * The grid is built from the twin itself, never shipped with the client: the
 * sites the export locates and, when the geo service has them, the catchment
 * polygons. Its cell size follows the extent, so a city gets city blocks and a
 * province gets districts, at roughly the same number of cells on screen.
 */

export interface GridSite {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface GridPopulation {
  id: string;
  name: string;
  size: number;
  servedBy: string[];
}

/** A catchment's outline, as lon/lat rings. */
export interface GridPolygon {
  populationId: string;
  /** Each polygon is an outer ring followed by holes; a multipolygon is several. */
  polygons: Array<Array<Array<[number, number]>>>;
}

export interface Hex {
  index: number;
  /** Kilometres from the grid's north-west corner. */
  x: number;
  y: number;
  lat: number;
  lon: number;
  population: string | null;
  /** The catchment's head count, spread evenly over its cells. */
  residents: number;
  nearestSite: string | null;
}

export interface HexGrid {
  hexes: Hex[];
  radiusKm: number;
  widthKm: number;
  heightKm: number;
  /** How the residents were placed, said rather than hidden. */
  placement: "polygons" | "nearest-site" | "none";
  project: (lat: number, lon: number) => { x: number; y: number };
}

const EMPTY: HexGrid = {
  hexes: [],
  radiusKm: 1,
  widthKm: 0,
  heightKm: 0,
  placement: "none",
  project: () => ({ x: 0, y: 0 }),
};

function insideRing(lon: number, lat: number, ring: Array<[number, number]>): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export function insidePolygons(
  lon: number,
  lat: number,
  polygons: GridPolygon["polygons"],
): boolean {
  for (const rings of polygons) {
    const [outer, ...holes] = rings;
    if (!outer || !insideRing(lon, lat, outer)) continue;
    if (holes.some((h) => insideRing(lon, lat, h))) continue;
    return true;
  }
  return false;
}

/** GeoJSON Polygon or MultiPolygon coordinates, as the geo service returns them. */
export function polygonsFromGeoJson(geometry: {
  type: string;
  coordinates?: unknown;
}): GridPolygon["polygons"] {
  if (geometry.type === "Polygon") return [geometry.coordinates as Array<Array<[number, number]>>];
  if (geometry.type === "MultiPolygon")
    return geometry.coordinates as Array<Array<Array<[number, number]>>>;
  return [];
}

export function buildHexGrid(
  sites: GridSite[],
  populations: GridPopulation[],
  opts: { targetCells?: number; polygons?: GridPolygon[] } = {},
): HexGrid {
  const target = opts.targetCells ?? 900;
  const polygons = (opts.polygons ?? []).filter((p) => p.polygons.length > 0);
  const lats: number[] = sites.map((s) => s.lat);
  const lons: number[] = sites.map((s) => s.lon);
  for (const p of polygons)
    for (const rings of p.polygons)
      for (const [lon, lat] of rings[0] ?? []) {
        lats.push(lat);
        lons.push(lon);
      }
  if (lats.length === 0) return EMPTY;

  const latMax = Math.max(...lats);
  const latMin = Math.min(...lats);
  const lonMin = Math.min(...lons);
  const lonMax = Math.max(...lons);
  const lat0 = (latMax + latMin) / 2;
  const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110.57;
  const project = (lat: number, lon: number) => ({ x: (lon - lonMin) * kx, y: (latMax - lat) * ky });
  const unproject = (x: number, y: number) => ({ lat: latMax - y / ky, lon: lonMin + x / kx });

  const widthKm = Math.max((lonMax - lonMin) * kx, 1);
  const heightKm = Math.max((latMax - latMin) * ky, 1);
  // Cell size from the area the grid has to cover. Masking removes most cells
  // of a sparse network, so the target is generous rather than tight.
  const radiusKm = Math.min(50, Math.max(0.3, Math.sqrt((widthKm * heightKm) / (2.598 * target))));
  const w = Math.sqrt(3) * radiusKm;
  const reach = Math.max(2.2 * radiusKm, 1.5);

  const projected = sites.map((s) => ({ s, ...project(s.lat, s.lon) }));
  const nearest = (x: number, y: number) => {
    let best: (typeof projected)[number] | null = null;
    let bd = Infinity;
    for (const p of projected) {
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best ? { site: best.s, km: Math.sqrt(bd) } : null;
  };

  // A facility is served for many catchments; the largest is the one its
  // neighbourhood most likely belongs to.
  const servingPop = new Map<string, GridPopulation>();
  for (const p of [...populations].sort((a, b) => b.size - a.size))
    for (const f of p.servedBy) if (!servingPop.has(f)) servingPop.set(f, p);

  const hexes: Hex[] = [];
  let row = 0;
  for (let y = 0; y <= heightKm + radiusKm; y += 1.5 * radiusKm, row++) {
    for (let x = row % 2 ? w / 2 : 0; x <= widthKm + w; x += w) {
      const { lat, lon } = unproject(x, y);
      const near = nearest(x, y);
      let population: string | null = null;
      if (polygons.length > 0) {
        const hit = polygons.find((p) => insidePolygons(lon, lat, p.polygons));
        if (!hit) continue;
        population = hit.populationId;
      } else {
        if (!near || near.km > reach) continue;
        population = servingPop.get(near.site.id)?.id ?? null;
      }
      hexes.push({
        index: hexes.length,
        x,
        y,
        lat,
        lon,
        population,
        residents: 0,
        nearestSite: near?.site.id ?? null,
      });
    }
  }

  const cells = new Map<string, number>();
  for (const h of hexes) if (h.population) cells.set(h.population, (cells.get(h.population) ?? 0) + 1);
  const size = new Map(populations.map((p) => [p.id, p.size]));
  for (const h of hexes)
    if (h.population) h.residents = (size.get(h.population) ?? 0) / (cells.get(h.population) ?? 1);

  return {
    hexes,
    radiusKm,
    widthKm,
    heightKm,
    placement: polygons.length > 0 ? "polygons" : sites.length > 0 ? "nearest-site" : "none",
    project,
  };
}

/** Indexes of the cells within `km` of a cell, itself included. */
export function cellsWithin(grid: HexGrid, centre: number, km: number): number[] {
  const c = grid.hexes[centre];
  if (!c) return [];
  return grid.hexes
    .filter((h) => (h.x - c.x) ** 2 + (h.y - c.y) ** 2 <= km * km)
    .map((h) => h.index);
}

/** The catchments a set of cells belongs to, each once. */
export function populationsOf(grid: HexGrid, cells: number[]): string[] {
  const out = new Set<string>();
  for (const i of cells) {
    const p = grid.hexes[i]?.population;
    if (p) out.add(p);
  }
  return Array.from(out);
}
