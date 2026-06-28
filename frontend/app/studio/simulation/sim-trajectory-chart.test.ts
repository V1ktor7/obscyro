import { describe, expect, it } from "vitest";

import {
  buildBandPolygon,
  buildChartScales,
  buildLinePath,
} from "./TrajectoryChart";
import type { DailyTrajectory } from "../sim-api";

const sample = (days: number, fn: (d: number) => number): DailyTrajectory[] =>
  Array.from({ length: days }, (_, i) => ({
    day: i,
    S: 10,
    E: 0,
    I: fn(i),
    R: 0,
    isolationDemand: 0,
  }));

describe("TrajectoryChart helpers", () => {
  const p5 = sample(5, (d) => d);
  const p50 = sample(5, (d) => d * 2);
  const p95 = sample(5, (d) => d * 3);

  it("buildChartScales sets y max from infected values", () => {
    const scales = buildChartScales(p5, p50, p95);
    expect(scales.minY).toBe(0);
    expect(scales.maxY).toBe(12);
    expect(scales.maxDay).toBe(4);
  });

  it("buildLinePath produces an SVG path for p50", () => {
    const scales = buildChartScales(p5, p50, p95);
    const path = buildLinePath(scales, p50);
    expect(path).toMatch(/^M /);
    expect(path.split("L").length).toBe(5);
  });

  it("buildBandPolygon closes upper and lower bounds", () => {
    const scales = buildChartScales(p5, p50, p95);
    const poly = buildBandPolygon(scales, p5, p95);
    const points = poly.split(",");
    expect(points.length).toBeGreaterThanOrEqual(8);
  });
});
