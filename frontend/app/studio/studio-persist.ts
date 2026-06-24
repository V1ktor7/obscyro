/**
 * localStorage persistence for the Studio pipeline graph.
 */

import type { GraphEdge } from "./studio-graph-ops";

export type StudioVariant = "parser" | "workspace";

const STORAGE_KEYS: Record<StudioVariant, string> = {
  parser: "obs_studio_parser_v1",
  workspace: "obs_studio_workspace_v1",
};

function storageKey(variant: StudioVariant): string {
  return STORAGE_KEYS[variant];
}

export type PersistedNode = {
  id: string;
  type: string;
  title: string;
  x: number;
  y: number;
  config: Record<string, unknown>;
  code: string;
};

export type PersistedGraph = {
  version: 1;
  nodes: PersistedNode[];
  edges: GraphEdge[];
  pan: { x: number; y: number };
  zoom: number;
  savedAt: string;
};

function isValidGraph(data: unknown): data is PersistedGraph {
  if (!data || typeof data !== "object") return false;
  const g = data as PersistedGraph;
  return (
    g.version === 1 &&
    Array.isArray(g.nodes) &&
    Array.isArray(g.edges) &&
    typeof g.pan?.x === "number" &&
    typeof g.pan?.y === "number" &&
    typeof g.zoom === "number"
  );
}

export function loadStudioGraph(variant: StudioVariant): PersistedGraph | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey(variant));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidGraph(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveStudioGraph(
  variant: StudioVariant,
  graph: {
    nodes: PersistedNode[];
    edges: GraphEdge[];
    pan: { x: number; y: number };
    zoom: number;
  },
): void {
  if (typeof window === "undefined") return;
  try {
    const payload: PersistedGraph = {
      version: 1,
      ...graph,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(storageKey(variant), JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

export function clearStudioGraph(variant: StudioVariant): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(storageKey(variant));
  } catch {
    /* ignore */
  }
}
