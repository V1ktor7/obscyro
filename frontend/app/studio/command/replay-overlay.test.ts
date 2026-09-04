import { describe, expect, it } from "vitest";

import { applyFrame, frameCoverage } from "./replay-overlay";
import type { TwinTreeSnapshot, TwinUnitNode } from "@/lib/platform-api";
import type { Frame } from "../events/replay-frames";

/**
 * Showing a replayed step where a live reading used to be.
 *
 * Every case here is a way the two could be confused on screen, which is the
 * only real risk in this feature: a number from a simulation and a number from
 * this morning look identical once they are in the same cell.
 */

const node = (id: string, occ: number | null): TwinUnitNode => ({
  id,
  name: id,
  kind: "Installation",
  code: id,
  parentId: null,
  metrics: {
    unitId: id,
    instanceCountByType: {},
    values: { occupancy: occ ?? 0, beds: 30 },
    occupancyPct: occ,
    numericMeans: { x: 1 },
    freshnessSeconds: 120,
    linkedInstanceCount: 4,
  },
  worstAlertSeverity: "critical",
  openAlertCount: 3,
});

const snap = (): TwinTreeSnapshot => ({
  computedAt: "2026-09-04T00:00:00.000Z",
  nodes: [node("a", 41), node("b", 88), node("c", 12)],
  edges: [],
  roots: ["a"],
});

const frame = (): Frame => ({
  step: 42,
  waiting: 1984,
  full: 1,
  facilities: [
    { id: "a", name: "a", worst: 0.973, activity: "urgence", waiting: 210 },
    { id: "b", name: "b", worst: 0.42, activity: "urgence", waiting: 0 },
  ],
});

describe("laying a replayed step over the units view", () => {
  it("returns the live snapshot untouched when nothing is being replayed", () => {
    const s = snap();
    expect(applyFrame(s, null)).toBe(s);
  });

  it("survives having no snapshot yet", () => {
    expect(applyFrame(null, frame())).toBeNull();
  });

  it("writes the replayed occupancy in place of the live one", () => {
    const out = applyFrame(snap(), frame())!;
    expect(out.nodes.find((n) => n.id === "a")!.metrics.occupancyPct).toBe(97.3);
  });

  it("carries the waiting count through, since that is what a replay is about", () => {
    const out = applyFrame(snap(), frame())!;
    expect(out.nodes.find((n) => n.id === "a")!.metrics.values.waiting).toBe(210);
  });

  it("blanks a unit the run never touched rather than leaving this morning's figure", () => {
    // The dangerous case: a real 12% sitting beside a simulated 97% on one
    // screen, with nothing saying they come from different worlds.
    const out = applyFrame(snap(), frame())!;
    expect(out.nodes.find((n) => n.id === "c")!.metrics.occupancyPct).toBeNull();
  });

  it("clears alerts, which belong to the live network and not to a replay", () => {
    const out = applyFrame(snap(), frame())!;
    for (const n of out.nodes) {
      expect(n.openAlertCount).toBe(0);
      expect(n.worstAlertSeverity).toBeNull();
    }
  });

  it("clears freshness, because a replayed step was not updated three minutes ago", () => {
    const out = applyFrame(snap(), frame())!;
    for (const n of out.nodes) expect(n.metrics.freshnessSeconds).toBeNull();
  });

  it("leaves the live snapshot object alone", () => {
    const s = snap();
    applyFrame(s, frame());
    expect(s.nodes[0]!.metrics.occupancyPct).toBe(41);
    expect(s.nodes[0]!.openAlertCount).toBe(3);
  });

  it("keeps every unit, so the network does not appear to shrink mid-replay", () => {
    expect(applyFrame(snap(), frame())!.nodes).toHaveLength(3);
  });
});

describe("how much of the network a step covers", () => {
  it("counts the units the run actually reached", () => {
    expect(frameCoverage(snap(), frame())).toEqual({ covered: 2, total: 3 });
  });

  it("reports full coverage when nothing is being replayed", () => {
    expect(frameCoverage(snap(), null)).toEqual({ covered: 3, total: 3 });
  });

  it("says nothing rather than guessing without a snapshot", () => {
    expect(frameCoverage(null, frame())).toEqual({ covered: 0, total: 0 });
  });
});
