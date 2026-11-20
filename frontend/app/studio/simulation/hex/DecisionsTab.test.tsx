// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Decision, FollowUp, OptionFigures } from "../../analyst-api";

const api = vi.hoisted(() => ({ listDecisions: vi.fn(), fetchFollowUp: vi.fn() }));
vi.mock("../../analyst-api", async (orig) => ({ ...(await orig<typeof import("../../analyst-api")>()), ...api }));

import DecisionsTab from "./DecisionsTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const figures = (over: Partial<OptionFigures> = {}): OptionFigures => ({
  peakOccupancy: 0.941,
  peakDay: 24,
  sitesWithQueue: 8,
  sitesWithActivity: 34,
  firstQueueDay: 12,
  waitingDays: 7316.4,
  peakWaiting: 410,
  peakWaitingDay: 27,
  strandedWaitingDays: null,
  ...over,
});

const decision = (over: Partial<Decision> = {}): Decision => ({
  id: "d1",
  scenarioId: "sc1",
  scenarioName: "Omicron",
  exchangeId: "ex-1",
  optionStep: "s3",
  objective: "Nobody should wait at Lakeshore.",
  optionLabel: "Open 80 beds at Lakeshore from day 5",
  optionStamps: [],
  expected: {
    horizon: 60,
    activity: "lit",
    asItIs: figures(),
    withOption: figures({ sitesWithQueue: 0, firstQueueDay: null, waitingDays: 0, peakOccupancy: 0.9 }),
    sites: [],
    arrivals: { hospitalisation: [10, 20, 30] },
    basis: [
      { element: "+80 lit at Lakeshore from day 5, open and staffed", evidence: "assumption", from: "option" },
      { element: "Lakeshore holds 234 lit today", evidence: "measured", from: "twin" },
    ],
    mechanism: "",
    notTested: [],
    notes: [],
  },
  sourceSteps: [],
  note: null,
  decidedBy: "Dominique Roy",
  decidedAt: "2026-11-17T15:00:00.000Z",
  ...over,
});

const LINKED: FollowUp = {
  linked: true,
  dataset: { id: "ds", name: "INSPQ — Admissions" },
  acuity: "hospitalisation",
  origin: "2021-12-13",
  horizon: 60,
  reported: 3,
  expected: [10, 20, 30],
  observed: [12, 18, 41],
  fit: { n: 3, meanAbsoluteError: 5, peakSimulated: { step: 2, value: 30 }, peakObserved: { step: 2, value: 41 }, peakOffset: 0, correlation: null },
  totals: { days: 3, expected: 60, observed: 71, gap: 11 },
};

const tab = (scenario: { id: string; name: string } | null = { id: "sc1", name: "Omicron" }, refresh = 0) =>
  render(<DecisionsTab env="mtl" scenario={scenario} refresh={refresh} />);

