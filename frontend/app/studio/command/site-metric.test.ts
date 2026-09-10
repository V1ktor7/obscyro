import { describe, expect, it } from "vitest";

import { bandFor, formatValue, ruleForMetric, siteValue, wouldFire } from "./site-metric";

/**
 * The map's colour and the alert have to agree.
 *
 * Before this, the badge was banded at 85 and 100 — numbers written into the
 * component, meaningful only for occupancy. Air quality runs 1 to 50+ and a
 * wastewater index sits around 1, so a second and third pair would have put
 * three private definitions of "bad" in the product, none of them the one the
 * rule uses. The band now comes from the rule, so a red badge means precisely
 * "the alert on this metric fires here".
 */

const over100 = { op: ">" as const, threshold: 100 };

describe("the badge agrees with the rule", () => {
  it("is over exactly when the rule fires", () => {
    expect(bandFor(101, over100)).toBe("over");
    // Exactly at the threshold is not over it — but it is as near as a value
    // can get, and the badge says that rather than calling it calm.
    expect(bandFor(100, over100)).toBe("near");
  });

  it("respects the operator the rule was written with", () => {
    // `>` and `>=` do not agree at the threshold, and neither does the map now.
    expect(bandFor(100, { op: ">=", threshold: 100 })).toBe("over");
    expect(bandFor(100, { op: ">", threshold: 100 })).toBe("near");
  });

  it("handles a rule where low is the problem", () => {
    // Staffing below five is the same kind of statement as occupancy above a
    // hundred, and the badge has to read it the same way round.
    const low = { op: "<" as const, threshold: 5 };
    expect(bandFor(3, low)).toBe("over");
    expect(bandFor(5.5, low)).toBe("near");
    expect(bandFor(20, low)).toBe("calm");
  });

  it("keeps occupancy looking exactly as it did", () => {
    // The one metric people have actually been reading must not change
    // appearance the day this ships: amber began at 85, red at 100.
    expect(bandFor(84, over100)).toBe("calm");
    expect(bandFor(85, over100)).toBe("near");
    expect(bandFor(99, over100)).toBe("near");
    expect(bandFor(140, over100)).toBe("over");
  });

  it("bands air quality on its own threshold, not occupancy's", () => {
    const iqa = { op: ">" as const, threshold: 50 };
    expect(bandFor(11, iqa)).toBe("calm");
    expect(bandFor(44, iqa)).toBe("near");
    expect(bandFor(63, iqa)).toBe("over");
  });

  it("bands a dimensionless index around one", () => {
    const eau = { op: ">" as const, threshold: 1 };
    expect(bandFor(0.12, eau)).toBe("calm");
    expect(bandFor(0.9, eau)).toBe("near");
    expect(bandFor(1.4, eau)).toBe("over");
  });

  it("gives equality no approach", () => {
    expect(bandFor(9, { op: "==", threshold: 10 })).toBe("calm");
    expect(bandFor(10, { op: "==", threshold: 10 })).toBe("over");
  });
});

describe("what the badge says when it cannot say a number", () => {
  it("keeps its own tint for a site with no reading", () => {
    // Absent is not calm. A hospital nobody can see must not be painted the
    // colour of a hospital that is fine.
    expect(bandFor(null, over100)).toBe("absent");
    expect(bandFor(undefined, over100)).toBe("absent");
    expect(bandFor(Number.NaN, over100)).toBe("absent");
  });

  it("says so when nobody has thresholded the metric", () => {
    // Not green: a metric with no rule has no good or bad, and borrowing the
    // green-amber-red axis would imply a judgement the data does not carry.
    expect(bandFor(42, null)).toBe("unbanded");
  });
});

describe("choosing the rule that governs a metric", () => {
  const rules = [
    { metric: "occupancy", op: ">" as const, threshold: 100 },
    { metric: "occupancy", op: ">" as const, threshold: 130 },
    { metric: "iqa", op: ">" as const, threshold: 50 },
  ];

  it("follows the one that fires first", () => {
    // Two severities on one metric: the colour must not lag behind the earliest
    // alert a viewer could already be reading in the panel beside the map.
    expect(ruleForMetric(rules, "occupancy")).toEqual({ metric: "occupancy", op: ">", threshold: 100 });
  });

  it("picks the highest threshold when low is the problem", () => {
    const low = [
      { metric: "staff", op: "<" as const, threshold: 3 },
      { metric: "staff", op: "<" as const, threshold: 6 },
    ];
    expect(ruleForMetric(low, "staff")?.threshold).toBe(6);
  });

  it("returns nothing for a metric nobody watches", () => {
    expect(ruleForMetric(rules, "charge_eaux_usees")).toBeNull();
  });
});

describe("reading a value off a site", () => {
  it("takes the metric by key", () => {
    const site = { metrics: { values: { occupancy: 140, iqa: 9 } } };
    expect(siteValue(site, "iqa")).toBe(9);
  });

  it("returns null rather than zero for a metric the site does not carry", () => {
    expect(siteValue({ metrics: { values: { occupancy: 140 } } }, "iqa")).toBeNull();
    expect(siteValue({}, "iqa")).toBeNull();
  });
});

describe("how the number is written", () => {
  it("writes a percentage as one", () => {
    expect(formatValue(140.4, "percent")).toBe("140%");
  });

  it("keeps the precision a small index needs", () => {
    // 0.12 rounded to a whole number is 0, which would read as no signal at all.
    expect(formatValue(0.121, "number")).toBe("0.12");
  });

  it("does not pretend to precision on a large number", () => {
    expect(formatValue(1234.7, "number")).toBe("1235");
  });

  it("writes an em dash for a missing reading", () => {
    expect(formatValue(null, "percent")).toBe("—");
  });
});

describe("wouldFire is the alert engine's own test", () => {
  it("covers every operator a rule can use", () => {
    expect(wouldFire(5, { op: ">", threshold: 4 })).toBe(true);
    expect(wouldFire(4, { op: ">=", threshold: 4 })).toBe(true);
    expect(wouldFire(3, { op: "<", threshold: 4 })).toBe(true);
    expect(wouldFire(4, { op: "<=", threshold: 4 })).toBe(true);
    expect(wouldFire(4, { op: "==", threshold: 4 })).toBe(true);
    expect(wouldFire(4, { op: ">", threshold: 4 })).toBe(false);
  });
});
