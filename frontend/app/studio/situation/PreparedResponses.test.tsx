// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OptionFigures } from "../analyst-api";
import type { LiveTest, PreparedResponseCard } from "../prepared-api";

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

/** No signal of this kind has had the response tested again: the card shows the test kept in calm time. */
const live = (over: Partial<LiveTest> = {}): LiveTest => ({
  state: "none",
  says: "Not tested on the current state. What is shown is the test kept in calm time.",
  figures: null,
  testedAt: null,
  current: false,
  seconds: null,
  problem: null,
  ...over,
});

/** The retest's two runs: the network has filled up since the response was kept. */
const RETEST = { asItIs: figures(9120, 11), withOption: figures(1840, 5) };

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
  live: live(),
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
    // And the card says which test these figures are: nothing has tested the response on the current state.
    expect(within(card).getByRole("status").textContent).toBe("Not tested on the current state. What is shown is the test kept in calm time.");
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

  it("shows the last test known while the retest runs, then the retest's figures in its place", () => {
    const KEPT = "267 patient-days waiting · 3 of 34 sites with a queue · peak 93 % on day 36 · first wait on day 20";
    const running = response({
      live: live({ state: "testing", says: "Being tested on the current state, started 12 s ago. What is shown is the test kept in calm time." }),
    });
    const view = render(section({ responses: [running] }));
    let card = screen.getByRole("article", { name: "Open 60 beds at Lakeshore" });
    expect(within(card).getByRole("status").textContent).toBe("Being tested on the current state, started 12 s ago. What is shown is the test kept in calm time.");
    // A run in progress is not a result: the figures are still the kept test's, with its date.
    expect(within(card).getByText(KEPT)).toBeTruthy();
    expect(within(card).getByText(/^Tested 3 d ago on “Omicron — calibrated”/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Engage" }) as HTMLButtonElement).disabled).toBe(false);

    // The retest finished: its two runs take the place of the kept test's.
    const tested = response({
      // The kept test is old: that was about figures no longer on the card.
      standing: { testedAt: "2026-09-01T00:00:00.000Z", age: "80 d", stale: true, reasons: ["The test is 80 d old. The network it ran on may not be the network now."] },
      live: live({ state: "tested", says: "Tested on the current state 40 s ago.", figures: RETEST, testedAt: "2026-11-20T14:59:20.000Z", current: true, seconds: 61 }),
    });
    view.rerender(section({ responses: [tested] }));
    card = screen.getByRole("article", { name: "Open 60 beds at Lakeshore" });
    expect(within(card).getByRole("status").textContent).toBe("Tested on the current state 40 s ago. The engine took 61 s.");
    expect(within(card).getByText("1,840 patient-days waiting · 5 of 34 sites with a queue · peak 93 % on day 36 · first wait on day 20")).toBeTruthy();
    expect(within(card).getByText("9,120 patient-days waiting · 11 of 34 sites with a queue · peak 93 % on day 36 · first wait on day 20")).toBeTruthy();
    expect(within(card).queryByText(KEPT)).toBeNull();
    // What the kept test gave stays readable beside it, said as such.
    expect(within(card).getByText("In the test it was kept from: 267 patient-days waiting with it, 7,316 without.")).toBeTruthy();
    expect(within(card).getByText("Run on “Omicron — calibrated” · 60 days · litsantephysique · first tested 80 d ago · kept by A planner")).toBeTruthy();
    // The conditions of the run are stated, and what is measured stays apart from what is assumed.
    expect(
      within(card).getByText(
        /^This test starts from the twin as it was read when the test ran, which is measured\. The response, and the events and choices of the scenario, are assumptions\. The test it was kept from rested on 1 measured, 1 published and 2 assumed elements\. A run is the result of a model under the conditions of its test, not a forecast\.$/,
      ),
    ).toBeTruthy();
    expect(within(card).queryByRole("note")).toBeNull();
  });

  it("never shows an abandoned retest as a result, and leaves the response engageable", () => {
    const says =
      "The test on the current state was abandoned 2 min ago: The engine had not answered after 3 min, so the test was abandoned. What is shown is the test kept in calm time.";
    render(section({ responses: [response({ live: live({ says, problem: says }) })] }));
    const card = screen.getByRole("article", { name: "Open 60 beds at Lakeshore" });
    expect(within(card).getByRole("status").textContent).toBe(says);
    expect(within(card).getByText("267 patient-days waiting · 3 of 34 sites with a queue · peak 93 % on day 36 · first wait on day 20")).toBeTruthy();
    expect(within(card).queryByText(/In the test it was kept from/)).toBeNull();
    expect((screen.getByRole("button", { name: "Engage" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("says before the click that a retest speaks of an earlier state", () => {
    const earlier = live({ state: "tested", says: "Tested on the network as it was 3 h ago; it has not been tested since.", figures: RETEST, testedAt: "2026-11-20T12:00:00.000Z", current: false, seconds: 58 });
    render(section({ responses: [response({ live: earlier })] }));
    expect(screen.getByRole("status").textContent).toBe("Read this before engaging it. Tested on the network as it was 3 h ago; it has not been tested since. The engine took 58 s.");
    expect((screen.getByRole("button", { name: "Engage" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("says that the decision keeps both tests when a retest was on the card", async () => {
    api.engageResponse.mockResolvedValue({
      decision: { id: "d1", expected: { retested: { testedAt: "2026-11-20T14:59:20.000Z", current: true, ...RETEST } } },
      signal: { id: "s1" },
      stage: { name: "Évalué", needsApproval: false, closes: false },
      by: "A planner",
    });
    render(section({ responses: [response({ live: live({ state: "tested", says: "Tested on the current state 40 s ago.", figures: RETEST, current: true }) })] }));
    fireEvent.click(screen.getByRole("button", { name: "Engage" }));
    const said = await screen.findByText(/Engaged by A planner/);
    expect(said.textContent).toContain(
      "The decision is recorded on this signal with the figures of the test it was kept from as what is expected, and those of the test on the current state beside them, and the signal moved to “Évalué”.",
    );
  });

  it("engages in one click, says what was recorded, and has the card read again", async () => {
    api.engageResponse.mockResolvedValue({ decision: { id: "d1" }, signal: { id: "s1" }, stage: { name: "Évalué", needsApproval: true, closes: false }, by: "A planner" });
    const onEngaged = vi.fn();
    render(section({ onEngaged }));

    fireEvent.click(screen.getByRole("button", { name: "Engage" }));
    await waitFor(() => expect(api.engageResponse).toHaveBeenCalledTimes(1));
    // The signal and the response, by id. No figure is sent: the server holds them.
    expect(api.engageResponse).toHaveBeenCalledWith("mtl", "s1", { responseId: "r1" });
    const said = await screen.findByText(/Engaged by A planner\. The decision is recorded on this signal with these figures as what is expected/);
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