describe("the decisions tab", () => {
  it("says how a decision comes to be, when there is none", async () => {
    api.listDecisions.mockResolvedValue({ decisions: [] });
    tab();
    expect(await screen.findByText("No decision recorded in this project yet.")).toBeTruthy();
    expect(api.listDecisions).toHaveBeenCalledWith("mtl");
  });

  it("lists who retained what, for which objective, and what was expected of it", async () => {
    api.listDecisions.mockResolvedValue({ decisions: [decision(), decision({ id: "d2", scenarioId: "sc9", scenarioName: "Heat 2027", optionLabel: "Open the cooling centres" })] });
    tab();
    // The open scenario's decisions first, the project's others after.
    expect(await screen.findByText("On this scenario · 1")).toBeTruthy();
    expect(screen.getByText("On other scenarios of the project · 1")).toBeTruthy();
    const card = screen.getByText("Open 80 beds at Lakeshore from day 5").closest("li")!;
    expect(within(card).getByText(/Dominique Roy · .*2026.* · Omicron/)).toBeTruthy();
    expect(within(card).getByText("Nobody should wait at Lakeshore.")).toBeTruthy();

    // What was expected with the option is on the card, with its gap from the same run without it.
    const figure = (term: string) => within(card).getAllByText(term).map((dt) => dt.nextElementSibling?.textContent);
    expect(within(card).getByText("Expected with it · 60 days · lit")).toBeTruthy();
    expect(figure("Peak occupancy")).toEqual(["90 % · day 24"]);
    expect(figure("Sites with a queue")).toEqual(["0 of 34"]);
    expect(figure("Patient-days waiting")).toEqual(["0−7,316 vs without it"]);
    expect(figure("First day somebody waits")).toEqual(["nobody waits"]);
    // What is expected is a run, and the card says so.
    expect(within(card).getByText(/From the run that tested the option \(step s3\).*not a forecast/)).toBeTruthy();

    // The run without it is one click away, in the same figures.
    fireEvent.click(within(card).getByRole("button", { name: "Expected without it" }));
    expect(figure("Peak occupancy")).toEqual(["90 % · day 24", "94 % · day 24"]);
    expect(figure("Sites with a queue")).toEqual(["0 of 34", "8 of 34"]);
    expect(figure("Patient-days waiting")).toEqual(["0−7,316 vs without it", "7,316"]);
    expect(figure("First day somebody waits")).toEqual(["nobody waits", "day 12"]);

    // So is what it rested on, counted by level before it is opened.
    const rested = within(card).getByRole("button", { name: /What it rested on/ });
    expect(rested.textContent).toMatch(/1 measured · 1 assumption/);
    fireEvent.click(rested);
    expect(within(card).getByText("Lakeshore holds 234 lit today").previousSibling?.textContent).toBe("Measured");
  });

  it("sets what was expected beside what was observed, gives the gap, and concludes nothing", async () => {
    api.listDecisions.mockResolvedValue({ decisions: [decision()] });
    api.fetchFollowUp.mockResolvedValue(LINKED);
    tab();
    fireEvent.click(await screen.findByRole("button", { name: "Compare with observed" }));
    expect(await screen.findByRole("img", { name: "Expected and observed hospitalisation arrivals, by day" })).toBeTruthy();
    expect(api.fetchFollowUp).toHaveBeenCalledWith("mtl", "d1");

    const value = (term: string) => screen.getByText(term).nextElementSibling?.textContent;
    expect(value("Expected over the 3 days both report")).toBe("60");
    expect(value("Observed over the same days")).toBe("71");
    expect(value("Gap, observed minus expected")).toBe("+11");
    expect(value("Average gap a day")).toBe("5");
    expect(value("Observed peak, against the expected one")).toBe("same day");
    // The limit is named, and the judgement is left where it belongs.
    expect(screen.getByText(/The twin keeps no\s+history of queues or occupancy/)).toBeTruthy();
    expect(screen.getByText(/whether the decision held is yours to judge/)).toBeTruthy();
    expect(screen.queryByText(/worked|failed|success|was right|was wrong/i)).toBeNull();
  });

  it("says why there is nothing to compare when no series is set beside the scenario", async () => {
    api.listDecisions.mockResolvedValue({ decisions: [decision()] });
    api.fetchFollowUp.mockResolvedValue({ linked: false, reason: "No observed series is set beside this scenario. Set one under Result, Reality check, then come back." });
    tab();
    fireEvent.click(await screen.findByRole("button", { name: "Compare with observed" }));
    expect(await screen.findByText(/No observed series is set beside this scenario/)).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("does not turn a series that reports nothing into a gap of nothing", async () => {
    api.listDecisions.mockResolvedValue({ decisions: [decision()] });
    api.fetchFollowUp.mockResolvedValue({ ...LINKED, reported: 0, observed: [null, null, null], totals: null, fit: null });
    tab();
    fireEvent.click(await screen.findByRole("button", { name: "Compare with observed" }));
    expect(await screen.findByText(/reports nothing over these days/)).toBeTruthy();
    expect(screen.queryByText("Gap, observed minus expected")).toBeNull();
  });

  it("reads the list again when a decision was just recorded, and says when it cannot", async () => {
    api.listDecisions.mockResolvedValue({ decisions: [] });
    const view = tab();
    await screen.findByText("No decision recorded in this project yet.");
    api.listDecisions.mockResolvedValue({ decisions: [decision()] });
    view.rerender(<DecisionsTab env="mtl" scenario={{ id: "sc1", name: "Omicron" }} refresh={1} />);
    expect(await screen.findByText("Open 80 beds at Lakeshore from day 5")).toBeTruthy();

    api.listDecisions.mockRejectedValue(new Error("offline"));
    view.rerender(<DecisionsTab env="mtl" scenario={{ id: "sc1", name: "Omicron" }} refresh={2} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/could not be read: offline/));
  });
});

describe("a decision that replaced or removed a choice of the scenario", () => {
  it("says what the option took out, so “40 beds” is not read as forty more", async () => {
    api.listDecisions.mockResolvedValue({
      decisions: [
        decision({
          optionLabel: "40 beds at Lakeshore instead of 60",
          expected: {
            ...decision().expected,
            changes: [{ does: "replaces", now: "+40 lit at Lakeshore from day 10", was: "+60 lit at Lakeshore from day 10" }],
            retires: [{ id: "st-60", stamp: { body: { kind: "capacity" }, start: 10, days: 50 }, text: "+60 lit at Lakeshore from day 10", replacedBy: 0 }],
          },
        }),
      ],
    });
    tab();
    expect(await screen.findByText("What it did to the scenario")).toBeTruthy();
    expect(screen.getByText("Replaces").parentElement!.textContent).toBe("Replaces +60 lit at Lakeshore from day 10 with +40 lit at Lakeshore from day 10");
  });

  it("says nothing more for a decision that only added, as every older decision did", async () => {
    api.listDecisions.mockResolvedValue({ decisions: [decision()] });
    tab();
    await screen.findByText("Open 80 beds at Lakeshore from day 5");
    expect(screen.queryByText("What it did to the scenario")).toBeNull();
  });
});

