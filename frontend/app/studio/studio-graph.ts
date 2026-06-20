/**
 * Shared graph geometry for the Studio canvas. Used by both the pipeline
 * editor (StudioEditor) and the ontology SCHEMA view (StudioOntologyMode) so
 * the two render with the same curves, sizing, and accents.
 */

export const NODE_W = 216;
export const NODE_H = 96;

export const ACCENT_HEX = "#4f46e5"; // indigo — active edges / travelling token
export const EDGE_HEX = "#cbd5e1"; // slate-300 — idle edges

export type Point = { x: number; y: number };

export type Geom = {
  a: Point;
  b: Point;
  c1: Point;
  c2: Point;
};

/** Y coordinate for the center of an output port on a multi-branch router node. */
export function outputPortY(
  nodeY: number,
  portIndex: number,
  portCount: number,
  nodeHeight: number = NODE_H,
): number {
  const slot = nodeHeight / (portCount + 1);
  return nodeY + slot * (portIndex + 1);
}

/** Taller card height when a node exposes multiple output ports. */
export function routerNodeHeight(portCount: number): number {
  return Math.max(NODE_H, 28 * portCount + 36);
}

/** Edge geometry between two node boxes (left input → right output ports). */
export function geom(
  s: Point,
  t: Point,
  opts?: {
    sourceY?: number;
    targetY?: number;
    sourceHeight?: number;
    targetHeight?: number;
  },
): Geom {
  const sh = opts?.sourceHeight ?? NODE_H;
  const th = opts?.targetHeight ?? NODE_H;
  const a = { x: s.x + NODE_W, y: opts?.sourceY ?? s.y + sh / 2 };
  const b = { x: t.x, y: opts?.targetY ?? t.y + th / 2 };
  const dx = Math.max(50, (b.x - a.x) / 2);
  return { a, b, c1: { x: a.x + dx, y: a.y }, c2: { x: b.x - dx, y: b.y } };
}

/** Edge geometry between two explicit points. */
export function pointGeom(a: Point, b: Point): Geom {
  const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
  return { a, b, c1: { x: a.x + dx, y: a.y }, c2: { x: b.x - dx, y: b.y } };
}

export function pathD(g: Geom): string {
  return `M ${g.a.x},${g.a.y} C ${g.c1.x},${g.c1.y} ${g.c2.x},${g.c2.y} ${g.b.x},${g.b.y}`;
}

export function bezierPoint(g: Geom, t: number): Point {
  const u = 1 - t;
  const x =
    u * u * u * g.a.x +
    3 * u * u * t * g.c1.x +
    3 * u * t * t * g.c2.x +
    t * t * t * g.b.x;
  const y =
    u * u * u * g.a.y +
    3 * u * u * t * g.c1.y +
    3 * u * t * t * g.c2.y +
    t * t * t * g.b.y;
  return { x, y };
}
