import { describe, expect, it } from "vitest";

import {
  barLayout,
  formatValue,
  linePath,
  linePoints,
  niceTicks,
  scaleFor,
  shortLabel,
  thinLabels,
  type PlotBox,
} from "./chart-geometry";

/**
 * A chart that is wrong does not throw. It draws.
 *
 * Every case here produced either a misleading picture or an invisible one, and
 * none of them would have appeared in a log.
 */

const BOX: PlotBox = { width: 400, height: 200, padLeft: 40, padRight: 10, padTop: 10, padBottom: 30 };

describe("the vertical scale", () => {
  it("starts a bar chart at zero", () => {
    // 40 next to 20 has to look twice as long. An axis cropped to 19-41 makes
    // a 5% difference look like a doubling, which is the oldest misleading
    // chart there is.
    const s = scaleFor([20, 40], true);
    expect(s.min).toBe(0);
    expect(s.norm(20)).toBeCloseTo(0.5, 5);
  });

  it("lets a line sit above zero, and says that it does", () => {
    // Forcing zero flattens a real movement between 1900 and 1990 into a
    // straight line. The flag is what lets the axis admit the crop.
    const s = scaleFor([1900, 1990], false);
    expect(s.min).toBe(1900);
    expect(s.zeroBased).toBe(false);
  });

  it("keeps negative values visible on a zero-based scale", () => {
    const s = scaleFor([-5, 10], true);
    expect(s.min).toBe(-5);
    expect(s.max).toBe(10);
  });

  it("does not divide by zero on a flat series", () => {
    // Every value 227. Without the guard the range is zero, every point is
    // NaN, and the path disappears from the document with no error — a blank
    // card that reads as "no data" when the truth is "nothing changed".
    const s = scaleFor([227, 227, 227], false);
    expect(Number.isFinite(s.norm(227))).toBe(true);
    expect(s.max).toBeGreaterThan(s.min);
  });

  it("handles a series that is flat at zero", () => {
    const s = scaleFor([0, 0], false);
    expect(Number.isFinite(s.norm(0))).toBe(true);
    expect(s.max).toBeGreaterThan(s.min);
  });

  it("survives an empty series", () => {
    expect(Number.isFinite(scaleFor([], false).norm(3))).toBe(true);
  });

  it("ignores a non-finite value rather than poisoning the range", () => {
    const s = scaleFor([10, NaN, 20], true);
    expect(s.max).toBe(20);
    expect(Number.isFinite(s.norm(10))).toBe(true);
  });
});

describe("axis ticks", () => {
  it("lands on round numbers", () => {
    // 0, 4713.4, 9426.8 is arithmetically correct and unreadable.
    const ticks = niceTicks(scaleFor([0, 18000], true));
    expect(ticks.every((t) => t % 1000 === 0)).toBe(true);
  });

  it("leaves no floating point dust on the axis", () => {
    for (const t of niceTicks(scaleFor([0, 1], true))) {
      expect(String(t)).not.toMatch(/00000|99999/);
    }
  });

  it("returns something for a flat scale rather than an empty axis", () => {
    expect(niceTicks(scaleFor([5, 5], false)).length).toBeGreaterThan(0);
  });

  it("stays inside the scale", () => {
    const s = scaleFor([3, 97], false);
    for (const t of niceTicks(s)) {
      expect(t).toBeGreaterThanOrEqual(s.min);
      expect(t).toBeLessThanOrEqual(s.max);
    }
  });
});

