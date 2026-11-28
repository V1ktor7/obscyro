// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/auth";

import type { Backtest, ForecastModel, ModelOffer, Score, Standing, Verification } from "../forecast-models-api";

const api = vi.hoisted(() => ({
  fetchForecastModels: vi.fn(),
  importForecastModel: vi.fn(),
  removeForecastModel: vi.fn(),
  verifyForecastModel: vi.fn(),
  backtestForecastModel: vi.fn(),
  setForecastTrial: vi.fn(),
}));
vi.mock("../forecast-models-api", async (orig) => ({ ...(await orig<typeof import("../forecast-models-api")>()), ...api }));

import ImportedModelsTab from "./ImportedModelsTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const OFFER: ModelOffer = {
  measures: [
    { key: "occupancy", label: "Stretcher occupancy", unit: "percent", units: 107, since: "2026-09-09T14:45:00.000Z" },
    { key: "iqa", label: "Air quality index", unit: "number", units: 318, since: "2026-11-22T20:00:00.000Z" },
  ],
  series: [{ key: "virus_detections", label: "Virus detections", entities: ["Quebec | Influenza", "Quebec | RSV"] }],
  calendar: ["calendar:hour", "calendar:weekday"],
  service: { configured: false, says: "The model service is not configured on this server (MODEL_SERVICE_URL). Everything works with the built-in reference; an open model cannot be called until an administrator sets it." },
  keyPrefix: "MODEL_KEY_",
  contract: 1,
  limits: { horizonMax: 336, historyMax: 2160, seriesMax: 300, sampleUnits: 3, backtestDays: 14 },
};
const score = (over: Partial<Score> = {}): Score => ({ n: 100152, model: 6.2, reference: 29.4, held: 8.3, inside: 0.8, ...over });
const model = (over: Partial<ForecastModel> = {}): ForecastModel => ({
  id: "fm1",
  key: "chronos_2",
  label: "Chronos-2",
  source: "service",
  serviceModel: "chronos-2",
  endpointUrl: null,
  endpointKeyEnv: null,
  metric: "occupancy",
  units: null,
  step: "hour",
  historySteps: 336,
  horizonSteps: 72,
  holdHours: 3,
  minHistoryDays: 14,
  companions: [],
  timeZone: null,
  state: "imported",
  verifiedAt: null,
  triedAt: null,
  backtest: null,
  lastError: null,
  trialEveryHours: 6,
  trialStartedAt: null,
  lastRunAt: null,
  standing: null,
  createdAt: "2026-11-27T12:00:00.000Z",
  updatedAt: "2026-11-27T12:00:00.000Z",
  ...over,
});
const BACKTEST: Backtest = {
  ranAt: "2026-11-27T12:00:00.000Z",
  days: 14,
  step: "hour",
  horizon: 72,
  origins: Array.from({ length: 14 }, (_, i) => ({ origin: `2026-11-${13 + i}T12:00:00.000Z`, series: 107, leftOut: 0, score: score() })),
  overall: score(),
  byHorizon: Array.from({ length: 72 }, (_, i) => score({ n: 1498, model: i < 24 ? 5 : 30 })),
  verdict: { beats: true, why: "Its error is 6.2, under both rules: 8.3 for “the last value holds” and 29.4 for “the same hour a week before”, over 100,152 steps." },
  partial: false,
  stopped: null,
  said: { name: "chronos-2" },
  unit: "percent",
};

async function page(models: ForecastModel[] = [], offer: ModelOffer = OFFER) {
  api.fetchForecastModels.mockResolvedValue({ models, offer });
  render(<ImportedModelsTab env="mtl" />);
  await screen.findByRole("button", { name: "Import a model" });
}
const card = (name: string) => screen.getByRole("listitem", { name });
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

