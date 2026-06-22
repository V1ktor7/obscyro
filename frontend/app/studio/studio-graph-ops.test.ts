import { describe, expect, it } from "vitest";

import {
  canvasToScreen,
  hitTestInputPort,
  inputPortCenter,
  screenToCanvas,
  zoomAtPoint,
} from "./studio-canvas";
import {
  detectWorkflows,
  removeNodes,
  validateConnection,
  wouldCycle,
} from "./studio-graph-ops";

describe("validateConnection", () => {
  it("rejects self-loop", () => {
    expect(validateConnection([], "a", "a")).toBe("self-loop");
  });

  it("rejects cycle A→B then B→A", () => {
    const edges = [{ id: "e1", source: "a", target: "b" }];
    expect(wouldCycle(edges, "b", "a")).toBe(true);
    expect(validateConnection(edges, "b", "a")).toBe("cycle");
  });

  it("rejects duplicate edge", () => {
    const edges = [{ id: "e1", source: "a", target: "b" }];
    expect(validateConnection(edges, "a", "b")).toBe("duplicate");
  });

  it("rejects when input port is saturated", () => {
    const edges = [{ id: "e1", source: "a", target: "b" }];
    expect(validateConnection(edges, "c", "b")).toBe("max-input");
  });
});

describe("removeNodes", () => {
  it("removes all edges connected to deleted nodes", () => {
    const nodes = [
      { id: "n1", x: 0, y: 0 },
      { id: "n2", x: 100, y: 0 },
      { id: "n3", x: 200, y: 0 },
    ];
    const edges = [
      { id: "e1", source: "n1", target: "n2" },
      { id: "e2", source: "n2", target: "n3" },
    ];
    const result = removeNodes(["n2"], nodes, edges);
    expect(result.nodes.map((n) => n.id)).toEqual(["n1", "n3"]);
    expect(result.edges).toEqual([]);
  });
});

describe("detectWorkflows", () => {
  it("finds two graphs plus one detached node", () => {
    const nodes = [
      { id: "a1", x: 0, y: 0 },
      { id: "a2", x: 100, y: 0 },
      { id: "b1", x: 0, y: 200 },
      { id: "b2", x: 100, y: 200 },
      { id: "solo", x: 400, y: 0 },
    ];
    const edges = [
      { id: "e1", source: "a1", target: "a2" },
      { id: "e2", source: "b1", target: "b2" },
    ];
    const workflows = detectWorkflows(nodes, edges);
    expect(workflows).toHaveLength(3);
    const sizes = workflows.map((w) => w.nodeIds.length).sort();
    expect(sizes).toEqual([1, 2, 2]);
    const solo = workflows.find((w) => w.nodeIds.includes("solo"));
    expect(solo?.nodeIds).toEqual(["solo"]);
    expect(solo?.edgeIds).toEqual([]);
  });
});

describe("port hit-test at min and max zoom", () => {
  const nodeX = 100;
  const nodeY = 200;

  it("hits inside 12px screen radius at 0.25× zoom", () => {
    const t = { pan: { x: 50, y: 30 }, zoom: 0.25 };
    const port = inputPortCenter(nodeX, nodeY);
    const screen = canvasToScreen(port.x, port.y, t);
    expect(
      hitTestInputPort(screen.x, screen.y, screen.x, screen.y),
    ).toBe(true);
    expect(
      hitTestInputPort(screen.x + 10, screen.y, screen.x, screen.y),
    ).toBe(true);
    expect(
      hitTestInputPort(screen.x + 20, screen.y, screen.x, screen.y),
    ).toBe(false);
  });

  it("hits inside 12px screen radius at 2× zoom", () => {
    const t = { pan: { x: 10, y: 20 }, zoom: 2 };
    const port = inputPortCenter(nodeX, nodeY);
    const screen = canvasToScreen(port.x, port.y, t);
    const canvasNear = screenToCanvas(screen.x + 8, screen.y, t);
    const portCanvas = inputPortCenter(nodeX, nodeY);
    expect(
      hitTestInputPort(
        canvasToScreen(canvasNear.x, canvasNear.y, t).x,
        canvasToScreen(canvasNear.x, canvasNear.y, t).y,
        screen.x,
        screen.y,
      ),
    ).toBe(true);
    expect(
      hitTestInputPort(screen.x + 11, screen.y, screen.x, screen.y),
    ).toBe(true);
    expect(
      hitTestInputPort(screen.x + 15, screen.y, screen.x, screen.y),
    ).toBe(false);
    expect(portCanvas.x).toBe(nodeX);
  });
});

describe("zoomAtPoint", () => {
  it("keeps canvas point under cursor fixed", () => {
    const before = { pan: { x: 100, y: 50 }, zoom: 1 };
    const screenX = 300;
    const screenY = 200;
    const canvasBefore = screenToCanvas(screenX, screenY, before);
    const after = zoomAtPoint(before, screenX, screenY, 1.5);
    const canvasAfter = screenToCanvas(screenX, screenY, after);
    expect(canvasAfter.x).toBeCloseTo(canvasBefore.x, 5);
    expect(canvasAfter.y).toBeCloseTo(canvasBefore.y, 5);
  });
});
