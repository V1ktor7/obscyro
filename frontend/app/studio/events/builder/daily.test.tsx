// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SimEffect, SimEvent, SimExport } from "@/lib/platform-api";
import { dailySeries, seriesSummary } from "./daily";
import EventPreview from "./EventPreview";

afterEach(cleanup);

const POPS = [{ id: "pop:a", name: "Villeray", size: 100_000 }, { id: "pop:b", name: "Plateau", size: 200_000 }];

/** What the spreading model writes: one change per territory, severity and day. */
function spread(days: number): SimEffect[] {
  const out: SimEffect[] = [];
  for (let d = 0; d < days; d++)
    for (const p of POPS)
      for (const a of ["urgence", "hospitalisation"])
        out.push({ id: `${p.id}-${a}-${d}`, target: "demand.incidence", select: { acuity: [a], population: [p.id] }, op: "add", value: a === "urgence" ? 0.01 * (d + 1) : 0.005, profile: { start: d, end: d, shape: "step", peak: 1 } } as SimEffect);
  return out;
}

describe("day-by-day arrivals", () => {
  it("become one curve per severity, summed over the territories", () => {
    const capacity = { id: "cap", target: "resource.capacity", select: { activity: ["lit"] }, op: "add", value: 50, profile: { start: 14, end: null, shape: "step", peak: 1 } } as SimEffect;
    const { series, rest } = dailySeries([...spread(10), capacity], (id) => POPS.find((p) => p.id === id)!.size);
    expect(series.map((s) => s.acuity)).toEqual(["urgence", "hospitalisation"]);
    expect(rest).toEqual([capacity]);
    const urg = series[0]!;
    expect(urg).toMatchObject({ first: 0, last: 9, count: 20, pops: ["pop:a", "pop:b"] });
    // Day 9: 0.10 per 1,000 over 300,000 people.
    expect(urg.perDay[9]).toBeCloseTo(30);
    expect(seriesSummary(urg)).toMatchObject({ peakDay: 9 });
  });

  it("leaves a handful of changes as the sentences they are", () => {
    const { series, rest } = dailySeries(spread(1), () => 1000);
    expect(series).toHaveLength(0);
    expect(rest).toHaveLength(4);
  });

  it("reads in the preview as one line per severity, not one per day", () => {
    const snapshot = {
      environment: "t", scenario_id: null, generated_at: "", facilities: [], objects: [], object_types: [], edges: [], gaps: [],
      object_rules: { unavailable_keys: [], unavailable_values: [] },
      populations: POPS.map((p) => ({ id: p.id, name: p.name, size: p.size, served_by: [] })),
    } as unknown as SimExport;
    const event: SimEvent = { id: "e", name: "Outbreak", description: "", horizon: 60, effects: spread(60), twinScenarioId: null, createdAt: "", updatedAt: "" };
    render(<EventPreview snapshot={snapshot} event={event} onEdit={vi.fn()} />);
    expect(screen.getAllByText(/set day by day by a model/)).toHaveLength(2);
    expect(screen.getAllByText(/120 stored changes/)).toHaveLength(2);
  });
});
