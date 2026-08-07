import { describe, expect, it } from "vitest";

import {
  TREE_COL_GAP,
  TREE_NODE_H,
  TREE_NODE_W,
  TREE_ORIGIN,
  TREE_ROW_GAP,
  edgePath,
  layoutTree,
} from "./twin-tree-layout";

// ---------------------------------------------------------------------------
// The tree used to be dragged by hand and stored per browser, so its shape was
// a private opinion — two people on the same twin saw different trees, and a
// node dragged over another hid it. The hierarchy comes from the `contains`
// links, so it is computed, and these pin what "readable" means:
// depth decides the column, a parent sits between its children, and nothing
// disappears.
// ---------------------------------------------------------------------------

//        chum
//       /    \
//    hsl      hnd
//   /   \       \
//  icu  ward    er
const NODES = ["chum", "hsl", "hnd", "icu", "ward", "er"];
const EDGES = [
  { fromId: "chum", toId: "hsl" },
  { fromId: "chum", toId: "hnd" },
  { fromId: "hsl", toId: "icu" },
  { fromId: "hsl", toId: "ward" },
  { fromId: "hnd", toId: "er" },
];

describe("layoutTree", () => {
  const pos = layoutTree(NODES, EDGES, ["chum"]);

  it("places every node", () => {
    expect(pos.size).toBe(NODES.length);
  });

  it("depth decides the column — root on the left", () => {
    expect(pos.get("chum")!.x).toBe(TREE_ORIGIN.x);
    expect(pos.get("hsl")!.x).toBe(TREE_ORIGIN.x + TREE_COL_GAP);
    expect(pos.get("hnd")!.x).toBe(TREE_ORIGIN.x + TREE_COL_GAP);
    expect(pos.get("icu")!.x).toBe(TREE_ORIGIN.x + 2 * TREE_COL_GAP);
    expect(pos.get("er")!.x).toBe(TREE_ORIGIN.x + 2 * TREE_COL_GAP);
  });

  it("leaves take their own row, so none can cover another", () => {
    const leafYs = ["icu", "ward", "er"].map((id) => pos.get(id)!.y);
    expect(new Set(leafYs).size).toBe(3);
    for (let i = 1; i < leafYs.length; i++) {
      expect(Math.abs(leafYs[i]! - leafYs[i - 1]!)).toBeGreaterThanOrEqual(TREE_ROW_GAP);
    }
  });

  it("a parent sits between its children", () => {
    const hsl = pos.get("hsl")!.y;
    const icu = pos.get("icu")!.y;
    const ward = pos.get("ward")!.y;
    expect(hsl).toBe((Math.min(icu, ward) + Math.max(icu, ward)) / 2);

    // And the root sits between its own children, which is what makes a branch
    // readable without following corners.
    const chum = pos.get("chum")!.y;
    expect(chum).toBe((Math.min(hsl, pos.get("hnd")!.y) + Math.max(hsl, pos.get("hnd")!.y)) / 2);
  });

  it("a unit no `contains` link reached still gets a place", () => {
    // An orphan is real data. Dropping it would hide instances that exist.
    const withOrphan = layoutTree([...NODES, "lone"], EDGES, ["chum"]);
    expect(withOrphan.has("lone")).toBe(true);
  });

  it("a cycle terminates instead of recursing forever", () => {
    // `contains` is an ordinary link and nothing in the ontology forbids a loop.
    const cyclic = layoutTree(
      ["a", "b", "c"],
      [
        { fromId: "a", toId: "b" },
        { fromId: "b", toId: "c" },
        { fromId: "c", toId: "a" },
      ],
      ["a"],
    );
    expect(cyclic.size).toBe(3);
  });

  it("an edge naming a node that is not there is ignored", () => {
    const partial = layoutTree(["a"], [{ fromId: "a", toId: "ghost" }], ["a"]);
    expect(partial.size).toBe(1);
  });
});

describe("edgePath", () => {
  it("is a straight segment, parent's right edge to child's left edge", () => {
    // No elbows, no curves: corners give the eye something to follow that
    // carries no information.
    const d = edgePath({ x: 0, y: 0 }, { x: 240, y: 74 });
    expect(d).toBe(`M ${TREE_NODE_W},${TREE_NODE_H / 2} L 240,${74 + TREE_NODE_H / 2}`);
    expect(d).not.toMatch(/[QCA]/);
  });
});
