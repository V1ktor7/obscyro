// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/auth";

import type { GridAnswer, SeriesLine, SeriesList, SeriesOffer } from "../series-api";

const api = vi.hoisted(() => ({
  fetchSeries: vi.fn(),
  declareSeries: vi.fn(),
  removeSeries: vi.fn(),
  readSeriesGrid: vi.fn(),
}));
vi.mock("../series-api", async (orig) => ({ ...(await orig<typeof import("../series-api")>()), ...api }));

const studio = vi.hoisted(() => ({ hasKey: true, selectedEnv: "mtl" as string | null }));
vi.mock("../StudioShell", () => ({ useStudio: () => studio }));

import KeptSeriesView from "./KeptSeries";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  studio.hasKey = true;
  studio.selectedEnv = "mtl";
});

const OFFER: SeriesOffer = {
  datasets: [
    { id: "d-virus", name: "ASPC — Détections de virus respiratoires", columns: [{ name: "date", type: "string" }, { name: "province", type: "string" }, { name: "virus", type: "string" }, { name: "detections", type: "string" }] },
    { id: "d-meteo", name: "ECCC — Météo", columns: [{ name: "lastUpdated", type: "string" }, { name: "temperature", type: "number" }] },
  ],
};

const OCCUPANCY: SeriesLine = {
  key: "twin:occupancy",
  label: "Stretcher occupancy",
  origin: "twin",
  from: "A measure of the twin",
  step: "change",
  unit: "percent",
  entities: 107,
  points: 12424,
  emptyPoints: 3,
  replayed: 0,
  firstAt: "2026-11-22T21:00:00.000Z",
  lastAt: "2026-11-27T19:50:00.000Z",
  keptSince: "2026-11-22T21:43:00.000Z",
  note: null,
  declared: null,
};
const VIRUS: SeriesLine = {
  key: "respiratory_virus_detections",
  label: "Respiratory virus detections",
  origin: "dataset",
  from: "ASPC — Détections de virus respiratoires",
  step: "week",
  unit: null,
  entities: 13,
  points: 880,
  emptyPoints: 0,
  replayed: 0,
  firstAt: "2026-09-05T04:00:00.000Z",
  lastAt: "2026-11-21T05:00:00.000Z",
  keptSince: "2026-11-27T20:00:00.000Z",
  note: "12 rows have a time that cannot be read.",
  declared: { datasetId: "d-virus", timeColumn: "date", timeZone: "America/Toronto", valueColumn: "detections", entityColumns: ["province", "virus"] },
};

const list = (series: SeriesLine[] = [OCCUPANCY, VIRUS]): SeriesList => ({ series, offer: OFFER });
async function page(l: SeriesList = list()) {
  api.fetchSeries.mockResolvedValue(l);
  render(<KeptSeriesView />);
  await screen.findByRole("button", { name: "Keep a dataset as a series" });
}
const card = (name: string) => screen.getByRole("listitem", { name });
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

beforeEach(() => {
  api.removeSeries.mockResolvedValue(undefined);
  api.declareSeries.mockResolvedValue({ series: { key: "respiratory_virus_detections", label: "Respiratory virus detections" }, captured: { key: "respiratory_virus_detections", written: 880, note: null } });
});

