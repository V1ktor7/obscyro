/**
 * What the map is allowed to draw, and where its colours come from.
 */

import { describe, expect, it } from "vitest";

import type { InstanceShape } from "@/lib/platform-api";

import { AUTO_TINTS, adjacency, assignColours, colourOf, shapeFeatures, tagsOf } from "./map-shapes";

function shape(over: Partial<InstanceShape> = {}): InstanceShape {
  return {
    instanceId: "t1",
    instanceName: "RLS des Faubourgs",
    objectType: "Territoire",
    kind: "territoire",
    geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    areaM2: 1,
    properties: {},
    ...over,
  } as InstanceShape;
}

describe("colourOf", () => {
  it("reads the colour off whatever property holds one", () => {
    // The key is not blessed: a deployment naming it `color` or `teinte` gets
    // the same map without a code change. That is what an editable ontology
    // buys, and hard-coding `couleur` would spend it.
    expect(colourOf({ couleur: "#2f80ed" })).toBe("#2f80ed");
    expect(colourOf({ color: "#2f80ed" })).toBe("#2f80ed");
    expect(colourOf({ teinte_affichage: "#abc" })).toBe("#abc");
  });

  it("ignores strings that are not colours", () => {
    expect(colourOf({ code: "0601", nom: "Faubourgs" })).toBeNull();
  });

  it("is stable when two properties both hold one", () => {
    // JSON key order is not a contract; a polygon that changes colour between
    // two renders of the same data is a bug nobody can reproduce.
    const props = { zeta: "#111111", alpha: "#222222" };
    expect(colourOf(props)).toBe("#222222");
    expect(colourOf({ alpha: "#222222", zeta: "#111111" })).toBe("#222222");
  });

  it("says nothing rather than picking a colour", () => {
    expect(colourOf(undefined)).toBeNull();
    expect(colourOf({})).toBeNull();
  });
});

describe("tagsOf", () => {
  it("finds the list of strings", () => {
    expect(tagsOf({ tags: ["urbain", "défavorisé"] })).toEqual(["urbain", "défavorisé"]);
    expect(tagsOf({ etiquettes: ["ouest"] })).toEqual(["ouest"]);
  });

  it("does not mistake a list of numbers for tags", () => {
    expect(tagsOf({ population: [1, 2, 3] })).toEqual([]);
  });

  it("returns nothing for an empty list", () => {
    expect(tagsOf({ tags: [] })).toEqual([]);
  });
});

describe("which shapes reach the map", () => {
  it("draws territories on the territory axis", () => {
    const fc = shapeFeatures([shape()], { axis: "territoire" });
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]!.properties.label).toBe("RLS des Faubourgs");
  });

  it("draws no boundary on an axis that has none", () => {
    // A CIUSSS is not a place and a mission is everywhere. Leaving RLS lines up
    // while grouping by mission suggests the missions follow them.
    expect(shapeFeatures([shape()], { axis: "etablissement" }).features).toHaveLength(0);
    expect(shapeFeatures([shape()], { axis: "mission" }).features).toHaveLength(0);
  });

  it("keeps a hand-drawn area on every axis", () => {
    // That shape is the user's own assertion about coverage, not an inference
    // this file is entitled to withdraw when the grouping changes.
    const drawn = shape({ instanceId: "c1", kind: "couverture", instanceName: "Corridor" });
    expect(shapeFeatures([drawn], { axis: "mission" }).features).toHaveLength(1);
  });
});

