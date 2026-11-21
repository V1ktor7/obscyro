import { describe, expect, it } from "vitest";

import type { TwinAlertSeverity, TwinUnitNode } from "@/lib/platform-api";

import {
  ancestorsOf,
  bandLabel,
  barScale,
  barShare,
  buildRows,
  comparator,
  countUnits,
  formatMeasure,
  hasHierarchy,
  heatLegend,
  heatOf,
  kindsOf,
  matches,
  ruleForUnit,
  ruleInWords,
  sections,
  sharedRule,
  treeLines,
  type Measure,
  type RuleLike,
} from "./units-list";

const STRETCHERS: Measure = { key: "stretchers", label: "Stretcher occupancy", unit: "percent" };
const OVER_100: RuleLike[] = [{ metric: "stretchers", op: ">", threshold: 100 }];

/** A unit as the twin's tree gives it. `value` is its stretcher occupancy; null when it reports none. */
function node(
  id: string,
  name: string,
  value: number | null,
  more: { kind?: string; parent?: string; alerts?: number; severity?: TwinAlertSeverity; values?: Record<string, number | null> } = {},
): TwinUnitNode {
  const alerts = more.alerts ?? 0;
  return {
    id,
    name,
    kind: more.kind ?? "org",
    code: id.toUpperCase(),
    parentId: more.parent ?? null,
    metrics: {
      unitId: id,
      instanceCountByType: {},
      values: { ...(value === null ? {} : { stretchers: value }), ...(more.values ?? {}) },
      occupancyPct: null,
      numericMeans: {},
      freshnessSeconds: null,
      freshnessBasis: "empty",
      fetchedAgeSeconds: null,
      linkedInstanceCount: 0,
    },
    worstAlertSeverity: alerts > 0 ? (more.severity ?? "critical") : null,
    openAlertCount: alerts,
  };
}

const NETWORK = [
  node("a", "HÔPITAL DU SUROÎT", 150, { alerts: 1 }),
  node("b", "Hôpital Royal Victoria", 239, { alerts: 1 }),
  node("c", "Hôpital de Verdun", 62),
  node("d", "Hôpital de Granby", 95),
  node("e", "CHSLD Légaré", null),
  node("f", "Bassin d'égout de Montréal-Sud", null, { kind: "bassin", values: { wastewater: 1.2 } }),
  // In alert on another measure: it reports nothing for the one shown.
  node("g", "Station Saint-Michel", null, { alerts: 1, severity: "warn", values: { air: 55 } }),
];

const rows = (nodes = NETWORK, rules = OVER_100, measure = STRETCHERS) => buildRows(nodes, measure, rules);
const names = (list: { name: string }[]) => list.map((r) => r.name);

describe("the three states of a unit", () => {
  it("puts every unit in exactly one, so the counters add up to the total", () => {
    const counts = countUnits(rows());
    expect(counts).toEqual({ all: 7, alert: 3, reporting: 2, silent: 2 });
    expect(counts.alert + counts.reporting + counts.silent).toBe(counts.all);
  });

  it("keeps a unit in alert on another measure in alert, and says it has no value here", () => {
    const station = rows().find((r) => r.id === "g")!;
    expect(station.status).toBe("alert");
    expect(station.value).toBeNull();
    expect(station.text).toBe("no value");
    expect(station.band).toBe("absent");
  });

  it("never reads a missing value as a zero", () => {
    const silent = rows().find((r) => r.id === "e")!;
    expect(silent.value).toBeNull();
    expect(silent.status).toBe("silent");
    // A real zero is a value, and the unit reports.
    const empty = rows([node("z", "Centre de santé", 0)])[0]!;
    expect(empty.value).toBe(0);
    expect(empty.status).toBe("reporting");
    expect(empty.text).toBe("0%");
  });
});