describe("what the project keeps", () => {
  it("lists the twin's measures and the datasets kept as series, each with what it holds", async () => {
    await page();
    expect(screen.getByText(/It is what a model can be shown of the past, and nothing else/)).toBeTruthy();

    const twin = within(screen.getByRole("region", { name: "Measures of the twin" }));
    const occupancy = within(twin.getByRole("listitem", { name: "Stretcher occupancy" }));
    expect(occupancy.getByText("twin:occupancy")).toBeTruthy();
    expect(occupancy.getByText("A measure of the twin · Written down when it changes")).toBeTruthy();
    expect(occupancy.getByText("12,424 points for 107 units")).toBeTruthy();
    expect(occupancy.getByText("About 22 Nov 2026 to 27 Nov 2026. Kept here since 22 Nov 2026.")).toBeTruthy();
    expect(occupancy.getByText("3 points written down with no value: a gap that was seen, not a zero.")).toBeTruthy();
    // A measure of the twin is a series as long as the twin keeps it: nothing removes it here.
    expect(occupancy.queryByRole("button", { name: "Remove" })).toBeNull();

    const kept = within(screen.getByRole("region", { name: "Series of datasets" }));
    const virus = within(kept.getByRole("listitem", { name: "Respiratory virus detections" }));
    expect(virus.getByText("ASPC — Détections de virus respiratoires · Every week · time in date, value in detections, by province and virus")).toBeTruthy();
    expect(virus.getByText("880 points for 13 entities")).toBeTruthy();
    expect(virus.getByRole("alert").textContent).toBe("The last write was not read whole. 12 rows have a time that cannot be read.");
    expect(virus.getByRole("button", { name: "Remove" })).toBeTruthy();
  });

  it("says so when nothing is kept, in each of the two groups", async () => {
    await page(list([]));
    expect(screen.getByText(/The twin kept no reading in this project yet/)).toBeTruthy();
    expect(screen.getByText(/No dataset is kept as a series yet\. Its copies are kept, but nothing in them is filed by place and by time\./)).toBeTruthy();
  });

  it("asks for a session and an environment, and says when the list could not be read", async () => {
    studio.hasKey = false;
    const a = render(<KeptSeriesView />);
    expect(screen.getByText("Sign in to see what is kept.")).toBeTruthy();
    a.unmount();
    studio.hasKey = true;
    studio.selectedEnv = null;
    const b = render(<KeptSeriesView />);
    expect(screen.getByText("Select an environment first.")).toBeTruthy();
    expect(api.fetchSeries).not.toHaveBeenCalled();
    b.unmount();
    studio.selectedEnv = "mtl";
    api.fetchSeries.mockRejectedValue(new ApiError(500, "INTERNAL", "The database did not answer."));
    render(<KeptSeriesView />);
    expect((await screen.findByRole("alert")).textContent).toBe("The kept series could not be read: The database did not answer.");
  });

  it("removes a dataset series only once a person confirmed, and reads the list again", async () => {
    await page();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(within(card("Respiratory virus detections")).getByRole("button", { name: "Remove" }));
    expect(confirm.mock.calls[0]![0]).toBe("Stop keeping “Respiratory virus detections”? The points written down for it are removed. The copies of the dataset are not touched.");
    expect(api.removeSeries).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(within(card("Respiratory virus detections")).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(api.removeSeries).toHaveBeenCalledWith("mtl", "respiratory_virus_detections"));
    await waitFor(() => expect(api.fetchSeries).toHaveBeenCalledTimes(2));
  });
});

