import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertResolvable,
  effectiveAt,
  validateOverrides,
  type ScenarioOverride,
} from "./scenario-overrides.js";

function ov(p: Partial<ScenarioOverride> & { id: string }): ScenarioOverride {
  return {
    scenarioId: "s1",
    seq: 1,
    targetType: "instance",
    targetId: null,
    targetLocalKey: null,
    op: "set_property",
    payload: {},
    effectiveOffsetHours: 0,
    durationHours: null,
    note: null,
    ...p,
  };
}

// --- effectiveAt -------------------------------------------------------------

test("an override applies once its offset is reached, not before", () => {
  const list = [ov({ id: "a", effectiveOffsetHours: 216 })]; // day 9
  assert.equal(effectiveAt(list, 0).length, 0);
  assert.equal(effectiveAt(list, 215).length, 0);
  assert.equal(effectiveAt(list, 216).length, 1, "the boundary hour is included");
  assert.equal(effectiveAt(list, 400).length, 1);
});

test("a duration expires the effect — a ward closed for a week reopens", () => {
  // Closed on day 9 for 7 days: in effect through day 15, open again on day 16.
  const closed = [ov({ id: "close", effectiveOffsetHours: 216, durationHours: 168 })];
  assert.equal(effectiveAt(closed, 216).length, 1, "day 9");
  assert.equal(effectiveAt(closed, 383).length, 1, "last hour of day 15");
  assert.equal(effectiveAt(closed, 384).length, 0, "day 16 — reopened");
});

test("no duration means permanent", () => {
  const list = [ov({ id: "a", effectiveOffsetHours: 0, durationHours: null })];
  assert.equal(effectiveAt(list, 100000).length, 1);
});

// --- validation --------------------------------------------------------------

test("an edit with no target is refused", () => {
  const issues = validateOverrides([ov({ id: "a", targetId: null, targetLocalKey: null })]);
  assert.ok(issues.some((i) => /names no target/.test(i.message)));
});

test("a param override needs no instance target", () => {
  const issues = validateOverrides([
    ov({ id: "a", targetType: "param", op: "set_param", payload: { r0: 2.4 } }),
  ]);
  assert.deepEqual(issues, []);
});

test("referencing a local key before creating it is caught", () => {
  // "Route patients into the new ward" placed before "open the new ward".
  const issues = validateOverrides([
    ov({ id: "link", seq: 1, op: "link", targetLocalKey: "new_ward" }),
    ov({ id: "make", seq: 2, op: "create", targetLocalKey: "new_ward" }),
  ]);
  assert.ok(issues.some((i) => i.overrideId === "link" && /not created by any earlier edit/.test(i.message)));
});

test("creating then referencing a local key is fine", () => {
  const issues = validateOverrides([
    ov({ id: "make", seq: 1, op: "create", targetLocalKey: "new_ward" }),
    ov({ id: "link", seq: 2, op: "link", targetLocalKey: "new_ward" }),
  ]);
  assert.deepEqual(issues, []);
});

test("editing something an earlier edit deleted is reported as a no-op", () => {
  const issues = validateOverrides([
    ov({ id: "del", seq: 1, op: "delete", targetId: "u1" }),
    ov({ id: "set", seq: 2, op: "set_property", targetId: "u1", payload: { property: "status" } }),
  ]);
  assert.ok(issues.some((i) => i.overrideId === "set" && /earlier edit deleted/.test(i.message)));
});

test("two writes to the same property at the same offset are flagged, not blocked", () => {
  const list = [
    ov({ id: "a", seq: 1, targetId: "u1", payload: { property: "status", value: "closed" } }),
    ov({ id: "b", seq: 2, targetId: "u1", payload: { property: "status", value: "open" } }),
  ];
  const issues = validateOverrides(list);
  assert.ok(issues.some((i) => /silently wins/.test(i.message)));
  // Ambiguous, not broken — seq still decides, so a run is allowed.
  assert.doesNotThrow(() => assertResolvable(list));
});

test("the same property at different offsets is a schedule, not a conflict", () => {
  const issues = validateOverrides([
    ov({ id: "a", seq: 1, targetId: "u1", effectiveOffsetHours: 0, payload: { property: "beds", value: 24 } }),
    ov({ id: "b", seq: 2, targetId: "u1", effectiveOffsetHours: 120, payload: { property: "beds", value: 36 } }),
  ]);
  assert.deepEqual(issues, []);
});

test("nonsense durations and offsets are refused", () => {
  const issues = validateOverrides([
    ov({ id: "a", targetId: "u1", durationHours: 0 }),
    ov({ id: "b", targetId: "u1", effectiveOffsetHours: -5 }),
  ]);
  assert.ok(issues.some((i) => /at least one hour/.test(i.message)));
  assert.ok(issues.some((i) => /before the scenario starts/.test(i.message)));
});

test("assertResolvable blocks on real problems and lists them together", () => {
  assert.throws(
    () =>
      assertResolvable([
        ov({ id: "a", targetId: null, targetLocalKey: null }),
        ov({ id: "b", targetId: "u1", durationHours: 0 }),
      ]),
    (e: Error) => /names no target/.test(e.message) && /at least one hour/.test(e.message),
  );
});
