import { describe, expect, it } from "vitest";

import type { Comparison } from "../analyst-api";
import { seriesLane } from "./series-lane";

// A window of ten days, drawn in a box 100 wide and 50 high: a day is 10 across.
const DAY = 86_400_000;
const START = new Date("2022-01-01T00:00:00").getTime();
const END = START + 10 * DAY;
const BOX = { x0: 0, x1: 100, y0: 0, y1: 50 };
const at = (day: number) => new Date(START + day * DAY).toISOString();
const reading = (day: number, value: number | null, observed = true) => ({ observedAt: observed ? at(day) : null, recordedAt: at(day + 0.01), value });
const event = (ref: string, startsOn: string | null, over: Partial<Comparison> = {}): Comparison => ({
  ref,
  from: "candidate",
  title: ref,
  startsOn,
  endsOn: null,
  episode: null,
  leadDays: null,
  before: null,
  after: null,
  delta: null,
  doubts: [],
  ...over,
});
const lane = (over: Partial<Parameters<typeof seriesLane>[0]> = {}) =>
  seriesLane({ readings: [reading(1, 90), reading(4, 120), reading(7, 100)], start: START, end: END, box: BOX, threshold: null, episodes: [], events: [], ...over });

describe("the series on the timeline", () => {
  it("is a staircase: each value holds until the next reading, and the last one until now", () => {
    const l = lane();
    expect(l.low).toBe(90);
    expect(l.high).toBe(120);
    // 90 at the bottom, 120 at the top; a step is drawn flat, then up or down.
    expect(l.segments).toEqual(["10.0,50.0 40.0,50.0 40.0,0.0 70.0,0.0 70.0,33.3 100.0,33.3"]);
  });

  it("breaks the line where the measure had no value: a gap is not a zero", () => {
    const l = lane({ readings: [reading(1, 90), reading(3, null), reading(6, 120)] });
    expect(l.segments).toEqual(["10.0,50.0 30.0,50.0", "60.0,0.0 100.0,0.0"]);
    expect(l.low).toBe(90);
  });

  it("stands a reading where its source dates it, and where it was written down when the source does not say", () => {
    const l = lane({ readings: [reading(2, 90, false), reading(5, 90)] });
    expect(l.segments[0]!.startsWith("20.1,")).toBe(true);
  });

  it("draws a single value as a flat line, and nothing when nothing was read", () => {
    expect(lane({ readings: [reading(5, 100)] }).segments).toEqual(["50.0,25.0 100.0,25.0"]);
    const none = lane({ readings: [] });
    expect(none.segments).toEqual([]);
    expect([none.low, none.high, none.thresholdY]).toEqual([null, null, null]);
  });
});

describe("the alert threshold on the timeline", () => {
  it("shares the scale with the series when it is near what was read", () => {
    const l = lane({ threshold: 100 });
    // 90 to 120: 100 sits a third of the way up.
    expect(l.thresholdY).toBeCloseTo(33.33, 1);
    const above = lane({ threshold: 130 });
    expect(above.thresholdY).toBe(0);
    expect(above.segments[0]!.startsWith("10.0,50.0")).toBe(true);
  });

  it("is left out when it is far from what was read, instead of flattening the series", () => {
    const l = lane({ readings: [reading(1, 20), reading(4, 30)], threshold: 100 });
    expect(l.thresholdY).toBeNull();
    expect(l.segments).toEqual(["10.0,50.0 40.0,50.0 40.0,0.0 100.0,0.0"]);
  });
});

describe("what an investigation found, on the timeline", () => {
  it("draws the episodes it counted as bands, an open one running to now", () => {
    const l = lane({
      episodes: [
        { id: "e1", startsAt: at(4), endsAt: at(6) },
        { id: "e2", startsAt: at(8), endsAt: null },
        // Over before the window began: not drawn.
        { id: "e0", startsAt: at(-5), endsAt: at(-3) },
      ],
    });
    expect(l.bands).toEqual([
      { id: "e1", x: 40, width: 20 },
      { id: "e2", x: 80, width: 20 },
    ]);
  });

  it("marks each event at the day its source dates it, and says how it sits beside the series", () => {
    const l = lane({
      events: [
        event("c1", "2022-01-03", { episode: "e1", leadDays: 1 }),
        event("h:ev1", "2022-01-06", { from: "calendar", episode: "e1", leadDays: -2, doubts: [{ kind: "starts_after", days: 2 }] }),
        event("c2", "2022-01-09"),
      ],
    });
    expect(l.marks.map((m) => [m.ref, m.x, m.from, m.pairing])).toEqual([
      ["c1", 20, "candidate", "before"],
      ["h:ev1", 50, "calendar", "inside"],
      ["c2", 80, "candidate", "none"],
    ]);
    expect(l.marksOutside).toBe(0);
  });

  it("leaves out an event with no date, and counts those dated outside the window", () => {
    const l = lane({ events: [event("undated", null, { doubts: [{ kind: "no_date" }] }), event("old", "2021-12-01"), event("later", "2022-02-01"), event("in", "2022-01-05")] });
    expect(l.marks.map((m) => m.ref)).toEqual(["in"]);
    expect(l.marksOutside).toBe(2);
  });
});
