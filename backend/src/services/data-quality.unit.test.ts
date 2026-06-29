import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { detectNumericAnomaly, mlAnomalyHook } from "./data-quality.js";
import type { EnvInstanceRow } from "./ontology.js";

const OPTS = { iqrK: 3.0, zThreshold: 5.0, minSample: 12 };

describe("detectNumericAnomaly (pure)", () => {
  const tightPopulation = Array.from({ length: 30 }, (_, i) => 70 + (i % 5)); // 70..74

  it("flags a value far outside the IQR fence", () => {
    const verdict = detectNumericAnomaly(tightPopulation, 5000, OPTS);
    assert.equal(verdict.isOutlier, true);
    assert.equal(verdict.method, "iqr");
  });

  it("does not flag an in-distribution value", () => {
    const verdict = detectNumericAnomaly(tightPopulation, 72, OPTS);
    assert.equal(verdict.isOutlier, false);
    assert.equal(verdict.method, null);
  });

  it("returns no verdict below the minimum sample size", () => {
    const verdict = detectNumericAnomaly([1, 2, 3], 9999, OPTS);
    assert.equal(verdict.isOutlier, false);
  });

  it("handles a degenerate (zero-spread) population without false positives", () => {
    const flat = Array.from({ length: 20 }, () => 50);
    const verdict = detectNumericAnomaly(flat, 50, OPTS);
    assert.equal(verdict.isOutlier, false);
  });
});

describe("mlAnomalyHook (L6)", () => {
  const schema = [{ key: "heart_rate", type: "number" as const }];
  function inst(id: string, hr: number): EnvInstanceRow {
    return {
      id,
      typeId: "t",
      typeName: "Vitals",
      properties: { heart_rate: hr },
      provenance: {},
      propertySchema: schema,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  it("emits an ML_ANOMALY finding for a numeric outlier", () => {
    const population = Array.from({ length: 30 }, (_, i) => inst(`n${i}`, 60 + (i % 4)));
    const target = inst("bad", 400);
    const findings = mlAnomalyHook({ instance: target, sameType: [...population, target] });
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.layer, 6);
    assert.equal(findings[0]!.code, "ML_ANOMALY");
  });

  it("emits nothing for a normal value", () => {
    const population = Array.from({ length: 30 }, (_, i) => inst(`n${i}`, 60 + (i % 4)));
    const target = inst("ok", 61);
    const findings = mlAnomalyHook({ instance: target, sameType: [...population, target] });
    assert.equal(findings.length, 0);
  });
});
