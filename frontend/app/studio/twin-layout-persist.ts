/**
 * Frontend-only layout persistence for Live Twin canvas.
 */

import type { TwinTreeEdge } from "@/lib/platform-api";

export type TwinLayout = Record<string, { x: number; y: number }>;

const PREFIX = "obs_twin_layout_v1:";

export const TWIN_NODE_W = 168;
export const TWIN_NODE_H = 72;
export const TWIN_COL_GAP = 220;
export const TWIN_ROW_GAP = 120;
export const TWIN_ORIGIN = { x: 64, y: 64 };

function storageKey(envSlug: string): string {
  return `${PREFIX}${envSlug}`;
}

export function loadTwinLayout(envSlug: string): TwinLayout {
  if (typeof window === "undefined" || !envSlug) return {};
  try {
    const raw = localStorage.getItem(storageKey(envSlug));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: TwinLayout = {};
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

export function saveTwinLayout(envSlug: string, layout: TwinLayout): void {
  if (typeof window === "undefined" || !envSlug) return;
  try {
    localStorage.setItem(storageKey(envSlug), JSON.stringify(layout));
  } catch {
    /* quota / private mode */
  }
}

/** Depth-based hierarchy layout from contains edges. */
export function defaultTreeLayout(
  nodeIds: string[],
  edges: TwinTreeEdge[],
  roots: string[],
): TwinLayout {
  const children = new Map<string, string[]>();
  for (const id of nodeIds) children.set(id, []);
  for (const e of edges) {
    const list = children.get(e.fromId);
    if (list) list.push(e.toId);
  }

  const depthOf = new Map<string, number>();
  const queue = [...roots];
  for (const r of roots) depthOf.set(r, 0);
  while (queue.length) {
    const id = queue.shift()!;
    const d = depthOf.get(id) ?? 0;
    for (const child of children.get(id) ?? []) {
      if (!depthOf.has(child)) {
        depthOf.set(child, d + 1);
        queue.push(child);
      }
    }
  }

  const byDepth = new Map<number, string[]>();
  for (const id of nodeIds) {
    const d = depthOf.get(id) ?? 0;
    const list = byDepth.get(d) ?? [];
    list.push(id);
    byDepth.set(d, list);
  }

  const layout: TwinLayout = {};
  Array.from(byDepth.entries()).forEach(([depth, ids]) => {
    ids.forEach((id, i) => {
      layout[id] = {
        x: TWIN_ORIGIN.x + i * TWIN_COL_GAP,
        y: TWIN_ORIGIN.y + depth * TWIN_ROW_GAP,
      };
    });
  });
  return layout;
}

export function mergeTwinPositions(
  nodeIds: string[],
  edges: TwinTreeEdge[],
  roots: string[],
  saved: TwinLayout,
): Map<string, { x: number; y: number }> {
  const defaults = defaultTreeLayout(nodeIds, edges, roots);
  const m = new Map<string, { x: number; y: number }>();
  for (const id of nodeIds) {
    m.set(id, saved[id] ?? defaults[id] ?? TWIN_ORIGIN);
  }
  return m;
}