describe("the colour of a line follows the alert rule", () => {
  it("is over exactly when the rule would fire, near within 15% of it, calm below", () => {
    const band = (id: string) => rows().find((r) => r.id === id)!.band;
    expect(band("a")).toBe("over");
    expect(band("d")).toBe("near"); // 95, threshold 100
    expect(band("c")).toBe("calm"); // 62
    expect(band("e")).toBe("absent");
  });

  it("has no good or bad on a measure nobody thresholded", () => {
    expect(rows(NETWORK, []).find((r) => r.id === "a")!.band).toBe("unbanded");
  });

  it("applies the rule written for the unit's kind", () => {
    const rules: RuleLike[] = [
      { metric: "stretchers", op: ">", threshold: 100, unitKind: "org" },
      { metric: "stretchers", op: ">", threshold: 200, unitKind: "bassin" },
    ];
    expect(ruleForUnit(rules, "stretchers", "org")).toEqual(expect.objectContaining({ threshold: 100 }));
    expect(ruleForUnit(rules, "stretchers", "bassin")).toEqual(expect.objectContaining({ threshold: 200 }));
    expect(ruleForUnit(rules, "stretchers", "ward")).toBeNull();
    // A rule for every kind applies everywhere.
    expect(ruleForUnit(OVER_100, "stretchers", "ward")).toEqual(expect.objectContaining({ threshold: 100 }));
  });
});

describe("the order of the list", () => {
  it("ranks highest first, and leaves a unit with no value last in both directions", () => {
    const high = [...rows()].sort(comparator("high"));
    expect(names(high).slice(0, 4)).toEqual(["Hôpital Royal Victoria", "HÔPITAL DU SUROÎT", "Hôpital de Granby", "Hôpital de Verdun"]);
    expect(high.slice(4).every((r) => r.value === null)).toBe(true);

    const low = [...rows()].sort(comparator("low"));
    expect(names(low).slice(0, 4)).toEqual(["Hôpital de Verdun", "Hôpital de Granby", "HÔPITAL DU SUROÎT", "Hôpital Royal Victoria"]);
    expect(low.slice(4).every((r) => r.value === null)).toBe(true);
  });

  it("sorts by name without regard to case or accents", () => {
    const byName = [...rows()].sort(comparator("name"));
    expect(names(byName)[0]).toBe("Bassin d'égout de Montréal-Sud");
    expect(names(byName).indexOf("HÔPITAL DU SUROÎT")).toBeGreaterThan(names(byName).indexOf("Hôpital de Verdun"));
  });

  it("groups in alert, reporting, and no value, each in its own order", () => {
    const groups = sections(rows(), { filter: "all", query: "", sort: "high" });
    expect(names(groups.alert)).toEqual(["Hôpital Royal Victoria", "HÔPITAL DU SUROÎT", "Station Saint-Michel"]);
    expect(names(groups.reporting)).toEqual(["Hôpital de Granby", "Hôpital de Verdun"]);
    // Nothing to rank them on: by name.
    expect(names(groups.silent)).toEqual(["Bassin d'égout de Montréal-Sud", "CHSLD Légaré"]);
  });

  it("empties the groups a filter leaves out", () => {
    const groups = sections(rows(), { filter: "alert", query: "", sort: "high" });
    expect(groups.alert).toHaveLength(3);
    expect(groups.reporting).toEqual([]);
    expect(groups.silent).toEqual([]);
  });
});

describe("the search", () => {
  it("finds a name whatever its case and its accents", () => {
    const suroit = rows().find((r) => r.id === "a")!;
    expect(matches(suroit, "hopital du suroit")).toBe(true);
    expect(matches(suroit, "  SUROÎT ")).toBe(true);
    expect(matches(suroit, "verdun")).toBe(false);
    expect(matches(suroit, "")).toBe(true);
  });

  it("narrows every group", () => {
    const groups = sections(rows(), { filter: "all", query: "hopital de", sort: "high" });
    expect(names(groups.alert)).toEqual([]);
    expect(names(groups.reporting)).toEqual(["Hôpital de Granby", "Hôpital de Verdun"]);
  });
});

