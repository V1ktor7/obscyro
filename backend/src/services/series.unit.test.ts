import assert from "node:assert/strict";
import { test } from "node:test";

import { extractPoints, noteOf, numberOf, type Extracted } from "./series-capture.js";
import { GRID_MAX, STEP_MS, checkDraft, gridOf, knownAsOf, onGrid, seriesDraft, seriesKeyFrom, type KeptPoint } from "./series.js";

/**
 * A history a model can read.
 *
 * Two things are held here without a database: how the rows of one copy of a
 * file become the points of a series, and how points become a regular grid.
 * The rules a forecast leans on are the ones tested hardest: a gap is not a
 * zero, nothing is known before the first point, and a read "as of" a day
 * shows only what had been written down by then.
 */

const HOUR = STEP_MS.hour;
const at = (iso: string) => new Date(iso);
const point = (when: string, value: number | null, seen: string = when): KeptPoint => ({ at: at(when), value, seenAt: at(seen) });

// --- from the rows of a file to points --------------------------------------------------

const DEF = { timeColumn: "Mise_a_jour", timeZone: "America/Toronto", valueColumn: "occupees", entityColumns: ["installation"] };

test("a cell is a number or an absence, never a guess", () => {
  assert.equal(numberOf(42), 42);
  assert.equal(numberOf("42"), 42);
  assert.equal(numberOf(" 10.5 "), 10.5);
  // A decimal comma, as a French file writes it.
  assert.equal(numberOf("10,5"), 10.5);
  // What the ministry writes when an emergency department sent nothing.
  assert.equal(numberOf("pas d'information disponible"), null);
  assert.equal(numberOf(""), null);
  assert.equal(numberOf(null), null);
  assert.equal(numberOf(Number.NaN), null);
  // A thousands separator is left unread rather than guessed.
  assert.equal(numberOf("1 234"), null);
});

test("the rows of one copy become one point per entity and instant", () => {
  const x = extractPoints(
    [
      { installation: "CHUM", Mise_a_jour: "2026-11-27T12:50", occupees: "67" },
      { installation: "Verdun", Mise_a_jour: "2026-11-27T12:50", occupees: 31 },
      // An emergency department that sent nothing: an absence that is kept, not a zero.
      { installation: "Lachine", Mise_a_jour: "2026-11-27T12:50", occupees: "pas d'information disponible" },
    ],
    DEF,
  );
  assert.deepEqual(
    x.points.map((p) => [p.entity, p.at.toISOString(), p.value]),
    [
      // 12:50 on Montréal's clock in November is 17:50 UTC.
      ["CHUM", "2026-11-27T17:50:00.000Z", 67],
      ["Verdun", "2026-11-27T17:50:00.000Z", 31],
      ["Lachine", "2026-11-27T17:50:00.000Z", null],
    ],
  );
  assert.deepEqual([x.rows, x.empty, x.unreadableTime, x.zoneUnknown, x.ambiguous], [3, 1, 0, 0, 0]);
  assert.equal(noteOf(x), null);
});

test("a time with no zone is not placed when the series does not say which clock it is", () => {
  const x = extractPoints([{ installation: "CHUM", Mise_a_jour: "2026-11-27T12:50", occupees: 67 }], { ...DEF, timeZone: null });
  assert.deepEqual([x.points.length, x.zoneUnknown], [0, 1]);
  assert.match(noteOf(x)!, /carry no time zone and the series declares none: none of the 1 row could be placed\. Say which clock the file is written on\./);
  // A time that says its own zone needs none declared.
  const zoned = extractPoints([{ installation: "CHUM", Mise_a_jour: "2026-11-27T12:50:00-05:00", occupees: 67 }], { ...DEF, timeZone: null });
  assert.equal(zoned.points[0]!.at.toISOString(), "2026-11-27T17:50:00.000Z");
});

