/**
 * Frontend-only layout persistence for Ontology Manager schema canvas.
 */

export type SchemaLayout = Record<string, { x: number; y: number }>;

// v2: the default layout follows the link types instead of the alphabet, so
// saved v1 positions describe a picture nobody wants back.
const PREFIX = "obs_ontology_schema_layout_v2:";

function storageKey(envSlug: string): string {
  return `${PREFIX}${envSlug}`;
}

export function loadSchemaLayout(envSlug: string): SchemaLayout {
  if (typeof window === "undefined" || !envSlug) return {};
  try {
    const raw = localStorage.getItem(storageKey(envSlug));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: SchemaLayout = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        v &&
        typeof v === "object" &&
        typeof (v as { x?: unknown }).x === "number" &&
        typeof (v as { y?: unknown }).y === "number"
      ) {
        out[k] = { x: (v as { x: number }).x, y: (v as { y: number }).y };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function saveSchemaLayout(envSlug: string, layout: SchemaLayout): void {
  if (typeof window === "undefined" || !envSlug) return;
  try {
    localStorage.setItem(storageKey(envSlug), JSON.stringify(layout));
  } catch {
    /* quota / private mode */
  }
}

export function clearSchemaLayout(envSlug: string): void {
  if (typeof window === "undefined" || !envSlug) return;
  try {
    localStorage.removeItem(storageKey(envSlug));
  } catch {
    /* ignore */
  }
}

/** Header plus footer plus borders — the height edge anchors aim at the middle of. */
export const SCHEMA_BOX_H = 54;
export const COL_GAP = 260;
export const ROW_GAP = 104;
export const SCHEMA_ORIGIN = { x: 48, y: 48 };

/** Types per column before a level spills into a second one. */
const MAX_ROWS = 6;

export type SchemaEdge = { fromType: string; toType: string };

/**
 * Default positions that follow the link types.
 *
 * The previous default was two columns in whatever order the types arrived,
 * which put linked types on opposite sides of the canvas and sent every edge
 * across the whole picture. Here a type sits one column to the right of
 * everything that points at it, so links read left to right and the columns
 * mean something: column 0 is what nothing references.
 *
 * Cycles are legal in a schema — Patient links to Bed, Bed links back — so the
 * relaxation is capped at one pass per type rather than run to a fixed point.
 * A cycle's members settle at some level and stop moving; the result is
 * deterministic and the work is bounded.
 */
export function layeredLayout(typeNames: string[], edges: SchemaEdge[]): SchemaLayout {
  const known = new Set(typeNames);
  const incoming = new Map<string, string[]>();
  for (const name of typeNames) incoming.set(name, []);
  for (const e of edges) {
    if (e.fromType === e.toType) continue;
    if (!known.has(e.fromType) || !known.has(e.toType)) continue;
    incoming.get(e.toType)!.push(e.fromType);
  }

  const level = new Map<string, number>(typeNames.map((n) => [n, 0]));
  for (let pass = 0; pass < typeNames.length; pass++) {
    let changed = false;
    for (const name of typeNames) {
      let want = 0;
      for (const from of incoming.get(name)!) {
        want = Math.max(want, (level.get(from) ?? 0) + 1);
      }
      if (want > (level.get(name) ?? 0)) {
        level.set(name, want);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const byLevel = new Map<number, string[]>();
  for (const name of typeNames) {
    const lv = level.get(name) ?? 0;
    const bucket = byLevel.get(lv);
    if (bucket) bucket.push(name);
    else byLevel.set(lv, [name]);
  }

  const out: SchemaLayout = {};
  let col = 0;
  for (const lv of Array.from(byLevel.keys()).sort((a, b) => a - b)) {
    const members = byLevel.get(lv)!;
    members.forEach((name, i) => {
      out[name] = {
        x: SCHEMA_ORIGIN.x + (col + Math.floor(i / MAX_ROWS)) * COL_GAP,
        y: SCHEMA_ORIGIN.y + (i % MAX_ROWS) * ROW_GAP,
      };
    });
    col += Math.max(1, Math.ceil(members.length / MAX_ROWS));
  }
  return out;
}

/** Saved positions win; anything unplaced falls back to the layered default. */
export function mergeLayoutPositions(
  typeNames: string[],
  edges: SchemaEdge[],
  saved: SchemaLayout,
): Map<string, { x: number; y: number }> {
  const fallback = layeredLayout(typeNames, edges);
  const m = new Map<string, { x: number; y: number }>();
  for (const name of typeNames) {
    m.set(name, saved[name] ?? fallback[name] ?? SCHEMA_ORIGIN);
  }
  return m;
}
