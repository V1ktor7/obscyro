/**
 * Frontend-only layout persistence for Ontology Manager schema canvas.
 */

export type SchemaLayout = Record<string, { x: number; y: number }>;

const PREFIX = "obs_ontology_schema_layout_v1:";

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

export const SCHEMA_COLS = 2;
export const SCHEMA_BOX_H = 84;
export const COL_GAP = 320;
export const ROW_GAP = 150;
export const SCHEMA_ORIGIN = { x: 48, y: 48 };

/** Default grid position for a type at index i. */
export function gridPosition(index: number): { x: number; y: number } {
  const col = index % SCHEMA_COLS;
  const row = Math.floor(index / SCHEMA_COLS);
  return {
    x: SCHEMA_ORIGIN.x + col * COL_GAP,
    y: SCHEMA_ORIGIN.y + row * ROW_GAP,
  };
}

/** Merge saved layout with grid fallback for each type name. */
export function mergeLayoutPositions(
  typeNames: string[],
  saved: SchemaLayout,
): Map<string, { x: number; y: number }> {
  const m = new Map<string, { x: number; y: number }>();
  typeNames.forEach((name, i) => {
    m.set(name, saved[name] ?? gridPosition(i));
  });
  return m;
}
