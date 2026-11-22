// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/auth";

import type { PreparedResponseCard } from "../prepared-api";
import type { AlertReading, SituationCard, UnitReading } from "../situation-api";

const api = vi.hoisted(() => ({ getSituation: vi.fn() }));
vi.mock("../situation-api", async (orig) => ({ ...(await orig<typeof import("../situation-api")>()), ...api }));

const analyst = vi.hoisted(() => ({ askAnalyst: vi.fn() }));
vi.mock("../analyst-api", async (orig) => ({ ...(await orig<typeof import("../analyst-api")>()), ...analyst }));

const where = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(where.search) }));
vi.mock("../StudioShell", () => ({ useStudio: () => ({ selectedEnv: "mtl" }) }));

import SituationView, { REREAD_MS, REREAD_TESTING_MS } from "./SituationView";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  where.search = "alert=a1&unit=u1&signal=s1";
});

const alert = (over: Partial<AlertReading> = {}): AlertReading => ({
  id: "a1",
  unit: "Urgence — Hôpital A",
  unit_id: "u1",
  severity: "critical",
  measure: "Occupancy",
  measure_key: "occupancy",
  value: 132,
  counted_in: "percent",
  says: "Urgence — Hôpital A — 132 %",
  opened_at: "2026-11-20T12:00:00.000Z",
  open_for: "3 h",
  value_age: { known: "exact", age: "37 min", says: "value read 37 min ago", why: null },
  signal: null,
  ...over,
});

const unit = (over: Partial<UnitReading> = {}): UnitReading => ({
  read_at: "2026-11-20T15:00:00.000Z",
  unit: { id: "u1", name: "Urgence — Hôpital A", inside: "Hôpital A", sub_units: 2 },
  measures: [
    { key: "occupancy", measure: "Occupancy", value: 132, counted_in: "percent" },
    { key: "iqa", measure: "Air quality index", value: null, counted_in: "number" },
  ],
  under_it_by_type: { Civière: 41, Patient: 54 },
  linked: 95,
  value_age: { known: "at_least", age: "2 h", says: "value read at least 2 h ago", why: "One of the sources feeding this unit published no readable time, so this is a floor." },
  last_written_here: "50 min ago",
  open_alerts: [alert(), alert({ id: "a2", severity: "warn", says: "Air quality above 50 near Hôpital A", measure: "Air quality index", value: 61.4, counted_in: "number", open_for: "12 min" })],
  how_to_read: [],
  ...over,
});

const card = (over: Partial<SituationCard> = {}): SituationCard => ({
  at: "2026-11-20T15:00:00.000Z",
  unit: unit(),
  alert: { state: "open", reading: alert() },
  signal: {
    id: "s1",
    title: "Urgence — Hôpital A at 132 %",
    severity: "critical",
    detectedAt: "2026-11-20T12:00:00.000Z",
    closedAt: null,
    unitId: "u1",
    alertId: "a1",
    typeId: "kind-1",
    type: "Capacity breach",
    domain: "Capacity",
    stage: "Triage",
    stageNo: 1,
    stages: 3,
    needsApproval: false,
    isLast: false,
    path: [
      { name: "Triage", current: true, needsApproval: false },
      { name: "Response", current: false, needsApproval: true },
      { name: "Closed", current: false, needsApproval: false },
    ],
  },
  responses: [],
  engage: { possible: true, why: null },
  decisions: { items: [], note: "No decision has been taken on a signal of this kind yet. One is recorded when a prepared response is engaged." },
  question: "What is open at Urgence — Hôpital A right now, how old are its figures, and what else is open around it?",
  checked: { at: "2026-11-20T14:59:56.000Z", says: "thresholds last checked 4 s ago" },
  alertRules: 3,
  limits: ["The live figures above are the reading now. What a figure was earlier is on the unit's page; this card does not show it."],
  analyst: { configured: true },
  ...over,
});

