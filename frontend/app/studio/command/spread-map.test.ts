import { describe, expect, it } from "vitest";

import type { SpreadState } from "@/lib/platform-api";

import { leaders, paintFor, shapeIdOf, waveFrames } from "./spread-map";

function s(tick: number, population: string, malade: number, inc: number): SpreadState {
  return {
    tick,
    population,
    states: { malade, sain: 1000 - malade },
    incidence: inc > 0 ? { urgence: inc * 0.8, hospitalisation: inc * 0.2 } : {},
  };
}

const RUN: SpreadState[] = [
  s(0, "pop:a", 5, 1),
  s(0, "pop:b", 0, 0),
  s(1, "pop:a", 40, 12),
  s(1, "pop:b", 2, 1),
  s(2, "pop:a", 100, 30),
  s(2, "pop:b", 20, 8),
];

describe("turning a run into frames", () => {
  it("scales the whole run against its peak, not each step against its own", () => {
    // Per-step normalising is the version that writes itself, and it destroys
    // the only thing the animation exists to show: every frame comes out
    // equally deep and the wave stops rising.
    const { frames, peak } = waveFrames(RUN, { kind: "state", name: "malade" });
    expect(peak).toBe(100);
    expect(frames[0]!.get("pop:a")).toBe(0.05);
    expect(frames[2]!.get("pop:a")).toBe(1);
  });

  it("reads the flow when asked for the flow", () => {
    // Stock and flow answer different questions: how much of the territory is
    // affected now, against how fast it is getting worse.
    const { frames, peak } = waveFrames(RUN, { kind: "incidence" });
    expect(peak).toBeCloseTo(30, 6);
    expect(frames[1]!.get("pop:a")).toBeCloseTo(12 / 30, 6);
  });

  it("leaves a run that never moved uncoloured rather than dividing by zero", () => {
    const flat = [s(0, "pop:a", 0, 0), s(1, "pop:a", 0, 0)];
    const { frames, peak } = waveFrames(flat, { kind: "incidence" });
    expect(peak).toBe(0);
    expect(frames[0]!.get("pop:a")).toBe(0);
  });

  it("keeps a step nobody reported as an empty frame, not a hole", () => {
    // The player indexes frames by step. A missing tick would shift every
    // frame after it and show the wrong day's map under the right day's label.
    const { frames } = waveFrames([s(0, "pop:a", 1, 1), s(2, "pop:a", 9, 9)], {
      kind: "state",
      name: "malade",
    });
    expect(frames).toHaveLength(3);
    expect(frames[1]!.size).toBe(0);
  });

  it("reads a state nobody declared as absent rather than as an error", () => {
    const { peak } = waveFrames(RUN, { kind: "state", name: "immunise" });
    expect(peak).toBe(0);
  });
});

describe("joining a catchment to the shape it was built from", () => {
  it("knows the prefix the export puts on a population id", () => {
    expect(shapeIdOf("pop:9f3e")).toBe("9f3e");
    expect(shapeIdOf("9f3e")).toBe("9f3e");
  });

  it("says which catchments the map cannot draw", () => {
    // A twin whose catchments are not the objects carrying the boundaries
    // paints a blank map, and a blank map reads as "the wave never arrived".
    const { byShape, unmatched } = paintFor(
      new Map([
        ["pop:a", 0.5],
        ["pop:zz", 0.9],
      ]),
      new Set(["a"]),
    );
    expect(byShape.get("a")).toBe(0.5);
    expect(unmatched).toEqual(["pop:zz"]);
  });
});

describe("the list beside the map", () => {
  const { frames, values } = waveFrames(RUN, { kind: "state", name: "malade" });

  it("names the worst territories at this step, worst first", () => {
    const top = leaders(frames[2]!, values[2]!, (id) => id.toUpperCase());
    expect(top.map((t) => t.name)).toEqual(["POP:A", "POP:B"]);
    expect(top[0]!.value).toBe(100);
  });

  it("leaves out a territory the wave has not reached", () => {
    // Zero is not a small amount of something, and listing it as a leader
    // reads as a place with a little of the wave rather than none.
    expect(leaders(frames[0]!, values[0]!, (id) => id)).toHaveLength(1);
  });
});
