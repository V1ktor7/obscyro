/**
 * A layer's values, on the hexes.
 *
 * Sites land on the cell they sit in; a catchment's value lands on every cell
 * of that catchment. When several meet on one cell they combine the way the
 * layer declares — the same rule the server used for rows naming one site, so
 * a cell and a site never disagree about what "adds up" means.
 */

import type { HexGrid } from "./hex-grid";
import type { LayerAggregate } from "./layers-api";

export interface LayerInput {
  points: [number, number, number][];
  catchments: [string, number][];
  aggregate: LayerAggregate;
}

export function combine(values: number[], agg: LayerAggregate): number {
  if (values.length === 0) return 0;
  if (agg === "max") return Math.max(...values);
  const sum = values.reduce((a, b) => a + b, 0);
  // Count was taken per site already; on a cell, counts add.
  return agg === "mean" ? sum / values.length : sum;
}

/** The cell a point falls in, or -1 off the grid. */
export function cellOf(grid: HexGrid, lat: number, lon: number): number {
  const p = grid.project(lat, lon);
  let best = -1;
  let bd = Infinity;
  for (const h of grid.hexes) {
    const d = (h.x - p.x) ** 2 + (h.y - p.y) ** 2;
    if (d < bd) {
      bd = d;
      best = h.index;
    }
  }
  // A cell's centre is at most one radius from any point inside it; a little
  // slack for the corners. Farther than that, the point is somewhere the map
  // left out, and is counted rather than pinned to the nearest edge.
  return best >= 0 && bd <= (grid.radiusKm * 1.15) ** 2 ? best : -1;
}

export function cellValues(grid: HexGrid, layer: LayerInput): { values: (number | null)[]; outside: number } {
  const buckets = grid.hexes.map(() => [] as number[]);
  let outside = 0;
  for (const [lat, lon, v] of layer.points) {
    const c = cellOf(grid, lat, lon);
    if (c < 0) outside++;
    else buckets[c]!.push(v);
  }
  if (layer.catchments.length) {
    const cells = new Map<string, number[]>();
    for (const h of grid.hexes) if (h.population) cells.set(h.population, [...(cells.get(h.population) ?? []), h.index]);
    const spread = layer.aggregate === "sum" || layer.aggregate === "count";
    for (const [pop, v] of layer.catchments) {
      const list = cells.get(pop);
      if (!list?.length) {
        outside++;
        continue;
      }
      for (const i of list) buckets[i]!.push(spread ? v / list.length : v);
    }
  }
  return { values: buckets.map((b) => (b.length ? combine(b, layer.aggregate) : null)), outside };
}

export const LAYER_COLOURS = ["#d8efec", "#9fd8d0", "#4fb3a6", "#1e8e83", "#0f6b6b"];
export const LAYER_EMPTY = "#f6f7f9";

export function fmtNumber(v: number): string {
  const a = Math.abs(v);
  const digits = a >= 100 ? 0 : a >= 10 ? 1 : 2;
  return v.toLocaleString("en-CA", { maximumFractionDigits: digits });
}

/**
 * Five bins with about as many cells in each.
 *
 * Quantiles rather than equal widths because added data is lopsided: one
 * 400-bed home beside forty 60-bed ones would leave four of five colours
 * unused under equal widths.
 */
export function quantileRamp(values: (number | null)[], unit: string | null = null) {
  const xs = values.filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  const u = unit ? ` ${unit}` : "";
  if (xs.length === 0) return { colourOf: () => LAYER_EMPTY, legend: [] as { colour: string; label: string }[] };
  const edges = Array.from(new Set([0.2, 0.4, 0.6, 0.8].map((q) => xs[Math.min(xs.length - 1, Math.floor(q * xs.length))]!)))
    .filter((e) => e > xs[0]!)
    .sort((a, b) => a - b);
  const colours = edges.length + 1 >= LAYER_COLOURS.length ? LAYER_COLOURS : LAYER_COLOURS.slice(LAYER_COLOURS.length - edges.length - 1);
  const colourOf = (v: number | null) => {
    if (v === null || !Number.isFinite(v)) return LAYER_EMPTY;
    let i = 0;
    while (i < edges.length && v >= edges[i]!) i++;
    return colours[i]!;
  };
  const legend = colours.map((colour, i) => {
    const lo = i === 0 ? null : edges[i - 1]!;
    const hi = i < edges.length ? edges[i]! : null;
    const label =
      lo === null && hi !== null
        ? `under ${fmtNumber(hi)}${u}`
        : hi === null && lo !== null
          ? `${fmtNumber(lo)}${u} and over`
          : lo !== null && hi !== null
            ? `${fmtNumber(lo)}–${fmtNumber(hi)}${u}`
            : `${fmtNumber(xs[0]!)}${u}`;
    return { colour, label };
  });
  return { colourOf, legend };
}

// ---------------------------------------------------------------------------
// Live readings: the twin's own measures, one number per site.
// ---------------------------------------------------------------------------

export type ReadingUnit = "percent" | "ratio" | "count" | "number";

export interface Reading {
  key: string;
  label: string;
  unit: ReadingUnit;
  /** Site (twin unit) id → its latest value. Sites with no value are absent. */
  values: Record<string, number>;
}

/** Every active measure that at least one site actually reports. */
export function readingsOf(
  metrics: { key: string; label: string; unit: ReadingUnit; active: boolean }[],
  nodes: { id: string; metrics: { values: Record<string, number | null> } }[],
): Reading[] {
  const out: Reading[] = [];
  for (const m of metrics) {
    if (!m.active) continue;
    const values: Record<string, number> = {};
    for (const n of nodes) {
      const v = n.metrics.values[m.key];
      if (typeof v === "number" && Number.isFinite(v)) values[n.id] = v;
    }
    if (Object.keys(values).length) out.push({ key: m.key, label: m.label, unit: m.unit, values });
  }
  return out;
}

/** A percentage of something full — read on the occupancy colours, not quantiles. */
export function looksLikeOccupancy(r: Pick<Reading, "key" | "label" | "unit">): boolean {
  return r.unit === "percent" && /occup|taux d.?occ/i.test(`${r.key} ${r.label}`);
}

/**
 * Each cell takes the value of the nearest site that reports one: the reading
 * of the site that serves the area, the way the occupancy lens reads.
 */
export function nearestValues(grid: HexGrid, sites: { lat: number; lon: number; value: number }[]): (number | null)[] {
  if (sites.length === 0) return grid.hexes.map(() => null);
  const at = sites.map((s) => ({ ...grid.project(s.lat, s.lon), value: s.value }));
  return grid.hexes.map((h) => {
    let best: number | null = null;
    let bd = Infinity;
    for (const s of at) {
      const d = (s.x - h.x) ** 2 + (s.y - h.y) ** 2;
      if (d < bd) {
        bd = d;
        best = s.value;
      }
    }
    return best;
  });
}
