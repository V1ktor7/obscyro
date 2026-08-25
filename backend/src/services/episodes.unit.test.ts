import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findEpisodes, replicationAcross } from "./episodes.js";

/** A series with waves at the given steps, each a bell of the given height. */
function waves(n: number, at: Array<[number, number]>): number[] {
  return Array.from({ length: n }, (_, i) =>
    at.reduce((sum, [peak, h]) => sum + h * Math.exp(-(((i - peak) / 8) ** 2)), 0),
  );
}
function lead(xs: Array<number | null>, by: number): Array<number | null> {
  // The same series arriving `by` steps earlier.
  return xs.map((_, i) => xs[i + by] ?? null);
}

const OPTS = { minSeparation: 40, halfWidth: 25, minHeightFraction: 0.15 };

describe("cutting a long series into its waves", () => {
  it("finds each wave", () => {
    const series = waves(400, [[60, 100], [180, 70], [320, 90]]);
    const found = findEpisodes(series, OPTS);
    assert.equal(found.length, 3);
    assert.deepEqual(found.map((e) => e.peak), [60, 180, 320]);
  });

  it("does not call the shoulder of a wave a second wave", () => {
    // A bumpy descent is one outbreak, and counting it as four would let a
    // single wave vote four times in the replication that follows.
    const series = waves(200, [[80, 100], [92, 60]]);
    assert.equal(findEpisodes(series, OPTS).length, 1);
  });

  it("keeps the taller of two candidates inside one separation", () => {
    const series = waves(200, [[80, 40], [95, 100]]);
    assert.equal(findEpisodes(series, OPTS)[0]!.peak, 95);
  });

  it("ignores a ripple against the largest wave", () => {
    // Relative rather than absolute, so the same call works on admissions, on
    // deaths and on a viral load, whose units share nothing.
    const series = waves(400, [[60, 100], [250, 4]]);
    assert.equal(findEpisodes(series, OPTS).length, 1);
  });

  it("clips a window that runs past either end of the series", () => {
    const found = findEpisodes(waves(60, [[8, 100]]), OPTS);
    assert.equal(found[0]!.start, 0);
    assert.equal(found[0]!.end, 33);
  });

  it("returns nothing for a series that never rises", () => {
    assert.deepEqual(findEpisodes(Array.from({ length: 100 }, () => 0), OPTS), []);
  });
});

describe("whether a lead holds up wave after wave", () => {
  const target = waves(600, [[70, 100], [190, 80], [310, 95], [430, 60], [545, 90]]);
  const episodes = findEpisodes(target, OPTS);

  it("finds the same lag on every wave when it is really there", () => {
    const signal = lead(target, 6);
    const r = replicationAcross(signal, target, episodes, { maxLag: 14 });
    assert.equal(r.measured, 5);
    assert.equal(r.medianLag, 6);
    assert.equal(r.agreement, 1);
    assert.ok(r.replicates);
  });

  it("refuses to call it a finding when the waves disagree", () => {
    // The search finding what it was looking for: strong in each window,
    // pointing somewhere different each time.
    const noise = target.map((_, i) => Math.sin(i / 2.7) * 40 + Math.cos(i / 5.3) * 25);
    const r = replicationAcross(noise, target, episodes, { maxLag: 14 });
    assert.ok(!r.replicates, `lags were ${JSON.stringify(r.lags)}`);
  });

  it("refuses on too few waves even when they agree", () => {
    // Two agreeing episodes is a coincidence with a witness. The cost of
    // missing a real lead is looking again next wave; the cost of announcing
    // one that is not there is a hospital planning around it.
    const short = waves(250, [[70, 100], [190, 80]]);
    const eps = findEpisodes(short, OPTS);
    const r = replicationAcross(lead(short, 5), short, eps, { maxLag: 14 });
    assert.equal(r.agreement, 1);
    assert.ok(!r.replicates, "two episodes must not be enough");
  });

  it("counts an episode that said nothing as unmeasured, not as agreeing", () => {
    const flat = target.map(() => 5);
    const r = replicationAcross(flat, target, episodes, { maxLag: 14 });
    assert.equal(r.measured, 0);
    assert.equal(r.medianLag, null);
    assert.ok(!r.replicates);
  });

  it("tolerates a wave or two landing beside the median", () => {
    // Real lags wobble. Demanding an exact match every time would reject
    // findings that are true and merely measured on noisy data.
    const signal = target.map((_, i) => (i < 250 ? (target[i + 6] ?? 0) : (target[i + 7] ?? 0)));
    const r = replicationAcross(signal, target, episodes, { maxLag: 14, tolerance: 2 });
    assert.ok(r.replicates, `lags were ${JSON.stringify(r.lags)}`);
  });
});
