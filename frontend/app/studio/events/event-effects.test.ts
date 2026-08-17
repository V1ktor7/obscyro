import { describe, expect, it } from "vitest";

import type { SimEffect, SimTarget } from "@/lib/platform-api";
import {
  blankEffect,
  describeEffect,
  eventProblems,
  inertReasons,
  type Vocabulary,
} from "./event-effects";

const CAPACITY: SimTarget = {
  path: "resource.capacity",
  label: "Capacity of a resource",
  help: "",
  selector: ["facility", "category", "activity"],
  ops: ["multiply", "set", "add"],
  compose: "baseline",
  minimum: 0,
  maximum: null,
  unit: "units",
};

const STAY: SimTarget = {
  path: "care.stay_ticks",
  label: "Length of stay",
  help: "",
  selector: ["acuity"],
  ops: ["multiply", "add", "set"],
  compose: "baseline",
  minimum: 1,
  maximum: null,
  unit: "steps",
};

const DEMAND: SimTarget = {
  path: "demand.volume",
  label: "Patients arriving",
  help: "",
  selector: ["population", "acuity"],
  ops: ["add"],
  compose: "accumulate",
  minimum: null,
  maximum: null,
  unit: "patients/step",
};

const TARGETS = [CAPACITY, STAY, DEMAND];

const VOCAB: Vocabulary = {
  facility: [
    { id: "u1", name: "Emergency" },
    { id: "u2", name: "Medicine" },
  ],
  population: [{ id: "pop:s1", name: "Notre-Dame" }],
  acuity: [
    { id: "critical", name: "Critical" },
    { id: "routine", name: "Routine" },
  ],
};

function effect(over: Partial<SimEffect> = {}): SimEffect {
  return { ...blankEffect(CAPACITY, 30, 1), ...over };
}

describe("blankEffect", () => {
  it("is inert until it is given a number", () => {
    // A new row that already halved something would be a silent edit to an
    // event someone was only exploring.
    expect(blankEffect(CAPACITY, 30, 1).value).toBe(1);
    expect(blankEffect(DEMAND, 30, 1).value).toBe(0);
  });

  it("picks an operation the quantity actually accepts", () => {
    expect(DEMAND.ops).toContain(blankEffect(DEMAND, 30, 1).op);
  });
});

describe("describeEffect", () => {
  it("says a multiplier as the direction it moves, not as the number", () => {
    // "0.4" reads as both "drops to 40%" and "drops by 40%", and the two are
    // opposite severities.
    const s = describeEffect(effect({ op: "multiply", value: 0.4 }), CAPACITY, VOCAB);
    expect(s).toContain("drops by 60%");
  });

  it("names growth as growth rather than a lesser disaster", () => {
    const s = describeEffect(effect({ op: "multiply", value: 1.5 }), CAPACITY, VOCAB);
    expect(s).toContain("grows by 50%");
    expect(s).not.toContain("drops");
  });

  it("reads a negative addition as a reduction", () => {
    const e = effect({ target: DEMAND.path, op: "add", value: -25 });
    expect(describeEffect(e, DEMAND, VOCAB)).toContain("falls by 25");
  });

  it("admits when an effect does nothing rather than describing it anyway", () => {
    expect(describeEffect(effect({ op: "multiply", value: 1 }), CAPACITY, VOCAB)).toMatch(
      /^Nothing/,
    );
    expect(
      describeEffect(effect({ target: DEMAND.path, op: "add", value: 0 }), DEMAND, VOCAB),
    ).toMatch(/^Nothing/);
  });

  it("names the selected facilities", () => {
    const e = effect({ op: "set", value: 0, select: { facility: ["u1"] } });
    expect(describeEffect(e, CAPACITY, VOCAB)).toContain("Emergency");
  });

  it("says 'every facility' when nothing is selected", () => {
    // Silence here would read as a narrow effect. An unfiltered capacity change
    // hits the whole network, which is a decision worth seeing.
    expect(describeEffect(effect({ op: "set", value: 0 }), CAPACITY, VOCAB)).toContain(
      "every facility",
    );
  });

  it("falls back to an id fragment when a target is not in the twin", () => {
    const e = effect({ op: "set", value: 0, select: { facility: ["deadbeef-0000"] } });
    expect(describeEffect(e, CAPACITY, VOCAB)).toContain("deadbeef");
  });

  it("refuses to describe a quantity the engine does not have", () => {
    const e = effect({ target: "staff.morale" });
    expect(describeEffect(e, undefined, VOCAB)).toContain("cannot run");
  });
});