describe("the situation card", () => {
  it("reads what the link names, and shows the unit's live figures with their age", async () => {
    api.getSituation.mockResolvedValue(card());
    render(<SituationView />);

    const figures = await screen.findByRole("region", { name: "Live figures" });
    expect(api.getSituation).toHaveBeenCalledWith("mtl", { unit: "u1", alert: "a1", signal: "s1" });
    expect(screen.getByRole("heading", { name: "Urgence — Hôpital A" })).toBeTruthy();
    expect(screen.getByText("Inside Hôpital A · 2 sub-units")).toBeTruthy();

    // The value as the unit page prints it, and a measure with nothing to compute it from said as such.
    expect(within(figures).getByText("132%")).toBeTruthy();
    expect(within(figures).getByText("Nothing here to compute it from.")).toBeTruthy();
    // A floor is said as a floor, with its reason in the text and not in a hover.
    expect(within(figures).getByText("value read at least 2 h ago")).toBeTruthy();
    expect(within(figures).getByText(/published no readable time, so this is a floor/)).toBeTruthy();
    // And it is named for what it is: the unit as a whole, not one of its figures.
    expect(within(figures).getByText("Oldest source under this unit:")).toBeTruthy();
    // When the data arrived is not offered as the age of the value.
    expect(within(figures).getByText(/Last written to the twin 50 min ago: that is when the data arrived, not when it was true/)).toBeTruthy();
    expect(within(figures).getByText(/count everything under this unit, its sub-units included/)).toBeTruthy();
    expect(within(figures).getByRole("row", { name: "Patient 54" })).toBeTruthy();

    expect(screen.getByRole("link", { name: "Open unit" }).getAttribute("href")).toBe("/studio/live?env=mtl&unit=u1");
    expect(screen.getByRole("link", { name: "Signal" }).getAttribute("href")).toBe("/studio/response?env=mtl&signal=s1");
    expect(screen.getByText(/thresholds last checked 4 s ago · 3 alert rules in this project/)).toBeTruthy();
  });

  it("gives each live figure the age of its own value, beside the unit's", async () => {
    // The occupancy comes from a census read 37 minutes ago; the unit as a
    // whole is only known to be at least two hours old.
    api.getSituation.mockResolvedValue(
      card({
        unit: unit({
          measures: [
            { key: "occupancy", measure: "Occupancy", value: 132, counted_in: "percent", value_age: { known: "exact", age: "37 min", says: "value read 37 min ago", why: null } },
            { key: "iqa", measure: "Air quality index", value: null, counted_in: "number" },
          ],
        }),
      }),
    );
    render(<SituationView />);

    const figures = await screen.findByRole("region", { name: "Live figures" });
    // In the tile of the figure it dates.
    const tile = within(figures).getByText("132%").parentElement!;
    expect(within(tile).getByText("value read 37 min ago")).toBeTruthy();
    // A figure with nothing to compute it from has nothing to date.
    expect(within(within(figures).getByText("Nothing here to compute it from.").parentElement!).queryByText(/value read|age of the value/)).toBeNull();
    // The unit's own age is still there, and is another answer.
    expect(within(figures).getByText("Oldest source under this unit:").parentElement!.textContent).toMatch(/value read at least 2 h ago/);
  });

  it("shows the alert it was opened from, the others at the unit, and where the signal stands", async () => {
    api.getSituation.mockResolvedValue(card());
    render(<SituationView />);

    const from = await screen.findByRole("region", { name: "The alert" });
    expect(within(from).getByText("Urgence — Hôpital A — 132 %")).toBeTruthy();
    expect(within(from).getByText(/open for 3 h/)).toBeTruthy();
    expect(within(from).getByText("value read 37 min ago")).toBeTruthy();

    // The alert the card was opened from is not listed twice.
    const others = screen.getByRole("region", { name: "Other open alerts at this unit" });
    expect(within(others).getByText("Air quality above 50 near Hôpital A")).toBeTruthy();
    expect(within(others).queryByText("Urgence — Hôpital A — 132 %")).toBeNull();
    expect(within(others).getByText("61.4")).toBeTruthy();

    const signal = screen.getByRole("region", { name: "The signal" });
    expect(within(signal).getByText("Capacity breach · Capacity · step 1 of 3")).toBeTruthy();
    const steps = within(signal).getAllByRole("listitem");
    expect(steps.map((s) => s.textContent)).toEqual(["1. Triage", "2. Response · needs approval", "3. Closed"]);
    expect(steps[0]!.getAttribute("aria-current")).toBe("step");
    expect(steps[1]!.getAttribute("aria-current")).toBeNull();

    expect(within(screen.getByRole("region", { name: "Decisions" })).getByText(/No decision has been taken on a signal of this kind yet/)).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "What this card cannot say" })).getByText(/this card does not/)).toBeTruthy();
  });

  it("has the question already written, and asks it with what the card is about", async () => {
    api.getSituation.mockResolvedValue(card());
    analyst.askAnalyst.mockResolvedValue(undefined);
    render(<SituationView />);

    const ask = await screen.findByRole("region", { name: "Ask the analyst" });
    const box = within(ask).getByLabelText("Question for the analyst") as HTMLTextAreaElement;
    // Written by the program, and not sent: asking is the person's move.
    expect(box.value).toBe("What is open at Urgence — Hôpital A right now, how old are its figures, and what else is open around it?");
    expect(analyst.askAnalyst).not.toHaveBeenCalled();

    fireEvent.click(within(ask).getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(analyst.askAnalyst).toHaveBeenCalledTimes(1));
    expect(analyst.askAnalyst.mock.calls[0]![0]).toBe("mtl");
    expect(analyst.askAnalyst.mock.calls[0]![1]).toEqual({
      question: "What is open at Urgence — Hôpital A right now, how old are its figures, and what else is open around it?",
      scenarioId: null,
      looking: "reality",
      run: null,
      focus: { page: "situation", unitId: "u1", signalId: "s1" },
    });
  });

  it("reads in full when the analyst is switched off", async () => {
    api.getSituation.mockResolvedValue(card({ analyst: { configured: false } }));
    render(<SituationView />);

    const ask = await screen.findByRole("region", { name: "Ask the analyst" });
    expect(within(ask).getByText(/The analyst is not switched on for this server\. Everything above is read without it/)).toBeTruthy();
    expect(within(ask).queryByLabelText("Question for the analyst")).toBeNull();
    // Nothing else is missing.
    expect(within(screen.getByRole("region", { name: "Live figures" })).getByText("132%")).toBeTruthy();
    expect(screen.getByRole("region", { name: "The alert" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "The signal" })).toBeTruthy();
  });

  it("says when the alert has cleared, and still reads the unit", async () => {
    api.getSituation.mockResolvedValue(card({ alert: { state: "not_open" }, unit: unit({ open_alerts: [] }), signal: null }));
    render(<SituationView />);

    const from = await screen.findByRole("region", { name: "The alert" });
    expect(within(from).getByText(/This alert is no longer open: it cleared, or the link is old/)).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Live figures" })).getByText("132%")).toBeTruthy();
    expect(screen.getByText(/No alert is open at this unit\. That is what the rules saw when they were last checked/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "The signal" })).toBeNull();
  });

  it("says that nothing can open in a project with no alert rule", async () => {
    api.getSituation.mockResolvedValue(card({ alert: null, alertRules: 0, checked: { at: null, says: "no alert rule exists in this project, so nothing can open" } }));
    render(<SituationView />);
    const line = await screen.findByText(/no alert rule exists in this project, so nothing can open/);
    // Said once, and not beside a count of rules that would contradict it.
    expect(line.textContent).not.toMatch(/alert rules? in this project/);
    // No open alert, with no rule that could have opened one, is not offered as good news.
    cleanup();
    api.getSituation.mockResolvedValue(
      card({ alert: null, alertRules: 0, unit: unit({ open_alerts: [] }), checked: { at: null, says: "no alert rule exists in this project, so nothing can open" } }),
    );
    render(<SituationView />);
    expect(await screen.findByText(/No alert is open at this unit, and none could be: this project has no alert rule\. That is not a sign that nothing is wrong\./)).toBeTruthy();
    expect(screen.queryByText(/That is what the rules saw when they were last checked/)).toBeNull();
    expect(screen.queryByRole("region", { name: "The alert" })).toBeNull();
  });

  it("says a link that leads nowhere, and that it names nothing when it names nothing", async () => {
    api.getSituation.mockRejectedValue(new ApiError(404, "UNIT_NOT_FOUND", "That unit is not in this project."));
    const first = render(<SituationView />);
    expect((await screen.findByRole("alert")).textContent).toContain("This link names a unit or a signal that is not in this project.");
    first.unmount();

    where.search = "";
    api.getSituation.mockClear();
    render(<SituationView />);
    expect(screen.getByText(/A situation card opens from an alert, a signal or a unit/)).toBeTruthy();
    expect(api.getSituation).not.toHaveBeenCalled();
  });
});

