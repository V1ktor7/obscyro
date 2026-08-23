/**
 * Three groupings of the same 190 installations. What matters is that switching
 * axis never loses one, and that a node's figure is the worst underneath it
 * rather than an average that hides the site on fire.
 */

import { describe, expect, it } from "vitest";

import type { TwinTreeSnapshot, TwinUnitNode } from "@/lib/platform-api";

import { AXES, axisHasBoundaries, missionsIn, treeForAxis } from "./units-axes";

function unit(id: string, name: string, over: Partial<TwinUnitNode> = {}): TwinUnitNode {
  return {
    id,
    name,
    kind: "installation",
    code: "",
    parentId: null,
    metrics: {
      unitId: id,
      instanceCountByType: {},
      values: {},
      occupancyPct: null,
      numericMeans: {},
      freshnessSeconds: null,
      linkedInstanceCount: 0,
    },
    worstAlertSeverity: null,
    openAlertCount: 0,
    ...over,
  } as TwinUnitNode;
}

function withBeds(id: string, name: string, beds: number, occ: number | null, parentId?: string) {
  return unit(id, name, {
    parentId: parentId ?? null,
    metrics: {
      unitId: id,
      instanceCountByType: { LitSantePhysique: beds },
      values: {},
      occupancyPct: occ,
      numericMeans: {},
      freshnessSeconds: null,
      linkedInstanceCount: beds,
    },
  } as Partial<TwinUnitNode>);
}

const SNAP: TwinTreeSnapshot = {
  computedAt: "2026-08-19T00:00:00Z",
  roots: ["ciusss"],
  nodes: [
    unit("ciusss", "Santé Québec Centre-Sud", { kind: "etablissement" }),
    withBeds("nd", "HÔPITAL NOTRE-DAME", 296, 140, "ciusss"),
    withBeds("hd", "HÔTEL-DIEU", 150, 60, "ciusss"),
    withBeds("chsld", "CHSLD ANGUS", 49, 70, "ciusss"),
  ],
  edges: [
    { fromId: "ciusss", toId: "nd" },
    { fromId: "ciusss", toId: "hd" },
    { fromId: "ciusss", toId: "chsld" },
  ],
} as TwinTreeSnapshot;

const TERRITORY = new Map([
  ["nd", "RLS des Faubourgs"],
  ["hd", "RLS des Faubourgs"],
  ["chsld", "RLS de Hochelaga"],
]);

describe("axes", () => {
  it("offers three, and only one claims boundaries", () => {
    // An establishment envelope put 135 of 190 installations inside somebody
    // else's; a mission has no geography at all. Drawing either would be a
    // fiction the map presents as a fact.
    expect(AXES.map((a) => a.id)).toEqual(["etablissement", "territoire", "mission"]);
    expect(axisHasBoundaries("territoire")).toBe(true);
    expect(axisHasBoundaries("etablissement")).toBe(false);
    expect(axisHasBoundaries("mission")).toBe(false);
  });
});

describe("grouping by establishment", () => {
  it("keeps the twin's own hierarchy", () => {
    const t = treeForAxis(SNAP, "etablissement", TERRITORY);
    expect(t).toHaveLength(1);
    expect(t[0]!.label).toBe("Santé Québec Centre-Sud");
    expect(t[0]!.children).toHaveLength(3);
  });

  it("rolls capacity up and reports the worst reading, not the mean", () => {
    // 140, 60 and 70 average to 90 — which reads as busy. The 140 is the fact
    // that decides whether you expand the node.
    const t = treeForAxis(SNAP, "etablissement", TERRITORY);
    expect(t[0]!.count).toBe(495);
    expect(t[0]!.value).toBe("140%");
    expect(t[0]!.tone).toBe("danger");
  });
});

describe("grouping by territory", () => {
  it("regroups the same leaves under their boundaries", () => {
    const t = treeForAxis(SNAP, "territoire", TERRITORY);
    expect(t.map((x) => x.label)).toEqual(["RLS des Faubourgs", "RLS de Hochelaga"]);
    expect(t[0]!.children!.map((c) => c.label)).toEqual(["HÔPITAL NOTRE-DAME", "HÔTEL-DIEU"]);
  });

  it("loses no installation when the axis changes", () => {
    // Switching grouping is a change of question, never a filter. An
    // installation that quietly disappears on one axis is one nobody will think
    // to look for.
    const leaves = (items: ReturnType<typeof treeForAxis>) =>
      items.flatMap((i) => (i.children ?? [i])).map((c) => c.label).sort();
    expect(leaves(treeForAxis(SNAP, "territoire", TERRITORY)))
      .toEqual(leaves(treeForAxis(SNAP, "etablissement", TERRITORY)));
  });

  it("names the unassigned rather than dropping them", () => {
    const t = treeForAxis(SNAP, "territoire", new Map([["nd", "RLS des Faubourgs"]]));
    const orphan = t.find((x) => x.label === "No territory");
    expect(orphan).toBeTruthy();
    expect(orphan!.children).toHaveLength(2);
  });

  it("sorts the biggest territory first", () => {
    // 51 roots with 38 singletons: alphabetical order buries the ones holding
    // two thirds of the network.
    const t = treeForAxis(SNAP, "territoire", TERRITORY);
    expect(t[0]!.count).toBeGreaterThan(t[1]!.count!);
  });
});