describe("inertReasons", () => {
  it("catches an effect that starts after the run ends", () => {
    const e = effect({ profile: { start: 40, end: 50, shape: "step", peak: 1 } });
    expect(inertReasons(e, CAPACITY, 30).join(" ")).toContain("after the run ends");
  });

  it("catches a window that ends before it starts", () => {
    const e = effect({ profile: { start: 10, end: 4, shape: "step", peak: 1 } });
    expect(inertReasons(e, CAPACITY, 30).join(" ")).toContain("before it starts");
  });

  it("catches a multiplier of one", () => {
    expect(inertReasons(effect({ op: "multiply", value: 1 }), CAPACITY, 30).join(" ")).toContain(
      "changes nothing",
    );
  });

  it("catches an operation the quantity rejects", () => {
    // A queue has no prior value to multiply; offering it would read as
    // "halve the wave" and do nothing.
    const e = effect({ target: DEMAND.path, op: "multiply", value: 0.5 });
    expect(inertReasons(e, DEMAND, 30).join(" ")).toContain("cannot be changed by multiply");
  });

  it("catches a filter the quantity does not have", () => {
    // Narrowing length of stay by facility looks reasonable and does nothing:
    // the care model is global.
    const e = effect({ target: STAY.path, op: "add", value: 2, select: { facility: ["u1"] } });
    expect(inertReasons(e, STAY, 30).join(" ")).toContain("does not have");
  });

  it("does not complain about setting a value to zero", () => {
    // Setting capacity to 0 is the most severe effect available; treating it as
    // "no value" would silently drop the flooded building from the event.
    expect(inertReasons(effect({ op: "set", value: 0 }), CAPACITY, 30)).toEqual([]);
  });

  it("accepts an open-ended window", () => {
    const e = effect({ op: "set", value: 0, profile: { start: 2, end: null, shape: "step", peak: 1 } });
    expect(inertReasons(e, CAPACITY, 30)).toEqual([]);
  });
});

describe("eventProblems", () => {
  function setCap(id: string, value: number, over: Partial<SimEffect> = {}): SimEffect {
    return effect({ id, op: "set", value, ...over });
  }

  it("catches two effects that set the same thing to different values", () => {
    // The engine resolves this by id — deterministic, but arbitrary. It is an
    // event saying two contradictory things and one being discarded silently,
    // which nothing downstream can recover.
    const problems = eventProblems([setCap("flood", 0), setCap("closure", 12)], TARGETS, 30);
    expect(problems.join(" ")).toContain("cannot tell which you meant");
  });

  it("allows two sets that never meet in time", () => {
    const early = setCap("early", 0, { profile: { start: 0, end: 5, shape: "step", peak: 1 } });
    const late = setCap("late", 12, { profile: { start: 6, end: 20, shape: "step", peak: 1 } });
    expect(eventProblems([early, late], TARGETS, 30)).toEqual([]);
  });

  it("allows two sets aimed at different facilities", () => {
    const a = setCap("north", 0, { select: { facility: ["u1"] } });
    const b = setCap("south", 12, { select: { facility: ["u2"] } });
    expect(eventProblems([a, b], TARGETS, 30)).toEqual([]);
  });

  it("still warns when one of them targets everything", () => {
    // An unfiltered effect covers the filtered one, so they do contradict —
    // and this is the case an author is least likely to spot.
    const everywhere = setCap("blackout", 0);
    const oneWard = setCap("ward", 12, { select: { facility: ["u1"] } });
    expect(eventProblems([everywhere, oneWard], TARGETS, 30).join(" ")).toContain(
      "cannot tell which you meant",
    );
  });

  it("does not warn when both set the same value", () => {
    expect(eventProblems([setCap("a", 0), setCap("b", 0)], TARGETS, 30)).toEqual([]);
  });

  it("rejects an event with no effects", () => {
    expect(eventProblems([], TARGETS, 30)[0]).toContain("no effects");
  });

  it("rejects two effects sharing an id", () => {
    const a = effect({ id: "same", op: "set", value: 0 });
    const b = effect({ id: "same", op: "set", value: 1 });
    expect(eventProblems([a, b], TARGETS, 30).join(" ")).toContain("both called");
  });

  it("passes a well-formed event", () => {
    const a = effect({ id: "flood", op: "set", value: 0, select: { facility: ["u1"] } });
    const b = effect({
      id: "lingering",
      target: STAY.path,
      op: "add",
      value: 2,
      select: { acuity: ["critical"] },
    });
    expect(eventProblems([a, b], TARGETS, 30)).toEqual([]);
  });
});
