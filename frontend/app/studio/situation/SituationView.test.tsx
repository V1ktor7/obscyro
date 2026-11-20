// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/auth";

import type { AlertReading, SituationCard, UnitReading } from "../situation-api";

const api = vi.hoisted(() => ({ getSituation: vi.fn() }));
vi.mock("../situation-api", async (orig) => ({ ...(await orig<typeof import("../situation-api")>()), ...api }));

const analyst = vi.hoisted(() => ({ askAnalyst: vi.fn() }));
vi.mock("../analyst-api", async (orig) => ({ ...(await orig<typeof import("../analyst-api")>()), ...analyst }));

const where = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(where.search) }));
vi.mock("../StudioShell", () => ({ useStudio: () => ({ selectedEnv: "mtl" }) }));

import SituationView from "./SituationView";

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
  decisions: { items: [], note: "No decision can be listed here yet: nothing attaches a decision to a kind of signal." },
  question: "What is open at Urgence — Hôpital A right now, how old are its figures, and what else is open around it?",
  checked: { at: "2026-11-20T14:59:56.000Z", says: "thresholds last checked 4 s ago" },
  alertRules: 3,
  limits: ["This is the reading now. The twin keeps no history."],
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
    // When the data arrived is not offered as the age of the value.
    expect(within(figures).getByText(/Last written to the twin 50 min ago: that is when the data arrived, not when it was true/)).toBeTruthy();
    expect(within(figures).getByText(/count everything under this unit, its sub-units included/)).toBeTruthy();
    expect(within(figures).getByRole("row", { name: "Patient 54" })).toBeTruthy();

    expect(screen.getByRole("link", { name: "Open unit" }).getAttribute("href")).toBe("/studio/live?env=mtl&unit=u1");
    expect(screen.getByRole("link", { name: "Signal" }).getAttribute("href")).toBe("/studio/response?env=mtl&signal=s1");
    expect(screen.getByText(/thresholds last checked 4 s ago · 3 alert rules in this project/)).toBeTruthy();
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

    expect(within(screen.getByRole("region", { name: "Decisions" })).getByText(/nothing attaches a decision to a kind of signal/)).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "What this card cannot say" })).getByText(/keeps no history/)).toBeTruthy();
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
    api.getSituation.mockResolvedValue(card({ alert: null, alertRules: 0 }));
    render(<SituationView />);
    expect(await screen.findByText(/no alert rule exists in this project, so nothing can open/)).toBeTruthy();
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