describe("keeping a dataset as a series", () => {
  it("says what to correct, and sends nothing until it is", async () => {
    await page();
    fireEvent.click(screen.getByRole("button", { name: "Keep a dataset as a series" }));
    const form = screen.getByRole("form", { name: "Keep a dataset as a series" });
    fireEvent.click(within(form).getByRole("button", { name: "Keep it" }));
    const problems = within(form).getByRole("alert");
    expect(within(problems).getByText("Give the series a name.")).toBeTruthy();
    expect(within(problems).getByText("Pick the dataset it is read from.")).toBeTruthy();
    expect(api.declareSeries).not.toHaveBeenCalled();
  });

  it("offers the columns of the dataset picked, and declares the series from them", async () => {
    await page();
    fireEvent.click(screen.getByRole("button", { name: "Keep a dataset as a series" }));
    const f = within(screen.getByRole("form", { name: "Keep a dataset as a series" }));

    // No column can be picked before the dataset.
    expect((f.getByRole("combobox", { name: "Column of the time" }) as HTMLSelectElement).disabled).toBe(true);
    type(f.getByRole("textbox", { name: "Name" }), "Respiratory virus detections");
    type(f.getByRole("combobox", { name: "Dataset" }), "d-virus");
    expect(Array.from((f.getByRole("combobox", { name: "Column of the time" }) as HTMLSelectElement).options).map((o) => o.textContent)).toEqual([
      "pick a column…",
      "date (string)",
      "province (string)",
      "virus (string)",
      "detections (string)",
    ]);
    type(f.getByRole("combobox", { name: "Column of the time" }), "date");
    type(f.getByRole("combobox", { name: "Column of the value" }), "detections");
    type(f.getByRole("combobox", { name: "The source publishes" }), "week");
    type(f.getByRole("textbox", { name: "Time zone of the file" }), "America/Toronto");
    fireEvent.click(f.getByRole("checkbox", { name: "province" }));
    fireEvent.click(f.getByRole("checkbox", { name: "virus" }));

    fireEvent.click(f.getByRole("button", { name: "Keep it" }));
    await waitFor(() => expect(api.declareSeries).toHaveBeenCalledTimes(1));
    expect(api.declareSeries).toHaveBeenCalledWith("mtl", {
      label: "Respiratory virus detections",
      datasetId: "d-virus",
      timeColumn: "date",
      timeZone: "America/Toronto",
      valueColumn: "detections",
      entityColumns: ["province", "virus"],
      step: "week",
      unit: null,
    });
    // The form closes, and the page says what was read from the latest copy.
    expect((await screen.findByRole("status")).textContent).toBe("“Respiratory virus detections” is kept. 880 points read from the dataset's latest copy.");
    expect(screen.queryByRole("form", { name: "Keep a dataset as a series" })).toBeNull();
    await waitFor(() => expect(api.fetchSeries).toHaveBeenCalledTimes(2));
  });

  it("forgets the columns picked when the dataset changes", async () => {
    await page();
    fireEvent.click(screen.getByRole("button", { name: "Keep a dataset as a series" }));
    const f = within(screen.getByRole("form", { name: "Keep a dataset as a series" }));
    type(f.getByRole("combobox", { name: "Dataset" }), "d-virus");
    type(f.getByRole("combobox", { name: "Column of the time" }), "date");
    fireEvent.click(f.getByRole("checkbox", { name: "virus" }));
    type(f.getByRole("combobox", { name: "Dataset" }), "d-meteo");
    expect((f.getByRole("combobox", { name: "Column of the time" }) as HTMLSelectElement).value).toBe("");
    expect(f.queryByRole("checkbox", { name: "virus" })).toBeNull();
    expect(f.getByRole("checkbox", { name: "temperature" })).toBeTruthy();
  });

  it("says what the latest copy could not give, and keeps the form open when the server refuses", async () => {
    await page();
    fireEvent.click(screen.getByRole("button", { name: "Keep a dataset as a series" }));
    const form = screen.getByRole("form", { name: "Keep a dataset as a series" });
    const f = within(form);
    type(f.getByRole("textbox", { name: "Name" }), "Weather");
    type(f.getByRole("combobox", { name: "Dataset" }), "d-meteo");
    type(f.getByRole("combobox", { name: "Column of the time" }), "lastUpdated");
    type(f.getByRole("combobox", { name: "Column of the value" }), "temperature");

    api.declareSeries.mockRejectedValueOnce(new ApiError(400, "SERIES_INVALID", "“Montreal time” is not a time zone this server knows."));
    fireEvent.click(f.getByRole("button", { name: "Keep it" }));
    expect((await f.findByRole("alert")).textContent).toBe("“Montreal time” is not a time zone this server knows.");
    expect(screen.getByRole("form", { name: "Keep a dataset as a series" })).toBeTruthy();

    api.declareSeries.mockResolvedValueOnce({ series: { key: "weather", label: "Weather" }, captured: { key: "weather", written: 0, note: "The times carry no time zone and the series declares none: none of the 42 rows could be placed." } });
    fireEvent.click(f.getByRole("button", { name: "Keep it" }));
    expect((await screen.findByRole("status")).textContent).toBe(
      "“Weather” is kept. 0 points read from the dataset's latest copy. The times carry no time zone and the series declares none: none of the 42 rows could be placed.",
    );
  });

  it("says a dataset never written is kept from its next write", async () => {
    await page();
    api.declareSeries.mockResolvedValue({ series: { key: "weather", label: "Weather" }, captured: null });
    fireEvent.click(screen.getByRole("button", { name: "Keep a dataset as a series" }));
    const f = within(screen.getByRole("form", { name: "Keep a dataset as a series" }));
    type(f.getByRole("textbox", { name: "Name" }), "Weather");
    type(f.getByRole("combobox", { name: "Dataset" }), "d-meteo");
    type(f.getByRole("combobox", { name: "Column of the time" }), "lastUpdated");
    type(f.getByRole("combobox", { name: "Column of the value" }), "temperature");
    fireEvent.click(f.getByRole("button", { name: "Keep it" }));
    expect((await screen.findByRole("status")).textContent).toBe("“Weather” is kept. The dataset has not been written yet: its next write is read.");
  });
});

