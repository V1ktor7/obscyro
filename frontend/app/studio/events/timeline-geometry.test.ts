import { describe, expect, it } from "vitest";

import type { TemporalProfile } from "@/lib/platform-api";
import {
  applyDrag,
  overlapWindow,
  shapePoints,
  stepAt,
  trackOf,
} from "./timeline-geometry";

function profile(over: Partial<TemporalProfile> = {}): TemporalProfile {
  return { start: 10, end: 20, shape: "step", peak: 1, ...over };
}

const H = 60;

describe("trackOf", () => {
  it("places a bar as a fraction of the horizon", () => {
    const t = trackOf(profile(), H);
    expect(t.left).toBeCloseTo(10 / 60);
    expect(t.width).toBeCloseTo(10 / 60);
  });

  it("draws an open-ended effect out to the horizon", () => {
    expect(trackOf(profile({ end: null }), H).width).toBeCloseTo(50 / 60);
  });

  it("keeps a pulse wide enough to grab", () => {
    // A zero-width bar cannot be hit with a pointer, and a pulse is exactly the
    // effect someone would most want to drag.
    expect(trackOf(profile({ start: 5, end: 5 }), H).width).toBeGreaterThan(0);
  });

  it("never draws past the right edge", () => {
    const t = trackOf(profile({ start: 58, end: null }), H);
    expect(t.left + t.width).toBeLessThanOrEqual(1.0001);
  });
});

describe("stepAt", () => {
  it("maps a pointer offset to a step", () => {
    expect(stepAt(0, 600, H)).toBe(0);
    expect(stepAt(300, 600, H)).toBe(30);
    expect(stepAt(600, 600, H)).toBe(60);
  });

  it("clamps outside the track rather than returning a negative step", () => {
    expect(stepAt(-50, 600, H)).toBe(0);
    expect(stepAt(900, 600, H)).toBe(60);
  });
});

describe("applyDrag", () => {
  it("moves only the start when the left edge is dragged", () => {
    const p = applyDrag(profile(), "start", 4, H);
    expect(p.start).toBe(4);
    expect(p.end).toBe(20);
  });

  it("moves only the end when the right edge is dragged", () => {
    const p = applyDrag(profile(), "end", 44, H);
    expect(p.start).toBe(10);
    expect(p.end).toBe(44);
  });

  it("clamps an edge at its opposite instead of inverting the window", () => {
    // Swapping would silently turn "shorten this" into "invert this", and a
    // reversed window is exactly the inert-effect bug the composer warns about.
    expect(applyDrag(profile(), "start", 50, H).start).toBe(20);
    expect(applyDrag(profile(), "end", 2, H).end).toBe(10);
  });

  it("preserves duration when the body is dragged", () => {
    const p = applyDrag(profile(), "body", 30, H);
    expect(p.start).toBe(30);
    expect(p.end).toBe(40);
  });

  it("does not push a dragged body past the horizon", () => {
    const p = applyDrag(profile(), "body", 58, H);
    expect(p.end).toBe(H);
    expect((p.end as number) - p.start).toBe(10);
  });

  it("keeps an open-ended effect open when its end is dragged to the edge", () => {
    // Pinning it silently would turn "and it is still going" into "it stops
    // exactly when we stopped looking", which are different claims.
    const p = applyDrag(profile({ end: null }), "end", H, H);
    expect(p.end).toBeNull();
  });

  it("closes an open-ended effect when its end is dragged inside", () => {
    expect(applyDrag(profile({ end: null }), "end", 35, H).end).toBe(35);
  });

  it("keeps an open-ended body drag open-ended", () => {
    expect(applyDrag(profile({ end: null }), "body", 25, H).end).toBeNull();
  });
});

describe("shapePoints", () => {
  it("draws a step flat at its peak", () => {
    const pts = shapePoints("step", 0.8);
    expect(pts.every((p) => p.y === 0.8)).toBe(true);
  });

  it("draws a ramp rising to its peak", () => {
    const pts = shapePoints("ramp", 1);
    expect(pts[0]!.y).toBe(0);
    expect(pts[pts.length - 1]!.y).toBeCloseTo(1);
  });

  it("draws a pulse as a single spike", () => {
    const pts = shapePoints("pulse", 1);
    expect(pts[0]!.y).toBe(1);
    expect(pts.slice(1).every((p) => p.y === 0)).toBe(true);
  });

  it("draws a gaussian peaking in the middle", () => {
    const pts = shapePoints("gaussian", 1);
    const mid = pts[Math.floor(pts.length / 2)]!;
    expect(mid.y).toBeGreaterThan(pts[0]!.y);
    expect(mid.y).toBeGreaterThan(pts[pts.length - 1]!.y);
  });
});

describe("overlapWindow", () => {
  it("reports the steps two effects share", () => {
    expect(overlapWindow(profile(), profile({ start: 15, end: 30 }), H)).toEqual({
      from: 15,
      to: 20,
    });
  });

  it("returns nothing when they never meet", () => {
    expect(overlapWindow(profile(), profile({ start: 30, end: 40 }), H)).toBeNull();
  });

  it("counts a shared endpoint as an overlap", () => {
    // Both are active on that step, so the composition rule applies there.
    expect(overlapWindow(profile(), profile({ start: 20, end: 30 }), H)).toEqual({
      from: 20,
      to: 20,
    });
  });

  it("treats an open end as reaching the horizon", () => {
    expect(overlapWindow(profile({ end: null }), profile({ start: 55, end: 58 }), H)).toEqual({
      from: 55,
      to: 58,
    });
  });
});
