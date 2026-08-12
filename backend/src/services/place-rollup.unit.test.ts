import assert from "node:assert/strict";
import { test } from "node:test";

import { topmostPlacements } from "./twin.js";

// ---------------------------------------------------------------------------
// The arithmetic that decides whether a building reports 48 beds or 96.
//
// Notre-Dame the building holds five org units: the hospital, its emergency,
// a ward, a lab, a pharmacy. Four of them are inside the hospital, whose
// subtree already contains their beds. Counting each placement separately
// doubles everything below the top — which is precisely the shape of the
// roll-up removed in 84601a5, and it shipped for months without an error.
// ---------------------------------------------------------------------------

const ND = "notre-dame-building";
const CS = "cite-sante-building";

test("a unit under a placed ancestor is not counted again", () => {
  const placed = new Map([
    ["hopital", ND],
    ["urgence", ND],
    ["ward3a", ND],
  ]);
  const parent = new Map([
    ["urgence", "hopital"],
    ["ward3a", "hopital"],
  ]);
  assert.deepEqual(topmostPlacements(placed, parent), new Map([[ND, ["hopital"]]]));
});

test("siblings with no placed ancestor are all counted", () => {
  // Three labs of one organisation in one building: three units, one dot, and
  // all three sets of numbers.
  const placed = new Map([
    ["lab-a", ND],
    ["lab-b", ND],
    ["lab-c", ND],
  ]);
  const got = topmostPlacements(placed, new Map());
  assert.deepEqual(got.get(ND)?.sort(), ["lab-a", "lab-b", "lab-c"]);
});

test("an ancestor placed somewhere else does not cover its child", () => {
  // The cardiology institute belongs to the CHUM but sits in another building.
  // It has to count for its own site, not disappear into its parent's.
  const placed = new Map([
    ["chum-hopital", ND],
    ["institut-cardio", CS],
  ]);
  const parent = new Map([["institut-cardio", "chum-hopital"]]);
  const got = topmostPlacements(placed, parent);
  assert.deepEqual(got.get(ND), ["chum-hopital"]);
  assert.deepEqual(got.get(CS), ["institut-cardio"]);
});

test("coverage reaches through an unplaced middle", () => {
  // hopital(ND) -> service(nowhere) -> ward(ND). The ward is still inside the
  // hospital's subtree even though the layer between them sits nowhere.
  const placed = new Map([
    ["hopital", ND],
    ["ward", ND],
  ]);
  const parent = new Map([
    ["ward", "service"],
    ["service", "hopital"],
  ]);
  assert.deepEqual(topmostPlacements(placed, parent), new Map([[ND, ["hopital"]]]));
});

test("a cycle in the hierarchy terminates instead of hanging", () => {
  // `contains` is transitive; a mis-ingested cycle would otherwise walk for
  // ever, and the twin would stop answering rather than answer wrongly.
  const placed = new Map([["a", ND]]);
  const parent = new Map([
    ["a", "b"],
    ["b", "c"],
    ["c", "a"],
  ]);
  assert.deepEqual(topmostPlacements(placed, parent), new Map([[ND, ["a"]]]));
});

test("nothing placed, nothing counted", () => {
  assert.deepEqual(topmostPlacements(new Map(), new Map()), new Map());
});
