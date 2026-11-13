import { describe, expect, it } from "vitest";

import type { LoopView } from "../forecast-loops-api";
import { RULE, addDays, buildLoop } from "./loop-rules";

const START = "2022-01-03"; // a Monday

/** 120 mornings of a flat series at 100; model A errs by `errA(day)`, B by `errB(day)`. */
function view(errA: (k: number) => number, errB: (k: number) => number, maeAtRefit = 2): LoopView {
  const actual: Record<string, number> = {};
  for (let k = -30; k < 160; k++) actual[addDays(START, k)] = 100;
  const forecasts: LoopView["forecasts"] = [];
  const retrains: LoopView["retrains"] = [];
  for (let k = 0; k < 120; k++) {
    const made = addDays(START, k);
    for (const h of [1, 7, 14, 21]) {
      forecasts.push({ made, h, spec: "A", value: 100 + errA(k) });
      forecasts.push({ made, h, spec: "B", value: 100 + errB(k) });
      if (k % 7 === 0) for (const spec of ["A", "B"]) retrains.push({ on: made, h, spec, mae: maeAtRefit, points: 300 + k });
    }
  }
  return {
    loop: {
      id: "l", projectId: "p", name: "Admissions", datasetId: "d", datasetName: "", timeColumn: "date", target: "admissions",
      driver: null, horizons: [1, 7, 14, 21], lags: 14,
      specs: [{ key: "A", label: "Ridge", estimator: "ridge", exog: false, params: {} }, { key: "B", label: "Boosting", estimator: "gradient_boosting", exog: false, params: {} }],
      startDate: START, frozenThrough: addDays(START, 119), status: "live", lastError: null, createdAt: "", updatedAt: "",
    },
    actual, lastDay: addDays(START, 158), forecasts, retrains,
  };
}

describe("the loop's rules", () => {
  it("keeps the first model in force while the other is no better", () => {
    const L = buildLoop(view(() => 2, () => 2));
    expect(new Set(Object.values(L.inForce))).toEqual(new Set(["A"]));
    expect(L.events.filter((e) => e.kind === "promote")).toHaveLength(0);
  });

  it("replaces the model in force only on a Monday, once the other beats it by 10 % over eight weeks", () => {
    const L = buildLoop(view(() => 4, () => 2));
    const promo = L.events.find((e) => e.kind === "promote");
    expect(promo).toBeTruthy();
    expect(new Date(`${promo!.day}T00:00:00Z`).getUTCDay()).toBe(1);
    // Not before RULE.promoMin outcomes are known at 21 days.
    expect(promo!.day >= addDays(START, RULE.promoMin + 20)).toBe(true);
    expect(L.inForce[addDays(START, 119)]).toBe("B");
  });

  it("raises a drift alert at 1.5× the expected error and clears it below 1.25×", () => {
    // Error 2 (as expected), then 4 from day 40 to 79, then back to 2.
    const L = buildLoop(view((k) => (k >= 40 && k < 80 ? 4 : 2), (k) => (k >= 40 && k < 80 ? 4 : 2)));
    const alerts = L.events.filter((e) => e.kind === "alert" && e.h === 1);
    const clears = L.events.filter((e) => e.kind === "clear" && e.h === 1);
    expect(alerts.length).toBe(1);
    expect(clears.length).toBe(1);
    expect(alerts[0]!.day > addDays(START, 40)).toBe(true);
    expect(clears[0]!.day > alerts[0]!.day).toBe(true);
  });

  it("scores only forecasts whose day had come by that morning", () => {
    const L = buildLoop(view(() => 3, () => 3));
    const day = addDays(START, 30);
    for (const r of L.resolvedAt("A", 7, day, 28)) expect(r.tgt < day).toBe(true);
    expect(L.liveStats("A", 7, day).mae).toBeCloseTo(3);
  });
});
