import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { alertsToResolve, type OpenAlertRef } from "./twin-alert-scheduler.js";
import type { TwinAlertRuleRow, UnitMetrics } from "./twin.js";

/**
 * Closing an alert is a claim, not housekeeping.
 *
 * Opening one on a bad reading is noise somebody deletes. Closing one on a bad
 * reading tells a charge nurse the ward is fine. These tests are all about the
 * second kind of mistake.
 */

const RULE: TwinAlertRuleRow = {
  id: "r1",
  environmentId: "p1",
  unitKind: null,
  metric: "occupancy",
  op: ">",
  threshold: 100,
  severity: "critical",
  messageTemplate: "{unit} — {value} %",
  recommendationTemplate: "",
};

function metrics(values: Record<string, number | null>): UnitMetrics {
  return {
    unitId: "u1",
    instanceCountByType: {},
    values,
    occupancyPct: values.occupancy ?? null,
    numericMeans: {},
    freshnessSeconds: null,
    freshnessBasis: "undeclared",
    fetchedAgeSeconds: null,
    linkedInstanceCount: 0,
  } as unknown as UnitMetrics;
}

const openAlert = (over: Partial<OpenAlertRef> = {}): OpenAlertRef => ({
  id: "a1",
  unitInstanceId: "u1",
  ruleId: "r1",
  ...over,
});

const KINDS = new Map([["u1", "org"]]);

describe("an alert closes only on a reading that says so", () => {
  it("resolves when the metric has come back under the threshold", () => {
    const m = new Map([["u1", metrics({ occupancy: 62 })]]);
    const { resolve, unreadable } = alertsToResolve([openAlert()], [RULE], m, KINDS);
    assert.deepEqual(resolve, ["a1"]);
    assert.deepEqual(unreadable, []);
  });

  it("leaves it open when the unit has stopped reporting", () => {
    // The dangerous case. An emergency ward whose feed died has no occupancy,
    // and treating that absence as "back to normal" turns a hospital nobody
    // can see any more into a green dot. Absent is not calm.
    const m = new Map([["u1", metrics({ occupancy: null })]]);
    const { resolve, unreadable } = alertsToResolve([openAlert()], [RULE], m, KINDS);
    assert.deepEqual(resolve, []);
    assert.deepEqual(unreadable, ["a1"]);
  });

  it("leaves it open when the unit is missing from the rollup entirely", () => {
    const { resolve, unreadable } = alertsToResolve([openAlert()], [RULE], new Map(), KINDS);
    assert.deepEqual(resolve, []);
    assert.deepEqual(unreadable, ["a1"]);
  });

  it("does not resolve a unit still exactly on the wrong side", () => {
    const m = new Map([["u1", metrics({ occupancy: 100.5 })]]);
    assert.deepEqual(alertsToResolve([openAlert()], [RULE], m, KINDS).resolve, []);
  });

  it("resolves at the boundary the rule actually names", () => {
    // `> 100` means a ward at exactly capacity is not over it, so the alert
    // that fired at 140 % has genuinely cleared at 100 %.
    const m = new Map([["u1", metrics({ occupancy: 100 })]]);
    assert.deepEqual(alertsToResolve([openAlert()], [RULE], m, KINDS).resolve, ["a1"]);
  });
});

describe("configuration changes are not conditions clearing", () => {
  it("never resolves an alert whose rule was deleted", () => {
    // The delete dialog promises "open alerts it already raised stay where
    // they are". A scheduler sweeping them up an hour later would make the
    // application lie to the person who read that sentence.
    const m = new Map([["u1", metrics({ occupancy: 20 })]]);
    const { resolve, unreadable } = alertsToResolve([openAlert()], [], m, KINDS);
    assert.deepEqual(resolve, []);
    assert.deepEqual(unreadable, []);
  });

  it("never resolves an alert with no rule recorded on it", () => {
    const m = new Map([["u1", metrics({ occupancy: 20 })]]);
    assert.deepEqual(alertsToResolve([openAlert({ ruleId: null })], [RULE], m, KINDS).resolve, []);
  });

  it("ignores an alert on a unit the rule no longer covers", () => {
    const scoped = { ...RULE, unitKind: "ward" };
    const m = new Map([["u1", metrics({ occupancy: 20 })]]);
    // Same skip evaluateAlerts makes. If the resolver judged units the
    // evaluator never visits, the two halves would disagree about which
    // alerts exist.
    const { resolve, unreadable } = alertsToResolve([openAlert()], [scoped], m, KINDS);
    assert.deepEqual(resolve, []);
    assert.deepEqual(unreadable, []);
  });

  it("follows a threshold somebody raised", () => {
    // 120 % was a problem under `> 100` and is not under `> 150`. That is a
    // human redefining the problem, and the alert should go quiet.
    const raised = { ...RULE, threshold: 150 };
    const m = new Map([["u1", metrics({ occupancy: 120 })]]);
    assert.deepEqual(alertsToResolve([openAlert()], [raised], m, KINDS).resolve, ["a1"]);
  });
});

describe("several units at once", () => {
  it("sorts each alert on its own reading", () => {
    const rules = [RULE, { ...RULE, id: "r2", metric: "staffing", op: "<" as const, threshold: 5 }];
    const m = new Map([
      ["u1", metrics({ occupancy: 40 })],
      ["u2", metrics({ occupancy: 180 })],
      ["u3", metrics({ occupancy: null })],
      ["u4", metrics({ staffing: 9 })],
    ]);
    const kinds = new Map([
      ["u1", "org"],
      ["u2", "org"],
      ["u3", "org"],
      ["u4", "org"],
    ]);
    const { resolve, unreadable } = alertsToResolve(
      [
        openAlert({ id: "a1", unitInstanceId: "u1" }),
        openAlert({ id: "a2", unitInstanceId: "u2" }),
        openAlert({ id: "a3", unitInstanceId: "u3" }),
        openAlert({ id: "a4", unitInstanceId: "u4", ruleId: "r2" }),
      ],
      rules,
      m,
      kinds,
    );
    assert.deepEqual(resolve.sort(), ["a1", "a4"]);
    assert.deepEqual(unreadable, ["a3"]);
  });

  it("accounts for every alert it was given", () => {
    // Nothing may fall between the three outcomes without being counted:
    // an alert that is neither resolved nor flagged unreadable is one this
    // pass deliberately kept, and there is no fourth, silent bucket.
    const m = new Map([
      ["u1", metrics({ occupancy: 40 })],
      ["u2", metrics({ occupancy: null })],
      ["u3", metrics({ occupancy: 200 })],
    ]);
    const kinds = new Map([
      ["u1", "org"],
      ["u2", "org"],
      ["u3", "org"],
    ]);
    const open = [
      openAlert({ id: "a1", unitInstanceId: "u1" }),
      openAlert({ id: "a2", unitInstanceId: "u2" }),
      openAlert({ id: "a3", unitInstanceId: "u3" }),
    ];
    const { resolve, unreadable } = alertsToResolve(open, [RULE], m, kinds);
    const kept = open.filter(
      (a) => !resolve.includes(a.id) && !unreadable.includes(a.id),
    );
    assert.equal(resolve.length + unreadable.length + kept.length, open.length);
    assert.deepEqual(kept.map((a) => a.id), ["a3"], "the one still over capacity");
  });
});