test("a date with no hour is the start of that day, and a weekly file is read the same way", () => {
  const x = extractPoints([{ date: "2026-09-05", virus: "SARS-CoV-2", province: "Québec", detections: "212" }], {
    timeColumn: "date",
    timeZone: "America/Toronto",
    valueColumn: "detections",
    entityColumns: ["province", "virus"],
  });
  assert.deepEqual([x.points[0]!.entity, x.points[0]!.at.toISOString(), x.points[0]!.value], ["Québec | SARS-CoV-2", "2026-09-05T04:00:00.000Z", 212]);
});

test("rows that share an entity and an instant and disagree are left out and said, never averaged", () => {
  const x = extractPoints(
    [
      // The file has one total per region under the same name: the region is missing from the entity.
      { installation: "Total régional", Mise_a_jour: "2026-11-27T12:50", occupees: 410 },
      { installation: "Total régional", Mise_a_jour: "2026-11-27T12:50", occupees: 96 },
      { installation: "CHUM", Mise_a_jour: "2026-11-27T12:50", occupees: 67 },
      // The same row twice is one point.
      { installation: "Verdun", Mise_a_jour: "2026-11-27T12:50", occupees: 31 },
      { installation: "Verdun", Mise_a_jour: "2026-11-27T12:50", occupees: 31 },
      { installation: "Lachine", Mise_a_jour: "bientôt", occupees: 12 },
    ],
    DEF,
  );
  assert.deepEqual(x.points.map((p) => p.entity), ["CHUM", "Verdun"]);
  assert.deepEqual([x.ambiguous, x.unreadableTime], [2, 1]);
  assert.equal(
    noteOf(x),
    "1 row has a time that cannot be read. 2 rows share an entity and a time and give different values: a column that tells them apart is missing from the series. They were left out.",
  );
});

test("a series with no entity column has one entity, and an empty name is said rather than merged", () => {
  const whole = extractPoints([{ jour: "2026-11-27", total: 5 }], { timeColumn: "jour", timeZone: "UTC", valueColumn: "total", entityColumns: [] });
  assert.equal(whole.points[0]!.entity, "");
  const unnamed = extractPoints([{ jour: "2026-11-27", total: 5, site: "  " }], { timeColumn: "jour", timeZone: "UTC", valueColumn: "total", entityColumns: ["site"] });
  assert.equal(unnamed.points[0]!.entity, "(not said)");
});

test("what a write could not read is counted in words a person can act on", () => {
  const base: Extracted = { points: [], rows: 120, unreadableTime: 0, zoneUnknown: 0, ambiguous: 0, empty: 0 };
  assert.equal(noteOf(base), null);
  assert.equal(noteOf({ ...base, zoneUnknown: 12 }), "12 rows carry a time with no time zone, and the series declares none.");
  assert.equal(noteOf({ ...base, unreadableTime: 3 }), "3 rows have a time that cannot be read.");
  // An absence is not a fault: a value that is missing is kept as a gap, and nothing is said of it here.
  assert.equal(noteOf({ ...base, empty: 12 }), null);
});

// --- from points to a regular grid -----------------------------------------------------

const FROM = at("2026-11-27T00:00:00Z");

test("each value holds until the next point, and nothing is known before the first", () => {
  const points = [point("2026-11-27T01:00:00Z", 120), point("2026-11-27T03:00:00Z", 140)];
  assert.deepEqual(onGrid(points, FROM, 5, HOUR, "mean"), [null, 120, 120, 140, 140]);
});

test("the point in force when the grid begins is the last one before it", () => {
  const points = [point("2026-11-26T22:00:00Z", 110), point("2026-11-27T02:00:00Z", 130)];
  assert.deepEqual(onGrid(points, FROM, 3, HOUR, "mean"), [110, 110, 130]);
});

test("a point with no value opens a gap: null, never zero, until a value comes back", () => {
  const points = [point("2026-11-27T00:00:00Z", 120), point("2026-11-27T01:00:00Z", null), point("2026-11-27T03:00:00Z", 90)];
  assert.deepEqual(onGrid(points, FROM, 4, HOUR, "mean"), [120, null, null, 90]);
  assert.deepEqual(onGrid(points, FROM, 4, HOUR, "max"), [120, null, null, 90]);
  assert.deepEqual(onGrid(points, FROM, 4, HOUR, "last"), [120, null, null, 90]);
});

