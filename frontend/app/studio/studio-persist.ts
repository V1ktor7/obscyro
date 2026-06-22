/**
 * localStorage persistence for the Studio pipeline graph.
 */

import type { GraphEdge } from "./studio-graph-ops";

const STORAGE_KEY = "obs_studio_graph_v1";

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

export function loadStudioGraph(): PersistedGraph | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidGraph(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveStudioGraph(graph: {
  nodes: PersistedNode[];
  edges: GraphEdge[];
  pan: { x: number; y: number };
  zoom: number;
}): void {
  if (typeof window === "undefined") return;
  try {
    const payload: PersistedGraph = {
      version: 1,
      ...graph,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

export function clearStudioGraph(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
