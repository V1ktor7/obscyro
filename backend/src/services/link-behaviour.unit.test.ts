import assert from "node:assert/strict";
import { test } from "node:test";

import { aggregationEnds, attaches, buildsHierarchy } from "./twin.js";

// ---------------------------------------------------------------------------
// The engine used to match three strings — `contains`, `located_in`,
// `located_in_bed`. An institution modelling « chapeaute » or « se trouve
// dans » got an empty tree and zeroes, with no error anywhere. These tests pin
// the replacement: the link type declares what it does, and the name is never
// consulted.
// ---------------------------------------------------------------------------

const hierarchy = { aggregates: "metrics" as const, aggregateToward: "source" as const, transitive: true };
const attachment = { aggregates: "metrics" as const, aggregateToward: "target" as const, transitive: false };
const plainRelation = { aggregates: null, aggregateToward: null, transitive: false };

test("a hierarchy aggregates and chains", () => {
  assert.equal(buildsHierarchy(hierarchy), true);
  assert.equal(attaches(hierarchy), false);
});

test("an attachment aggregates without chaining", () => {
  assert.equal(attaches(attachment), true);
  assert.equal(buildsHierarchy(attachment), false);
});

test("a relation that aggregates nothing is neither", () => {
  // A transfer between two wards is a real relation — drawn, queryable — but
  // the beds of one do not become the beds of the other.
  assert.equal(buildsHierarchy(plainRelation), false);
  assert.equal(attaches(plainRelation), false);
});

test("transitive alone does not make a hierarchy", () => {
  // `tranfer_to` may legitimately be cyclic: A transfers to B, B to A. It is
  // harmless precisely because nothing accumulates along it.
  const cyclicButInert = { aggregates: null, aggregateToward: null, transitive: true };
  assert.equal(buildsHierarchy(cyclicButInert), false);
});

test("direction decides which end receives", () => {
  const link = { from: "CHUM", to: "Notre-Dame" };

  // « CHUM contains Notre-Dame » — the parent is the source.
  assert.deepEqual(
    aggregationEnds({ ...hierarchy, fromInstanceId: link.from, toInstanceId: link.to }),
    { receiver: "CHUM", giver: "Notre-Dame" },
  );

  // « Notre-Dame part_of CHUM » — same tree, arrow reversed. Without this the
  // hierarchy inverts and the top of the organisation reads as a leaf.
  assert.deepEqual(
    aggregationEnds({
      aggregates: "metrics",
      aggregateToward: "target",
      transitive: true,
      fromInstanceId: "Notre-Dame",
      toInstanceId: "CHUM",
    }),
    { receiver: "CHUM", giver: "Notre-Dame" },
  );
});

test("an attachment points the instance at the unit", () => {
  assert.deepEqual(
    aggregationEnds({ ...attachment, fromInstanceId: "bed-12", toInstanceId: "HND Emergency" }),
    { receiver: "HND Emergency", giver: "bed-12" },
  );
});

test("no direction declared falls to the target end", () => {
  // Only reachable for a link that aggregates nothing — the migration's check
  // constraint refuses `aggregates` without `aggregate_toward`. It still has to
  // be total rather than throw.
  assert.deepEqual(
    aggregationEnds({ ...plainRelation, fromInstanceId: "a", toInstanceId: "b" }),
    { receiver: "b", giver: "a" },
  );
});