test("over a wider step: the mean is weighted by time, the max is the highest in force, the last is what the step ends on", () => {
  const day = at("2026-11-27T00:00:00Z");
  // 100 for six hours, 160 for six hours, then 120 until the end of the day.
  const points = [point("2026-11-27T00:00:00Z", 100), point("2026-11-27T06:00:00Z", 160), point("2026-11-27T12:00:00Z", 120)];
  assert.deepEqual(onGrid(points, day, 1, STEP_MS.day, "mean"), [125]);
  assert.deepEqual(onGrid(points, day, 1, STEP_MS.day, "max"), [160]);
  assert.deepEqual(onGrid(points, day, 1, STEP_MS.day, "last"), [120]);
  // A day half unknown is averaged over the half that is known, not diluted by a zero.
  const half = [point("2026-11-27T12:00:00Z", 80)];
  assert.deepEqual(onGrid(half, day, 2, STEP_MS.day, "mean"), [80, 80]);
});

test("a weekly value read by the day holds for its week", () => {
  const points = [point("2026-11-16T00:00:00Z", 3.2), point("2026-11-23T00:00:00Z", 4.1)];
  assert.deepEqual(onGrid(points, at("2026-11-21T00:00:00Z"), 4, STEP_MS.day, "last"), [3.2, 3.2, 4.1, 4.1]);
});

test("read as of an instant, only what had been written down by then is used", () => {
  const points = [
    point("2026-11-27T01:00:00Z", 120, "2026-11-27T01:05:00Z"),
    point("2026-11-27T02:00:00Z", 135, "2026-11-27T02:05:00Z"),
    point("2026-11-27T03:00:00Z", 150, "2026-11-27T03:05:00Z"),
  ];
  const known = knownAsOf(points, at("2026-11-27T02:30:00Z"));
  assert.deepEqual(known.map((p) => p.value), [120, 135]);
  // The 03:00 value is not there for whoever was looking at 02:30.
  assert.deepEqual(onGrid(known, FROM, 3, HOUR, "last"), [null, 120, 135]);
  assert.deepEqual(knownAsOf(points, null).length, 3);
});

test("a value its source corrected is read as it was known that day", () => {
  // A weekly count published at 212, then corrected to 240 a week later.
  const points = [point("2026-11-16T00:00:00Z", 212, "2026-11-18T12:00:00Z"), point("2026-11-16T00:00:00Z", 240, "2026-11-25T12:00:00Z")];
  assert.deepEqual(knownAsOf(points, at("2026-11-20T00:00:00Z")).map((p) => p.value), [212]);
  assert.deepEqual(knownAsOf(points, at("2026-11-26T00:00:00Z")).map((p) => p.value), [240]);
  // With no instant, the last one written down stands, once.
  assert.deepEqual(knownAsOf(points, null).map((p) => p.value), [240]);
  // Whatever order the points come in.
  assert.deepEqual(knownAsOf([...points].reverse(), null).map((p) => p.value), [240]);
});

// --- what a read may ask for -------------------------------------------------------------

test("a grid is refused when it ends before it starts, runs past what was known, or is too long", () => {
  const ask = (over: object) => () => gridOf({ from: "2026-11-01T00:00:00Z", to: "2026-11-02T00:00:00Z", step: "hour", asOf: null, ...over });
  assert.equal(ask({})().buckets, 24);
  // A stretch that does not fall on whole steps is covered, not cut short.
  assert.equal(ask({ to: "2026-11-01T02:30:00Z" })().buckets, 3);
  assert.throws(ask({ to: "2026-10-31T00:00:00Z" }), /ends before it starts/);
  assert.throws(ask({ asOf: "2026-11-01T12:00:00Z" }), /ends after the instant it is read as of\. Nothing was known then of what came after/);
  assert.doesNotThrow(ask({ asOf: "2026-11-02T00:00:00Z" }));
  assert.throws(ask({ to: "2027-11-01T00:00:00Z" }), new RegExp(`where one read returns ${GRID_MAX.toLocaleString("en-CA")} at most\\. Shorten the stretch, or read it by the day`));
  assert.doesNotThrow(ask({ to: "2027-11-01T00:00:00Z", step: "day" }));
});

