import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  behaviourOf,
  isQuantity,
  propertyProblem,
  schemaProblems,
  type PropertyDef,
} from "./property-schema.js";

function def(over: Partial<PropertyDef> = {}): PropertyDef {
  return { key: "capacite", type: "number", ...over };
}

describe("behaviourOf", () => {
  it("returns what was declared", () => {
    assert.equal(behaviourOf(def({ behaviour: "stock" })), "stock");
  });

  it("says nothing about an undeclared number", () => {
    // 40 beds, 40 arrivals a day and 40 people waiting are the same JSON. A
    // default here would be right one time in three and silent the other two,
    // and the two wrong ones produce a run that finishes and reads as a
    // finding.
    assert.equal(behaviourOf(def()), null);
  });

  it("derives state for anything that cannot be arithmetic", () => {
    // Not a guess: a string has no other option, so deriving costs nothing and
    // spares an author a declaration they could not get wrong.
    assert.equal(behaviourOf(def({ type: "string" })), "state");
    assert.equal(behaviourOf(def({ type: "boolean" })), "state");
    assert.equal(behaviourOf(def({ type: "array" })), "state");
  });
});

describe("isQuantity", () => {
  it("is true for the three behaviours that allow arithmetic", () => {
    for (const behaviour of ["level", "rate", "stock"] as const) {
      assert.equal(isQuantity(def({ behaviour })), true, behaviour);
    }
  });

  it("is false for a number declared a label", () => {
    // A triage level of 3 is not three of anything. Multiplying it by 0.5 is
    // not a milder case, it is a corrupted record.
    assert.equal(isQuantity(def({ behaviour: "state" })), false);
  });

  it("is false while nobody has declared a behaviour", () => {
    assert.equal(isQuantity(def()), false);
  });
});

describe("propertyProblem", () => {
  it("accepts an undeclared property", () => {
    // Every type in the ontology today is in this state. Requiring a
    // declaration would make reading them a breaking change.
    assert.equal(propertyProblem(def({ type: "string" })), null);
    assert.equal(propertyProblem(def()), null);
  });

  it("accepts a fully declared quantity", () => {
    assert.equal(
      propertyProblem(def({ behaviour: "level", unit: "lits", bounds: { min: 0, max: null } })),
      null,
    );
  });

  it("refuses a unit on something that is never measured", () => {
    assert.match(propertyProblem(def({ type: "string", unit: "lits" })) ?? "", /unit measures/);
  });

  it("lets an empty unit through rather than nagging about a blank field", () => {
    assert.equal(propertyProblem(def({ type: "string", unit: "  " })), null);
  });

  it("refuses bounds on something with no numeric range", () => {
    assert.match(
      propertyProblem(def({ type: "string", bounds: { min: 0, max: 3 } })) ?? "",
      /numeric range/,
    );
  });

  it("ignores empty bounds on a string, because that is what an untouched form sends", () => {
    assert.equal(propertyProblem(def({ type: "string", bounds: { min: null, max: null } })), null);
  });

  it("refuses a range no value can satisfy", () => {
    // Silently swapping them would be worse: the author would never learn that
    // what they typed was not what they got.
    assert.match(propertyProblem(def({ bounds: { min: 10, max: 2 } })) ?? "", /no value can satisfy/);
  });

  it("allows a minimum equal to its maximum", () => {
    assert.equal(propertyProblem(def({ bounds: { min: 4, max: 4 } })), null);
  });

  it("refuses arithmetic behaviour on a property that cannot do arithmetic", () => {
    assert.match(propertyProblem(def({ type: "string", behaviour: "level" })) ?? "", /only be set/);
  });

  it("allows a number declared a label", () => {
    // A triage level is a category stored as a number. Refusing this would be
    // the schema telling an institution how to model its own data.
    assert.equal(propertyProblem(def({ behaviour: "state" })), null);
  });

  it("allows bounds on a numeric label, because 1..3 is a real constraint", () => {
    assert.equal(propertyProblem(def({ behaviour: "state", bounds: { min: 1, max: 3 } })), null);
  });
});

describe("schemaProblems", () => {
  it("reports nothing for a clean schema", () => {
    assert.equal(schemaProblems([def({ key: "a" }), def({ key: "b", type: "string" })]).size, 0);
  });

  it("points at the row that is wrong", () => {
    const problems = schemaProblems([
      def({ key: "a" }),
      def({ key: "b", type: "string", unit: "kg" }),
    ]);
    assert.deepEqual([...problems.keys()], [1]);
  });

  it("catches a duplicate key, which no single row can see", () => {
    // Two properties called `status` means one shadows the other everywhere the
    // schema is read as a map, and which one wins is decided by array order —
    // the same class of bug as the effect ordering.
    const problems = schemaProblems([
      def({ key: "status", type: "string" }),
      def({ key: "status", type: "string" }),
    ]);
    assert.match(problems.get(1) ?? "", /declared twice/);
    assert.equal(problems.has(0), false);
  });

  it("does not call two blank rows duplicates of each other", () => {
    // A blank row is a form in progress, not a collision.
    assert.equal(schemaProblems([def({ key: "" }), def({ key: "" })]).size, 0);
  });

  it("keeps the row's own problem rather than replacing it with the duplicate", () => {
    const problems = schemaProblems([
      def({ key: "status", type: "string" }),
      def({ key: "status", type: "string", unit: "kg" }),
    ]);
    assert.match(problems.get(1) ?? "", /unit measures/);
  });
});

describe("the spreading model", () => {
  it("binds its mechanics the way a care requirement does", () => {
    // The same idiom, third application: a type whose instances bind these
    // becomes the spreading model, exactly as a type binding the first five
    // becomes the care model. The engine learns no vocabulary — not
    // "susceptible", not "school" — only which state a transition leaves,
    // which it enters, how fast, and what makes it go.
    const rows: PropertyDef[] = [
      { key: "de_etat", type: "string", mechanic: "leaves_state" },
      { key: "vers_etat", type: "string", mechanic: "enters_state" },
      { key: "taux", type: "number", behaviour: "level", mechanic: "transition_rate" },
      { key: "pousse_par", type: "string", mechanic: "driven_by_state" },
      { key: "le_long_de", type: "string", mechanic: "couples_along" },
      { key: "devient", type: "string", mechanic: "produces_demand" },
    ];
    for (const r of rows) assert.equal(propertyProblem(r), null, `${r.key}: ${propertyProblem(r)}`);
  });

  it("names a state, never counts it", () => {
    // Binding a number to `leaves_state` gives a model keyed by "3", which runs
    // and matches nothing — the failure `serves_severity` already guards against.
    const bad: PropertyDef = {
      key: "de_etat",
      type: "number",
      behaviour: "level",
      mechanic: "leaves_state",
    };
    assert.match(String(propertyProblem(bad)), /leaves_state/);
  });

  it("keeps a coupling strength a quantity, because the engine multiplies by it", () => {
    const bad: PropertyDef = { key: "ecole", type: "string", mechanic: "couples_at" };
    assert.match(String(propertyProblem(bad)), /couples_at/);
  });
});
