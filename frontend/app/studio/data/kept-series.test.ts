import { describe, expect, it } from "vitest";

import type { CatchupOffer, CatchupState, CopiesOf, SeriesLine, SeriesOffer } from "../series-api";
import {
  blankSeriesForm,
  catchupText,
  columnsOf,
  copiesText,
  coversText,
  draftOfSeries,
  firstPick,
  gapsText,
  holdHoursOf,
  holdsText,
  lastKnown,
  leftOutShort,
  leftOutText,
  lookWindow,
  missingColumns,
  planOf,
  progressText,
  resembles,
  slowDownOf,
  sourcesOf,
  sparkPaths,
  standsFor,
  stepText,
  type SeriesForm,
} from "./kept-series";

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

  it("lets a value of a dataset series hold for two of its source's steps, and bounds nothing for a twin measure", () => {
    expect(holdHoursOf("hour")).toBe(2);
    expect(holdHoursOf("day")).toBe(48);
    expect(holdHoursOf("week")).toBe(336);
    // Written down when it changes: how often its source publishes is not known here.
    expect(holdHoursOf("change")).toBeNull();
  });

  it("finds the last value that was read, and how far back it sits", () => {
    expect(lastKnown([1, 2, 3])).toEqual({ value: 3, stepsAgo: 0 });
    expect(lastKnown([1, 2, null, null])).toEqual({ value: 2, stepsAgo: 2 });
    // A zero is a value.
    expect(lastKnown([5, 0])).toEqual({ value: 0, stepsAgo: 0 });
    expect(lastKnown([null, null])).toBeNull();
  });
});

