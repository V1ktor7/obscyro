import { describe, expect, it } from "vitest";

import { NAV_SECTIONS, navItemActive } from "../platform-nav";
import { LAB_TABS, labTabFrom } from "./lab-tabs";

const models = NAV_SECTIONS.find((s) => s.id === "models")!;
const items = models.groups.flatMap((g) => g.items);

describe("the lab's tabs", () => {
  it("are each listed once in the navigation, in the same order: the page has no row of its own", () => {
    expect(items.map((i) => i.href)).toEqual(LAB_TABS.map((t) => `/studio/lab?tab=${t}`));
  });

  it("light exactly one entry of the navigation for the tab the page shows", () => {
    for (const tab of LAB_TABS) {
      const params = new URLSearchParams({ tab });
      const lit = items.filter((i) => navItemActive(i, "/studio/lab", params, items));
      expect(lit.map((i) => i.href)).toEqual([`/studio/lab?tab=${tab}`]);
      expect(labTabFrom(params.get("tab"))).toBe(tab);
    }
  });

  it("open on Models when the address names no tab, or one that does not exist", () => {
    expect(labTabFrom(null)).toBe("models");
    expect(labTabFrom("")).toBe("models");
    expect(labTabFrom("nope")).toBe("models");
  });

  it("keep the name that says which signal model it is", () => {
    expect(items.find((i) => i.href.endsWith("tab=train"))?.label).toBe("Signal model (ARX)");
  });
});
