import { describe, expect, it } from "vitest";

import type { TwinReading, TwinUnitHistory } from "@/lib/platform-api";

import { BOX, historyView, windowLabel } from "./unit-history";

const AT = "2026-11-22T12:00:00.000Z";
const ago = (hours: number) => new Date(Date.parse(AT) - hours * 3_600_000).toISOString();
const reading = (hoursAgo: number, value: number | null): TwinReading => ({
  value,
  observedAt: value === null ? null : ago(hoursAgo),
  observedBasis: value === null ? null : "observed",
  recordedAt: ago(hoursAgo),
});
const history = (readings: TwinReading[], over: Partial<TwinUnitHistory> = {}): TwinUnitHistory => ({
  at: AT,
  unitId: "suroit",
  metric: "stretchers",
  hours: 48,
  since: readings.length ? readings[0]!.recordedAt : null,
  readings,
  cut: false,
  everySeconds: 300,
  ...over,
});
const pct = (v: number) => `${Math.round(v)}%`;
const points = (segment: string) => segment.split(" ").map((p) => p.split(",").map(Number) as [number, number]);

describe("what is said of a value's history", () => {
  it("gives the lowest and the highest in the words of the value above it", () => {
    const view = historyView(history([reading(40, 96), reading(20, 143), reading(2, 118)], { since: ago(400) }), pct);
    expect(view.lines).toEqual([
      "3 readings · lowest 96% · highest 143%",
      // Where the history starts is always said: nothing earlier was kept.
      "The first reading of this value was kept 17 d ago. Nothing earlier is known.",
      "Each value holds until the next reading. The twin is read every 5 min.",
    ]);
    expect([view.low, view.high, view.count]).toEqual([96, 143, 3]);
  });

  it("says that nothing was kept yet, which is not the same as nothing changed", () => {
    const view = historyView(history([]), pct);
    expect(view.lines).toEqual([
      "No reading of this value has been kept yet. The twin writes its measures down every 5 min: the history starts with the first one.",
    ]);
    expect(view.segments).toEqual([]);
    expect([view.low, view.high, view.count]).toEqual([null, null, 0]);
  });

  it("says when the window is empty although older readings exist", () => {
    const view = historyView(history([], { since: ago(900) }), pct);
    expect(view.lines[0]).toBe("No reading of this value was kept in the last 48 h.");
  });

  it("does not turn a single reading into a trend", () => {
    const view = historyView(history([reading(1, 143)]), pct);
    expect(view.lines).toEqual(["One reading so far: 143%.", "The first reading of this value was kept 1 h ago. Nothing earlier is known."]);
    // It holds until now: a flat line, at mid-height since there is nothing to scale against.
    expect(points(view.segments[0]!).map(([, y]) => y)).toEqual([BOX.height / 2, BOX.height / 2]);
  });

  it("says when the measure had no value at all, and when the list was cut", () => {
    expect(historyView(history([reading(30, null)]), pct).lines[0]).toBe("This measure had no value here over the last 48 h.");
    const cut = historyView(history([reading(3, 100), reading(1, 110)], { cut: true }), pct);
    expect(cut.lines).toContain("The window holds more readings than are drawn: the oldest are left out.");
  });

  it("names its window", () => {
    expect(windowLabel(48)).toBe("48 h");
    expect(windowLabel(24)).toBe("24 h");
    expect(windowLabel(168)).toBe("7 d");
  });
});

describe("the line drawn from the readings", () => {
  it("is a staircase: each value holds until the next reading, and the last one until now", () => {
    const view = historyView(history([reading(48, 100), reading(24, 140), reading(12, 120)]), pct);
    expect(view.segments).toHaveLength(1);
    const line = points(view.segments[0]!);
    const [left, right] = [BOX.pad, BOX.width - BOX.pad];
    const [top, bottom] = [BOX.pad, BOX.height - BOX.pad];
    const mid = (left + right) / 2;
    expect(line).toEqual([
      [left, bottom], // 100, the lowest, when the window opens
      [mid, bottom], // held for a day
      [mid, top], // then 140, the highest
      [(mid + right) / 2, top], // held for twelve hours
      [(mid + right) / 2, (top + bottom) / 2], // then 120
      [right, (top + bottom) / 2], // held until now
    ]);
  });

  it("breaks where the measure had no value: a gap is not a zero", () => {
    const view = historyView(history([reading(40, 100), reading(30, null), reading(10, 120)]), pct);
    expect(view.segments).toHaveLength(2);
    const [before, after] = view.segments.map(points);
    // The first stretch stops where the value was lost, at the level it had.
    expect(before![before!.length - 1]![1]).toBe(before![0]![1]);
    // Nothing joins the two stretches.
    expect(after![0]![0]).toBeGreaterThan(before![before!.length - 1]![0]);
    expect(view.count).toBe(2);
  });

  it("places a reading kept before the window at its left edge, and never draws backwards", () => {
    const view = historyView(
      history([
        reading(60, 100), // in force when the window opens
        // A source that dates this reading before the one kept just before it.
        { value: 130, observedAt: ago(70), observedBasis: "observed", recordedAt: ago(20) },
        reading(5, 110),
      ]),
      pct,
    );
    const xs = points(view.segments[0]!).map(([x]) => x);
    expect(xs[0]).toBe(BOX.pad);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(Math.max(...xs)).toBe(BOX.width - BOX.pad);
  });

  it("places a value its source does not date at the time it was written down", () => {
    const undated: TwinReading = { value: 12, observedAt: null, observedBasis: "undeclared", recordedAt: ago(24) };
    const view = historyView(history([undated, { ...undated, value: 15, recordedAt: ago(12) }]), pct);
    const xs = points(view.segments[0]!).map(([x]) => x);
    expect(xs[0]).toBe((BOX.pad + BOX.width - BOX.pad) / 2);
  });
});
