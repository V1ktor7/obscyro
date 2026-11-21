// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TwinAlertSeverity, TwinUnitNode } from "@/lib/platform-api";

import UnitsBoard, { type UnitsBoardProps } from "./UnitsBoard";
import type { Measure, RuleLike } from "./units-list";

afterEach(cleanup);

const STRETCHERS: Measure = { key: "stretchers", label: "Stretcher occupancy", unit: "percent" };
const AIR: Measure = { key: "air", label: "Air quality index", unit: "number" };
const OVER_100: RuleLike[] = [{ metric: "stretchers", op: ">", threshold: 100 }];

function node(
  id: string,
  name: string,
  value: number | null,
  more: { kind?: string; parent?: string; alerts?: number; severity?: TwinAlertSeverity } = {},
): TwinUnitNode {
  const alerts = more.alerts ?? 0;
  return {
    id,
    name,
    kind: more.kind ?? "org",
    code: id,
    parentId: more.parent ?? null,
    metrics: {
      unitId: id,
      instanceCountByType: {},
      values: value === null ? {} : { stretchers: value },
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

const FLAT = [
  node("suroit", "HÔPITAL DU SUROÎT", 150, { alerts: 1 }),
  node("victoria", "Hôpital Royal Victoria", 239, { alerts: 1 }),
  node("verdun", "Hôpital de Verdun", 62),
  node("granby", "Hôpital de Granby", 95),
  node("legare", "CHSLD Légaré", null),
  node("bassin", "Bassin d'égout de Montréal-Sud", null, { kind: "bassin" }),
];

const TREE = [
  node("e1", "Santé Québec Centre-Sud", 82, { kind: "etablissement" }),
  node("s1", "Hôpital de Verdun", 77, { kind: "installation", parent: "e1" }),
  node("s2", "Hôpital Notre-Dame", 111, { kind: "installation", parent: "e1", alerts: 1 }),
  node("e2", "Santé Québec Ouest-de-l'Île", 100, { kind: "etablissement" }),
];

function board(over: Partial<UnitsBoardProps> = {}) {
  const props: UnitsBoardProps = {
    nodes: FLAT,
    measure: STRETCHERS,
    measures: [STRETCHERS, AIR],
    rules: OVER_100,
    kind: null,
    selectedId: null,
    stream: "stream",
    onMeasure: vi.fn(),
    onKind: vi.fn(),
    onSelect: vi.fn(),
    onEditMeasures: vi.fn(),
    onEditThresholds: vi.fn(),
    onLiveMetrics: vi.fn(),
    onSeed: vi.fn(),
    sheet: (unit) => <p>sheet: {unit ? `${unit.name}, ${unit.text}` : "nothing"}</p>,
    ...over,
  };
  return { props, ...render(<UnitsBoard {...props} />) };
}

/** The names of the lines on screen, top to bottom. */
const lines = () => Array.from(document.querySelectorAll('[id^="unit-row-"]')).map((el) => el.getAttribute("id")!.slice("unit-row-".length));
const chip = (label: RegExp) => within(screen.getByRole("group", { name: "Filter the units" })).getByRole("button", { name: label });

describe("the Units page", () => {
  it("lists the units in alert first, then those that report, and folds away those with no value", () => {
    board();
    expect(lines()).toEqual(["victoria", "suroit", "granby", "verdun"]);
    expect(screen.getByRole("heading", { name: /2 in alert · over the threshold/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /2 reporting, no alert/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /2 with no value for this measure/ })).toBeTruthy();

    // One click unfolds them, with a sentence that says a missing value is not a zero.
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(lines()).toEqual(["victoria", "suroit", "granby", "verdun", "bassin", "legare"]);
    expect(screen.getByText(/That is not a zero/)).toBeTruthy();
    expect(within(document.getElementById("unit-row-legare")!).getByText("no value")).toBeTruthy();
  });

  it("counts the units on the chips, and a chip keeps only its units", () => {
    board();
    expect(chip(/All units/).textContent).toContain("6");
    expect(chip(/In alert/).textContent).toContain("2");
    expect(chip(/Reporting, no alert/).textContent).toContain("2");
    expect(chip(/No value/).textContent).toContain("2");

    fireEvent.click(chip(/In alert/));
    expect(chip(/In alert/).getAttribute("aria-pressed")).toBe("true");
    expect(lines()).toEqual(["victoria", "suroit"]);

    // The chip of the units with no value shows them without a second click.
    fireEvent.click(chip(/No value/));
    expect(lines()).toEqual(["bassin", "legare"]);
  });

  it("says a full name, its value, and how many alerts are open on it", () => {
    board();
    const row = document.getElementById("unit-row-suroit")!;
    expect(within(row).getByText("HÔPITAL DU SUROÎT")).toBeTruthy();
    expect(within(row).getByText("150%")).toBeTruthy();
    expect(within(row).getByText("1 critical")).toBeTruthy();
    expect(within(document.getElementById("unit-row-verdun")!).queryByText(/critical/)).toBeNull();
  });

  it("finds a unit by name without its accents, in the folded group too", () => {
    board();
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a unit" }), { target: { value: "legare" } });
    expect(lines()).toEqual(["legare"]);

    fireEvent.change(screen.getByRole("searchbox", { name: "Find a unit" }), { target: { value: "zzz" } });
    expect(lines()).toEqual([]);
    expect(screen.getByText("No unit matches “zzz”.")).toBeTruthy();
  });

  it("reorders on demand", () => {
    board();
    fireEvent.change(screen.getByRole("combobox", { name: /^Sort/ }), { target: { value: "low" } });
    expect(lines()).toEqual(["suroit", "victoria", "verdun", "granby"]);
    fireEvent.change(screen.getByRole("combobox", { name: /^Sort/ }), { target: { value: "name" } });
    expect(lines()).toEqual(["suroit", "victoria", "granby", "verdun"]);
  });

  it("selects a unit on a click and hands it to the sheet", () => {
    const { props, rerender } = board();
    expect(screen.getByText("sheet: nothing")).toBeTruthy();
    fireEvent.click(document.getElementById("unit-row-suroit")!);
    expect(props.onSelect).toHaveBeenCalledWith("suroit");

    rerender(<UnitsBoard {...props} selectedId="suroit" />);
    expect(document.getElementById("unit-row-suroit")!.getAttribute("aria-current")).toBe("true");
    expect(screen.getByText("sheet: HÔPITAL DU SUROÎT, 150%")).toBeTruthy();
  });

  it("changes the measure, and names its buttons", () => {
    const { props } = board();
    fireEvent.change(screen.getByRole("combobox", { name: /^Measure/ }), { target: { value: "air" } });
    expect(props.onMeasure).toHaveBeenCalledWith("air");

    fireEvent.click(screen.getByRole("button", { name: "Measures" }));
    fireEvent.click(screen.getByRole("button", { name: "Alert thresholds" }));
    fireEvent.click(screen.getByRole("button", { name: "Live metrics" }));
    expect(props.onEditMeasures).toHaveBeenCalledTimes(1);
    expect(props.onEditThresholds).toHaveBeenCalledTimes(1);
    expect(props.onLiveMetrics).toHaveBeenCalledTimes(1);
  });

  it("offers the kinds the twin really has, and only when there is more than one", () => {
    const { props, unmount } = board();
    const kind = screen.getByRole("combobox", { name: /^Kind/ });
    expect(within(kind).getAllByRole("option").map((o) => o.textContent)).toEqual(["All kinds", "org", "bassin"]);
    fireEvent.change(kind, { target: { value: "bassin" } });
    expect(props.onKind).toHaveBeenCalledWith("bassin");
    unmount();

    board({ nodes: FLAT.filter((n) => n.kind === "org") });
    expect(screen.queryByRole("combobox", { name: /^Kind/ })).toBeNull();
  });

  it("narrows the list and its counters to one kind", () => {
    board({ kind: "bassin" });
    expect(chip(/All units/).textContent).toContain("1");
    expect(chip(/In alert/).textContent).toContain("0");
    // A kind kept from another project filters nothing.
    cleanup();
    board({ kind: "ward" });
    expect(chip(/All units/).textContent).toContain("6");
  });

  it("offers the demo only on a project with no unit", () => {
    const { props, unmount } = board({ nodes: [] });
    fireEvent.click(screen.getByRole("button", { name: "Seed demo" }));
    expect(props.onSeed).toHaveBeenCalledTimes(1);
    unmount();

    board();
    expect(screen.queryByRole("button", { name: "Seed demo" })).toBeNull();
  });

  it("says it is reading before the first units arrive", () => {
    board({ nodes: null });
    expect(screen.getByText("Reading the units…")).toBeTruthy();
    expect(lines()).toEqual([]);
  });

  it("unfolds the group that hides a unit a link names", () => {
    board({ revealId: "legare", selectedId: "legare" });
    expect(lines()).toContain("legare");
  });
});

describe("the tiles", () => {
  it("draw one tile per unit with a value, and say how many are not drawn", () => {
    const { props } = board();
    fireEvent.click(screen.getByRole("button", { name: "Tiles" }));
    expect(screen.getByRole("button", { name: "Tiles" }).getAttribute("aria-pressed")).toBe("true");

    expect(screen.getByRole("heading", { name: /4 units with a value · one tile each/ })).toBeTruthy();
    const tile = screen.getByRole("button", { name: "HÔPITAL DU SUROÎT, 150%" });
    expect(screen.queryByRole("button", { name: /CHSLD Légaré/ })).toBeNull();
    expect(screen.getByText(/2 units with no value for this measure are not drawn\./)).toBeTruthy();
    // The legend carries the threshold's own numbers.
    expect(screen.getByText("over 160%")).toBeTruthy();
    expect(screen.getByText("over the threshold, 100%")).toBeTruthy();

    fireEvent.click(tile);
    expect(props.onSelect).toHaveBeenCalledWith("suroit");
  });

  it("say why there is nothing to draw for the units with no value", () => {
    board();
    fireEvent.click(screen.getByRole("button", { name: "Tiles" }));
    fireEvent.click(chip(/No value/));
    expect(screen.getByText(/A tile shows a value, and the 2 units here have none for this measure/)).toBeTruthy();
  });

  it("carry no colour, and say so, when the measure has no threshold", () => {
    board({ rules: [] });
    fireEvent.click(screen.getByRole("button", { name: "Tiles" }));
    expect(screen.getByText(/No alert threshold is set on this measure/)).toBeTruthy();
    expect(screen.queryByText(/over the threshold/)).toBeNull();
  });
});

describe("a twin with a hierarchy", () => {
  it("shows the top units folded, and says what a folded one hides", () => {
    board({ nodes: TREE });
    expect(lines()).toEqual(["e2", "e1"]);
    const parent = document.getElementById("unit-row-e1")!;
    expect(parent.getAttribute("aria-expanded")).toBe("false");
    expect(within(parent).getByText(/etablissement · 2 under it/)).toBeTruthy();
    expect(within(parent).getByText("1 in alert below")).toBeTruthy();
    // A unit with nothing under it does not fold.
    expect(document.getElementById("unit-row-e2")!.hasAttribute("aria-expanded")).toBe(false);
  });

  it("unfolds a unit on a click, and folds it back on a second click on the unit being read", () => {
    const { props, rerender } = board({ nodes: TREE });
    fireEvent.click(document.getElementById("unit-row-e1")!);
    expect(props.onSelect).toHaveBeenCalledWith("e1");
    expect(lines()).toEqual(["e2", "e1", "s2", "s1"]);
    expect(document.getElementById("unit-row-e1")!.getAttribute("aria-expanded")).toBe("true");
    // Unfolded, the alert is on its own line: the parent no longer has to announce it.
    expect(within(document.getElementById("unit-row-e1")!).queryByText(/in alert below/)).toBeNull();

    rerender(<UnitsBoard {...props} nodes={TREE} selectedId="e1" />);
    fireEvent.click(document.getElementById("unit-row-e1")!);
    expect(lines()).toEqual(["e2", "e1"]);
  });

  it("lists flat again as soon as a chip filters", () => {
    board({ nodes: TREE });
    fireEvent.click(chip(/In alert/));
    expect(lines()).toEqual(["s2"]);
  });

  it("opens the branch that leads to a unit a link names", () => {
    board({ nodes: TREE, revealId: "s1", selectedId: "s1" });
    expect(lines()).toEqual(["e2", "e1", "s2", "s1"]);
  });
});
