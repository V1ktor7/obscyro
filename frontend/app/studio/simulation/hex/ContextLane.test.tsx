// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HealthEvent } from "../../analyst-api";
import ContextLane from "./ContextLane";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const CURFEW: HealthEvent = {
  id: "e1",
  title: "Curfew across Québec",
  place: "Québec",
  door: "access",
  startsOn: "2021-12-31",
  endsOn: "2022-01-17",
  proposedStartsOn: "2021-12-31",
  proposedEndsOn: null,
  sourceUrl: "https://www.quebec.ca/nouvelles/couvre-feu",
  sourceTitle: "Nouvelles mesures pour freiner la transmission",
  passage: "Un couvre-feu sera en vigueur à compter du 31 décembre 2021",
  sources: [],
  proposedByAnalyst: true,
  exchangeId: "ex-1",
  candidate: "c1",
  validatedBy: "Dominique Roy",
  validatedAt: "2026-11-17T15:00:00.000Z",
};

const remove = vi.fn();
function lane(props: Partial<Parameters<typeof ContextLane>[0]> = {}) {
  return render(
    <div>
      <ContextLane events={[CURFEW]} origin="2021-12-13" horizon={60} day={0} onRemove={remove} {...props} />
    </div>,
  );
}

describe("the Context lane of the timeline", () => {
  it("places a validated event on the scenario's days, from the date of day 0", () => {
    lane();
    const bar = screen.getByRole("button", { name: "Curfew across Québec" });
    // Day 18 to day 35 of sixty.
    expect(bar.style.left).toBe("30%");
    expect(bar.style.width).toBe("30%");
    expect(bar.getAttribute("title")).toMatch(/2021-12-31 to 2022-01-17 · published, not part of the run/);
  });

  it("opens an event with its source, its quoted passage and who accepted it", () => {
    lane();
    fireEvent.click(screen.getByRole("button", { name: "Curfew across Québec" }));
    const card = screen.getByLabelText("Event: Curfew across Québec");
    expect(within(card).getByText("Published")).toBeTruthy();
    expect(within(card).getByText("Access")).toBeTruthy();
    expect(within(card).getByText(/“Un couvre-feu sera en vigueur à compter du 31 décembre 2021”/)).toBeTruthy();
    expect(within(card).getByText(/2021-12-31 to 2022-01-17 · Québec/)).toBeTruthy();
    expect(within(card).getByText(/Accepted by Dominique Roy on 2026-11-17, from a candidate the analyst proposed/)).toBeTruthy();
    // It is never passed off as the twin's, or as part of the run.
    expect(within(card).getByText(/not measured by the twin, and not\s+part of the run/)).toBeTruthy();
    const links = within(card).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([CURFEW.sourceUrl, CURFEW.sourceUrl]);
    expect(links.every((a) => a.getAttribute("rel") === "noopener noreferrer" && a.getAttribute("target") === "_blank")).toBe(true);
  });

  it("removes an event only after a second click that says what it does", async () => {
    remove.mockResolvedValue(undefined);
    lane();
    fireEvent.click(screen.getByRole("button", { name: "Curfew across Québec" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove from the calendar" }));
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByText(/The analyst will no longer see it/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("e1"));
    await waitFor(() => expect(screen.queryByLabelText("Event: Curfew across Québec")).toBeNull());
  });

  it("says why nothing is drawn when day 0 has no calendar date", () => {
    lane({ origin: null });
    expect(screen.queryByRole("button", { name: "Curfew across Québec" })).toBeNull();
    expect(screen.getByText(/Day 0 has no calendar date, so the 1 validated event cannot be placed\. Set one under Result, Reality check\./)).toBeTruthy();
  });

  it("says where events come from when there is none, and how many fall outside the days", () => {
    const { unmount } = lane({ events: [] });
    expect(screen.getByText("No validated event yet. Find some under Analyst, Event finder.")).toBeTruthy();
    unmount();
    lane({ events: [CURFEW, { ...CURFEW, id: "e2", title: "First wave", startsOn: "2020-03-13", endsOn: "2020-05-01" }] });
    expect(screen.getByText("1 more validated event outside these days.")).toBeTruthy();
  });

  it("does not make a link of an address that is not a web page", () => {
    lane({ events: [{ ...CURFEW, sourceUrl: "javascript:alert(1)" }] });
    fireEvent.click(screen.getByRole("button", { name: "Curfew across Québec" }));
    expect(within(screen.getByLabelText("Event: Curfew across Québec")).queryAllByRole("link")).toEqual([]);
  });
});