// --- declaring a series ------------------------------------------------------------------

const TABLE = {
  projectId: "p-1",
  kind: "table" as const,
  name: "ASPC — Détections de virus respiratoires",
  columnSchema: [
    { name: "date", type: "string" as const, nullable: false },
    { name: "province", type: "string" as const, nullable: false },
    { name: "virus", type: "string" as const, nullable: false },
    { name: "detections", type: "string" as const, nullable: true },
  ],
};
const draft = (over: object = {}) =>
  seriesDraft.parse({ label: "Respiratory virus detections", datasetId: "5f0c1a3e-8b1d-4c56-9a44-0b6d2f1e7a90", timeColumn: "date", timeZone: "America/Toronto", valueColumn: "detections", entityColumns: ["province", "virus"], step: "week", ...over });
const refusal = (re: RegExp) => (err: unknown) => (err as { code?: string }).code === "SERIES_INVALID" && re.test((err as Error).message);

test("a series is declared with columns the dataset has, and refused with what to correct", () => {
  assert.doesNotThrow(() => checkDraft(draft(), TABLE, "p-1"));
  assert.throws(() => checkDraft(draft({ valueColumn: "cases" }), TABLE, "p-1"), refusal(/has no column called “cases” for the value\. Its columns are: date, province, virus, detections\./));
  assert.throws(() => checkDraft(draft({ entityColumns: ["region"] }), TABLE, "p-1"), refusal(/no column called “region” for the entity/));
  assert.throws(() => checkDraft(draft({ valueColumn: "date" }), TABLE, "p-1"), refusal(/The time and the value cannot be the same column/));
  assert.throws(() => checkDraft(draft({ entityColumns: ["virus", "virus"] }), TABLE, "p-1"), refusal(/named twice/));
  assert.throws(() => checkDraft(draft({ entityColumns: ["detections"] }), TABLE, "p-1"), refusal(/cannot also name the entity/));
  assert.throws(() => checkDraft(draft({ timeZone: "Montreal time" }), TABLE, "p-1"), refusal(/is not a time zone this server knows\. Write it as a region and a city, such as America\/Toronto/));
  assert.throws(() => checkDraft(draft(), { ...TABLE, kind: "stream" }, "p-1"), refusal(/is a stream\. A series is kept from a table/));
  // A dataset of another project is not there, for this one.
  assert.throws(() => checkDraft(draft(), TABLE, "p-2"), (err: unknown) => (err as { code?: string }).code === "DATASET_NOT_FOUND");
});

test("a draft is read strictly: a step that is not one of three, too many entity columns", () => {
  assert.equal(seriesDraft.safeParse({ ...draft(), step: "month" }).success, false);
  assert.equal(seriesDraft.safeParse({ ...draft(), entityColumns: ["a", "b", "c", "d", "e"] }).success, false);
  assert.equal(seriesDraft.safeParse({ ...draft(), label: " " }).success, false);
  assert.deepEqual([draft({ timeZone: undefined }).timeZone, draft({ entityColumns: undefined }).entityColumns], [null, []]);
});

test("a series key is made from its label, and never taken twice", () => {
  const none = new Set<string>();
  assert.equal(seriesKeyFrom("Respiratory virus detections", none), "respiratory_virus_detections");
  assert.equal(seriesKeyFrom("Eaux usées, Montréal Nord", none), "eaux_usees_montreal_nord");
  assert.equal(seriesKeyFrom("Météo", new Set(["meteo"])), "meteo_2");
  assert.equal(seriesKeyFrom("7 j", none), "j_series");
  assert.equal(seriesKeyFrom("???", none), "series");
});
