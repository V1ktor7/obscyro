import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { crossCorrelate, effectiveSize, findLead } from "./lag-scan.js";

/** A wave, and the same wave arriving `by` steps later. */
function wave(n: number, peak: number, height = 100): number[] {
  return Array.from({ length: n }, (_, i) => height * Math.exp(-(((i - peak) / 6) ** 2)));
}
function shift(xs: number[], by: number): Array<number | null> {
  return xs.map((_, i) => (i - by >= 0 ? (xs[i - by] ?? null) : null));
}

describe("finding which series comes first", () => {
  const target = wave(60, 30);

  it("finds the lag a signal leads by", () => {
    // The signal is the same wave five steps earlier: the scan should say so.
    const signal = shift(target, -5);
    const scan = crossCorrelate(signal, target, 12);
    const best = scan.reduce((a, b) => (Math.abs(b.correlation) > Math.abs(a.correlation) ? b : a));
    assert.equal(best.lag, 5);
    assert.ok(best.correlation > 0.99, `got ${best.correlation}`);
  });

  it("reports a negative lag for a signal that trails", () => {
    const scan = crossCorrelate(shift(target, 4), target, 12);
    const best = scan.reduce((a, b) => (Math.abs(b.correlation) > Math.abs(a.correlation) ? b : a));
    assert.equal(best.lag, -4);
  });

  it("skips a lag with too little overlap to say anything", () => {
    const scan = crossCorrelate([1, 2, 3, 4, 5], [1, 2, 3, 4, 5], 4);
    assert.ok(scan.every((p) => p.n >= 4), JSON.stringify(scan));
  });
});

describe("how many independent observations there really are", () => {
  it("collapses the count for a smooth curve", () => {
    // Ninety daily points on an epidemic curve are not ninety samples: today's
    // count is nearly yesterday's. A correlation that would be overwhelming on
    // ninety is unremarkable on the handful this leaves.
    const smooth = wave(90, 45);
    const n = effectiveSize(smooth, smooth.map((v) => v * 1.1));
    assert.ok(n < 20, `expected far fewer than 90, got ${n}`);
  });

  it("leaves the count nearly alone for series with no memory", () => {
    // Genuinely memoryless: each value tells you almost nothing about the next,
    // so there is almost nothing to discount.
    const hash = (i: number) => {
      const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
      return x - Math.floor(x);
    };
    const a = Array.from({ length: 40 }, (_, i) => hash(i));
    const b = Array.from({ length: 40 }, (_, i) => hash(i + 1000));
    assert.ok(effectiveSize(a, b) >= 36, `got ${effectiveSize(a, b)} of 40`);
  });

  it("discounts two series that are each perfectly predictable from their own past", () => {
    // Both alternate, so each is entirely determined by the step before. Forty
    // points, almost no independent information — which is what the Bartlett
    // product is for, and it is the same reason an epidemic curve collapses.
    const a = Array.from({ length: 40 }, (_, i) => (i % 2 ? 1 : -1));
    const b = Array.from({ length: 40 }, (_, i) => (i % 2 ? -1 : 1));
    assert.ok(effectiveSize(a, b) <= 6, `got ${effectiveSize(a, b)}`);
  });

  it("never reports more independent points than were observed", () => {
    const a = Array.from({ length: 30 }, (_, i) => (i % 2 ? 1 : -1));
    assert.ok(effectiveSize(a, a.slice().reverse()) <= 30);
  });
});

describe("whether to believe the lead", () => {
  const target = wave(80, 40);

  it("keeps a lead that is really there", () => {
    const lead = findLead(shift(target, -6), target, { maxLag: 14 });
    assert.ok(lead);
    assert.equal(lead!.lag, 6);
    assert.ok(lead!.survives, JSON.stringify(lead));
  });

  it("checks the lead on a stretch held out of the search", () => {
    // Choosing the lag that maximises correlation and then reporting that same
    // correlation is circular, and the number it gives is always flattering.
    const lead = findLead(shift(target, -6), target, { maxLag: 14, holdoutFraction: 0.3 });
    assert.ok((lead!.holdoutCorrelation ?? 0) > 0.9, `got ${lead!.holdoutCorrelation}`);
  });

  it("counts the effective size, not the number of days", () => {
    const lead = findLead(shift(target, -6), target, { maxLag: 14 });
    assert.ok(lead!.effectiveN < lead!.n, `${lead!.effectiveN} should be under ${lead!.n}`);
  });

  it("raises the bar when many combinations were tried", () => {
    // Twenty signals across fourteen lags is 280 chances for noise to look like
    // a lead. The same correlation must clear a higher bar to survive.
    const noisy = Array.from({ length: 80 }, (_, i) => Math.sin(i / 3) * 10 + (i % 7));
    const alone = findLead(noisy, target, { maxLag: 14, testsRun: 1, holdoutFraction: 0 });
    const among = findLead(noisy, target, { maxLag: 14, testsRun: 280, holdoutFraction: 0 });
    assert.ok(!among!.survives || alone!.survives, "the stricter test must not be the lenient one");
    assert.equal(among!.testsRun, 280);
  });

  it("says nothing rather than inventing a lead from two points", () => {
    assert.equal(findLead([1, 2], [1, 2], { maxLag: 1 }), null);
  });

  it("reports a flat signal as no lead at all", () => {
    const flat = Array.from({ length: 80 }, () => 5);
    assert.equal(findLead(flat, target, { maxLag: 10 }), null);
  });
});
