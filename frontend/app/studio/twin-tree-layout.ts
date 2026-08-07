/**
 * Where the twin's units sit.
 *
 * Positions used to be dragged by hand and stored per browser, which made the
 * shape of a network a private opinion: two people looking at the same twin saw
 * different trees, and a node dragged onto another hid it. The tree is a fact —
 * it comes from the `contains` links — so the layout is computed and the canvas
 * is read-only.
 *
 * Root on the left, one column per depth, children stacked down. A parent sits
 * at the midpoint of its children, which is what makes a branch readable at a
 * glance: the line from a parent to its children is the only thing your eye has
 * to follow.
 */

export const TREE_NODE_W = 168;
export const TREE_NODE_H = 54;
export const TREE_COL_GAP = 240;
export const TREE_ROW_GAP = 74;
export const TREE_ORIGIN = { x: 40, y: 32 };

export interface TreeEdge {
  fromId: string;
  toId: string;
}

export type TreePositions = Map<string, { x: number; y: number }>;

export function layoutTree(
  nodeIds: readonly string[],
  edges: readonly TreeEdge[],
  roots: readonly string[],
): TreePositions {
  const known = new Set(nodeIds);
  const children = new Map<string, string[]>();
  for (const id of nodeIds) children.set(id, []);
  for (const e of edges) {
    if (!known.has(e.fromId) || !known.has(e.toId)) continue;
    children.get(e.fromId)!.push(e.toId);
  }

  const pos: TreePositions = new Map();
  // A leaf takes the next free row; a parent centres on its children. `visited`
  // is the cycle guard: `contains` is a link like any other and nothing in the
  // ontology forbids a loop.
  const visited = new Set<string>();
  let nextRow = 0;

  function place(id: string, depth: number): number {
    if (visited.has(id)) return pos.get(id)?.y ?? TREE_ORIGIN.y;
    visited.add(id);

    const kids = (children.get(id) ?? []).filter((k) => !visited.has(k));
    const x = TREE_ORIGIN.x + depth * TREE_COL_GAP;

    let y: number;
    if (kids.length === 0) {
      y = TREE_ORIGIN.y + nextRow * TREE_ROW_GAP;
      nextRow++;
    } else {
      const ys = kids.map((k) => place(k, depth + 1));
      y = (Math.min(...ys) + Math.max(...ys)) / 2;
    }

    pos.set(id, { x, y });
    return y;
  }

  // Roots first, then anything the `contains` links never reached — an orphan
  // still has to be somewhere, and dropping it would hide real instances.
  const startingPoints = [...roots.filter((r) => known.has(r)), ...nodeIds];
  for (const id of startingPoints) place(id, 0);

  return pos;
}

/** Straight segment, right edge of the parent to left edge of the child. */
export function edgePath(
  from: { x: number; y: number },
  to: { x: number; y: number },
): string {
  const a = { x: from.x + TREE_NODE_W, y: from.y + TREE_NODE_H / 2 };
  const b = { x: to.x, y: to.y + TREE_NODE_H / 2 };
  return `M ${a.x},${a.y} L ${b.x},${b.y}`;
}

/** Canvas size that fits every node, with room to breathe. */
export function treeExtent(pos: TreePositions): { width: number; height: number } {
  let maxX = 0;
  let maxY = 0;
  for (const p of Array.from(pos.values())) {
    maxX = Math.max(maxX, p.x + TREE_NODE_W);
    maxY = Math.max(maxY, p.y + TREE_NODE_H);
  }
  return { width: maxX + TREE_ORIGIN.x, height: maxY + TREE_ORIGIN.y };
}
