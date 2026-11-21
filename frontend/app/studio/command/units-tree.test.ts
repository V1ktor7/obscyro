import { describe, expect, it } from "vitest";

import { alertsForSite, isSiteHidden, lineAndBelow, lineOfSite, pickFromExplorer, unitsAbove } from "./units-tree";

/**
 * The map and the tree do not share identifiers, and forgetting that is what
 * made "hide everything" leave every pin on screen. The map draws `Site`
 * instances — the ones carrying coordinates — and the tree is built from the
 * `OrgUnit`s standing on them.
 */

const site = (id: string, units: string[]) => ({
  id,
  contributingUnits: units.map((u) => ({ id: u })),
});

describe("isSiteHidden", () => {
  it("does not match a site against unit ids, which share nothing", () => {
    // The bug, pinned: hiding the unit standing on this site used to compare
    // `site.id` to a set of unit ids and never match.
    expect(isSiteHidden(site("site-1", ["unit-1"]), new Set(["unit-1"]))).toBe(true);
  });

  it("keeps a site while any unit on it is still visible", () => {
    // Two tenants at one address: hiding one should not remove the building.
    expect(isSiteHidden(site("s", ["a", "b"]), new Set(["a"]))).toBe(false);
    expect(isSiteHidden(site("s", ["a", "b"]), new Set(["a", "b"]))).toBe(true);
  });

  it("hides nothing when nothing is hidden", () => {
    expect(isSiteHidden(site("s", ["a"]), new Set())).toBe(false);
  });

  it("leaves a site no unit stands on alone", () => {
    // Nothing in the tree speaks for it, so nothing in the tree should be able
    // to silence it — it would vanish with no row to bring it back.
    expect(isSiteHidden({ id: "orphan", contributingUnits: [] }, new Set(["a", "b"]))).toBe(false);
  });

  it("still honours a direct hit on an orphan's own id", () => {
    expect(isSiteHidden({ id: "orphan", contributingUnits: [] }, new Set(["orphan"]))).toBe(true);
  });

  it("survives a payload with no contributingUnits field at all", () => {
    expect(isSiteHidden({ id: "s" }, new Set(["a"]))).toBe(false);
  });
});

describe("alertsForSite", () => {
  const alert = (unitInstanceId: string, id = unitInstanceId) => ({ id, unitInstanceId });

  it("finds the alert raised on the unit standing on this site", () => {
    // The bug, pinned: the inspector compared an alert's unit id to the site's
    // own id and never matched, so a hospital ringed red on the map read
    // "Open alerts · 0" in the panel beside it.
    const site = { id: "site-1", contributingUnits: [{ id: "unit-1" }] };
    expect(alertsForSite(site, [alert("unit-1"), alert("unit-2")])).toEqual([alert("unit-1")]);
  });

  it("gathers every tenant's alerts at a shared address", () => {
    const site = { id: "s", contributingUnits: [{ id: "a" }, { id: "b" }] };
    expect(alertsForSite(site, [alert("a"), alert("b"), alert("c")]).length).toBe(2);
  });

  it("still matches a site that is itself a unit", () => {
    expect(alertsForSite({ id: "u", contributingUnits: [] }, [alert("u")]).length).toBe(1);
  });

  it("claims nothing for a sensor nothing stands on", () => {
    expect(alertsForSite({ id: "station", contributingUnits: [] }, [alert("unit-1")])).toEqual([]);
  });

  it("survives a payload with no contributingUnits field", () => {
    expect(alertsForSite({ id: "s" }, [alert("s"), alert("x")]).length).toBe(1);
  });
});

/**
 * The same trap on the click: a line of the explorer is a unit, the panel beside
 * the map opens on a site. Looking for a site with the unit's id opened nothing,
 * on every line of both production projects.
 */
