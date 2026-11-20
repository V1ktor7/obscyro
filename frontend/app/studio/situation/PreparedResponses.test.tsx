// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OptionFigures } from "../analyst-api";
import type { PreparedResponseCard } from "../prepared-api";

const api = vi.hoisted(() => ({ engageResponse: vi.fn() }));
vi.mock("../prepared-api", async (orig) => ({ ...(await orig<typeof import("../prepared-api")>()), ...api }));

import PreparedResponses, { runLine } from "./PreparedResponses";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const figures = (waitingDays: number, sitesWithQueue: number): OptionFigures => ({
  peakOccupancy: 0.93,
  peakDay: 36,
  sitesWithQueue,
  sitesWithActivity: 34,
  firstQueueDay: 20,
  waitingDays,
  peakWaiting: 12,
  peakWaitingDay: 38,
  strandedWaitingDays: null,
});

const response = (over: Partial<PreparedResponseCard> = {}): PreparedResponseCard => ({
  id: "r1",
  label: "Open 60 beds at Lakeshore",
  approver: "Director of nursing",
  objective: "Nobody waits at Lakeshore.",
  changes: ["Adds +60 litsantephysique at Lakeshore from day 10"],
  mechanism: "Lakeshore is the only site of its catchment.",
  horizon: 60,
  activity: "litsantephysique",
  withIt: figures(267, 3),
  without: figures(7316, 8),
  evidence: { measured: 1, published: 1, assumption: 2 },
  notTested: ["Whether 60 beds can be staffed by day 10."],
  scenarioName: "Omicron — calibrated",
  standing: { testedAt: "2026-11-17T15:00:00.000Z", age: "3 d", stale: false, reasons: [] },
  keptBy: "A planner",
  keptAt: "2026-11-17T15:10:00.000Z",
  ...over,
});

const section = (over: Partial<Parameters<typeof PreparedResponses>[0]> = {}) => (
  <PreparedResponses env="mtl" signalId="s1" kind="Occupation élevée" responses={[response()]} engage={{ possible: true, why: null }} onEngaged={() => {}} {...over} />
);

describe("the prepared responses on a situation card", () => {
  it("shows each response with what its test gave, what it rests on and what it does not say", () => {
    render(section());
    const card = screen.getByRole("article", { name: "Open 60 beds at Lakeshore" });
    expect(within(card).getByText("Can be approved by: Director of nursing")).toBeTruthy();
    expect(within(card).getByText("Tested 3 d ago on “Omicron — calibrated” · 60 days · litsantephysique · kept by A planner")).toBeTruthy();
    // The run with it beside the same run without, in the Result panel's terms.
    expect(within(card).getByText("267 patient-days waiting · 3 of 34 sites with a queue · peak 93 % on day 36 · first wait on day 20")).toBeTruthy();
    expect(within(card).getByText("7,316 patient-days waiting · 8 of 34 sites with a queue · peak 93 % on day 36 · first wait on day 20")).toBeTruthy();
    expect(within(card).getByText("Adds +60 litsantephysique at Lakeshore from day 10")).toBeTruthy();
    // The three levels stay apart, and the run is not offered as a forecast.
    expect(within(card).getByText(/rests on 1 measured, 1 published and 2 assumed elements\. A run is the result of a model under the conditions of its test, not a forecast\./)).toBeTruthy();
    expect(within(card).getByText("Whether 60 beds can be staffed by day 10.")).toBeTruthy();
    // A test that still speaks of the present carries no warning.
    expect(within(card).queryByRole("note")).toBeNull();
    expect(screen.getByText(/Nothing is triggered in any other system: Obscyro records and follows\. In the order they were kept; nothing here ranks them\./)).toBeTruthy();
  });

  it("says before the click that a test no longer speaks of the present", () => {
    const stale = response({
      standing: {
        testedAt: "2026-09-01T00:00:00.000Z",
        age: "80 d",
        stale: true,
        reasons: ["The scenario it was tested on (“Omicron — calibrated”) has changed since: these figures are those of the scenario as it was.", "The test is 80 d old. The network it ran on may not be the network now."],
      },
    });
    render(section({ responses: [stale] }));
    const warning = screen.getByRole("note");
    expect(within(warning).getByText("Read this before engaging it.")).toBeTruthy();
    expect(within(warning).getAllByRole("listitem").map((li) => li.textContent)).toEqual(stale.standing.reasons);
    // Still engageable: the person decides, knowing it.
    expect((screen.getByRole("button", { name: "Engage" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("engages in one click, says what was recorded, and has the card read again", async () => {
    api.engageResponse.mockResolvedValue({ decision: { id: "d1" }, signal: { id: "s1" }, stage: { name: "Évalué", needsApproval: true, closes: false }, by: "A planner" });
    const onEngaged = vi.fn();
    render(section({ onEngaged }));

    fireEvent.click(screen.getByRole("button", { name: "Engage" }));
    await waitFor(() => expect(api.engageResponse).toHaveBeenCalledTimes(1));
    // The signal and the response, by id. No figure is sent: the server holds them.
    expect(api.engageResponse).toHaveBeenCalledWith("mtl", "s1", { responseId: "r1" });
    const said = await screen.findByText(/Engaged by A planner\. The decision is recorded on this signal/);
    expect(said.textContent).toContain("the signal moved to “Évalué”, a stage that needs an approval: A planner is named as approving");
    expect(said.textContent).toContain("Nothing was triggered in any other system.");
    expect(onEngaged).toHaveBeenCalledTimes(1);
    // Engaged once: the button is gone, it cannot be clicked twice.
    expect(screen.queryByRole("button", { name: "Engage" })).toBeNull();
  });

  it("says why nothing can be engaged, and that nothing was recorded when the server refuses", async () => {
    const first = render(section({ engage: { possible: false, why: "This signal is closed. Reopen it before engaging a response." } }));
    expect((screen.getByRole("button", { name: "Engage" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("This signal is closed. Reopen it before engaging a response.")).toBeTruthy();
    first.unmount();

    api.engageResponse.mockRejectedValue(new Error("This signal is already at the last stage."));
    render(section());
    fireEvent.click(screen.getByRole("button", { name: "Engage" }));
    expect((await screen.findByRole("alert")).textContent).toBe("“Open 60 beds at Lakeshore” was not engaged: This signal is already at the last stage. Nothing was recorded.");
    // Refused: it can be tried again.
    expect((screen.getByRole("button", { name: "Engage" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("says where a response comes from when none is prepared", () => {
    render(section({ responses: [] }));
    expect(screen.getByText(/No response is prepared for this kind of signal yet\. One is kept from a tested option/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Engage" })).toBeNull();
  });

  it("writes a run the way the Result panel does", () => {
    expect(runLine({ ...figures(0.4, 0), firstQueueDay: null, peakOccupancy: null, peakDay: null })).toBe(
      "under 1 patient-days waiting · 0 of 34 sites with a queue · no peak reported · nobody waits",
    );
  });
});
