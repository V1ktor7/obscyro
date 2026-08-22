import assert from "node:assert/strict";
import { test } from "node:test";

import { bindsAnyMechanic } from "./twin-export.js";

test("a twin that has declared a care model is not told it has none", () => {
  // `NO_CARE_MODEL` used to be pushed on every export, from back when a care
  // model could only come from the scenario. Montréal declared one as two
  // `Protocole` instances and the export still reported the gap — the single
  // gap that decides whether a run means anything was the one that never
  // changed.
  const declared = [
    { properties: [{ key: "nom" }, { mechanic: "serves_severity" as const }] },
    { properties: [{ key: "status" }] },
  ];
  assert.equal(bindsAnyMechanic(declared), true);
});

test("a twin that has declared nothing is told so", () => {
  const bare = [{ properties: [{ key: "status", mechanic: null }] }, { properties: [] }];
  assert.equal(bindsAnyMechanic(bare), false);
});

test("a property whose mechanic was cleared does not count", () => {
  // Unbinding is how an institution retracts a care model, and a retraction
  // that leaves the engine still thinking it has one is worse than never
  // having declared it.
  assert.equal(bindsAnyMechanic([{ properties: [{ mechanic: null }] }]), false);
});
