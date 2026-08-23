/**
 * A run, turned into something you can scrub through.
 *
 * The engine hands back one row per step, facility and activity. What a player
 * needs is the opposite shape: one frame per step, holding every facility at
 * once. Building it once up front rather than filtering 71 000 rows on every
 * slider move is the difference between a scrubber and a stutter.
 *
 * Occupancy is read per activity and reduced to the worst one, because that is
 * what a coloured dot on a map has to mean. A facility whose twenty acute beds
 * are full and whose three hundred long-stay places are empty is not 6% full;
 * it is turning people away.
 */

export interface FacilityFrame {
  id: string;
  name: string;
  /** Worst occupancy across everything this facility provides, 0 to 1. */
  worst: number;
  /** Which activity that was. */
  activity: string;
  /** Units of demand waiting here, all activities. */
  waiting: number;
}

export interface Frame {
  step: number;
  facilities: FacilityFrame[];
  /** Sum of everyone waiting anywhere this step. */
  waiting: number;
  /** How many facilities were at or above this share of capacity. */
  full: number;
}

export interface FacilitiesTable {
  columns: string[];
  rows: Array<Array<string | number | boolean | null>>;
}

/** At or above this, a facility is drawn as turning people away. */
export const FULL = 0.999;

/**
 * Frames for one response, in step order.
 *
 * A step with no rows still produces a frame. Skipping it would make the
 * slider jump over a day, and the reader would be scrubbing a timeline whose
 * length does not match the run.
 */
export function framesFor(table: FacilitiesTable, policy: string, horizon: number): Frame[] {
  const ci = (n: string) => table.columns.indexOf(n);
  const P = ci("policy");
  const S = ci("step");
  const I = ci("facility_id");
  const N = ci("facility");
  const A = ci("activity");
  const O = ci("occupancy");
  const W = ci("waiting");
  if ([P, S, I, N, A, O].some((x) => x < 0)) return [];

  const byStep = new Map<number, Map<string, FacilityFrame>>();
  for (const row of table.rows) {
    if (row[P] !== policy) continue;
    const step = Number(row[S]);
    const id = String(row[I]);
    let at = byStep.get(step);
    if (!at) byStep.set(step, (at = new Map()));
    const occ = Number(row[O] ?? 0);
    const wait = W >= 0 ? Number(row[W] ?? 0) : 0;
    const seen = at.get(id);
    if (!seen) {
      at.set(id, {
        id,
        name: String(row[N] ?? id),
        worst: occ,
        activity: String(row[A] ?? ""),
        waiting: wait,
      });
      continue;
    }
    // The queue is per activity in the table and per facility on screen: a dot
    // says how many people are waiting there, not how many are waiting for one
    // of the things it provides.
    seen.waiting += wait;
    if (occ > seen.worst) {
      seen.worst = occ;
      seen.activity = String(row[A] ?? "");
    }
  }

  const out: Frame[] = [];
  for (let step = 0; step < horizon; step++) {
    const at = byStep.get(step);
    const facilities = at ? Array.from(at.values()) : [];
    out.push({
      step,
      facilities,
      waiting: facilities.reduce((n, f) => n + f.waiting, 0),
      full: facilities.filter((f) => f.worst >= FULL).length,
    });
  }
  return out;
}

/**
 * Colour for one facility, as a share of capacity.
 *
 * Four bands rather than a gradient. A gradient reads as precision the number
 * does not have, and the only question a reader has while scrubbing is which
 * of these four a site is in.
 */
export function bandOf(worst: number): "calme" | "charge" | "tendu" | "plein" {
  if (worst >= FULL) return "plein";
  if (worst >= 0.9) return "tendu";
  if (worst >= 0.6) return "charge";
  return "calme";
}

export const BAND_COLOUR: Record<ReturnType<typeof bandOf>, string> = {
  calme: "#1d9e75",
  charge: "#d9822b",
  tendu: "#c23030",
  plein: "#7a1414",
};

/**
 * Where a facility sits on screen.
 *
 * Equirectangular, scaled to the extent of the points themselves. Montréal is
 * 45°N and 40 km across; anything fancier would move a dot by less than its own
 * radius, and a projection nobody can check is a place for a bug to hide.
 */
export function project(
  points: Array<{ id: string; location: [number, number] | null }>,
  width: number,
  height: number,
  pad = 18,
): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  const placed = points.filter((p) => p.location);
  if (placed.length === 0) return out;
  const lats = placed.map((p) => p.location![0]);
  const lons = placed.map((p) => p.location![1]);
  const [y0, y1] = [Math.min(...lats), Math.max(...lats)];
  const [x0, x1] = [Math.min(...lons), Math.max(...lons)];
  // Latitude compresses longitude; without it the island looks stretched east.
  const k = Math.cos(((y0 + y1) / 2) * (Math.PI / 180));
  const w = Math.max(1e-9, (x1 - x0) * k);
  const h = Math.max(1e-9, y1 - y0);
  const scale = Math.min((width - 2 * pad) / w, (height - 2 * pad) / h);
  const ox = (width - w * scale) / 2;
  const oy = (height - h * scale) / 2;
  for (const p of placed) {
    const [lat, lon] = p.location!;
    out.set(p.id, [ox + (lon - x0) * k * scale, oy + (y1 - lat) * scale]);
  }
  return out;
}
