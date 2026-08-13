import assert from "node:assert/strict";
import { test } from "node:test";

import { assertEventMatchesWorld, type CrisisEventRow } from "./crisis-events.js";

// ---------------------------------------------------------------------------
// An event's effects name instances by id. Run one against the wrong world and
// every target is a stranger: the engine rejects it with "no facility <uuid>",
// which is true, unreadable, and says nothing about the mistake that was made.
// These pin the check that turns that into an instruction.
// ---------------------------------------------------------------------------

function event(twinScenarioId: string | null): CrisisEventRow {
  return {
    id: "e1",
    name: "East wing out",
    description: "",
    horizon: 30,
    effects: [],
    twinScenarioId,
    createdAt: "",
    updatedAt: "",
  };
}

const SCENARIO = "11111111-1111-1111-1111-111111111111";

test("an event composed on the live twin runs on the live twin", () => {
  assert.doesNotThrow(() => assertEventMatchesWorld(event(null), null));
});

test("an event composed against a scenario runs against that scenario", () => {
  assert.doesNotThrow(() => assertEventMatchesWorld(event(SCENARIO), SCENARIO));
});

test("a scenario event refused on the live twin says which scenario to pick", () => {
  assert.throws(
    () => assertEventMatchesWorld(event(SCENARIO), null),
    (err: Error) => /composed against a scenario/.test(err.message),
  );
});

test("a live event refused under a scenario explains why, not just that", () => {
  assert.throws(
    () => assertEventMatchesWorld(event(null), SCENARIO),
    (err: Error) => /composed against the live twin/.test(err.message),
  );
});

test("two different scenarios are not interchangeable", () => {
  // The tempting bug is to test only "has a scenario" against "has a scenario".
  // An event written for the expansion plan is meaningless under the closure
  // plan, and its targets may well exist in both.
  assert.throws(() =>
    assertEventMatchesWorld(event(SCENARIO), "22222222-2222-2222-2222-222222222222"),
  );
});