describe("the hierarchy", () => {
  const TREE = [
    node("e1", "Santé Québec Centre-Sud", 82, { kind: "etablissement" }),
    node("s1", "Hôpital de Verdun", 77, { kind: "installation", parent: "e1" }),
    node("s2", "Hôtel-Dieu de Montréal", null, { kind: "installation", parent: "e1" }),
    node("s3", "Hôpital Notre-Dame", 111, { kind: "installation", parent: "e1", alerts: 1 }),
    node("e2", "Santé Québec Ouest-de-l'Île", 100, { kind: "etablissement" }),
    node("s4", "Centre d'hébergement de Dorval", null, { kind: "installation", parent: "e2" }),
    node("w1", "Urgence", 111, { kind: "service", parent: "s3", alerts: 1 }),
  ];
  const tree = () => rows(TREE);

  it("is seen from the parent links, and only from parents that are in the list", () => {
    expect(hasHierarchy(tree())).toBe(true);
    expect(hasHierarchy(rows())).toBe(false);
    // A parent the list does not hold leaves its unit at the top.
    expect(rows([node("x", "Orphan", 1, { parent: "nowhere" })])[0]!.parentId).toBeNull();
  });

  it("shows only the top units until one is opened", () => {
    const folded = treeLines(tree(), { query: "", sort: "high", open: new Set() });
    expect(names(folded.map((l) => l.row))).toEqual(["Santé Québec Ouest-de-l'Île", "Santé Québec Centre-Sud"]);
    expect(folded.every((l) => !l.open && l.depth === 0)).toBe(true);
  });

  it("unfolds a unit into what is under it, ranked like the rest", () => {
    const lines = treeLines(tree(), { query: "", sort: "high", open: new Set(["e1"]) });
    expect(lines.map((l) => [l.row.name, l.depth])).toEqual([
      ["Santé Québec Ouest-de-l'Île", 0],
      ["Santé Québec Centre-Sud", 0],
      ["Hôpital Notre-Dame", 1],
      ["Hôpital de Verdun", 1],
      ["Hôtel-Dieu de Montréal", 1],
    ]);
    expect(lines.find((l) => l.row.id === "e1")!.open).toBe(true);
  });

  it("opens the path to a match when searching, and hides the rest", () => {
    const lines = treeLines(tree(), { query: "urgence", sort: "high", open: new Set() });
    expect(lines.map((l) => [l.row.name, l.depth, l.open])).toEqual([
      ["Santé Québec Centre-Sud", 0, true],
      ["Hôpital Notre-Dame", 1, true],
      ["Urgence", 2, false],
    ]);
  });

  it("says how many units under a folded one are in alert", () => {
    const byId = new Map(tree().map((r) => [r.id, r]));
    expect(byId.get("e1")!.children).toBe(3);
    expect(byId.get("e1")!.alertsBelow).toBe(2); // Notre-Dame and its emergency room
    expect(byId.get("s3")!.alertsBelow).toBe(1);
    expect(byId.get("e2")!.alertsBelow).toBe(0);
  });

  it("names the units to open to reach one", () => {
    expect(ancestorsOf(tree(), "w1")).toEqual(["e1", "s3"]);
    expect(ancestorsOf(tree(), "e1")).toEqual([]);
  });

  it("does not hang on links that loop", () => {
    const loop = [node("p", "P", 1, { parent: "q" }), node("q", "Q", 2, { parent: "p", alerts: 1 })];
    const built = rows(loop);
    expect(built).toHaveLength(2);
    expect(treeLines(built, { query: "", sort: "high", open: new Set(["p", "q"]) })).toEqual([]);
    expect(ancestorsOf(built, "p").length).toBeLessThanOrEqual(64);
  });
});

describe("the bar", () => {
  it("shares one scale, rounded up to a number one can say, with the threshold inside it", () => {
    expect(barScale(rows())).toEqual({ min: 0, max: 240 });
    // The threshold is on the track even when every value is under it.
    expect(barScale(rows([node("c", "Verdun", 62)]))).toEqual({ min: 0, max: 100 });
    expect(barScale(rows([node("x", "X", 7.3)], []))).toEqual({ min: 0, max: 7.3 });
  });

  it("has no scale when nothing reports, and a length when every value is zero", () => {
    expect(barScale(rows([node("e", "Légaré", null)]))).toBeNull();
    expect(barScale(rows([node("z", "Z", 0)], []))).toEqual({ min: 0, max: 1 });
  });

  it("places a value as a share of the track, never outside it", () => {
    const scale = { min: 0, max: 240 };
    expect(barShare(120, scale)).toBe(50);
    expect(barShare(500, scale)).toBe(100);
    expect(barShare(-5, scale)).toBe(0);
  });

  it("tells one threshold for all from several, and from none", () => {
    expect(sharedRule(rows())).toEqual({ kind: "one", rule: expect.objectContaining({ op: ">", threshold: 100 }) });
    expect(sharedRule(rows(NETWORK, []))).toEqual({ kind: "none" });
    const perKind: RuleLike[] = [
      { metric: "stretchers", op: ">", threshold: 100, unitKind: "org" },
      { metric: "stretchers", op: ">", threshold: 80, unitKind: "ward" },
    ];
    const mixed = rows([node("a", "A", 150), node("w", "W", 90, { kind: "ward" })], perKind);
    expect(sharedRule(mixed)).toEqual({ kind: "mixed" });
  });
});

