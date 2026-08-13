import { describe, expect, it } from "vitest";

import type { CapacityEffect, ConnectivityEffect, DemandEffect } from "@/lib/platform-api";
import {
  blankEffect,
  describeEffect,
  eventProblems,
  inertReasons,
} from "./event-effects";

const FACILITIES = [
  { id: "u1", name: "Emergency" },
  { id: "u2", name: "Medicine" },
];
const POPULATIONS = [{ id: "pop:s1", name: "Notre-Dame" }];

function demand(over: Partial<DemandEffect> = {}): DemandEffect {
  return {
    ...(blankEffect("demand", 30, 1) as DemandEffect),
    targets: ["pop:s1"],
    volume: 40,
    ...over,
  };
}

function capacity(over: Partial<CapacityEffect> = {}): CapacityEffect {
  return {
    ...(blankEffect("capacity", 30, 1) as CapacityEffect),
    facilities: ["u1"],
    category: "space",
    multiplier: 0.4,
    ...over,
  };
}

describe("describeEffect", () => {
  it("says a multiplier as the direction it moves, not as the number", () => {
    // Reading "0.4" as "drops to 40%" vs "drops by 40%" inverts the severity of
    // the event, and the field alone cannot tell you which it meant.
    expect(describeEffect(capacity(), FACILITIES, POPULATIONS)).toContain("drops by 60%");
    expect(describeEffect(capacity({ multiplier: 1.4 }), FACILITIES, POPULATIONS)).toContain(
      "grows by 40%",
    );
  });

  it("names an opening wing as growth, not as a lesser disaster", () => {
    const s = describeEffect(capacity({ multiplier: 1.5 }), FACILITIES, POPULATIONS);
    expect(s).toContain("Emergency");
    expect(s).not.toContain("drops");
  });

  it("reads negative demand as prevention", () => {
    const s = describeEffect(demand({ volume: -25 }), FACILITIES, POPULATIONS);
    expect(s).toContain("25 fewer patients");
  });

  it("admits when an effect does nothing rather than describing it anyway", () => {
    expect(describeEffect(demand({ volume: 0 }), FACILITIES, POPULATIONS)).toMatch(/^Nothing/);
    expect(describeEffect(capacity({ multiplier: 1 }), FACILITIES, POPULATIONS)).toMatch(
      /^Nothing/,
    );
  });

  it("falls back to an id fragment when a target is not in the twin", () => {
    // A stale id must still render — the composer has to be able to show you
    // the thing that is wrong.
    const s = describeEffect(capacity({ facilities: ["deadbeef-0000"] }), FACILITIES, POPULATIONS);
    expect(s).toContain("deadbeef");
  });

  it("describes a cut route as cut", () => {
    const e: ConnectivityEffect = {
      ...(blankEffect("connectivity", 30, 1) as ConnectivityEffect),
      edges: [["u1", "u2"]],
      multiplier: 0,
    };
    expect(describeEffect(e, FACILITIES, POPULATIONS)).toContain("Emergency → Medicine is cut");
  });
});

describe("inertReasons", () => {
  it("catches an effect that starts after the run ends", () => {
    const e = demand({ profile: { start: 40, end: 50, shape: "step", peak: 1 } });
    expect(inertReasons(e, 30).join(" ")).toContain("after the run ends");
  });

  it("catches a window that ends before it starts", () => {
    const e = demand({ profile: { start: 10, end: 4, shape: "step", peak: 1 } });
    expect(inertReasons(e, 30).join(" ")).toContain("before it starts");
  });

  it("catches a capacity effect that multiplies by one", () => {
    expect(inertReasons(capacity({ multiplier: 1 }), 30).join(" ")).toContain("changes nothing");
  });

  it("does not complain about an absolute of zero", () => {
    // Setting capacity to 0 is the most severe effect available; treating it as
    // "no value" would silently drop the flooded building from the event.
    const e = capacity({ absolute: 0, multiplier: null });
    expect(inertReasons(e, 30)).toEqual([]);
  });

  it("accepts an open-ended window", () => {
    const e = demand({ profile: { start: 2, end: null, shape: "step", peak: 1 } });
    expect(inertReasons(e, 30)).toEqual([]);
  });
});

describe("eventProblems", () => {
  it("rejects an event with no effects", () => {
    expect(eventProblems([], 30)[0]).toContain("no effects");
  });

  it("rejects two effects sharing an id", () => {
    const a = demand({ id: "same" });
    const b = capacity({ id: "same" });
    expect(eventProblems([a, b], 30).join(" ")).toContain("both called");
  });

  it("passes a well-formed event", () => {
    expect(eventProblems([demand(), capacity()], 30)).toEqual([]);
  });
});
