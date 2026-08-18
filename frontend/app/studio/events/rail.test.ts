/**
 * The left rail is the answer to "what is there to change?", so what it hides
 * or mislabels is what an author will never think to write.
 */

import { describe, expect, it } from "vitest";

import type { SimExport, SimObjectType } from "@/lib/platform-api";

import { describeRailProperty, ontologyRail, perturbableCount, vocabularyOf } from "./rail";

function prop(key: string, over: Partial<SimObjectType["properties"][number]> = {}) {
  return {
    key,
    type: "number" as const,
    label: null,
    unit: null,
    min: null,
    max: null,
    behaviour: null,
    mechanic: null,
    ...over,
  };
}

function snapshot(
  types: SimObjectType[],
  instances: Array<{ type: string; properties?: Record<string, unknown> }> = [],
): SimExport {
  return {
    environment: "prod",
    scenario_id: null,
    generated_at: "2026-08-18T00:00:00Z",
    facilities: [],
    objects: instances.map((o, i) => ({
      id: `o-${i}`,
      type: o.type,
      role: "space" as const,
      properties: o.properties ?? {},
      at: "unit-a",
    })),
    object_types: types,
    object_rules: { unavailable_keys: [], unavailable_values: [] },
    populations: [],
    edges: [],
    gaps: [],
  };
}

describe("ontologyRail", () => {
  it("puts what an effect can reach above what it cannot", () => {
    // Alphabetical alone would bury the only usable type under empty ones.
    const s = snapshot(
      [
        { name: "Zebra", role: "space", properties: [prop("charge", { behaviour: "level" })] },
        { name: "Alpha", role: "space", properties: [prop("x")] },
      ],
      [{ type: "Zebra" }],
    );
    expect(ontologyRail(s).map((t) => t.name)).toEqual(["Zebra", "Alpha"]);
  });

  it("keeps a type with no instances rather than hiding it", () => {
    // A type declared months ago and never populated looks exactly like a typo
    // until something says the count is zero.
    const rail = ontologyRail(snapshot([{ name: "Drone", role: null, properties: [prop("x")] }]));
    expect(rail[0]!.instances).toBe(0);
    expect(rail[0]!.blocked).toMatch(/would reach nothing/);
  });

  it("says when a type declares nothing to change", () => {
    const rail = ontologyRail(snapshot([{ name: "Lit", role: "space", properties: [] }], [{ type: "Lit" }]));
    expect(rail[0]!.blocked).toMatch(/declares no properties/);
  });

  it("counts instances per type", () => {
    const rail = ontologyRail(
      snapshot([{ name: "Lit", role: "space", properties: [prop("charge", { behaviour: "level" })] }], [
        { type: "Lit" },
        { type: "Lit" },
        { type: "Lit" },
      ]),
    );
    expect(rail[0]!.instances).toBe(3);
  });

  it("warns in the rail that a property can only be replaced, before an effect exists", () => {
    // Picking a property, filling a form and only then being told it cannot be
    // multiplied is three steps of work thrown away.
    const rail = ontologyRail(
      snapshot([{ name: "Lit", role: "space", properties: [prop("charge")] }], [{ type: "Lit" }]),
    );
    expect(rail[0]!.properties[0]!.limitation).toMatch(/no behaviour declared/);
  });

  it("leaves a declared quantity unrestricted", () => {
    const rail = ontologyRail(
      snapshot(
        [{ name: "Lit", role: "space", properties: [prop("charge", { behaviour: "level" })] }],
        [{ type: "Lit" }],
      ),
    );
    expect(rail[0]!.properties[0]!.limitation).toBeNull();
  });

  it("sorts properties so a long type stays scannable", () => {
    const rail = ontologyRail(
      snapshot([{ name: "Lit", role: "space", properties: [prop("z"), prop("a")] }], [{ type: "Lit" }]),
    );
    expect(rail[0]!.properties.map((p) => p.key)).toEqual(["a", "z"]);
  });
});

describe("perturbableCount", () => {
  it("counts only what arithmetic can reach", () => {
    const rail = ontologyRail(
      snapshot(
        [
          {
            name: "Lit",
            role: "space",
            properties: [
              prop("charge", { behaviour: "level" }),
              prop("statut", { type: "string", behaviour: "state" }),
              prop("inconnu"),
            ],
          },
          { name: "Vide", role: "space", properties: [prop("x", { behaviour: "level" })] },
        ],
        [{ type: "Lit" }],
      ),
    );
    // One on Lit. Vide's declared quantity does not count: it has no instances.
    expect(perturbableCount(rail)).toBe(1);
  });
});

describe("describeRailProperty", () => {
  it("reads as the fragment under the property name", () => {
    const rail = ontologyRail(
      snapshot(
        [
          {
            name: "Lit",
            role: "space",
            properties: [prop("charge", { behaviour: "level", unit: "%" })],
          },
        ],
        [{ type: "Lit" }],
      ),
    );
    expect(describeRailProperty(rail[0]!.properties[0]!)).toBe("level · %");
  });

  it("falls back to the limitation when there is nothing else to say", () => {
    const rail = ontologyRail(
      snapshot([{ name: "Lit", role: "space", properties: [prop("charge")] }], [{ type: "Lit" }]),
    );
    expect(describeRailProperty(rail[0]!.properties[0]!)).toMatch(/no behaviour declared/);
  });

  it("names a binding, because it is why the number matters", () => {
    const rail = ontologyRail(
      snapshot(
        [
          {
            name: "Protocole",
            role: null,
            properties: [prop("duree", { behaviour: "level", mechanic: "occupies_for" })],
          },
        ],
        [{ type: "Protocole" }],
      ),
    );
    expect(describeRailProperty(rail[0]!.properties[0]!)).toMatch(/feeds occupies_for/);
  });
});

describe("vocabularyOf", () => {
  it("reads severities off what the twin declares, not off a shipped list", () => {
    // The three hard-coded bands were the last place the composer asserted what
    // kind of institution this is.
    const s = snapshot(
      [
        {
          name: "Protocole",
          role: null,
          properties: [
            prop("gravite", { type: "string", behaviour: "state", mechanic: "serves_severity" }),
          ],
        },
      ],
      [
        { type: "Protocole", properties: { gravite: "P1" } },
        { type: "Protocole", properties: { gravite: "P2" } },
        { type: "Protocole", properties: { gravite: "P1" } },
      ],
    );
    expect(vocabularyOf(s).acuity).toEqual([
      { id: "P1", name: "P1" },
      { id: "P2", name: "P2" },
    ]);
  });

  it("offers no severities when nothing declares any", () => {
    const s = snapshot([{ name: "Lit", role: "space", properties: [prop("x")] }], [{ type: "Lit" }]);
    expect(vocabularyOf(s).acuity).toEqual([]);
  });

  it("counts instances beside each object type", () => {
    const s = snapshot([{ name: "Lit", role: "space", properties: [] }], [
      { type: "Lit" },
      { type: "Lit" },
    ]);
    expect(vocabularyOf(s).object_type).toEqual([{ id: "Lit", name: "Lit (2)" }]);
  });
});
