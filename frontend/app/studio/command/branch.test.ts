import { describe, expect, it } from "vitest";

import {
  demandFactorOf,
  divergenceProblem,
  divergesAt,
  rulesFromStep,
  withDemandFactor,
  type StepPoint,
} from "./branch";

const RULES = [
  { id: "r1", trigger: { when: "every_tick", start: 0, end: null }, action: { kind: "transfer" } },
  { id: "r2", trigger: { when: "from_tick", start: 60, end: null }, action: { kind: "transfer" } },
  { id: "r3", trigger: { when: "between", start: 5, end: 80 }, action: { kind: "transfer" } },
  { id: "r4", action: { kind: "transfer" } },
];

describe("making a response start where the reader is looking", () => {
  it("moves a rule that would otherwise have fired from the beginning", () => {
    // Run unchanged from a scrubbed step, a standing rule applies from its own
    // start — and the two runs already differ before the point they were meant
    // to branch at, which answers a different question from the one asked.
    const out = rulesFromStep(RULES, 42);
    expect(out[0]!.trigger).toEqual({ when: "from_tick", start: 42, end: null });
  });

  it("leaves a rule that already starts later alone", () => {
    // The author said "not before day 60". A reader asking at day 42 has not
    // contradicted that.
    expect(rulesFromStep(RULES, 42)[1]!.trigger).toEqual({
      when: "from_tick",
      start: 60,
      end: null,
    });
  });

  it("keeps a window that still has room, moved forward", () => {
    expect(rulesFromStep(RULES, 42)[2]!.trigger).toEqual({
      when: "between",
      start: 42,
      end: 80,
    });
  });

  it("opens a window the branch would have closed", () => {
    // Days 5 to 20, asked at day 42: the window is behind the reader. Kept open
    // rather than left to never fire, which is the reading closest to what was
    // written and, unlike silence, visible in the result.
    const closed = [{ id: "x", trigger: { when: "between", start: 5, end: 20 } }];
    expect(rulesFromStep(closed, 42)[0]!.trigger).toEqual({
      when: "from_tick",
      start: 42,
      end: null,
    });
  });

  it("gives a rule with no trigger at all one", () => {
    expect(rulesFromStep(RULES, 42)[3]!.trigger).toEqual({
      when: "from_tick",
      start: 42,
      end: null,
    });
  });

  it("changes nothing else about the rule", () => {
    expect(rulesFromStep(RULES, 42)[0]!.id).toBe("r1");
    expect(rulesFromStep(RULES, 42)[0]!.action).toEqual({ kind: "transfer" });
  });

  it("leaves the rules it was given untouched", () => {
    // A branch is frozen once made; rewriting the response it came from would
    // change every branch that already used it.
    rulesFromStep(RULES, 42);
    expect(RULES[0]!.trigger).toEqual({ when: "every_tick", start: 0, end: null });
  });
});

function line(...waiting: number[]): StepPoint[] {
  return waiting.map((w, step) => ({ step, waiting: w, full: w > 100 ? 1 : 0 }));
}

describe("whether two runs can be laid over each other", () => {
  it("says nothing when they share their past", () => {
    const parent = line(0, 10, 40, 90, 200);
    const branch = line(0, 10, 40, 60, 80);
    expect(divergenceProblem(parent, branch, 3)).toBeNull();
  });

  it("refuses when the branch reached backwards", () => {
    // Either the engine stopped being deterministic or the branch touched the
    // past. Either way the difference on screen is not the one asked about.
    const parent = line(0, 10, 40, 90);
    const branch = line(0, 12, 40, 60);
    expect(divergenceProblem(parent, branch, 3)).toMatch(/changed step 1/);
  });

  it("refuses two runs of different lengths", () => {
    expect(divergenceProblem(line(0, 1, 2), line(0, 1), 2)).toMatch(/cannot be laid over/);
  });

  it("says nothing about an empty run rather than inventing a complaint", () => {
    expect(divergenceProblem([], line(0, 1), 2)).toBeNull();
  });
});

describe("where they part", () => {
  it("finds the first step that differs", () => {
    expect(divergesAt(line(0, 10, 40, 90), line(0, 10, 40, 60))).toBe(3);
  });

  it("returns nothing when the response changed nothing", () => {
    // A branch that never parts is a real answer — this response would not have
    // helped — and it has to read as that rather than as a failed run.
    expect(divergesAt(line(0, 10, 40), line(0, 10, 40))).toBeNull();
  });
});

describe("running a lever at another strength", () => {
  const rules = [
    { id: "d1", action: { kind: "modify_demand", population: "pop:a", factor: 0.96 } },
    { id: "d2", action: { kind: "modify_demand", population: "pop:b", factor: 0.96 } },
    { id: "t1", action: { kind: "transfer", source: "u1", target: "u2", amount: 5 } },
  ];

  it("moves every demand rule to the same strength", () => {
    // A package applies across catchments. Moving one and not the others makes
    // a lever that is stronger in Verdun than in Anjou for no reason anyone
    // could state.
    const out = withDemandFactor(rules, 0.9);
    expect((out[0]!.action as { factor: number }).factor).toBe(0.9);
    expect((out[1]!.action as { factor: number }).factor).toBe(0.9);
  });

  it("leaves an action that has no strength alone", () => {
    // A transfer moves the number of patients it says it moves. Scaling it
    // would invent a dimension the action does not have.
    expect(withDemandFactor(rules, 0.9)[2]).toBe(rules[2]);
  });

  it("does not touch the rules it was given", () => {
    withDemandFactor(rules, 0.5);
    expect((rules[0]!.action as { factor: number }).factor).toBe(0.96);
  });

  it("reads the strength a response was stored at", () => {
    expect(demandFactorOf(rules)).toBe(0.96);
  });

  it("says nothing for a response that changes no demand", () => {
    expect(demandFactorOf([rules[2]!])).toBeNull();
  });
});