describe("the tiles", () => {
  const heat = (value: number, rules = OVER_100) => heatOf(rows([node("t", "T", value)], rules)[0]!);

  it("paints three steps past the threshold, by how far past", () => {
    expect(heat(101)).toBe("over1");
    expect(heat(120)).toBe("over1");
    expect(heat(121)).toBe("over2");
    expect(heat(160)).toBe("over2");
    expect(heat(161)).toBe("over3");
    expect(heat(95)).toBe("near");
    expect(heat(40)).toBe("calm");
    expect(heat(150, [])).toBe("plain");
  });

  it("counts the distance on the bad side, when low is the bad side", () => {
    const low: RuleLike[] = [{ metric: "stretchers", op: "<", threshold: 50 }];
    expect(heat(45, low)).toBe("over1");
    expect(heat(30, low)).toBe("over2");
    expect(heat(10, low)).toBe("over3");
    expect(heat(90, low)).toBe("calm");
  });

  it("writes the legend with the threshold's own numbers", () => {
    expect(heatLegend(sharedRule(rows()), STRETCHERS).map((s) => s.label)).toEqual([
      "over 160%",
      "over 120%",
      "over the threshold, 100%",
      "close to the threshold",
      "clear of it",
    ]);
    const low = rows([node("t", "T", 45)], [{ metric: "stretchers", op: "<=", threshold: 50 }]);
    expect(heatLegend(sharedRule(low), STRETCHERS).map((s) => s.label).slice(0, 3)).toEqual([
      "under 20%",
      "under 40%",
      "at or under the threshold, 50%",
    ]);
  });

  it("has no numbers to give when units have different thresholds, and no legend without one", () => {
    expect(heatLegend({ kind: "mixed" }, STRETCHERS)[0]!.label).toBe("far past its threshold");
    expect(heatLegend({ kind: "none" }, STRETCHERS)).toEqual([]);
  });
});

describe("the words", () => {
  it("writes a number with the unit of its measure", () => {
    expect(formatMeasure(149.6, STRETCHERS)).toBe("150%");
    expect(formatMeasure(null, STRETCHERS)).toBe("no value");
    expect(formatMeasure(1.234, { key: "wastewater", label: "Wastewater", unit: "ratio" })).toBe("1.23");
    expect(formatMeasure(33, { key: "linkedInstanceCount", label: "Linked instances" })).toBe("33");
    expect(formatMeasure(3360, { key: "freshnessSeconds", label: "Freshness (s)" })).toBe("56m");
  });

  it("says a rule in words", () => {
    expect(ruleInWords({ op: ">", threshold: 100 }, STRETCHERS)).toBe("alert when over 100%");
    expect(ruleInWords({ op: "<=", threshold: 2 }, { key: "staff", label: "Staff", unit: "count" })).toBe("alert when at or under 2");
  });

  it("names where a unit stands, on the side the rule calls bad", () => {
    expect(bandLabel("over", { op: ">", threshold: 100 })).toBe("Over the threshold");
    expect(bandLabel("calm", { op: ">", threshold: 100 })).toBe("Under the threshold");
    expect(bandLabel("over", { op: "<", threshold: 2 })).toBe("Under the threshold");
    expect(bandLabel("calm", { op: "<", threshold: 2 })).toBe("Over the threshold");
    expect(bandLabel("over", { op: ">=", threshold: 100 })).toBe("At or over the threshold");
    expect(bandLabel("near", { op: ">", threshold: 100 })).toBe("Close to the threshold");
    expect(bandLabel("unbanded", null)).toBe("No alert threshold");
    expect(bandLabel("absent", null)).toBe("No value for this measure");
  });

  it("lists the kinds present, most numerous first", () => {
    expect(kindsOf(NETWORK)).toEqual(["org", "bassin"]);
  });
});
