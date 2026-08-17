import { describe, expect, it } from "vitest";

import {
  behaviourOf,
  behavioursFor,
  describeProperty,
  isQuantity,
  propertyProblem,
  retypeProperty,
  schemaProblems,
  type PropertyDefinition,
} from "./property-schema";

function def(over: Partial<PropertyDefinition> = {}): PropertyDefinition {
  return { key: "capacite", type: "number", ...over };
}

describe("behaviourOf", () => {
  it("returns what was declared", () => {
    expect(behaviourOf(def({ behaviour: "stock" }))).toBe("stock");
  });

  it("says nothing about an undeclared number", () => {
    // 40 beds, 40 arrivals a day and 40 people waiting are the same JSON. A
    // default would be right one time in three and silent the other two.
    expect(behaviourOf(def())).toBeNull();
  });

  it("derives state for anything that cannot be arithmetic", () => {
    expect(behaviourOf(def({ type: "string" }))).toBe("state");
    expect(behaviourOf(def({ type: "boolean" }))).toBe("state");
  });
});

describe("behavioursFor", () => {
  it("offers all four on a number", () => {
    // Including `state`: a triage level is a category stored as a number, and
    // refusing that would be the editor telling an institution how to model.
    expect(behavioursFor("number")).toEqual(["level", "rate", "stock", "state"]);
  });

  it("offers only state on anything else", () => {
    // A menu entry whose only outcome is a refused save is worse than no menu
    // entry.
    expect(behavioursFor("string")).toEqual(["state"]);
    expect(behavioursFor("array")).toEqual(["state"]);
  });
});

describe("isQuantity", () => {
  it("is true only where arithmetic applies", () => {
    expect(isQuantity(def({ behaviour: "level" }))).toBe(true);
    expect(isQuantity(def({ behaviour: "state" }))).toBe(false);
    expect(isQuantity(def())).toBe(false);
  });
});

describe("propertyProblem", () => {
  it("accepts an undeclared property, which is every property today", () => {
    expect(propertyProblem(def({ type: "string" }))).toBeNull();
    expect(propertyProblem(def())).toBeNull();
  });

  it("refuses a unit on something never measured", () => {
    expect(propertyProblem(def({ type: "string", unit: "lits" }))).toMatch(/unit measures/);
  });

  it("does not nag about a blank unit field", () => {
    expect(propertyProblem(def({ type: "string", unit: "  " }))).toBeNull();
  });

  it("refuses bounds on something with no numeric range", () => {
    expect(propertyProblem(def({ type: "string", bounds: { min: 0, max: 3 } }))).toMatch(
      /numeric range/,
    );
  });

  it("refuses a range no value can satisfy", () => {
    expect(propertyProblem(def({ bounds: { min: 10, max: 2 } }))).toMatch(/no value can satisfy/);
  });

  it("allows a minimum equal to its maximum", () => {
    expect(propertyProblem(def({ bounds: { min: 4, max: 4 } }))).toBeNull();
  });

  it("refuses arithmetic behaviour on a property that cannot do arithmetic", () => {
    expect(propertyProblem(def({ type: "string", behaviour: "level" }))).toMatch(/only be set/);
  });
});

describe("schemaProblems", () => {
  it("points at the offending row", () => {
    const problems = schemaProblems([def({ key: "a" }), def({ key: "b", type: "string", unit: "kg" })]);
    expect(Array.from(problems.keys())).toEqual([1]);
  });

  it("catches a duplicate key, which no single row can see", () => {
    // Two properties called `status` means one shadows the other everywhere the
    // schema is read as a map, decided by array order — the same class of bug
    // as effect ordering.
    const problems = schemaProblems([
      def({ key: "status", type: "string" }),
      def({ key: "status", type: "string" }),
    ]);
    expect(problems.get(1)).toMatch(/declared twice/);
    expect(problems.has(0)).toBe(false);
  });

  it("compares keys trimmed, so the editor and the save agree", () => {
    const problems = schemaProblems([def({ key: "status" }), def({ key: " status " })]);
    expect(problems.get(1)).toMatch(/declared twice/);
  });

  it("does not call two blank rows duplicates", () => {
    expect(schemaProblems([def({ key: "" }), def({ key: "" })]).size).toBe(0);
  });
});

describe("describeProperty", () => {
  it("names the missing behaviour rather than staying quiet about it", () => {
    // "" would read as "fine", and it is the state that stops an effect from
    // existing at all.
    expect(describeProperty(def())).toBe("no behaviour");
  });

  it("reads as a sentence fragment a person can scan", () => {
    expect(
      describeProperty(def({ behaviour: "level", unit: "lits", bounds: { min: 0, max: null } })),
    ).toBe("level · lits · ≥ 0");
  });

  it("renders a closed range as a range", () => {
    expect(describeProperty(def({ behaviour: "state", bounds: { min: 1, max: 3 } }))).toBe(
      "state · 1–3",
    );
  });

  it("stays silent about a string's derived state", () => {
    // Printing "state" on every string adds a word per row and tells nobody
    // anything; it was never a choice.
    expect(describeProperty(def({ key: "statut", type: "string" }))).toBe("");
  });

  it("surfaces required, because it changes what ingestion rejects", () => {
    expect(describeProperty(def({ type: "string", required: true }))).toBe("required");
  });
});

describe("retypeProperty", () => {
  it("drops what the new type cannot carry", () => {
    // Otherwise changing number → string leaves a unit behind that only
    // surfaces as a refused save, with the field that caused it now hidden.
    const retyped = retypeProperty(
      def({ behaviour: "rate", unit: "par jour", bounds: { min: 0, max: 9 } }),
      "string",
    );
    expect(retyped.unit).toBeUndefined();
    expect(retyped.bounds).toBeUndefined();
    expect(retyped.behaviour).toBeUndefined();
    expect(propertyProblem(retyped)).toBeNull();
  });

  it("keeps state across a retype, because it survives the change", () => {
    expect(retypeProperty(def({ behaviour: "state" }), "string").behaviour).toBe("state");
  });

  it("leaves a number alone on the way back", () => {
    const numeric = retypeProperty(def({ key: "n", type: "string" }), "number");
    expect(numeric.type).toBe("number");
    expect(behaviourOf(numeric)).toBeNull();
  });

  it("returns the same object when nothing changed", () => {
    const original = def();
    expect(retypeProperty(original, "number")).toBe(original);
  });
});