describe("a card whose prepared response is being tested on the current state", () => {
  const run = { peakOccupancy: 0.93, peakDay: 36, sitesWithQueue: 3, sitesWithActivity: 34, firstQueueDay: 20, waitingDays: 267, peakWaiting: 12, peakWaitingDay: 38, strandedWaitingDays: null };
  const prepared = (live: PreparedResponseCard["live"]): PreparedResponseCard => ({
    id: "r1",
    label: "Open 60 beds at Lakeshore",
    approver: null,
    objective: "Nobody waits at Lakeshore.",
    changes: [],
    mechanism: "",
    horizon: 60,
    activity: "lit",
    withIt: run,
    without: { ...run, waitingDays: 7316, sitesWithQueue: 8 },
    evidence: { measured: 1, published: 0, assumption: 1 },
    notTested: [],
    scenarioName: "Omicron",
    standing: { testedAt: "2026-11-17T15:00:00.000Z", age: "3 d", stale: false, reasons: [] },
    live,
    keptBy: null,
    keptAt: "2026-11-17T15:10:00.000Z",
  });
  const none = { figures: null, testedAt: null, current: false, seconds: null, problem: null };

  it("is read again sooner until the result is there, which then shows without a click", async () => {
    vi.useFakeTimers();
    try {
      api.getSituation
        .mockResolvedValueOnce(card({ responses: [prepared({ ...none, state: "testing", says: "Being tested on the current state, started 2 s ago. What is shown is the test kept in calm time." })] }))
        .mockResolvedValue(
          card({
            responses: [
              prepared({ state: "tested", says: "Tested on the current state 3 s ago.", figures: { asItIs: { ...run, waitingDays: 9120 }, withOption: { ...run, waitingDays: 1840 } }, testedAt: "2026-11-20T15:00:02.000Z", current: true, seconds: 61, problem: null }),
            ],
          }),
        );
      render(<SituationView />);
      await vi.advanceTimersByTimeAsync(0);
      expect(api.getSituation).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/Being tested on the current state, started 2 s ago/)).toBeTruthy();
      expect(screen.getByText(new RegExp(`again every\\s+${REREAD_TESTING_MS / 1000} s`))).toBeTruthy();

      await vi.advanceTimersByTimeAsync(REREAD_TESTING_MS);
      expect(api.getSituation).toHaveBeenCalledTimes(2);
      expect(screen.getByText(/Tested on the current state 3 s ago\. The engine took 61 s\./)).toBeTruthy();
      expect(screen.getByText(/^1,840 patient-days waiting/)).toBeTruthy();

      // Nothing is being tested any more: the card is back to its usual pace.
      expect(screen.getByText(new RegExp(`again every\\s+${REREAD_MS / 1000} s`))).toBeTruthy();
      await vi.advanceTimersByTimeAsync(REREAD_TESTING_MS * 2);
      expect(api.getSituation).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(REREAD_MS);
      expect(api.getSituation).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("what happened on the signal after it was raised", () => {
  const followed = (over: Record<string, unknown> = {}): NonNullable<SituationCard["followUp"]> =>
    ({
      followed: true,
      measure: { key: "occupancy", label: "Stretcher occupancy", countedIn: "percent" },
      raised: { at: "2026-11-20T12:00:00.000Z", value: 138 },
      decision: { id: "d1", label: "60 more stretchers", by: "A. Tremblay", at: "2026-11-20T14:14:00.000Z", delaySeconds: 8040, delay: "2 h", others: 0 },
      measured: {
        from: "decision",
        fromAt: "2026-11-20T14:14:00.000Z",
        untilAt: "2026-11-20T15:00:00.000Z",
        closed: false,
        readings: 2,
        atStart: 150,
        latest: 96,
        lowest: 96,
        highest: 131,
        change: -54,
        says: ["Stretcher occupancy was 150% when the decision was taken.", "Since then, until now: 2 readings, lowest 96%, highest 131%; the last one is 96%.", "Measured change over that stretch: −54 points."],
      },
      alert: { state: "cleared", clearedAt: "2026-11-20T14:50:00.000Z", says: "The alert cleared 36 min after the decision: the condition stopped firing." },
      expected: {
        run: "kept_test",
        testedAt: null,
        horizon: 30,
        activity: "Stretchers",
        waiting: { without: 267, with: 120, change: -147 },
        site: null,
        says: ["What is given is the test the response was kept from, made in calm time.", "Over 30 days, for Stretchers, across the whole network: 267 patient-days waiting without the response, 120 with it."],
      },
      gap: "No figure sets one against the other. They are two different quantities, shown side by side. Whether the decision held is yours to judge.",
      closedAs: null,
      limits: ["A change measured after a decision is not an effect of the decision: other things changed too, and this does not tell them apart."],
      ...over,
    }) as NonNullable<SituationCard["followUp"]>;

  it("sets the decision, what was measured since and what the run gave side by side, and subtracts nothing", async () => {
    api.getSituation.mockResolvedValue(card({ followUp: followed() }));
    render(<SituationView />);
    const block = await screen.findByRole("region", { name: "Follow-up" });

    // Who decided, and how long after the signal: the delay is on the card.
    expect(within(block).getByText(/engaged by A\. Tremblay, 2 h after the signal was raised/)).toBeTruthy();
    // The measure, as the twin wrote it down, printed like the unit page prints it.
    const fact = (label: string) => within(block).getByText(label).parentElement!.textContent;
    expect(fact("When the signal was raised")).toBe("When the signal was raised138%");
    expect(fact("At the decision")).toBe("At the decision150%");
    expect(fact("Lowest since")).toBe("Lowest since96%");
    expect(fact("Highest since")).toBe("Highest since131%");
    expect(fact("Last reading")).toBe("Last reading96%");
    expect(within(block).getByText("Measured change over that stretch: −54 points.")).toBeTruthy();
    expect(within(block).getByText("The alert cleared 36 min after the decision: the condition stopped firing.")).toBeTruthy();
    // What the run gave is named as expected, apart from what was measured.
    expect(within(block).getByText("Measured · Stretcher occupancy, as the twin wrote it down")).toBeTruthy();
    expect(within(block).getByText("Expected · what the tested run gave")).toBeTruthy();
    expect(within(block).getByText(/267 patient-days waiting without the response, 120 with it/)).toBeTruthy();
    // And the card says why no figure sets one against the other, and that it does not conclude.
    expect(within(block).getByText(/No figure sets one against the other.*Whether the decision held is yours to judge\./)).toBeTruthy();
    expect(within(block).getByText(/is not an effect of the decision/)).toBeTruthy();
  });

  it("follows a signal nobody decided on from the moment it was raised, and claims nothing was expected", async () => {
    const none = followed({ decision: null, expected: null, gap: null });
    api.getSituation.mockResolvedValue(card({ followUp: { ...none, measured: { ...(none as { measured: object }).measured, from: "raised" } } as SituationCard["followUp"] }));
    render(<SituationView />);
    const block = await screen.findByRole("region", { name: "Follow-up" });
    expect(within(block).getByText("Follow-up · since the signal was raised")).toBeTruthy();
    expect(within(block).getByText("No decision has been taken on this signal.")).toBeTruthy();
    expect(within(block).queryByText("At the decision")).toBeNull();
    expect(within(block).queryByText("Expected · what the tested run gave")).toBeNull();
  });

  it("shows a closed signal with what it was closed as", async () => {
    const closed = followed({ closedAs: "Resolved" });
    api.getSituation.mockResolvedValue(card({ followUp: { ...closed, measured: { ...(closed as { measured: object }).measured, closed: true } } as SituationCard["followUp"] }));
    render(<SituationView />);
    const block = await screen.findByRole("region", { name: "Follow-up" });
    expect(within(block).getByText("When it closed")).toBeTruthy();
    expect(within(block).getByText("Closed as: Resolved")).toBeTruthy();
  });

  it("says why nothing is followed when the signal has no measure the twin keeps", async () => {
    api.getSituation.mockResolvedValue(card({ followUp: { followed: false, why: "This signal was not raised by an alert on a unit, so there is no measure to follow after it." } }));
    render(<SituationView />);
    const block = await screen.findByRole("region", { name: "Follow-up" });
    expect(within(block).getByText("This signal was not raised by an alert on a unit, so there is no measure to follow after it.")).toBeTruthy();
  });

  it("shows no follow-up where the card names no signal, or the answer brings none", async () => {
    api.getSituation.mockResolvedValue(card());
    render(<SituationView />);
    await screen.findByRole("region", { name: "Live figures" });
    expect(screen.queryByRole("region", { name: "Follow-up" })).toBeNull();
  });
});
