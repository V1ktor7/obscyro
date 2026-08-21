/**
 * What the map is allowed to draw, and where its colours come from.
 */

import { describe, expect, it } from "vitest";

import type { InstanceShape } from "@/lib/platform-api";

import { UNCOLOURED, colourOf, shapeFeatures, tagsOf } from "./map-shapes";

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

  it("falls back to grey rather than leaving the expression without a value", () => {
    expect(shapeFeatures([shape()], { axis: "territoire" })[
      "features"
    ][0]!.properties.couleur).toBe(UNCOLOURED);
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
