/**
 * Screen ↔ canvas coordinate transforms and zoom helpers for Studio.
 */

import {
  NODE_H,
  NODE_W,
  ZOOM_MAX,
  ZOOM_MIN,
  type Point,
} from "./studio-graph";

export type CanvasTransform = {
  pan: Point;
  zoom: number;
};

export const PORT_HIT_RADIUS_PX = 12;

export function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

/** Convert screen (viewport-relative) coords to canvas/world coords. */
export function screenToCanvas(
  screenX: number,
  screenY: number,
  t: CanvasTransform,
): Point {
  return {
    x: (screenX - t.pan.x) / t.zoom,
    y: (screenY - t.pan.y) / t.zoom,
  };
}

/** Convert canvas/world coords to screen coords. */
export function canvasToScreen(
  canvasX: number,
  canvasY: number,
  t: CanvasTransform,
): Point {
  return {
    x: canvasX * t.zoom + t.pan.x,
    y: canvasY * t.zoom + t.pan.y,
  };
}

/** Zoom toward a screen-space focal point; returns new pan + zoom. */
export function zoomAtPoint(
  t: CanvasTransform,
  screenX: number,
  screenY: number,
  factor: number,
): CanvasTransform {
  const newZoom = clampZoom(t.zoom * factor);
  const canvas = screenToCanvas(screenX, screenY, t);
  return {
    zoom: newZoom,
    pan: {
      x: screenX - canvas.x * newZoom,
      y: screenY - canvas.y * newZoom,
    },
  };
}

export type NodeBox = {
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
};

/** Fit all nodes into a viewport with padding. */
export function fitToContent(
  nodes: NodeBox[],
  viewportW: number,
  viewportH: number,
  padding = 48,
): CanvasTransform {
  if (!nodes.length) return { pan: { x: 0, y: 0 }, zoom: 1 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const w = n.width ?? NODE_W;
    const h = n.height ?? NODE_H;
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + w);
    maxY = Math.max(maxY, n.y + h);
  }

  const contentW = maxX - minX + padding * 2;
  const contentH = maxY - minY + padding * 2;
  const zoom = clampZoom(
    Math.min(viewportW / contentW, viewportH / contentH, 1),
  );
  const panX = (viewportW - (maxX - minX) * zoom) / 2 - minX * zoom;
  const panY = (viewportH - (maxY - minY) * zoom) / 2 - minY * zoom;

  return { pan: { x: panX, y: panY }, zoom };
}

/** Input port center in canvas coords (left edge, vertical center). */
export function inputPortCenter(
  nodeX: number,
  nodeY: number,
  nodeHeight: number = NODE_H,
): Point {
  return { x: nodeX, y: nodeY + nodeHeight / 2 };
}

/**
 * Hit-test an input port using screen-space radius (zoom-independent).
 * portScreen is the port center in screen coordinates.
 */
export function hitTestInputPort(
  screenX: number,
  screenY: number,
  portScreenX: number,
  portScreenY: number,
  radiusPx: number = PORT_HIT_RADIUS_PX,
): boolean {
  const dx = screenX - portScreenX;
  const dy = screenY - portScreenY;
  return dx * dx + dy * dy <= radiusPx * radiusPx;
}

/** Pointer position relative to canvas container element. */
export function pointerInContainer(
  clientX: number,
  clientY: number,
  rect: DOMRect,
): Point {
  return { x: clientX - rect.left, y: clientY - rect.top };
}