// The MSSS register, as it reads for these three: Notre-Dame is a hospital that
// also runs a CHSLD wing, Hôtel-Dieu is a hospital, Angus is a CHSLD.
const MISSIONS = new Map([
  ["nd", ["CHSGS", "CHSLD"]],
  ["hd", ["CHSGS"]],
  ["chsld", ["CHSLD"]],
]);

describe("grouping by mission", () => {
  it("says the mission is undeclared instead of pretending to group", () => {
    // Until the register is imported. An empty grouping you can see is a
    // prompt; a hidden axis is a mystery.
    const t = treeForAxis(SNAP, "mission", TERRITORY);
    expect(t).toHaveLength(1);
    expect(t[0]!.label).toBe("No mission declared");
    expect(t[0]!.children).toHaveLength(3);
  });

  it("puts an installation under every mission it declares", () => {
    // 46 of Montréal's 328 declare more than one. Picking a primary would be
    // inventing a rank the register does not state, and "show me everything
    // that does CHSLD" has to include the hospital that does.
    const t = treeForAxis(SNAP, "mission", TERRITORY, MISSIONS);
    const under = (m: string) =>
      t.find((x) => x.label === m)!.children!.map((c) => c.label).sort();
    expect(under("CHSGS")).toEqual(["HÔPITAL NOTRE-DAME", "HÔTEL-DIEU"]);
    expect(under("CHSLD")).toEqual(["CHSLD ANGUS", "HÔPITAL NOTRE-DAME"]);
  });

  it("loses no installation, and adds none", () => {
    const t = treeForAxis(SNAP, "mission", TERRITORY, MISSIONS);
    const seen = new Set(t.flatMap((x) => x.children!).map((c) => c.label));
    expect(Array.from(seen).sort()).toEqual(["CHSLD ANGUS", "HÔPITAL NOTRE-DAME", "HÔTEL-DIEU"]);
  });

  it("warns on the heading that its beds are counted twice", () => {
    // CHSGS shows 446 and CHSLD 345; they sum to more than the 495 that exist.
    // That is what an overlapping grouping does, and a reader who adds the
    // columns without being told is the one who gets it wrong.
    const t = treeForAxis(SNAP, "mission", TERRITORY, MISSIONS);
    expect(t.find((x) => x.label === "CHSGS")!.hint).toMatch(/1 also counted elsewhere/);
    expect(t.find((x) => x.label === "CHSLD")!.hint).toMatch(/1 also counted elsewhere/);
  });

  it("says nothing about double counting when nothing is doubled", () => {
    // Territory is a partition, so the warning would be noise on every heading.
    const t = treeForAxis(SNAP, "territoire", TERRITORY);
    expect(t[0]!.hint).not.toMatch(/elsewhere/);
  });

  it("still names the unclassified when only some are registered", () => {
    const t = treeForAxis(SNAP, "mission", TERRITORY, new Map([["nd", ["CHSGS"]]]));
    const orphan = t.find((x) => x.label === "No mission declared");
    expect(orphan!.children!.map((c) => c.label).sort()).toEqual(["CHSLD ANGUS", "HÔTEL-DIEU"]);
  });
});

describe("an empty twin", () => {
  it("returns nothing rather than throwing", () => {
    expect(treeForAxis(null, "territoire")).toEqual([]);
  });
});

describe("missionsIn", () => {
  it("reads the list the institution declared", () => {
    expect(missionsIn({ missions: ["CHSGS", "CHSLD"] })).toEqual(["CHSGS", "CHSLD"]);
  });

  it("takes a single mission written as a string", () => {
    // Both are things a person reasonably types when declaring the property.
    expect(missionsIn({ mission: "CLSC" })).toEqual(["CLSC"]);
    expect(missionsIn({ missions: "CLSC" })).toEqual(["CLSC"]);
  });

  it("assumes nothing about the vocabulary", () => {
    // A transit network has no CHSLD. Whatever they wrote becomes the headings.
    expect(missionsIn({ missions: ["urgence", "réadaptation"] }))
      .toEqual(["urgence", "réadaptation"]);
  });

  it("drops blanks rather than making a heading with no name", () => {
    expect(missionsIn({ missions: ["CHSGS", "  ", ""] })).toEqual(["CHSGS"]);
  });

  it("drops a repeat rather than counting the installation twice under one heading", () => {
    expect(missionsIn({ missions: ["CHSLD", "CHSLD"] })).toEqual(["CHSLD"]);
  });

  it("says nothing when the property is absent or not text", () => {
    expect(missionsIn({})).toEqual([]);
    expect(missionsIn(undefined)).toEqual([]);
    expect(missionsIn({ missions: [1, 2] })).toEqual([]);
  });
});
