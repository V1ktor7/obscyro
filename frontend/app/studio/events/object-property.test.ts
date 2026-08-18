/**
 * The composer offers what the ontology declares, and nothing else.
 *
 * Each test here guards a way the form could produce a *valid* event that means
 * something other than what was written: an operation whose composition law
 * nobody has stated, a key nothing declares, two types that declare the same key
 * differently. All three save cleanly and run to completion.
 */

import { describe, expect, it } from "vitest";

import type { SimExport, SimObjectType } from "@/lib/platform-api";

import {
  declaredProperties,
  describeDeclaration,
  opsFor,
  propertyProblem,
  resolveProperty,
  typesInScope,
  valueKind,
  valueLabel,
} from "./object-property";

function snapshot(types: SimObjectType[], instanceTypes = types.map((t) => t.name)): SimExport {
  return {
    environment: "prod",
    scenario_id: null,
    generated_at: "2026-08-17T00:00:00Z",
    facilities: [],
    objects: instanceTypes.map((type, i) => ({
      id: `o-${i}`,
      type,
      role: "space" as const,
      properties: {},
      at: "unit-a",
    })),
    object_types: types,
    object_rules: { unavailable_keys: [], unavailable_values: [] },
    populations: [],
    edges: [],
    gaps: [],
  };
}

function type(name: string, ...properties: SimObjectType["properties"]): SimObjectType {
  return { name, role: "space", properties };
}

function prop(
  key: string,
  over: Partial<SimObjectType["properties"][number]> = {},
): SimObjectType["properties"][number] {
  return {
    key,
    type: "number",
    label: null,
    unit: null,
    min: null,
    max: null,
    behaviour: null,
    mechanic: null,
    ...over,
  };
}

describe("opsFor", () => {
  it("allows arithmetic only where a composition law has been declared", () => {
    expect(opsFor("level")).toEqual(["multiply", "add", "set"]);
    expect(opsFor("rate")).toEqual(["multiply", "add", "set"]);
  });

  it("offers multiply on a stock, because decay is a real model", () => {
    // "The backlog sheds half of itself each step" composes against the running
    // value and means exactly what it says.
    expect(opsFor("stock")).toContain("multiply");
  });

  it("allows only set on a state", () => {
    expect(opsFor("state")).toEqual(["set"]);
  });

  it("allows only set while nobody has declared a behaviour", () => {
    // Not an oversight. `set` reads no prior value, so it is well-defined
    // without knowing whether the number rebuilds or accumulates; arithmetic is
    // not, and the engine refuses it before the run starts.
    expect(opsFor(null)).toEqual(["set"]);
  });
});

describe("typesInScope", () => {
  it("is every type with instances when nothing is selected", () => {
    const s = snapshot([type("Lit", prop("charge")), type("Salle", prop("etage"))]);
    expect(typesInScope(s, [])).toEqual(["Lit", "Salle"]);
  });

  it("narrows to the selection", () => {
    const s = snapshot([type("Lit", prop("charge")), type("Salle", prop("etage"))]);
    expect(typesInScope(s, ["Salle"])).toEqual(["Salle"]);
  });

  it("excludes a declared type with no instances", () => {
    // An effect cannot reach what does not exist, and offering its properties
    // would produce an event that runs and changes nothing.
    const s = snapshot([type("Lit", prop("charge")), type("Drone", prop("autonomie"))], ["Lit"]);
    expect(typesInScope(s, [])).toEqual(["Lit"]);
  });
});

describe("declaredProperties", () => {
  it("is a closed list drawn from the schema, not from what instances carry", () => {
    const s = snapshot([type("Lit", prop("charge"), prop("statut", { type: "string" }))]);
    expect(declaredProperties(s, []).map((d) => d.key)).toEqual(["charge", "statut"]);
  });

  it("merges keys across the selected types without duplicating them", () => {
    const s = snapshot([
      type("Lit", prop("statut", { type: "string", behaviour: "state" })),
      type("Salle", prop("statut", { type: "string", behaviour: "state" }), prop("etage")),
    ]);
    expect(declaredProperties(s, []).map((d) => d.key)).toEqual(["etage", "statut"]);
  });

  it("is empty when the types declare nothing", () => {
    expect(declaredProperties(snapshot([type("Lit")]), []).length).toBe(0);
  });
});

