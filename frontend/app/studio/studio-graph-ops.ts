/**
 * Pure graph topology helpers for the Studio pipeline editor.
 * Exported for unit tests and used by StudioEditor.
 */

import { DEFAULT_INPUT_MAX_CONNECTIONS, INPUT_PORT_ID, NODE_H, NODE_W } from "./studio-graph";

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  sourcePort?: string;
  targetPort?: string;
};

export type GraphNode = { id: string; x: number; y: number };

export type ConnectRejectReason =
  | "self-loop"
  | "cycle"
  | "duplicate"
  | "max-input";

export type Workflow = {
  id: string;
  nodeIds: string[];
  edgeIds: string[];
};

export type WorkflowBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

/** Topological order for a directed subgraph. Cyclic leftovers appended at end. */
export function topoOrder(nodeIds: string[], edges: GraphEdge[]): string[] {
  const idset = new Set(nodeIds);
  const indeg = new Map<string, number>(nodeIds.map((i) => [i, 0]));
  const adj = new Map<string, string[]>(nodeIds.map((i) => [i, []]));
  for (const e of edges) {
    if (!idset.has(e.source) || !idset.has(e.target)) continue;
    adj.get(e.source)!.push(e.target);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }
  const queue = nodeIds.filter((i) => (indeg.get(i) ?? 0) === 0);
  const order: string[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    order.push(n);
    for (const m of adj.get(n) ?? []) {
      indeg.set(m, (indeg.get(m) ?? 0) - 1);
      if ((indeg.get(m) ?? 0) === 0) queue.push(m);
    }
  }
  for (const i of nodeIds) if (!order.includes(i)) order.push(i);
  return order;
}

/** Would adding source -> target create a cycle? */
export function wouldCycle(
  edges: GraphEdge[],
  source: string,
  target: string,
): boolean {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }
  const stack = [target];
  const seen = new Set<string>();
  while (stack.length) {
    const n = stack.pop()!;
    if (n === source) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const m of adj.get(n) ?? []) stack.push(m);
  }
  return false;
}

function countInputConnections(
  edges: GraphEdge[],
  target: string,
  targetPort: string,
): number {
  return edges.filter(
    (e) =>
      e.target === target &&
      (e.targetPort ?? INPUT_PORT_ID) === targetPort,
  ).length;
}

/** Validate a proposed connection. Returns null when allowed. */
export function validateConnection(
  edges: GraphEdge[],
  source: string,
  target: string,
  sourcePort?: string,
  targetPort: string = INPUT_PORT_ID,
  maxInputConnections: number = DEFAULT_INPUT_MAX_CONNECTIONS,
): ConnectRejectReason | null {
  if (source === target) return "self-loop";
  if (
    edges.some(
      (e) =>
        e.source === source &&
        e.target === target &&
        (e.sourcePort ?? undefined) === (sourcePort ?? undefined) &&
        (e.targetPort ?? INPUT_PORT_ID) === targetPort,
    )
  ) {
    return "duplicate";
  }
  if (wouldCycle(edges, source, target)) return "cycle";
  if (
    countInputConnections(edges, target, targetPort) >= maxInputConnections
  ) {
    return "max-input";
  }
  return null;
}

/** Remove nodes and any edges touching them. */
export function removeNodes<T extends GraphNode>(
  nodeIds: string[],
  nodes: T[],
  edges: GraphEdge[],
): { nodes: T[]; edges: GraphEdge[] } {
  const drop = new Set(nodeIds);
  return {
    nodes: nodes.filter((n) => !drop.has(n.id)),
    edges: edges.filter((e) => !drop.has(e.source) && !drop.has(e.target)),
  };
}

export function removeEdge(
  edgeId: string,
  edges: GraphEdge[],
): GraphEdge[] {
  return edges.filter((e) => e.id !== edgeId);
}

/** Stable id from sorted member node ids. */
export function workflowIdFromNodeIds(nodeIds: string[]): string {
  const sorted = [...nodeIds].sort();
  let hash = 0;
  const key = sorted.join(",");
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return `wf-${Math.abs(hash).toString(36)}`;
}

/**
 * Detect independent workflows via undirected connected components.
 * Isolated nodes are singleton workflows.
 */
export function detectWorkflows(
  nodes: GraphNode[],
  edges: GraphEdge[],
): Workflow[] {
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n.id, new Set());
  for (const e of edges) {
    adj.get(e.source)?.add(e.target);
    adj.get(e.target)?.add(e.source);
  }

  const visited = new Set<string>();
  const workflows: Workflow[] = [];

  for (const n of nodes) {
    if (visited.has(n.id)) continue;
    const component: string[] = [];
    const stack = [n.id];
    visited.add(n.id);
    while (stack.length) {
      const cur = stack.pop()!;
      component.push(cur);
      for (const nb of Array.from(adj.get(cur) ?? [])) {
        if (!visited.has(nb)) {
          visited.add(nb);
          stack.push(nb);
        }
      }
    }
    const nodeSet = new Set(component);
    const edgeIds = edges
      .filter((e) => nodeSet.has(e.source) && nodeSet.has(e.target))
      .map((e) => e.id);
    component.sort();
    workflows.push({
      id: workflowIdFromNodeIds(component),
      nodeIds: component,
      edgeIds,
    });
  }

  workflows.sort((a, b) => a.nodeIds[0].localeCompare(b.nodeIds[0]));
  return workflows;
}

/** Bounding box for workflow chip placement (default node size). */
export function workflowBounds(
  nodeIds: string[],
  nodes: GraphNode[],
  nodeHeight: (id: string) => number = () => NODE_H,
): WorkflowBounds | null {
  const set = new Set(nodeIds);
  const members = nodes.filter((n) => set.has(n.id));
  if (!members.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of members) {
    const h = nodeHeight(n.id);
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + NODE_W);
    maxY = Math.max(maxY, n.y + h);
  }
  return { minX, minY, maxX, maxY };
}

/** True when two axis-aligned boxes intersect. */
export function rectsIntersect(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}
