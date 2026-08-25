import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  alignSeries,
  asDaily,
  asLog,
  compareSeries,
  withoutOutliers,
} from "./observed-series.js";

const OPTS = { when: "date", value: "n", origin: "2021-12-01", horizon: 5 };

describe("putting an observed file on a run's axis", () => {
  it("places each date on the step it was", () => {
    const out = alignSeries(
      [
        { date: "2021-12-01", n: "10" },
        { date: "2021-12-03", n: "30" },
      ],
      OPTS,
    );
    assert.deepEqual(out, [10, null, 30, null, null]);
  });

  it("leaves a day the file did not report as unknown, not as zero", () => {
    // A day with no reported figure and a day with none of the thing are
    // different. Filling one in as the other turns a reporting gap into an
    // apparent lull, which is what a reader would then explain.
    assert.equal(alignSeries([{ date: "2021-12-01", n: "" }], OPTS)[0], null);
  });

  it("ignores a date outside the run", () => {
    const out = alignSeries(
      [{ date: "2021-11-30", n: "9" }, { date: "2022-06-01", n: "9" }],
      OPTS,
    );
    assert.deepEqual(out, [null, null, null, null, null]);
  });

  it("reads a number written with spaces or commas", () => {
    assert.equal(alignSeries([{ date: "2021-12-01", n: "1 234" }], OPTS)[0], 1234);
  });

  it("takes a repeated date once rather than summing it", () => {
    // A series is not a ledger: a file that lists a day twice would double it.
    assert.equal(alignSeries([{ date: "2021-12-01", n: "5" }, { date: "2021-12-01", n: "5" }], OPTS)[0], 5);
  });
});

describe("reading a cumulative column as what happened each day", () => {
  it("takes the difference", () => {
    assert.deepEqual(asDaily([100, 110, 135]), [null, 10, 25]);
  });

  it("treats a total that goes down as a revision, not negative arrivals", () => {
    assert.deepEqual(asDaily([100, 90]), [null, 0]);
  });

  it("does not bridge a gap it cannot measure across", () => {
    // Differencing across a hole would attribute several days of arrivals to
    // one, which is a spike nobody observed.
    assert.deepEqual(asDaily([100, null, 140]), [null, null, null]);
  });
});

describe("comparing a run against what happened", () => {
  const observed = [10, 20, 40, 80, 40, 20];

  it("says how far apart the two peaks are", () => {
    // The number to read first: a model peaking three days late is wrong in a
    // way a high correlation hides completely.
    const late = [5, 10, 20, 40, 80, 40];
    const fit = compareSeries(late, observed);
    assert.equal(fit.peakObserved?.step, 3);
    assert.equal(fit.peakSimulated?.step, 4);
    assert.equal(fit.peakOffset, 1);
  });

  it("measures the average distance between them", () => {
    const fit = compareSeries([12, 22, 42, 82, 42, 22], observed);
    assert.equal(fit.meanAbsoluteError, 2);
  });

  it("compares only the steps where both have a value", () => {
    const fit = compareSeries([10, null, 40, 80, 40, 20], observed);
    assert.equal(fit.n, 5);
  });

  it("refuses to report a correlation from too few points", () => {
    // Two points always correlate perfectly and three nearly always do.
    // Reported as unknown rather than as 1.0, which reads as a model that
    // nailed it.
    const fit = compareSeries([1, 2, 3], [2, 4, 6]);
    assert.equal(fit.correlation, null);
    assert.equal(fit.n, 3);
  });

  it("reports nothing about a flat series rather than calling it unrelated", () => {
    const fit = compareSeries([5, 5, 5, 5, 5, 5], observed);
    assert.equal(fit.correlation, null);
    assert.notEqual(fit.meanAbsoluteError, null);
  });

  it("finds the shapes related when they are", () => {
    const fit = compareSeries([5, 10, 20, 40, 20, 10], observed);
    assert.ok((fit.correlation ?? 0) > 0.99, `got ${fit.correlation}`);
  });

  it("says nothing at all rather than guessing when nothing overlaps", () => {
    const fit = compareSeries([null, null], [null, null]);
    assert.equal(fit.n, 0);
    assert.equal(fit.meanAbsoluteError, null);
    assert.equal(fit.peakOffset, null);
  });
});

describe("reading a series on the scale it lives on", () => {
  it("compares a doubling the same wherever it happens", () => {
    // A viral load runs over orders of magnitude. On the raw scale a Pearson
    // correlation is decided by whichever day was largest; on the log scale a
    // doubling counts the same at the bottom and at the top.
    const out = asLog([1, 10, 100]);
    assert.deepEqual(out, [0, 1, 2]);
  });

  it("treats a value below detection as unknown, not as minus infinity", () => {
    // "We could not see it" is not "there was none", and log(0) would take the
    // whole series with it.
    assert.deepEqual(asLog([0, -1, 5]), [null, null, Math.log10(5)]);
  });
});

describe("a sample nothing else supports", () => {
  const normal = [1, 1.1, 0.9, 1.2, 0.95, 1.05, 1.15, 0.85, 1.0, 1.1];

  it("removes a point a hundred times its neighbours", () => {
    // One such point can set the sign of a whole episode, and Pearson has no
    // defence against it.
    const { series, removed } = withoutOutliers([...normal, 100]);
    assert.equal(removed, 1);
    assert.equal(series[series.length - 1], null);
  });

  it("keeps every ordinary point", () => {
    const { removed } = withoutOutliers(normal);
    assert.equal(removed, 0);
  });

  it("does not let the outlier widen the band meant to catch it", () => {
    // A standard deviation would be inflated by the very point being tested.
    // The median absolute deviation is not.
    const { removed } = withoutOutliers([...normal, 100, 120]);
    assert.equal(removed, 2);
  });

  it("leaves a short series alone rather than guessing at its spread", () => {
    assert.equal(withoutOutliers([1, 99]).removed, 0);
  });

  it("reports no outliers in a series with no spread", () => {
    assert.equal(withoutOutliers(Array.from({ length: 20 }, () => 7)).removed, 0);
  });
});