describe("resolveProperty", () => {
  it("carries the declaration through", () => {
    const s = snapshot([
      type("Lit", prop("charge", { behaviour: "level", unit: "%", min: 0, max: 100 })),
    ]);
    const r = resolveProperty(s, [], "charge");
    expect(r.behaviour).toBe("level");
    expect(r.def?.unit).toBe("%");
    expect(r.undeclared).toBe(false);
  });

  it("reports a key nothing declares rather than inventing one", () => {
    const s = snapshot([type("Lit", prop("charge"))]);
    expect(resolveProperty(s, [], "inexistant").undeclared).toBe(true);
  });

  it("names a conflict instead of picking a side", () => {
    // One effect composing two ways at once applies the wrong law to half the
    // objects, and the run completes either way.
    const s = snapshot([
      type("Lit", prop("charge", { behaviour: "level" })),
      type("Salle", prop("charge", { behaviour: "stock" })),
    ]);
    const r = resolveProperty(s, [], "charge");
    expect(r.conflict).toMatch(/cannot compose two ways/);
    expect(r.behaviour).toBeNull();
  });

  it("resolves the conflict once the selection narrows to one type", () => {
    const s = snapshot([
      type("Lit", prop("charge", { behaviour: "level" })),
      type("Salle", prop("charge", { behaviour: "stock" })),
    ]);
    expect(resolveProperty(s, ["Lit"], "charge").conflict).toBeNull();
    expect(resolveProperty(s, ["Lit"], "charge").behaviour).toBe("level");
  });

  it("treats an empty key as nothing chosen yet", () => {
    expect(resolveProperty(snapshot([type("Lit", prop("c"))]), [], null).undeclared).toBe(true);
  });
});

describe("valueKind", () => {
  it("takes text when setting a non-numeric property", () => {
    const s = snapshot([type("Lit", prop("statut", { type: "string", behaviour: "state" }))]);
    expect(valueKind(resolveProperty(s, [], "statut"), "set")).toBe("text");
  });

  it("takes a number when setting a numeric one", () => {
    // A number declared a state is still a number — a triage level, a ward
    // code. A text field there invites a word into something read as a figure.
    const s = snapshot([type("Lit", prop("niveau", { type: "number", behaviour: "state" }))]);
    expect(valueKind(resolveProperty(s, [], "niveau"), "set")).toBe("number");
  });

  it("always takes a number for arithmetic", () => {
    const s = snapshot([type("Lit", prop("statut", { type: "string" }))]);
    expect(valueKind(resolveProperty(s, [], "statut"), "multiply")).toBe("number");
  });
});

describe("propertyProblem", () => {
  const level = snapshot([type("Lit", prop("charge", { behaviour: "level" }))]);
  const state = snapshot([type("Lit", prop("niveau", { behaviour: "state" }))]);
  const bare = snapshot([type("Lit", prop("charge"))]);

  it("is silent on a declared quantity", () => {
    expect(propertyProblem(resolveProperty(level, [], "charge"), "multiply")).toBeNull();
  });

  it("is silent when nothing is picked yet", () => {
    expect(propertyProblem(resolveProperty(level, [], null), "set")).toBeNull();
  });

  it("names the undeclared behaviour and where to fix it", () => {
    const msg = propertyProblem(resolveProperty(bare, [], "charge"), "multiply") ?? "";
    expect(msg).toMatch(/no declared behaviour/);
    expect(msg).toMatch(/object type/);
  });

  it("refuses arithmetic on a state", () => {
    expect(propertyProblem(resolveProperty(state, [], "niveau"), "add") ?? "").toMatch(
      /declared a state/,
    );
  });

  it("permits set on anything declared", () => {
    expect(propertyProblem(resolveProperty(bare, [], "charge"), "set")).toBeNull();
    expect(propertyProblem(resolveProperty(state, [], "niveau"), "set")).toBeNull();
  });

  it("says a key nothing declares would run and change nothing", () => {
    expect(propertyProblem(resolveProperty(bare, [], "fantome"), "set") ?? "").toMatch(
      /change nothing/,
    );
  });
});

describe("valueLabel", () => {
  it("shows the institution's own unit for arithmetic", () => {
    const s = snapshot([type("Lit", prop("charge", { behaviour: "level", unit: "lits" }))]);
    expect(valueLabel(resolveProperty(s, [], "charge"), "add")).toBe("lits");
  });

  it("falls back to a plain word rather than an empty label", () => {
    const s = snapshot([type("Lit", prop("charge", { behaviour: "level" }))]);
    expect(valueLabel(resolveProperty(s, [], "charge"), "add")).toBe("Value");
  });
});

describe("describeDeclaration", () => {
  it("reads as a fragment a person can scan", () => {
    const s = snapshot([
      type("Lit", prop("charge", { behaviour: "level", unit: "%", min: 0, max: 100 })),
    ]);
    expect(describeDeclaration(resolveProperty(s, [], "charge"))).toBe(
      "number · level · % · 0–100 — on Lit.",
    );
  });

  it("says outright when a number has no behaviour", () => {
    const s = snapshot([type("Lit", prop("charge"))]);
    expect(describeDeclaration(resolveProperty(s, [], "charge"))).toMatch(
      /no behaviour declared/,
    );
  });

  it("names every type that declares it, so a conflict is visible before it bites", () => {
    const s = snapshot([
      type("Lit", prop("statut", { type: "string", behaviour: "state" })),
      type("Salle", prop("statut", { type: "string", behaviour: "state" })),
    ]);
    expect(describeDeclaration(resolveProperty(s, [], "statut"))).toMatch(/on Lit, Salle\.$/);
  });
});