describe("catching up from kept copies", () => {
  const copies = (over: Partial<CopiesOf>): CopiesOf => ({ datasetId: "d", datasetName: "A dataset", copies: 0, firstAt: null, lastAt: null, columns: [], ...over });
  const FULL = copies({ datasetId: "d-full", datasetName: "Emergency file, full", copies: 0, columns: ["No_permis", "Occupees", "Mise_a_jour", "Region", "DMS"] });
  const TABLE = copies({ datasetId: "d-xw", datasetName: "Permit table", copies: 4, firstAt: "2026-09-09T14:42:00.000Z", lastAt: "2026-09-09T15:24:00.000Z", columns: ["permis", "code"] });
  const OLD = copies({ datasetId: "d-old", datasetName: "Emergency file, Montréal", copies: 1523, firstAt: "2026-08-25T21:25:00.000Z", lastAt: "2026-11-23T15:11:00.000Z", columns: ["No_permis", "Occupees", "Mise_a_jour"] });
  const AIR = copies({ datasetId: "d-air", datasetName: "Air quality", copies: 1100, firstAt: "2026-09-09T17:38:00.000Z", lastAt: "2026-11-22T21:30:00.000Z", columns: ["stationId", "valeur"] });
  const TWIN: CatchupOffer = {
    key: "twin:occupancy",
    origin: "twin",
    until: "2026-11-23T15:13:00.000Z",
    paths: [{ pipelineId: "p-urg", pipelineName: "Urgences → Relevé d'urgence", inputs: [FULL, TABLE] }],
    standIns: [OLD, TABLE, AIR],
    why: null,
    begun: [],
  };
  const state = (over: Partial<CatchupState> = {}): CatchupState => ({
    key: "twin:occupancy",
    datasetId: "d-old",
    datasetName: "Emergency file, Montréal",
    pipelineId: "p-urg",
    pipelineName: "Urgences → Relevé d'urgence",
    inPlaceOf: { datasetId: "d-full", datasetName: "Emergency file, full" },
    until: "2026-11-23T15:13:00.000Z",
    firstCopyAt: "2026-08-25T21:25:00.000Z",
    copies: 1523,
    read: 1523,
    written: 41210,
    copiesLeftOut: 0,
    rowsLeftOut: 0,
    rowsUnattached: 0,
    note: null,
    done: true,
    startedAt: "2026-11-27T21:00:00.000Z",
    updatedAt: "2026-11-27T21:30:00.000Z",
    ...over,
  });

  it("says how many copies there are and when they were taken", () => {
    expect(copiesText(OLD)).toBe("1,523 copies, taken from 25 Aug 2026 to 23 Nov 2026");
    expect(copiesText(TABLE)).toBe("4 copies, taken on 9 Sep 2026");
    expect(copiesText(copies({ copies: 1, firstAt: "2026-11-23T15:01:00.000Z", lastAt: "2026-11-23T15:01:00.000Z" }))).toBe("1 copy, taken on 23 Nov 2026");
    expect(copiesText(FULL)).toBe("no older copy");
  });

  it("tells a pipeline's own inputs from the datasets that could stand in for one", () => {
    const { own, others } = sourcesOf(TWIN.paths[0]!, TWIN.standIns);
    // The full file has no copy that old; the permit table is an input, and is not offered twice.
    expect(own.map((s) => s.datasetName)).toEqual(["Permit table"]);
    expect(others.map((s) => s.datasetName)).toEqual(["Emergency file, Montréal", "Air quality"]);
    expect(missingColumns(FULL, OLD)).toEqual(["Region", "DMS"]);
    expect(missingColumns(FULL, FULL)).toEqual([]);
  });

  it("proposes first the dataset with the most older copies, in place of the input it shares the most columns with", () => {
    // The old emergency file holds three months of copies; the permit table, an input, holds four from one day.
    expect(firstPick(TWIN)).toEqual({ pipelineId: "p-urg", datasetId: "d-old", inPlaceOf: "d-full" });
    // It shares three columns with the full file and none with the permit table: it stands for the full file.
    expect(standsFor(TWIN.paths[0]!, OLD)).toBe("d-full");
    expect(standsFor({ inputs: [TABLE, FULL] }, OLD)).toBe("d-full");
    expect(standsFor({ inputs: [] }, OLD)).toBeNull();
    // An air quality file shares no column with an emergency file: however many copies it has, it is never proposed in its place.
    expect(resembles(FULL, OLD)).toBe(true);
    expect(resembles(FULL, AIR)).toBe(false);
    expect(resembles(FULL, { columns: [] })).toBe(false);
    expect(firstPick({ ...TWIN, standIns: [OLD, TABLE, { ...AIR, copies: 9000 }] })).toEqual({ pipelineId: "p-urg", datasetId: "d-old", inPlaceOf: "d-full" });
    expect(firstPick({ ...TWIN, standIns: [TABLE, { ...AIR, copies: 9000 }] })).toEqual({ pipelineId: "p-urg", datasetId: "d-xw", inPlaceOf: null });
    // At equal count, the dataset the pipeline reads today comes first.
    const few = { ...TWIN, standIns: [{ ...OLD, copies: 4 }, TABLE] };
    expect(firstPick(few)).toEqual({ pipelineId: "p-urg", datasetId: "d-xw", inPlaceOf: null });
    expect(firstPick({ paths: [], standIns: [OLD] })).toBeNull();
    expect(firstPick({ paths: [{ pipelineId: "p", pipelineName: "P", inputs: [FULL] }], standIns: [] })).toBeNull();
  });

  it("says, before anything is read, what a catch-up will read and what it will not do", () => {
    const plan = planOf(TWIN, { pipelineId: "p-urg", datasetId: "d-old", inPlaceOf: "d-full" })!;
    expect(plan.request).toEqual({ key: "twin:occupancy", datasetId: "d-old", pipelineId: "p-urg", inPlaceOf: "d-full" });
    expect(plan.copies).toBe(1523);
    expect(plan.said).toEqual([
      "1,523 copies of “Emergency file, Montréal”, taken from 25 Aug 2026 to 23 Nov 2026: all from before this series started being kept, on 23 Nov 2026.",
      "Each copy goes through “Urgences → Relevé d'urgence” as it is today, in place of “Emergency file, full”, and is measured as the measure is defined today, over today's units. Nothing is written in the ontology.",
      "“Emergency file, Montréal” does not have the columns Region, DMS that “Emergency file, full” has: what the pipeline makes from them will be empty.",
      "What is written down is marked as caught up, and carries the time its source gave and the time its copy was taken. A row that cannot be placed is left out and counted.",
    ]);

    // An input of the pipeline stands in place of nothing, and lacks nothing.
    const own = planOf(TWIN, { pipelineId: "p-urg", datasetId: "d-xw", inPlaceOf: null })!;
    expect(own.request.inPlaceOf).toBeNull();
    expect(own.said[1]).toBe("Each copy goes through “Urgences → Relevé d'urgence” as it is today, and is measured as the measure is defined today, over today's units. Nothing is written in the ontology.");
    expect(own.said).toHaveLength(3);

    // A pick that does not hold together plans nothing.
    expect(planOf(TWIN, { pipelineId: "p-other", datasetId: "d-old", inPlaceOf: "d-full" })).toBeNull();
    expect(planOf(TWIN, { pipelineId: "p-urg", datasetId: "d-full", inPlaceOf: null })).toBeNull();
    expect(planOf(TWIN, { pipelineId: "p-urg", datasetId: "d-old", inPlaceOf: "d-air" })).toBeNull();
  });

  it("plans a dataset series from the copies of its own dataset", () => {
    const offer: CatchupOffer = { key: "virus", origin: "dataset", until: "2026-11-27T20:00:00.000Z", paths: [{ pipelineId: null, pipelineName: null, inputs: [copies({ datasetId: "d-v", datasetName: "Virus detections", copies: 54, firstAt: "2026-09-07T15:36:00.000Z", lastAt: "2026-11-26T12:51:00.000Z" })] }], standIns: [], why: null, begun: [] };
    expect(firstPick(offer)).toEqual({ pipelineId: null, datasetId: "d-v", inPlaceOf: null });
    const plan = planOf(offer, firstPick(offer)!)!;
    expect(plan.request).toEqual({ key: "virus", datasetId: "d-v", pipelineId: null, inPlaceOf: null });
    expect(plan.said[1]).toBe("Each copy is read the way a write of the dataset is read today: only what changed from one copy to the next is written down.");
  });

  it("says in a few words, on the list, how much a catch-up left out", () => {
    expect(leftOutShort(state())).toBeNull();
    expect(leftOutShort(state({ copiesLeftOut: 309, rowsUnattached: 24 }))).toBe("309 copies and 24 rows left out: “Catch up” says why.");
    expect(leftOutShort(state({ copiesLeftOut: 1 }))).toBe("1 copy left out: “Catch up” says why.");
    // Rows that made no point and rows that named no place are both rows left out.
    expect(leftOutShort(state({ rowsLeftOut: 2, rowsUnattached: 1 }))).toBe("3 rows left out: “Catch up” says why.");
  });

  it("waits as long as the API says when it is asked too fast, and for nothing else", () => {
    expect(slowDownOf({ status: 429, code: "RATE_LIMITED", details: { limit: 100, ttlSeconds: 25 } })).toBe(26_000);
    // With no delay given, half a minute: the window of the limit is a minute.
    expect(slowDownOf({ status: 429, code: "RATE_LIMITED" })).toBe(30_000);
    expect(slowDownOf({ status: 400, code: "CATCHUP_REFUSED" })).toBeNull();
    expect(slowDownOf(new Error("offline"))).toBeNull();
    expect(slowDownOf(null)).toBeNull();
  });

  it("says where a catch-up stands, and what it left out", () => {
    expect(catchupText(state())).toBe(
      "Caught up from 1,523 copies of “Emergency file, Montréal”, through “Urgences → Relevé d'urgence” in place of “Emergency file, full”, the oldest taken on 25 Aug 2026: 41,210 points written down.",
    );
    expect(catchupText(state({ done: false, read: 312 }))).toBe(
      "Catch-up stopped at 312 of 1,523 copies of “Emergency file, Montréal”, through “Urgences → Relevé d'urgence” in place of “Emergency file, full”. Resume it to read the rest.",
    );
    expect(catchupText(state({ pipelineId: null, pipelineName: null, inPlaceOf: null, datasetName: "Virus detections", copies: 54, written: 1 }))).toBe(
      "Caught up from 54 copies of “Virus detections”, the oldest taken on 25 Aug 2026: 1 point written down.",
    );
    expect(progressText(state({ read: 312, written: 4210 }))).toBe("312 of 1,523 copies read · 4,210 points written down");

    expect(leftOutText(state())).toEqual([]);
    expect(leftOutText(state({ copiesLeftOut: 1, rowsLeftOut: 12, rowsUnattached: 1, note: "The pipeline could not run on the copy of 2026-09-02 10:20 UTC: it failed. That copy was left out." }))).toEqual([
      "1 copy could not be replayed. The pipeline could not run on the copy of 2026-09-02 10:20 UTC: it failed. That copy was left out.",
      "12 rows could not be read into a point.",
      "1 row named a place the twin does not hold, and was left out rather than placed by guess.",
    ]);
  });
});