describe("placing a line", () => {
  const pts = [
    { label: "a", value: 10 },
    { label: "b", value: 20 },
    { label: "c", value: 30 },
  ];

  it("spans the plot from left to right", () => {
    const coords = linePoints(pts, scaleFor([10, 30], false), BOX);
    expect(coords[0]!.x).toBeCloseTo(40, 5);
    expect(coords[2]!.x).toBeCloseTo(390, 5);
  });

  it("puts the largest value at the top", () => {
    const coords = linePoints(pts, scaleFor([10, 30], false), BOX);
    expect(coords[2]!.y).toBeLessThan(coords[0]!.y);
  });

  it("places a single point instead of dividing by zero", () => {
    // n - 1 is zero here. Unguarded, x is NaN and the point is not drawn.
    const coords = linePoints([{ label: "a", value: 5 }], scaleFor([5], false), BOX);
    expect(Number.isFinite(coords[0]!.x)).toBe(true);
    expect(coords[0]!.x).toBeCloseTo(215, 5);
  });

  it("never writes NaN into path data", () => {
    // One NaN in a path attribute removes the whole element silently.
    const path = linePath(linePoints(pts, scaleFor([], false), BOX));
    expect(path).not.toMatch(/NaN/);
  });

  it("draws nothing when there is nothing", () => {
    expect(linePath([])).toBe("");
  });
});

describe("placing bars", () => {
  const pts = [
    { label: "CHUM", value: 51 },
    { label: "Verdun", value: 26 },
  ];

  it("makes length proportional to value", () => {
    const bars = barLayout(pts, scaleFor([51, 26], true), BOX);
    expect(bars[0]!.height / bars[1]!.height).toBeCloseTo(51 / 26, 1);
  });

  it("gives a zero a visible sliver rather than nothing at all", () => {
    // A hospital reporting zero and a hospital reporting nothing must not look
    // identical.
    const bars = barLayout([{ label: "x", value: 0 }], scaleFor([0, 10], true), BOX);
    expect(bars[0]!.height).toBeGreaterThan(0);
  });

  it("keeps bars inside the plot", () => {
    const bars = barLayout(pts, scaleFor([51, 26], true), BOX);
    for (const b of bars) {
      expect(b.x).toBeGreaterThanOrEqual(BOX.padLeft - 0.01);
      expect(b.x + b.width).toBeLessThanOrEqual(BOX.width - BOX.padRight + 0.01);
      expect(b.y).toBeGreaterThanOrEqual(BOX.padTop - 0.01);
    }
  });

  it("hangs a negative bar below the zero line", () => {
    const s = scaleFor([-10, 10], true);
    const bars = barLayout([{ label: "d", value: -10 }], s, BOX);
    const zeroY = BOX.padTop + (BOX.height - BOX.padTop - BOX.padBottom) * (1 - s.norm(0));
    expect(bars[0]!.y).toBeCloseTo(zeroY, 1);
  });

  it("draws nothing for no points", () => {
    expect(barLayout([], scaleFor([], true), BOX)).toEqual([]);
  });
});

describe("what a reader sees", () => {
  it("does not print a mean to fourteen decimals", () => {
    expect(formatValue(33.66666666666667)).toBe("33,7");
  });

  it("rounds a large number rather than pretending to precision", () => {
    expect(formatValue(1984.4)).toMatch(/1\s?984/);
  });

  it("says nothing rather than NaN", () => {
    expect(formatValue(NaN)).toBe("—");
  });

  it("marks a truncated label so it is not read as a full name", () => {
    const s = shortLabel("Hopital du Sacre-Coeur de Montreal");
    expect(s.endsWith("…")).toBe(true);
    expect(s.length).toBeLessThanOrEqual(14);
  });

  it("leaves a short label alone", () => {
    expect(shortLabel("CHUM")).toBe("CHUM");
  });

  it("thins ninety dates down to something readable", () => {
    // Ninety labels on one axis is a grey smear.
    const keep = thinLabels(90, 8);
    expect(keep.length).toBeLessThanOrEqual(10);
    expect(keep[0]).toBe(0);
    expect(keep[keep.length - 1]).toBe(89);
  });

  it("keeps every label when they fit", () => {
    expect(thinLabels(5, 8)).toEqual([0, 1, 2, 3, 4]);
  });
});
