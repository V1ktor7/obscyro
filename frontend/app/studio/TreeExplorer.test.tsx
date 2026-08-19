// @vitest-environment jsdom

/**
 * The panel exists so a collapsed parent can answer "is anything wrong under
 * here" without being expanded, and so checking one branch redraws the map.
 * Both of those are behaviour, not layout.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import TreeExplorer, { matchingIds, subtreeIds, type TreeItem } from "./TreeExplorer";

afterEach(cleanup);

const TREE: TreeItem[] = [
  {
    id: "ciusss",
    label: "Santé Québec Centre-Sud",
    count: 4102,
    value: "140%",
    tone: "danger",
    children: [
      { id: "notre-dame", label: "HÔPITAL NOTRE-DAME", count: 296, value: "91%", tone: "warn" },
      { id: "hotel-dieu", label: "HÔTEL-DIEU", count: 150, value: "60%", tone: "ok" },
    ],
  },
  { id: "mcgill", label: "Centre universitaire de santé McGill", count: 5, tone: null },
];

function panel(over: Partial<React.ComponentProps<typeof TreeExplorer>> = {}) {
  const onSelect = vi.fn();
  const onToggleHidden = vi.fn();
  const onSolo = vi.fn();
  render(
    <TreeExplorer
      items={TREE}
      onSelect={onSelect}
      onToggleHidden={onToggleHidden}
      onSolo={onSolo}
      {...over}
    />,
  );
  return { onSelect, onToggleHidden, onSolo };
}

describe("expanding", () => {
  it("hides children until the parent is opened", () => {
    panel();
    expect(screen.queryByText("HÔPITAL NOTRE-DAME")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Expand Santé Québec Centre-Sud/ }));
    expect(screen.getByText("HÔPITAL NOTRE-DAME")).toBeTruthy();
  });

  it("collapses again", () => {
    panel();
    const toggle = () =>
      screen.getByRole("button", { name: /(Expand|Collapse) Santé Québec Centre-Sud/ });
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    expect(screen.queryByText("HÔPITAL NOTRE-DAME")).toBeNull();
  });

  it("gives a leaf no chevron to click", () => {
    panel();
    expect(screen.queryByRole("button", { name: /Expand Centre universitaire/ })).toBeNull();
  });
});

describe("what a collapsed row says", () => {
  it("carries the worst reading underneath, not just a name", () => {
    // A folder has no state; an establishment at 140% does. Without this the
    // panel is a list you scroll past on your way to the map.
    panel();
    expect(screen.getByText("140%")).toBeTruthy();
    expect(screen.getByText("4102")).toBeTruthy();
  });

  it("shows an empty ring when nothing is known, rather than a green one", () => {
    // "No data" and "fine" are different, and colouring the first like the
    // second is how a panel lies quietly.
    const { container } = render(<TreeExplorer items={[{ id: "x", label: "X", tone: null }]} />);
    expect(container.querySelector(".bg-emerald-500")).toBeNull();
  });
});

describe("inspecting, hiding and soloing are three gestures", () => {
  it("clicking a row inspects it and changes nothing on the map", () => {
    const { onSelect, onToggleHidden, onSolo } = panel();
    fireEvent.click(screen.getByText("Santé Québec Centre-Sud"));
    expect(onSelect).toHaveBeenCalledWith("ciusss");
    expect(onToggleHidden).not.toHaveBeenCalled();
    expect(onSolo).not.toHaveBeenCalled();
  });

  it("the eye hides a whole branch in one click", () => {
    // Deny-list semantics: from the default state, hiding one thing is one
    // click. With an allow-list the first click did nothing.
    const { onToggleHidden } = panel({ hidden: new Set<string>() });
    fireEvent.click(screen.getByRole("button", { name: /Hide Santé Québec Centre-Sud/ }));
    expect(onToggleHidden).toHaveBeenCalledWith(["ciusss", "notre-dame", "hotel-dieu"], true);
  });

  it("the eye brings a hidden branch back", () => {
    const { onToggleHidden } = panel({ hidden: new Set(["ciusss", "notre-dame", "hotel-dieu"]) });
    fireEvent.click(screen.getByRole("button", { name: /Show Santé Québec Centre-Sud/ }));
    expect(onToggleHidden).toHaveBeenCalledWith(["ciusss", "notre-dame", "hotel-dieu"], false);
  });

  it("`only` asks for this branch and nothing else", () => {
    // The gesture behind "show me Centre-Sud": its installations stay, every
    // other establishment goes. Hiding fifty of them by hand is not a workflow.
    const { onSolo } = panel({ hidden: new Set<string>() });
    fireEvent.click(screen.getAllByRole("button", { name: /Show only Santé Québec Centre-Sud/ })[0]!);
    expect(onSolo).toHaveBeenCalledWith(["ciusss", "notre-dame", "hotel-dieu"]);
  });

  it("offers no visibility controls when hiding is not on the table", () => {
    // A control that redraws nothing is an ornament.
    render(<TreeExplorer items={TREE} />);
    expect(screen.queryByRole("button", { name: /^Hide / })).toBeNull();
  });

  it("offers a way back when something is hidden", () => {
    // A hidden thing you have forgotten you hid is a map you will misread.
    const { onToggleHidden } = panel({ hidden: new Set(["notre-dame"]) });
    fireEvent.click(screen.getByText(/1 hidden/));
    expect(onToggleHidden).toHaveBeenCalledWith(["notre-dame"], false);
  });
});

describe("filtering", () => {
  it("opens the branches that contain a match", () => {
    // A filter that leaves its matches inside collapsed parents is worse than
    // no filter: the count says one, the panel shows none.
    panel();
    fireEvent.change(screen.getByLabelText("Filter the tree"), { target: { value: "notre" } });
    expect(screen.getByText("HÔPITAL NOTRE-DAME")).toBeTruthy();
  });

  it("hides what does not match, parents included", () => {
    panel();
    fireEvent.change(screen.getByLabelText("Filter the tree"), { target: { value: "notre" } });
    expect(screen.queryByText("Centre universitaire de santé McGill")).toBeNull();
    expect(screen.queryByText("HÔTEL-DIEU")).toBeNull();
    // The parent stays: it is the path to the match.
    expect(screen.getByText("Santé Québec Centre-Sud")).toBeTruthy();
  });

  it("says how many matched", () => {
    panel();
    fireEvent.change(screen.getByLabelText("Filter the tree"), { target: { value: "hôpital" } });
    expect(screen.getByText(/matching/)).toBeTruthy();
  });
});

describe("subtreeIds", () => {
  it("returns the node and everything under it", () => {
    expect(subtreeIds(TREE[0]!)).toEqual(["ciusss", "notre-dame", "hotel-dieu"]);
  });
});

describe("matchingIds", () => {
  it("keeps the ancestors of a match, so the path stays walkable", () => {
    expect(matchingIds(TREE, "dieu")).toEqual(new Set(["ciusss", "hotel-dieu"]));
  });

  it("matches across accents, in both directions", () => {
    // Half these names carry a circumflex and nobody types one while filtering.
    // Without folding, a network of HÔPITALs reports nothing found for
    // "hopital".
    expect(matchingIds(TREE, "hotel")).toEqual(new Set(["ciusss", "hotel-dieu"]));
    expect(matchingIds(TREE, "hôtel")).toEqual(new Set(["ciusss", "hotel-dieu"]));
    expect(matchingIds(TREE, "sante quebec")).toEqual(new Set(["ciusss"]));
  });

  it("is empty for an empty query, meaning no filtering at all", () => {
    expect(matchingIds(TREE, "   ").size).toBe(0);
  });
});

describe("the empty state", () => {
  it("says what to do rather than showing a blank panel", () => {
    render(<TreeExplorer items={[]} emptyLabel="No units yet." />);
    expect(screen.getByText("No units yet.")).toBeTruthy();
  });
});
