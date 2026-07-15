/**
 * Shared graph geometry for the Studio canvas. Used by both the pipeline
 * editor (StudioEditor) and the ontology SCHEMA view (StudioOntologyMode) so
 * the two render with the same curves, sizing, and accents.
 */

export const NODE_W = 216;
export const NODE_H = 96;

export const INPUT_PORT_ID = "in";
export const DEFAULT_INPUT_MAX_CONNECTIONS = 1;
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 2;

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

/** Waypoints for orthogonal (right-angle) edge routing between two ports. */
function orthoPoints(g: Geom): Point[] {
  const { a, b } = g;
  if (Math.abs(b.y - a.y) < 2) return [a, b];
  if (b.x - a.x >= 48) {
    const midX = (a.x + b.x) / 2;
    return [a, { x: midX, y: a.y }, { x: midX, y: b.y }, b];
  }
  // Backward edge: exit right, drop to a midline, re-enter from the left.
  const outX = a.x + 24;
  const inX = b.x - 24;
  const midY = (a.y + b.y) / 2;
  return [
    a,
    { x: outX, y: a.y },
    { x: outX, y: midY },
    { x: inX, y: midY },
    { x: inX, y: b.y },
    b,
  ];
}

const CORNER_R = 6;

/** Orthogonal path with small rounded corners (Foundry-style elbows). */
export function pathD(g: Geom): string {
  const pts = orthoPoints(g);
  if (pts.length === 2) return `M ${pts[0].x},${pts[0].y} L ${pts[1].x},${pts[1].y}`;
  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const next = pts[i + 1];
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(CORNER_R, inLen / 2, outLen / 2);
    const inUx = (cur.x - prev.x) / (inLen || 1);
    const inUy = (cur.y - prev.y) / (inLen || 1);
    const outUx = (next.x - cur.x) / (outLen || 1);
    const outUy = (next.y - cur.y) / (outLen || 1);
    d += ` L ${cur.x - inUx * r},${cur.y - inUy * r}`;
    d += ` Q ${cur.x},${cur.y} ${cur.x + outUx * r},${cur.y + outUy * r}`;
  }
  d += ` L ${pts[pts.length - 1].x},${pts[pts.length - 1].y}`;
  return d;
}

/** Point at fraction t along the orthogonal route (name kept for callers). */
export function bezierPoint(g: Geom, t: number): Point {
  const pts = orthoPoints(g);
  let total = 0;
  const lens: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    lens.push(l);
    total += l;
  }
  let remain = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < lens.length; i++) {
    if (remain <= lens[i] || i === lens.length - 1) {
      const f = lens[i] === 0 ? 0 : remain / lens[i];
      return {
        x: pts[i].x + (pts[i + 1].x - pts[i].x) * f,
        y: pts[i].y + (pts[i + 1].y - pts[i].y) * f,
      };
    }
    remain -= lens[i];
  }
  return pts[pts.length - 1];
}
