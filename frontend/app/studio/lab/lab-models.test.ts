import { describe, expect, it } from "vitest";

import { liftOverBaseline, type LabModel } from "../lab-models-api";

/**
 * The number that decides whether a fit was worth anything.
 *
 * A score on its own is unreadable: an R² of 0.8 is excellent on noisy data and
 * embarrassing on data where the mean already scores 0.79. This turns the pair
 * into the share of the baseline's error the model actually removed, which is
 * the question somebody is really asking when they look at a metric.
 */

const model = (over: Partial<LabModel>): LabModel => ({
  id: "m",
  projectId: "p",
  name: "m",
  datasetId: "d",
  datasetName: "d",
  task: "regression",
  estimator: "ridge",
  params: {},
  target: "y",
  features: ["x"],
  numericFeatures: ["x"],
  categoricalFeatures: [],
  split: "random",
  testSize: 0.25,
  timeColumn: null,
  metrics: {},
  baseline: {},
  importances: [],
  warnings: [],
  classes: [],
  nTrain: 100,
  nTest: 30,
  droppedRows: 0,
  createdAt: "2026-09-04T00:00:00.000Z",
  ...over,
});

describe("how much better than nothing a model is", () => {
  it("halving the baseline error reads as half the error removed", () => {
    const m = model({ metrics: { mae: 5 }, baseline: { mae: 10 } });
    expect(liftOverBaseline(m)).toBeCloseTo(0.5, 6);
  });

  it("matching the baseline reads as nothing learned", () => {
    const m = model({ metrics: { mae: 10 }, baseline: { mae: 10 } });
    expect(liftOverBaseline(m)).toBe(0);
  });

  it("goes negative when the model is worse than the mean", () => {
    // This happens, and hiding it behind a floor of zero would be a lie about
    // a fit that should be thrown away.
    const m = model({ metrics: { mae: 12 }, baseline: { mae: 10 } });
    expect(liftOverBaseline(m)).toBeLessThan(0);
  });

  it("reads accuracy against the majority class, not against zero", () => {
    // 95% accuracy where 94% of rows are one class is almost nothing, and a
    // raw accuracy would show it as excellent.
    const m = model({
      task: "classification",
      metrics: { accuracy: 0.95 },
      baseline: { accuracy: 0.94 },
    });
    expect(liftOverBaseline(m)).toBeCloseTo(1 / 6, 3);
  });

  it("says nothing rather than dividing by zero on a perfect baseline", () => {
    const m = model({
      task: "classification",
      metrics: { accuracy: 1 },
      baseline: { accuracy: 1 },
    });
    expect(liftOverBaseline(m)).toBeNull();
  });

  it("says nothing when the metric is missing", () => {
    expect(liftOverBaseline(model({ metrics: {}, baseline: { mae: 3 } }))).toBeNull();
  });
});
