import assert from "node:assert/strict";
import { test } from "node:test";

import { followUp, realityOf, type RealityConfig } from "./decisions.js";
import type { ScenarioOverride } from "./scenario-overrides.js";

/**
 * A decision's follow-up: what the tested run expected, beside what was
 * counted. (That a decision can only be recorded from a tested option is held
 * in `analyst-options.unit.test.ts`, where the option is really tested.)
 */

const REALITY: RealityConfig = { datasetId: "ds-1", datasetName: "Admissions", when: "date", value: "n", origin: "2021-12-13", acuity: "hospitalisation" };
const EXPECTED = { horizon: 5, arrivals: { hospitalisation: [10, 20, 30, 20, 10], urgence: [1, 1, 1, 1, 1] } };

const row = (date: string, n: number | string) => ({ date, n });

test("expected and observed sit on the run's own days, and the gap is in the series' unit", () => {
  const out = followUp(EXPECTED, REALITY, [row("2021-12-13", 12), row("2021-12-14", 18), row("2021-12-15", 41), row("2021-12-17", 10)]);
  assert.ok(out.linked);
  assert.deepEqual(out.dataset, { id: "ds-1", name: "Admissions" });
  assert.equal(out.acuity, "hospitalisation");
  assert.deepEqual(out.expected, [10, 20, 30, 20, 10]);
  // The 16th was not reported: unknown, not zero.
  assert.deepEqual(out.observed, [12, 18, 41, null, 10]);
  assert.equal(out.reported, 4);
  // Over the four days both report: 70 expected, 81 counted.
  assert.deepEqual(out.totals, { days: 4, expected: 70, observed: 81, gap: 11 });
  assert.equal(out.fit!.n, 4);
  assert.equal(out.fit!.peakOffset, 0);
  assert.equal(out.fit!.meanAbsoluteError, (2 + 2 + 11 + 0) / 4);
});

test("a day outside the run, or a blank, is not compared", () => {
  const out = followUp(EXPECTED, REALITY, [row("2021-12-01", 99), row("2021-12-13", ""), row("2021-12-14", 20), row("2022-03-01", 99)]);
  assert.ok(out.linked);
  assert.deepEqual(out.observed, [null, 20, null, null, null]);
  assert.deepEqual(out.totals, { days: 1, expected: 20, observed: 20, gap: 0 });
});

test("a series that reports nothing over the run gives no total, rather than a gap of nothing", () => {
  const out = followUp(EXPECTED, REALITY, [row("2020-01-01", 5)]);
  assert.ok(out.linked);
  assert.equal(out.reported, 0);
  assert.equal(out.totals, null);
  assert.equal(out.fit!.n, 0);
});

test("a severity the tested run did not produce has nothing to stand beside the series", () => {
  const out = followUp(EXPECTED, { ...REALITY, acuity: "soins intensifs" }, [row("2021-12-13", 12)]);
  assert.ok(out.linked);
  assert.equal(out.expected, null);
  assert.equal(out.totals, null);
  assert.equal(out.fit, null);
  // What was observed is still shown.
  assert.deepEqual(out.observed, [12, null, null, null, null]);
});

// --- which series a scenario is compared with --------------------------------

let seq = 0;
const param = (key: string, value: unknown): ScenarioOverride => ({
  id: `o${++seq}`,
  scenarioId: "s",
  seq,
  targetType: "param",
  targetId: null,
  targetLocalKey: key,
  op: "set_param",
  payload: { key, value },
  effectiveOffsetHours: 0,
  durationHours: null,
  note: null,
});

test("the scenario's reality setting is the last one written that is whole", () => {
  const first = { ...REALITY, datasetName: "Old" };
  assert.equal(realityOf([]), null);
  assert.equal(realityOf([param("stamp:x", { kind: "immunity", share: 0.3 })]), null);
  assert.deepEqual(realityOf([param("reality", first), param("reality", REALITY)]), REALITY);
  // A setting missing its date is passed over, not half-read.
  assert.deepEqual(realityOf([param("reality", first), param("reality", { ...REALITY, origin: "13 December" })]), first);
  assert.equal(realityOf([param("reality", { datasetId: "ds-1" })]), null);
});