describe("what each feature carries", () => {
  it("passes the declared colour through to the paint", () => {
    const fc = shapeFeatures([shape({ properties: { couleur: "#2f80ed" } })], {
      axis: "territoire",
    });
    expect(fc.features[0]!.properties.couleur).toBe("#2f80ed");
  });

  it("always carries a colour, so the paint expression never runs dry", () => {
    const c = shapeFeatures([shape()], { axis: "territoire" }).features[0]!.properties.couleur;
    expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("joins tags into something a tooltip can print", () => {
    const fc = shapeFeatures([shape({ properties: { tags: ["urbain", "insulaire"] } })], {
      axis: "territoire",
    });
    expect(fc.features[0]!.properties.tags).toBe("urbain · insulaire");
  });

  it("dims a territory the tree hid instead of dropping it", () => {
    // Hiding a branch is about which installations you are looking at. Removing
    // the outline as well takes away the frame you are looking at them in.
    const fc = shapeFeatures([shape()], {
      axis: "territoire",
      hidden: new Set(["axis:RLS des Faubourgs"]),
    });
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]!.properties.dimmed).toBe(true);
  });

  it("leaves a visible territory undimmed", () => {
    const fc = shapeFeatures([shape()], { axis: "territoire", hidden: new Set(["axis:Autre"]) });
    expect(fc.features[0]!.properties.dimmed).toBe(false);
  });
});


// A square with its lower-left corner at (x, y), sharing edges with its
// neighbours the way official boundaries cut from one source geometry do.
function square(id: string, x: number, y: number): InstanceShape {
  return shape({
    instanceId: id,
    instanceName: id,
    geometry: {
      type: "Polygon",
      coordinates: [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]],
    },
  });
}

describe("adjacency", () => {
  it("calls two shapes that share a corner neighbours", () => {
    const a = adjacency([square("a", 0, 0), square("b", 1, 0)]);
    expect(Array.from(a.get("a")!)).toEqual(["b"]);
  });

  it("leaves shapes that touch nothing alone", () => {
    const a = adjacency([square("a", 0, 0), square("b", 1, 0), square("far", 40, 40)]);
    expect(a.get("far")!.size).toBe(0);
  });

  it("falls back to overlapping extents when no vertex is shared at all", () => {
    // RDP simplified each ring on its own, so a border that is one line on the
    // ground can come back as two that miss each other by metres. Reading zero
    // neighbours off that would paint the whole island one colour.
    const drifted = shape({
      instanceId: "b",
      instanceName: "b",
      geometry: {
        type: "Polygon",
        coordinates: [[[0.99, 0.02], [2, 0], [2, 1], [1.01, 0.98], [0.99, 0.02]]],
      },
    });
    const a = adjacency([square("a", 0, 0), drifted]);
    expect(a.get("a")!.has("b")).toBe(true);
  });
});

describe("colouring what nobody has coloured", () => {
  it("never gives two neighbours the same tint", () => {
    // This is the whole job of the colour. A hash of the name would have been
    // one line and would put two of twelve RLS side by side in the same blue
    // often enough to matter on an island this crowded.
    const row = [square("a", 0, 0), square("b", 1, 0), square("c", 2, 0)];
    const c = assignColours(row);
    expect(c.get("a")).not.toBe(c.get("b"));
    expect(c.get("b")).not.toBe(c.get("c"));
    // Non-neighbours may reuse a tint; six colours over fifty territories has
    // to reuse them somewhere, and a and c share no border.
    expect(AUTO_TINTS).toContain(c.get("a"));
  });

  it("paints the same map every time", () => {
    // A territory that changes colour on reload is a legend nobody can trust.
    const row = [square("b", 1, 0), square("a", 0, 0), square("c", 2, 0)];
    expect(Array.from(assignColours(row))).toEqual(Array.from(assignColours(row)));
  });

  it("keeps a declared colour and pushes the neighbours out of its way", () => {
    const a = shape({ ...square("a", 0, 0), properties: { couleur: AUTO_TINTS[0] } });
    const c = assignColours([a, square("b", 1, 0)]);
    expect(c.get("a")).toBe(AUTO_TINTS[0]);
    expect(c.get("b")).not.toBe(AUTO_TINTS[0]);
  });
  it("keeps detached shapes apart instead of giving them all the first tint", () => {
    // Three islands constrain nothing, so "first free colour" would hand each
    // the same blue and the colour would stop saying anything at all.
    const c = assignColours([square("a", 0, 0), square("b", 40, 40), square("c", 80, 80)]);
    expect(new Set(Array.from(c.values())).size).toBe(3);
  });
});
