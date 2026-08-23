import { describe, expect, it } from "vitest";

import {
  ACTION_FIELDS,
  blankRule,
  compoundingWarning,
  describeRule,
  ruleProblem,
  type PolicyRule,
} from "./policy-shape";

const NAMES: Record<string, string> = {
  "u-1": "HÔPITAL NOTRE-DAME",
  "u-2": "HÔPITAL MAISONNEUVE-ROSEMONT",
  "pop:rdp": "RLS de Rivière-des-Prairies",
};
const label = (id: string) => NAMES[id] ?? id;

function transfer(over: Partial<PolicyRule["action"]> = {}): PolicyRule {
  const r = blankRule("r1", "transfer");
  r.action = { ...r.action, source: "u-1", target: "u-2", amount: 5, ...over };
  return r;
}

describe("a blank rule", () => {
  it("changes nothing until it is filled in", () => {
    // A rule that quietly halves a catchment because a field defaulted to 0.5
    // is worse than one that visibly does nothing.
    expect(blankRule("r1", "modify_demand").action.factor).toBe(1);
    expect(blankRule("r1", "transfer").action.amount).toBe(0);
  });
});

describe("what stops a rule from doing anything", () => {
  it("names the missing field rather than counting problems", () => {
    const r = transfer({ target: null });
    expect(ruleProblem(r)).toBe("Il manque la destination.");
  });

  it("catches a quantity of zero", () => {
    expect(ruleProblem(transfer({ amount: 0 }))).toMatch(/ne déplace rien/);
  });

  it("catches a demand factor that changes nothing", () => {
    const r = blankRule("r1", "modify_demand");
    r.action.population = "pop:rdp";
    expect(ruleProblem(r)).toMatch(/ne change rien/);
    r.action.factor = 0.7;
    expect(ruleProblem(r)).toBeNull();
  });

  it("catches a window that ends before it starts", () => {
    const r = transfer();
    r.trigger = { when: "between", start: 30, end: 10 };
    expect(ruleProblem(r)).toBe("La fin est avant le début.");
  });

  it("asks the reading for what it needs", () => {
    const r = transfer();
    r.condition = { compare: { left: { fn: "occupancy_ratio", activity: "lit" }, op: ">", right: 0.9 } };
    expect(ruleProblem(r)).toMatch(/l'installation/);
  });

  it("says nothing when the rule would act", () => {
    expect(ruleProblem(transfer())).toBeNull();
  });
});

describe("reading a rule back", () => {
  it("uses the names on screen, not the ids", () => {
    // The engine renders the same sentence into the trace after the run. A
    // composer that cannot show it beforehand leaves the author guessing.
    const r = transfer();
    r.trigger = { when: "from_tick", start: 21, end: null };
    r.condition = {
      compare: { left: { fn: "occupancy_ratio", facility: "u-1", activity: "lit" }, op: ">", right: 0.9 },
    };
    r.action.friction = { delay: 2, cost: 40000, effectiveness: 1 };
    const s = describeRule(r, label);
    expect(s).toContain("à partir du pas 21");
    expect(s).toContain("HÔPITAL NOTRE-DAME");
    expect(s).toContain("HÔPITAL MAISONNEUVE-ROSEMONT");
    expect(s).toContain("2 pas plus tard");
    expect(s).not.toContain("u-1");
  });

  it("prints an id it does not recognise rather than hiding it", () => {
    // A stale target has to be visible. Blanking it reads as "no destination",
    // which is a different and easier problem than "a destination that is gone".
    const s = describeRule(transfer({ target: "u-disparu" }), label);
    expect(s).toContain("u-disparu");
  });

  it("says a demand rule multiplies", () => {
    const r = blankRule("r1", "modify_demand");
    r.action.population = "pop:rdp";
    r.action.factor = 0.7;
    r.trigger = { when: "between", start: 21, end: 21 };
    expect(describeRule(r, label)).toBe(
      "du pas 21 au pas 21, toujours, multiplier la demande de RLS de Rivière-des-Prairies par 0.7.",
    );
  });
});

describe("the compounding trap", () => {
  it("warns on a standing demand rule", () => {
    // Written as a standing rule against the Montréal twin, a 30% cut took its
    // demand to zero by day 60 and read as a spectacular success.
    const r = blankRule("r1", "modify_demand");
    r.action.population = "pop:rdp";
    r.action.factor = 0.7;
    r.trigger = { when: "from_tick", start: 21, end: null };
    expect(compoundingWarning(r)).toMatch(/baisse unique/);
  });

  it("stays quiet on a one-off", () => {
    const r = blankRule("r1", "modify_demand");
    r.action.population = "pop:rdp";
    r.action.factor = 0.7;
    r.trigger = { when: "between", start: 21, end: 21 };
    expect(compoundingWarning(r)).toBeNull();
  });

  it("stays quiet on everything that is not demand", () => {
    expect(compoundingWarning(transfer())).toBeNull();
  });
});

describe("which fields each action shows", () => {
  it("offers a demand rule a catchment and a factor, nothing else", () => {
    // Showing `source` and `target` on an action that never reads them is how a
    // composer teaches the wrong model of what it is doing.
    expect(ACTION_FIELDS.modify_demand).toEqual(["population", "factor"]);
    expect(ACTION_FIELDS.transfer).toContain("source");
  });
});
