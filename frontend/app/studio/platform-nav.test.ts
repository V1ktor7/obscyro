import { describe, expect, it } from "vitest";

import { NAV_SECTIONS, navItemActive, type NavItem } from "./platform-nav";

/**
 * Which sub-navigation entry is lit.
 *
 * A highlight that says "you are in all three of these" is worse than none: it
 * is the one part of the screen whose whole job is to answer "where am I".
 * Three entries under Models point at `/studio/lab` and differ only by `?tab=`,
 * and a path-prefix test lit every one of them.
 */

const item = (href: string, label = "x"): NavItem => ({ label, href });
const q = (s: string) => new URLSearchParams(s);

describe("only one entry is the one you are looking at", () => {
  const lab = [
    item("/studio/lab?tab=models", "Models"),
    item("/studio/lab?tab=causality", "Causality"),
    item("/studio/lab?tab=train", "Signal model"),
  ];

  it("lights exactly the tab in the URL", () => {
    const on = lab.filter((i) => navItemActive(i, "/studio/lab", q("tab=causality"), lab));
    expect(on.map((i) => i.label)).toEqual(["Causality"]);
  });

  it("lights none of them when the URL names a tab they do not have", () => {
    const on = lab.filter((i) => navItemActive(i, "/studio/lab", q("tab=feed"), lab));
    expect(on).toEqual([]);
  });

  it("lights none of them on the bare page rather than all of them", () => {
    // This was the bug: every entry matched on path alone.
    const on = lab.filter((i) => navItemActive(i, "/studio/lab", q(""), lab));
    expect(on).toEqual([]);
  });

  it("does not leak across sections that share a prefix", () => {
    expect(navItemActive(item("/studio/lab?tab=models"), "/studio/twin", q("tab=models"), [])).toBe(
      false,
    );
  });
});

describe("entries that name no parameter", () => {
  const manager = [
    item("/studio/manager", "Overview"),
    item("/studio/manager?view=health", "Health"),
  ];

  it("stands in for the section's landing page", () => {
    expect(navItemActive(manager[0]!, "/studio/manager", q(""), manager)).toBe(true);
  });

  it("yields to a sibling whose parameters match", () => {
    // Otherwise both the landing entry and the real one are lit at once.
    expect(navItemActive(manager[0]!, "/studio/manager", q("view=health"), manager)).toBe(false);
    expect(navItemActive(manager[1]!, "/studio/manager", q("view=health"), manager)).toBe(true);
  });
});

describe("the legacy view field still behaves", () => {
  const items: NavItem[] = [
    { label: "Health issues", href: "/studio/manager?view=health", view: "health" },
    { label: "Cleanup", href: "/studio/manager?view=cleanup", view: "cleanup" },
  ];

  it("matches on the value it declares", () => {
    expect(navItemActive(items[0]!, "/studio/manager", q("view=health"), items)).toBe(true);
    expect(navItemActive(items[1]!, "/studio/manager", q("view=health"), items)).toBe(false);
  });
});

describe("the Models section lists what the lab has", () => {
  it("names every tab, so none is reachable only from inside the page", () => {
    const models = NAV_SECTIONS.find((s) => s.id === "models")!;
    const tabs = models.groups
      .flatMap((g) => g.items)
      .map((i) => new URLSearchParams(i.href.split("?")[1]).get("tab"));
    expect(tabs.sort()).toEqual(
      ["causality", "compare", "feed", "forecast", "models", "notebook", "train"].sort(),
    );
  });

  it("gives every entry a different destination", () => {
    const models = NAV_SECTIONS.find((s) => s.id === "models")!;
    const hrefs = models.groups.flatMap((g) => g.items).map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