describe("pickFromExplorer", () => {
  const suroit = { id: "unit-suroit", label: "HÔPITAL DU SUROÎT" };
  const none = { above: [], under: [] };

  it("opens the site that counts the unit, not a site with the unit's id", () => {
    const sites = [site("site-a", ["unit-other"]), site("site-b", ["unit-suroit"])];
    expect(pickFromExplorer(suroit, none, sites)).toEqual({ line: "unit-suroit", siteId: "site-b", fit: [], note: null });
  });

  it("still opens a site that is itself the unit", () => {
    expect(pickFromExplorer(suroit, none, [site("unit-suroit", [])]).siteId).toBe("unit-suroit");
    expect(pickFromExplorer(suroit, none, [{ id: "unit-suroit" }]).siteId).toBe("unit-suroit");
  });

  it("says so when the unit is counted at more than one site", () => {
    const pick = pickFromExplorer(suroit, none, [site("site-a", ["unit-suroit"]), site("site-b", ["unit-suroit"])]);
    expect(pick.siteId).toBe("site-a");
    expect(pick.note).toBe("“HÔPITAL DU SUROÎT” is counted at 2 sites. This is one of them.");
  });

  it("opens the site of the unit above, for a ward the site does not name", () => {
    // A site lists only the topmost unit standing on it.
    const ward = { id: "ward-1", label: "Urgence" };
    const pick = pickFromExplorer(ward, { above: ["dept-1", "unit-suroit"], under: [] }, [site("site-b", ["unit-suroit"])]);
    expect(pick.siteId).toBe("site-b");
    expect(pick.note).toBe("“Urgence” has no place of its own on the map. This is the site of the unit it belongs to.");
  });

  it("shows the sites of what is under an establishment, and opens no panel", () => {
    const establishment = { id: "etab-1", label: "Santé Québec Centre-Sud" };
    const sites = [site("site-a", ["inst-1"]), site("site-b", ["inst-2"]), site("site-c", ["inst-9"]), site("site-d", ["inst-1"])];
    const pick = pickFromExplorer(establishment, { above: [], under: ["inst-1", "inst-2", "inst-3"] }, sites);
    expect(pick.siteId).toBeNull();
    // Each site once, however many of the units under the line it counts.
    expect(pick.fit).toEqual(["site-a", "site-d", "site-b"]);
    expect(pick.note).toBe("“Santé Québec Centre-Sud” has no place of its own on the map. The map shows the 3 sites of what is under it.");
  });

  it("does the same for a heading of the territory or mission grouping", () => {
    const heading = { id: "axis:Montérégie", label: "Montérégie" };
    const pick = pickFromExplorer(heading, { above: [], under: ["unit-suroit"] }, [site("site-b", ["unit-suroit"])]);
    expect(pick).toEqual({
      line: "axis:Montérégie",
      siteId: null,
      fit: ["site-b"],
      note: "“Montérégie” has no place of its own on the map. The map shows the 1 site of what is under it.",
    });
  });

  it("says a unit is not on the map rather than doing nothing", () => {
    const basin = { id: "unit-basin", label: "BASSIN D'EGOUT DE MONTREAL-SUD" };
    expect(pickFromExplorer(basin, none, [site("site-a", ["unit-other"])])).toEqual({
      line: "unit-basin",
      siteId: null,
      fit: [],
      note: "“BASSIN D'EGOUT DE MONTREAL-SUD” is not on the map: no site counts it.",
    });
  });
});

describe("lineOfSite", () => {
  const lines = new Set(["unit-1", "unit-2"]);

  it("is the unit the site counts, since the site is not a line of the explorer", () => {
    expect(lineOfSite(site("site-a", ["unit-9", "unit-2"]), lines)).toBe("unit-2");
  });

  it("is the site itself when the site is a unit", () => {
    expect(lineOfSite(site("unit-1", []), lines)).toBe("unit-1");
  });

  it("is nothing for a sensor no unit stands on", () => {
    expect(lineOfSite(site("station", []), lines)).toBeNull();
    expect(lineOfSite({ id: "station" }, lines)).toBeNull();
  });
});

describe("lineAndBelow", () => {
  const items = [
    { id: "etab-1", label: "Centre-Sud", children: [{ id: "inst-1", label: "Verdun", children: [{ id: "ward-1", label: "Urgence" }] }, { id: "inst-2", label: "Notre-Dame" }] },
    { id: "etab-2", label: "Ouest-de-l'Île" },
  ];

  it("gives a line's name and every id under it, at any depth", () => {
    expect(lineAndBelow(items, "etab-1")).toEqual({ label: "Centre-Sud", under: ["inst-1", "ward-1", "inst-2"] });
    expect(lineAndBelow(items, "inst-1")).toEqual({ label: "Verdun", under: ["ward-1"] });
    expect(lineAndBelow(items, "etab-2")).toEqual({ label: "Ouest-de-l'Île", under: [] });
  });

  it("knows no line by an id the explorer does not show", () => {
    expect(lineAndBelow(items, "elsewhere")).toBeNull();
  });
});

describe("unitsAbove", () => {
  const nodes = [
    { id: "etab-1", parentId: null },
    { id: "inst-1", parentId: "etab-1" },
    { id: "ward-1", parentId: "inst-1" },
  ];

  it("lists the units above, nearest first", () => {
    expect(unitsAbove(nodes, "ward-1")).toEqual(["inst-1", "etab-1"]);
    expect(unitsAbove(nodes, "etab-1")).toEqual([]);
  });

  it("has nothing above a heading, which is not a unit", () => {
    expect(unitsAbove(nodes, "axis:Montérégie")).toEqual([]);
  });

  it("does not hang on links that loop", () => {
    const loop = [{ id: "a", parentId: "b" }, { id: "b", parentId: "a" }];
    expect(unitsAbove(loop, "a")).toEqual(["b", "a"]);
  });
});
