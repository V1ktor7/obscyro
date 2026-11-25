// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import type { TwinAlert } from "@/lib/platform-api";

import AlertsList, { inOrder } from "./AlertsList";

afterEach(cleanup);

const NOW = Date.parse("2026-11-24T18:00:00.000Z");
const alert = (id: string, over: Partial<TwinAlert> = {}): TwinAlert => ({
  id,
  unitInstanceId: `unit-${id}`,
  ruleId: null,
  severity: "critical",
  metric: "occupancy",
  value: 124,
  message: `${id} over capacity`,
  recommendation: "",
  status: "open",
  createdAt: "2026-11-24T15:00:00.000Z",
  ...over,
});
const ALERTS = [
  alert("verdun", { severity: "warn", createdAt: "2026-11-24T17:30:00.000Z" }),
  alert("chum", { createdAt: "2026-11-24T15:00:00.000Z" }),
  alert("hgj", { createdAt: "2026-11-24T17:00:00.000Z" }),
  alert("lab", { severity: "info", createdAt: "2026-11-22T18:00:00.000Z" }),
];
const SITES: Record<string, { id: string; name: string }> = {
  "unit-chum": { id: "site-chum", name: "CHUM" },
  "unit-hgj": { id: "site-hgj", name: "HGJ" },
  "unit-verdun": { id: "site-verdun", name: "Verdun" },
};
const pick = vi.fn();
const list = (props: Partial<Parameters<typeof AlertsList>[0]> = {}) =>
  render(<AlertsList alerts={ALERTS} siteOf={(u) => SITES[u] ?? null} env="mtl" selectedSiteId={null} onPick={pick} now={NOW} {...props} />);

describe("the open alerts beside the network map", () => {
  it("lists the most severe first, then the most recently opened", () => {
    expect(inOrder(ALERTS).map((a) => a.id)).toEqual(["hgj", "chum", "verdun", "lab"]);
    list();
    expect(screen.getByText("4 open · 2 critical. A click selects the site on the map.")).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((li) => within(li).getAllByText(/over capacity/)[0]!.textContent)).toEqual([
      "hgj over capacity",
      "chum over capacity",
      "verdun over capacity",
      "lab over capacity",
    ]);
  });

  it("says how severe an alert is and how long it has been open", () => {
    list();
    expect(screen.getByText("critical · open for 3 h")).toBeTruthy();
    expect(screen.getByText("warn · open for 30 min")).toBeTruthy();
  });

  it("selects the site that counts the alert's unit, and marks the one selected", () => {
    list({ selectedSiteId: "site-hgj" });
    const row = screen.getByRole("button", { name: /chum over capacity/ });
    expect(row.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: /hgj over capacity/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(row);
    expect(pick).toHaveBeenCalledWith("site-chum");
  });

  it("says when an alert's unit has no site on the map, and still leads to its situation card", () => {
    list();
    const row = screen.getByRole("button", { name: /lab over capacity/ }) as HTMLButtonElement;
    expect(row.disabled).toBe(true);
    expect(screen.getByText("info · open for 2 d · its unit has no site on the map")).toBeTruthy();
    const links = screen.getAllByRole("link", { name: "Situation" }).map((a) => a.getAttribute("href"));
    expect(links).toHaveLength(4);
    expect(links[3]).toBe("/studio/situation?env=mtl&alert=lab&unit=unit-lab");
  });

  it("says that nothing is open, and what opens an alert", () => {
    list({ alerts: [] });
    expect(screen.getByText(/No alert is open\. An alert opens when a measure crosses the threshold/)).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });
});
