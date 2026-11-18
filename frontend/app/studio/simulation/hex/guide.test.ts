import { describe, expect, it } from "vitest";

import { currentStep, guideMeta, guideSteps, type GuideInput } from "./guide";

const base: GuideInput = { conditions: 0, events: 0, choices: 0, hasRun: false, stale: false, running: false, analystSeen: false };
const states = (g: Partial<GuideInput>) => guideSteps({ ...base, ...g }).map((s) => s.state);

describe("the three steps of the Scenarios page", () => {
  it("starts on the first step, with the other two waiting", () => {
    expect(states({})).toEqual(["now", "later", "later"]);
    const steps = guideSteps(base);
    expect(currentStep(steps)).toBe(1);
    expect(guideMeta(steps)).toBe("step 1 of 3: say what happens");
    expect(steps[0]!.detail).toMatch(/Set where the network starts/);
  });

  it("does not count conditions alone as something to run", () => {
    expect(states({ conditions: 3 })).toEqual(["now", "later", "later"]);
    expect(guideSteps({ ...base, conditions: 3 })[0]!.detail).toMatch(/3 starting conditions set\. Now add what happens/);
  });

  it("moves to Run once something happens, and says what the scenario holds", () => {
    const steps = guideSteps({ ...base, conditions: 3, events: 12, choices: 5 });
    expect(steps.map((s) => s.state)).toEqual(["done", "now", "later"]);
    expect(steps[0]!.detail).toBe("12 events, 3 starting conditions, 5 choices");
    expect(guideSteps({ ...base, events: 1 })[0]!.detail).toBe("1 event");
  });

  it("moves to the analyst once the run is on screen", () => {
    const steps = guideSteps({ ...base, events: 1, hasRun: true });
    expect(steps.map((s) => s.state)).toEqual(["done", "done", "now"]);
    expect(guideMeta(steps)).toBe("step 3 of 3: ask what it shows");
  });

  it("sends back to Run when the scenario changed since the run", () => {
    const steps = guideSteps({ ...base, events: 1, hasRun: true, stale: true });
    expect(steps.map((s) => s.state)).toEqual(["done", "now", "later"]);
    expect(steps[1]!.detail).toMatch(/changed since the last run/);
  });

  it("says it is running while it is", () => {
    expect(guideSteps({ ...base, events: 1, running: true })[1]!.detail).toMatch(/^Running/);
  });

  it("is done when the analyst has been opened after a run", () => {
    const steps = guideSteps({ ...base, events: 1, hasRun: true, analystSeen: true });
    expect(steps.map((s) => s.state)).toEqual(["done", "done", "done"]);
    expect(currentStep(steps)).toBeNull();
    expect(guideMeta(steps)).toBe("all three steps done");
  });

  it("keeps asking for a run even when the analyst was opened early", () => {
    // Curiosity is not a step skipped: the run is still what there is to ask about.
    expect(states({ events: 1, analystSeen: true })).toEqual(["done", "now", "done"]);
  });
});