describe("what is imported", () => {
  it("says that without the model service everything works with the reference, and what the twin does not hold", async () => {
    await page();
    expect(screen.getByRole("note").textContent).toMatch(/The model service is not configured.*Everything works with the built-in reference/);
    expect(screen.getByText(/Ward beds, staff and calls to 811 are not in the twin\. No model can be shown them/)).toBeTruthy();
    expect(screen.getByText(/No model is imported yet\. The reference rule can be imported with nothing else to set up/)).toBeTruthy();
    // With the service configured, nothing needs saying.
    cleanup();
    await page([], { ...OFFER, service: { configured: true, says: "An open model can be called through the model service." } });
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("shows each model with where it comes from, what it forecasts and how far it has come", async () => {
    await page([model({ state: "verified" })]);
    const c = within(card("Chronos-2"));
    expect(c.getByText("An open model, “chronos-2”, served by the model service.")).toBeTruthy();
    expect(c.getByText("Stretcher occupancy, for every unit that carries it: the next 3 days, by the hour, from 14 days of history.")).toBeTruthy();
    const road = within(c.getByRole("list", { name: "Where this model stands" }));
    expect(road.getAllByRole("listitem").map((li) => [li.textContent, li.getAttribute("aria-current")])).toEqual([
      ["Imported", "step"],
      ["Contract checked", "step"],
      ["Replayed on the past", null],
      ["On trial", null],
      ["Shown", null],
    ]);
    // The steps come in order: it cannot go on trial before it was replayed.
    expect((c.getByRole("button", { name: "Put on trial" }) as HTMLButtonElement).disabled).toBe(true);
    expect((c.getByRole("button", { name: "Replay on the last 14 days" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("says when the list could not be read, and asks for an environment", async () => {
    api.fetchForecastModels.mockRejectedValue(new ApiError(500, "INTERNAL", "The database did not answer."));
    const a = render(<ImportedModelsTab env="mtl" />);
    expect((await screen.findByRole("alert")).textContent).toBe("The imported models could not be read: The database did not answer.");
    a.unmount();
    render(<ImportedModelsTab env={null} />);
    expect(screen.getByText("Select an environment first.")).toBeTruthy();
  });
});

describe("importing a model", () => {
  it("imports the reference with nothing to set up, and says nothing leaves the server", async () => {
    await page();
    fireEvent.click(screen.getByRole("button", { name: "Import a model" }));
    const f = within(screen.getByRole("form", { name: "Import a model" }));
    expect(f.getByRole("note").textContent).toBe("Nothing leaves this server: the reference is computed here.");
    fireEvent.click(f.getByRole("button", { name: "Import" }));
    expect(f.getByRole("alert").textContent).toBe("Give the model a name.Pick the measure it forecasts.");
    expect(api.importForecastModel).not.toHaveBeenCalled();

    type(f.getByLabelText("Name"), "Reference, occupancy");
    type(f.getByLabelText("Measure of the twin"), "occupancy");
    api.importForecastModel.mockResolvedValue({ model: model({ source: "reference", label: "Reference, occupancy" }) });
    fireEvent.click(f.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(api.importForecastModel).toHaveBeenCalledTimes(1));
    expect(api.importForecastModel.mock.calls[0]).toEqual([
      "mtl",
      { label: "Reference, occupancy", source: "reference", serviceModel: null, endpointUrl: null, endpointKeyEnv: null, metric: "occupancy", units: null, step: "hour", historySteps: 336, horizonSteps: 72, holdHours: 3, minHistoryDays: 14, companions: [], timeZone: null },
    ]);
    await waitFor(() => expect(api.fetchForecastModels).toHaveBeenCalledTimes(2));
  });

  it("never asks for a key: a hosted model names the variable an administrator set", async () => {
    await page();
    fireEvent.click(screen.getByRole("button", { name: "Import a model" }));
    const form = screen.getByRole("form", { name: "Import a model" });
    const f = within(form);
    fireEvent.click(f.getByLabelText(/A model hosted at an address that speaks the contract/));
    // No field of the form hides what is typed: there is no secret to type.
    expect(form.querySelectorAll('input[type="password"]').length).toBe(0);
    expect(f.getByText(/Never type a key here\. An administrator sets it on the API as an environment variable whose name starts with MODEL_KEY_/)).toBeTruthy();
    type(f.getByLabelText("Name"), "Acme");
    type(f.getByLabelText("Measure of the twin"), "occupancy");
    type(f.getByLabelText("Address"), "https://api.acme.io/v1/forecast");
    expect(f.getByRole("note").textContent).toMatch(/No unit's name or identifier does, and nothing about a person\. They go to api\.acme\.io, outside this platform\./);
    // What looks like a key is refused before anything is sent.
    type(f.getByLabelText("Name of the variable that holds its key"), "sk-live-9f2c1a");
    fireEvent.click(f.getByRole("button", { name: "Import" }));
    expect(f.getByRole("alert").textContent).toBe("The key is named by a variable that starts with MODEL_KEY_. Give that name, never the key itself.");
    expect(api.importForecastModel).not.toHaveBeenCalled();

    type(f.getByLabelText("Name of the variable that holds its key"), "MODEL_KEY_ACME");
    api.importForecastModel.mockResolvedValue({ model: model() });
    fireEvent.click(f.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(api.importForecastModel).toHaveBeenCalledTimes(1));
    expect(api.importForecastModel.mock.calls[0]![1]).toMatchObject({ source: "endpoint", endpointUrl: "https://api.acme.io/v1/forecast", endpointKeyEnv: "MODEL_KEY_ACME", serviceModel: null });
  });

  it("adds companion series from what the project keeps, and keeps the form open when the server refuses", async () => {
    await page();
    fireEvent.click(screen.getByRole("button", { name: "Import a model" }));
    const f = within(screen.getByRole("form", { name: "Import a model" }));
    expect((f.getByLabelText("Add a companion series") as HTMLSelectElement).disabled).toBe(true);
    type(f.getByLabelText("Name"), "Reference");
    type(f.getByLabelText("Measure of the twin"), "occupancy");
    type(f.getByLabelText("Add a companion series"), "virus_detections");
    type(f.getByLabelText("Entity of virus_detections"), "Quebec | RSV");
    type(f.getByLabelText("Add a companion series"), "calendar:hour");
    // The calendar is an hour somewhere: the zone is asked for once it is needed.
    fireEvent.click(f.getByRole("button", { name: "Import" }));
    expect(f.getByRole("alert").textContent).toBe("The hour of the day is an hour somewhere: give the time zone, such as America/Toronto.");
    type(f.getByLabelText("Time zone of the calendar"), "America/Toronto");
    api.importForecastModel.mockRejectedValue(new ApiError(400, "MODEL_INVALID", "The project keeps no series called “virus_detections”."));
    fireEvent.click(f.getByRole("button", { name: "Import" }));
    expect((await f.findByRole("alert")).textContent).toBe("The project keeps no series called “virus_detections”.");
    expect(api.importForecastModel.mock.calls[0]![1].companions).toEqual([
      { name: "virus_detections", kind: "past", series: "virus_detections", entity: "Quebec | RSV" },
      { name: "hour", kind: "known", series: "calendar:hour", entity: null },
    ]);
    expect(api.importForecastModel.mock.calls[0]![1].timeZone).toBe("America/Toronto");
  });
});

describe("the steps of a model", () => {
  const VERIFIED: Verification = {
    ok: true,
    why: null,
    sent: { to: "The model service (models.example.org), model “chronos-2”.", series: 3, history: 336, horizon: 72, step: "hour", companions: [], bytes: 18_400 },
    leftOut: [{ unitId: "u9", name: "Hôpital de Sept-Îles", why: "Its history starts 5 days before: the model asks for 14." }],
    sample: { unit: "CHUM", origin: "2026-11-27T12:00:00.000Z", low: [100, 101], likely: [110, 111.25], high: [120, 121] },
    said: { name: "chronos-2" },
    ms: 900,
  };

  it("checks the contract on a sample and says what left, to where, and what was left out", async () => {
    await page([model()]);
    api.verifyForecastModel.mockResolvedValue({ model: model({ state: "verified" }), verification: VERIFIED });
    fireEvent.click(within(card("Chronos-2")).getByRole("button", { name: "Check the contract on a sample" }));
    const panel = within(await screen.findByRole("region", { name: "Contract check" }));
    expect(api.verifyForecastModel).toHaveBeenCalledWith("mtl", "chronos_2");
    expect(panel.getByRole("status").textContent).toBe("The answer keeps the contract.");
    expect(panel.getByText("Sent to: The model service (models.example.org), model “chronos-2”.")).toBeTruthy();
    expect(panel.getByText("3 series under opaque labels, 336 steps of history each: 18 kB. No unit is named.")).toBeTruthy();
    expect(panel.getByText("1 unit was left out. Hôpital de Sept-Îles: Its history starts 5 days before: the model asks for 14.")).toBeTruthy();
    expect(panel.getByText("First steps for CHUM: 110, 111.3.")).toBeTruthy();
    // The model moved one step along its road.
    expect(within(card("Chronos-2")).getByText("Contract checked").getAttribute("aria-current")).toBe("step");
  });

  it("says why when the contract is not kept", async () => {
    await page([model()]);
    const why = "Series “s1” has 1 low value, where the horizon is 72 steps.";
    api.verifyForecastModel.mockResolvedValue({ model: model({ lastError: why }), verification: { ...VERIFIED, ok: false, why, sample: null } });
    fireEvent.click(within(card("Chronos-2")).getByRole("button", { name: "Check the contract on a sample" }));
    const panel = within(await screen.findByRole("region", { name: "Contract check" }));
    expect(panel.getByRole("status").textContent).toBe(`Refused: ${why}`);
    expect(within(card("Chronos-2")).getByText("Contract checked").getAttribute("aria-current")).toBeNull();
  });

  it("replays the model on the past and sets its error beside the two rules', in all and by horizon", async () => {
    await page([model({ state: "verified" })]);
    api.backtestForecastModel.mockResolvedValue({ model: model({ state: "tried", backtest: BACKTEST }), backtest: BACKTEST });
    fireEvent.click(within(card("Chronos-2")).getByRole("button", { name: "Replay on the last 14 days" }));
    const panel = within(await screen.findByRole("region", { name: "Replay on the past" }));
    expect(api.backtestForecastModel).toHaveBeenCalledWith("mtl", "chronos_2");
    // A replay is not a forecast, and the panel says so in its title.
    expect(panel.getByText("Replayed on the past · not a forecast")).toBeTruthy();
    expect(panel.getByText("Replayed over 14 days: 14 forecasts made with what was known then, 100,152 steps held against what was measured since.")).toBeTruthy();
    expect(panel.getByText(/Its error is 6\.2, under both rules/)).toBeTruthy();
    const errors = within(panel.getByRole("list", { name: "Mean error" })).getAllByRole("listitem").map((li) => li.textContent);
    expect(errors).toEqual(["6.2 pointsChronos-2lowest", "8.3 points“the last value holds”", "29.4 points“the same hour a week before”"]);
    const rows = within(panel.getByRole("table")).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));
    expect(rows).toEqual([
      ["5 points", "8.3 points", "29.4 points"],
      ["5 points", "8.3 points", "29.4 points"],
      ["5 points", "8.3 points", "29.4 points"],
      ["5 points", "8.3 points", "29.4 points"],
      ["30 points", "8.3 points", "29.4 points"],
      ["30 points", "8.3 points", "29.4 points"],
    ]);
    expect((within(card("Chronos-2")).getByRole("button", { name: "Put on trial" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("puts a model on trial at a rhythm, and says its forecasts are frozen and when the next one is due", async () => {
    await page([model({ state: "tried", backtest: BACKTEST })]);
    const standing: Standing = { computedAt: "", windowDays: 14, forecasts: 0, origins: 0, overall: score({ n: 0, model: null, reference: null, held: null, inside: null }), byHorizon: [], shown: false, why: "No forecast has been frozen yet: the trial has just begun.", unit: "percent" };
    api.setForecastTrial.mockResolvedValue({
      model: model({ state: "on_trial", backtest: BACKTEST, trialEveryHours: 3, standing }),
      run: { origin: "2026-11-27T12:00:00.000Z", frozen: 0, why: null, missed: true },
      standing,
      nextRunAt: "2026-11-27T15:25:00.000Z",
    });
    const c = within(card("Chronos-2"));
    type(c.getByLabelText("Trial rhythm"), "3");
    fireEvent.click(c.getByRole("button", { name: "Put on trial" }));
    const panel = within(await screen.findByRole("region", { name: "Trial" }));
    expect(api.setForecastTrial).toHaveBeenCalledWith("mtl", "chronos_2", true, 3);
    expect(panel.getByText(/It runs every 3 hours, 25 minutes after the hour\. Each forecast is written once and cannot be changed afterwards\./)).toBeTruthy();
    // The origin that was due is too old: nothing is made late, and the screen says when the next one comes.
    expect(panel.getByText("The origin of 2026-11-27 12:00 UTC is too old to be forecast honestly: no forecast is made late. Next run: 2026-11-27 15:25 UTC.")).toBeTruthy();
    expect(panel.getByText("Not shown. No forecast has been frozen yet: the trial has just begun.")).toBeTruthy();
    expect(c.getByText("Shown").getAttribute("aria-current")).toBeNull();
    expect(c.getByRole("button", { name: "Take off trial" })).toBeTruthy();
  });

  it("marks a model as shown only when the rule says so, with its record", async () => {
    const standing: Standing = { computedAt: "", windowDays: 14, forecasts: 5992, origins: 56, overall: score(), byHorizon: [], shown: true, why: "Its error is 6.2, under both rules.", unit: "percent" };
    await page([model({ state: "on_trial", backtest: BACKTEST, standing, lastRunAt: "2026-11-27T12:26:00.000Z" })]);
    const c = within(card("Chronos-2"));
    expect(c.getByText("Shown").getAttribute("aria-current")).toBe("step");
    const panel = within(c.getByRole("region", { name: "Trial" }));
    expect(panel.getByText("5,992 forecasts frozen over the last 14 days, made at 56 origins.")).toBeTruthy();
    expect(panel.getByText("Shown. Its error is 6.2, under both rules.")).toBeTruthy();
    expect(panel.getByText(/Last run: 2026-11-27 12:26 UTC\./)).toBeTruthy();
  });

  it("removes a model only once a person confirmed, and says why an action failed", async () => {
    await page([model()]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(within(card("Chronos-2")).getByRole("button", { name: "Remove" }));
    expect(confirm.mock.calls[0]![0]).toBe("Remove “Chronos-2”? Its replay and the forecasts it froze are removed with it. The series it was shown are not touched.");
    expect(api.removeForecastModel).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    api.removeForecastModel.mockResolvedValue(undefined);
    fireEvent.click(within(card("Chronos-2")).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(api.removeForecastModel).toHaveBeenCalledWith("mtl", "chronos_2"));

    api.verifyForecastModel.mockRejectedValue(new ApiError(404, "MODEL_NOT_FOUND", "That model is not imported in this project."));
    fireEvent.click(within(card("Chronos-2")).getByRole("button", { name: "Check the contract on a sample" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That model is not imported in this project.");
  });
});
