import { describe, expect, it } from "vitest";

import { alertsForSite, isSiteHidden } from "./units-tree";

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