describe("looking at a series", () => {
  const answer = (over: Partial<GridAnswer> = {}): GridAnswer => ({
    key: "twin:occupancy",
    label: "Stretcher occupancy",
    origin: "twin",
    unit: "percent",
    step: "hour",
    agg: "mean",
    from: "2026-11-25T21:00:00.000Z",
    to: "2026-11-27T21:00:00.000Z",
    asOf: null,
    grid: ["a", "b", "c", "d"],
    series: [
      { entity: "u-chum", label: "CHUM", values: [130, 137, null, 141.5], firstAt: "2026-11-22T21:00:00.000Z", points: 3, emptySteps: 1, replayed: 0 },
      { entity: "u-verdun", label: "Verdun", values: [null, null, null, null], firstAt: null, points: 0, emptySteps: 4, replayed: 0 },
    ],
    howToRead: "Each value holds until the next point. A step with no value is null: a gap, not a zero.",
    ...over,
  });

  it("reads the series on a grid, the way a model would be handed it, and shows its gaps", async () => {
    await page();
    api.readSeriesGrid.mockResolvedValue(answer());
    fireEvent.click(within(card("Stretcher occupancy")).getByRole("button", { name: "Look" }));
    const look = within(await screen.findByRole("region", { name: "Look at Stretcher occupancy" }));

    const chum = within(await look.findByRole("listitem", { name: "CHUM" }));
    expect(chum.getByText("141.5 · 1 of 4 steps with no value")).toBeTruthy();
    // The gap breaks the line in two: nothing is drawn across what was not read.
    expect(chum.getByRole("img", { name: "3 of 4 steps have a value" }).querySelectorAll("path").length).toBe(2);
    const verdun = within(look.getByRole("listitem", { name: "Verdun" }));
    expect(verdun.getByText("No value in this stretch · 4 of 4 steps with no value")).toBeTruthy();
    expect(verdun.getByRole("img").querySelectorAll("path").length).toBe(0);
    expect(look.getByText(/A step with no value is null: a gap, not a zero\./)).toBeTruthy();

    // A twin measure is read by the hour first; the read asks for a mean over whole hours.
    const sent = api.readSeriesGrid.mock.calls[0]!;
    expect(sent[0]).toBe("mtl");
    expect(sent[1]).toMatchObject({ key: "twin:occupancy", step: "hour", agg: "mean" });
    expect(new Date(sent[1].to).getTime() - new Date(sent[1].from).getTime()).toBe(48 * 3_600_000);
  });

  it("reads a weekly series by the day first, and reads again when the step changes", async () => {
    await page();
    api.readSeriesGrid.mockResolvedValue(answer({ key: VIRUS.key, step: "day" }));
    fireEvent.click(within(card("Respiratory virus detections")).getByRole("button", { name: "Look" }));
    await waitFor(() => expect(api.readSeriesGrid).toHaveBeenCalledTimes(1));
    expect(api.readSeriesGrid.mock.calls[0]![1]).toMatchObject({ key: "respiratory_virus_detections", step: "day" });

    fireEvent.click(await screen.findByRole("button", { name: "Last 48 hours, by the hour" }));
    await waitFor(() => expect(api.readSeriesGrid).toHaveBeenCalledTimes(2));
    expect(api.readSeriesGrid.mock.calls[1]![1]).toMatchObject({ step: "hour" });
  });

  it("draws a few entities and says how many more there are", async () => {
    await page();
    const many = Array.from({ length: 11 }, (_, i) => ({ entity: `u${i}`, label: `Unit ${i}`, values: [1, 2], firstAt: null, points: 2, emptySteps: 0, replayed: 0 }));
    api.readSeriesGrid.mockResolvedValue(answer({ series: many }));
    fireEvent.click(within(card("Stretcher occupancy")).getByRole("button", { name: "Look" }));
    const look = within(await screen.findByRole("region", { name: "Look at Stretcher occupancy" }));
    await look.findByRole("listitem", { name: "Unit 0" });
    expect(look.getAllByRole("listitem").length).toBe(8);
    expect(look.getByText("And 3 more, read the same way.")).toBeTruthy();
  });

  it("says why when the read is refused, and offers no look on a series with no point", async () => {
    await page(list([OCCUPANCY, { ...VIRUS, points: 0, entities: 0, firstAt: null, lastAt: null, keptSince: null, note: null }]));
    expect((within(card("Respiratory virus detections")).getByRole("button", { name: "Look" }) as HTMLButtonElement).disabled).toBe(true);
    api.readSeriesGrid.mockRejectedValue(new ApiError(400, "SERIES_READ_REFUSED", "107 units carry this measure: name the units to read."));
    fireEvent.click(within(card("Stretcher occupancy")).getByRole("button", { name: "Look" }));
    const look = within(await screen.findByRole("region", { name: "Look at Stretcher occupancy" }));
    expect((await look.findByRole("alert")).textContent).toBe("107 units carry this measure: name the units to read.");
  });
});
