import { describe, expect, it } from "vitest";

import type { SeriesLine, SeriesOffer } from "../series-api";
import { blankSeriesForm, columnsOf, coversText, draftOfSeries, gapsText, holdsText, lastKnown, lookWindow, sparkPaths, stepText, type SeriesForm } from "./kept-series";

const line = (over: Partial<SeriesLine> = {}): SeriesLine => ({
  key: "twin:occupancy",
  label: "Stretcher occupancy",
  origin: "twin",
  from: "A measure of the twin",
  step: "change",
  unit: "percent",
  entities: 107,
  points: 12424,
  emptyPoints: 0,
  replayed: 0,
  firstAt: "2026-11-22T21:00:00.000Z",
  lastAt: "2026-11-27T19:50:00.000Z",
  keptSince: "2026-11-22T21:43:00.000Z",
  note: null,
  declared: null,
  ...over,
});

describe("a kept series in words", () => {
  it("says how often it gets a point", () => {
    expect(stepText("change")).toBe("Written down when it changes");
    expect(stepText("hour")).toBe("Every hour");
    expect(stepText("day")).toBe("Every day");
    expect(stepText("week")).toBe("Every week");
  });

  it("says how much it holds, for units or for entities", () => {
    expect(holdsText(line())).toBe("12,424 points for 107 units");
    expect(holdsText(line({ origin: "dataset", entities: 13, points: 880 }))).toBe("880 points for 13 entities");
    expect(holdsText(line({ origin: "dataset", entities: 1, points: 1 }))).toBe("1 point for one entity");
    expect(holdsText(line({ points: 0, entities: 0 }))).toBe("No point yet");
  });

  it("says the stretch the points are about, apart from when keeping started", () => {
    expect(coversText(line())).toBe("About 22 Nov 2026 to 27 Nov 2026. Kept here since 22 Nov 2026.");
    // A file that carries years of its own history: what it is about is not when it was kept.
    expect(coversText(line({ firstAt: "2022-01-02T05:00:00.000Z", lastAt: "2026-11-22T05:00:00.000Z", keptSince: "2026-11-27T20:00:00.000Z" }))).toBe(
      "About 2 Jan 2022 to 22 Nov 2026. Kept here since 27 Nov 2026.",
    );
    expect(coversText(line({ points: 0, firstAt: null, lastAt: null, keptSince: null }))).toBe("Nothing is kept yet: the next write of the dataset is read.");
  });

  it("says what is missing and what was caught up, and nothing when there is neither", () => {
    expect(gapsText(line())).toEqual([]);
    expect(gapsText(line({ emptyPoints: 12, replayed: 1 }))).toEqual(["12 points written down with no value: a gap that was seen, not a zero.", "1 point caught up from kept copies."]);
  });
});

describe("the form of a series", () => {
  const OFFER: SeriesOffer = {
    datasets: [
      { id: "d-virus", name: "Virus detections", columns: [{ name: "date", type: "string" }, { name: "province", type: "string" }, { name: "virus", type: "string" }, { name: "detections", type: "number" }] },
      { id: "d-meteo", name: "Weather", columns: [] },
    ],
  };
  const filled = (over: Partial<SeriesForm> = {}): SeriesForm => ({
    ...blankSeriesForm(),
    label: " Respiratory virus detections ",
    datasetId: "d-virus",
    timeColumn: "date",
    valueColumn: "detections",
    entityColumns: ["province", "virus"],
    step: "week",
    timeZone: " America/Toronto ",
    unit: "",
    ...over,
  });

  it("offers the columns of the dataset it points at, and none before one is picked", () => {
    expect(columnsOf(OFFER, "d-virus").map((c) => c.name)).toEqual(["date", "province", "virus", "detections"]);
    expect(columnsOf(OFFER, "")).toEqual([]);
    expect(columnsOf(OFFER, "gone")).toEqual([]);
  });

  it("sends what was filled in, trimmed, with an empty zone or unit as none", () => {
    expect(draftOfSeries(filled())).toEqual({
      draft: { label: "Respiratory virus detections", datasetId: "d-virus", timeColumn: "date", timeZone: "America/Toronto", valueColumn: "detections", entityColumns: ["province", "virus"], step: "week", unit: null },
      problems: [],
    });
    expect(draftOfSeries(filled({ timeZone: " ", unit: " detections " })).draft).toMatchObject({ timeZone: null, unit: "detections" });
  });

  it("says what to correct before anything is sent", () => {
    expect(draftOfSeries(blankSeriesForm()).problems).toEqual([
      "Give the series a name.",
      "Pick the dataset it is read from.",
      "Pick the column that says when the value was true.",
      "Pick the column of the value.",
    ]);
    expect(draftOfSeries(filled({ valueColumn: "date" })).problems).toEqual(["The time and the value cannot be the same column."]);
    expect(draftOfSeries(filled({ entityColumns: ["province", "detections"] })).problems).toEqual(["The time and the value cannot also name the entity."]);
    expect(draftOfSeries(filled({ entityColumns: ["a", "b", "c", "d", "e"] })).problems).toEqual(["An entity is named by 4 columns at most."]);
  });
});

describe("looking at a series", () => {
  it("reads the last two days by the hour or the last thirty by the day, ending on a whole hour", () => {
    const now = new Date("2026-11-27T20:17:30Z");
    expect(lookWindow("hour", now)).toEqual({ from: "2026-11-25T21:00:00.000Z", to: "2026-11-27T21:00:00.000Z" });
    expect(lookWindow("day", now)).toEqual({ from: "2026-10-28T21:00:00.000Z", to: "2026-11-27T21:00:00.000Z" });
    // Two looks a minute apart read the same grid.
    expect(lookWindow("hour", new Date("2026-11-27T20:18:30Z"))).toEqual(lookWindow("hour", now));
  });

  it("draws a line that a gap breaks in two, never one drawn across what was not read", () => {
    expect(sparkPaths([1, 2, 3], 100, 10)).toEqual(["M0.00,10.00 L50.00,5.00 L100.00,0.00"]);
    expect(sparkPaths([1, 3, null, null, 2, 3], 100, 10)).toEqual(["M0.00,10.00 L20.00,0.00", "M80.00,5.00 L100.00,0.00"]);
    // A lone value between two gaps is still drawn.
    expect(sparkPaths([null, 5, null], 100, 10)).toEqual(["M50.00,5.00 h0.01"]);
    // A flat line sits in the middle of the box rather than on its floor.
    expect(sparkPaths([4, 4], 100, 10)).toEqual(["M0.00,5.00 L100.00,5.00"]);
    expect(sparkPaths([null, null], 100, 10)).toEqual([]);
    expect(sparkPaths([], 100, 10)).toEqual([]);
  });

  it("finds the last value that was read, and how far back it sits", () => {
    expect(lastKnown([1, 2, 3])).toEqual({ value: 3, stepsAgo: 0 });
    expect(lastKnown([1, 2, null, null])).toEqual({ value: 2, stepsAgo: 2 });
    // A zero is a value.
    expect(lastKnown([5, 0])).toEqual({ value: 0, stepsAgo: 0 });
    expect(lastKnown([null, null])).toBeNull();
  });
});
