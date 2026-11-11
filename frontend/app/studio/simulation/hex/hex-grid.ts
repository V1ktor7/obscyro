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
 *
 * The cells are H3's: one hexagonal tiling of the whole planet, the same at
 * every scale. A grid drawn on its own flat projection ended where the twin
 * ended, and could only be shown as a picture of a region; on H3 the twin's
 * cells are a patch of a tiling that covers the globe, so the map can be the
 * globe, and two layers built separately still land on the same cells.
 */
import { cellToLatLng, getHexagonEdgeLengthAvg, polygonToCells } from "h3-js";


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
  /** The H3 cell this hex is. */
  h3: string;
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
  /** The H3 resolution of every cell in the grid. */
  res: number;
  /** H3's average edge length at that resolution, which is also its circumradius. */
  radiusKm: number;
  widthKm: number;
  heightKm: number;
  /** How the residents were placed, said rather than hidden. */
  placement: "polygons" | "nearest-site" | "none";
  project: (lat: number, lon: number) => { x: number; y: number };
}

const EMPTY: HexGrid = {
  hexes: [],
  res: 0,
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

/**
 * The H3 resolution whose cells are closest in size to the radius wanted.
 *
 * Compared on a log scale: each resolution is about 2.6 times finer than the
 * last, so "closest" means closest in ratio, not in kilometres.
 */
export function resolutionFor(radiusKm: number): number {
  let best = 0;
  let bd = Infinity;
  for (let r = 0; r <= 12; r++) {
    const d = Math.abs(Math.log(getHexagonEdgeLengthAvg(r, "km") / radiusKm));
    if (d < bd) {
      bd = d;
      best = r;
    }
  }
  return best;
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
  // The radius the extent asks for, rounded to the nearest H3 resolution. The
  // cells are then exactly H3's, so `radiusKm` is H3's edge for that level.
  const wanted = Math.min(50, Math.max(0.3, Math.sqrt((widthKm * heightKm) / (2.598 * target))));
  const res = resolutionFor(wanted);
  const radiusKm = getHexagonEdgeLengthAvg(res, "km");
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

  // Every cell whose centre falls in the extent, padded by one reach so a site
  // on the edge still has its neighbourhood. Sorted so the indexes are stable
  // from one render to the next.
  const pad = reach + radiusKm;
  const nw = unproject(-pad, -pad);
  const se = unproject(widthKm + pad, heightKm + pad);
  const candidates = polygonToCells(
    [
      [
        [nw.lat, nw.lon],
        [nw.lat, se.lon],
        [se.lat, se.lon],
        [se.lat, nw.lon],
        [nw.lat, nw.lon],
      ],
    ],
    res,
  ).sort();

  const hexes: Hex[] = [];
  for (const id of candidates) {
    const [lat, lon] = cellToLatLng(id);
    const { x, y } = project(lat, lon);
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
      h3: id,
      x,
      y,
      lat,
      lon,
      population,
      residents: 0,
      nearestSite: near?.site.id ?? null,
    });
  }

  const cells = new Map<string, number>();
  for (const h of hexes) if (h.population) cells.set(h.population, (cells.get(h.population) ?? 0) + 1);
  const size = new Map(populations.map((p) => [p.id, p.size]));
  for (const h of hexes)
    if (h.population) h.residents = (size.get(h.population) ?? 0) / (cells.get(h.population) ?? 1);

  return {
    hexes,
    res,
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
