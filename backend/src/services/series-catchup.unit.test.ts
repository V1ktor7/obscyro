import assert from "node:assert/strict";
import { test } from "node:test";

import type { DbClient } from "../lib/db.js";
import type { EnvLinkRow, PropertyDef } from "./ontology.js";
import {
  BATCH_COPIES,
  catchupOffer,
  forgetCatchup,
  identityOf,
  recordReplayed,
  replayObjects,
  replayReadings,
  runCatchup,
  typesLookedAt,
  whyNotThrough,
  type OutputSpec,
  type TwinStructure,
} from "./series-catchup.js";
import { SAME_READING_SECONDS } from "./twin-history.js";
import type { MetricDef } from "./twin-metrics.js";

// ---------------------------------------------------------------------------
// Catching a series up from kept copies.
//
// What matters is what a catch-up does NOT do: write in the ontology, guess a
// place for a row that names none, pass a reading off as one the twin took,
// or start a history for a unit that never had a value.
// ---------------------------------------------------------------------------

const SCHEMA: PropertyDef[] = [
  { key: "permit", type: "string", label: "Permit" },
  { key: "occupied", type: "number", label: "Occupied stretchers" },
  { key: "updated", type: "string", label: "Updated", observedAt: true },
];

const ATTACH = { linkTypeName: "census_of", aggregates: "metrics" as const, aggregateToward: "target" as const, transitive: false };

const OCCUPIED: MetricDef = {
  key: "occupied",
  label: "Occupied stretchers",
  objectType: "OrgUnit",
  unit: "count",
  numerator: { ofType: "Census", agg: "sum", property: "occupied" },
};

const link = (id: string, from: string, to: string): EnvLinkRow => ({ id, ...ATTACH, fromInstanceId: from, toInstanceId: to, fromTypeName: "Census", toTypeName: "OrgUnit" });

const spec = (over: Partial<OutputSpec> = {}): OutputSpec => ({
  nodeId: "out",
  typeId: "t-census",
  typeName: "Census",
  simRole: null,
  schema: SCHEMA,
  identity: ["permit"],
  declared: true,
  rules: [
    { from: "No_permis", to: "permit" },
    { from: "Occupees", to: "occupied" },
    { from: "Mise_a_jour", to: "updated" },
  ],
  // The twin holds the census of room 1001 today, attached to unit A.
  today: new Map([['["1001"]', "inst-1001"]]),
  links: [{ fromColumn: "code", direction: "out", targetTypeName: "OrgUnit", link: ATTACH, targets: new Map([["1001", "u-a"], ["2002", "u-b"]]) }],
  ...over,
});

/** A network of four units: A and B under Top, and C on its own, under which nothing ever stood. */
const structure = (over: Partial<OutputSpec> = {}): TwinStructure => ({
  nodes: [{ id: "u-top" }, { id: "u-a" }, { id: "u-b" }, { id: "u-c" }],
  edges: [
    { fromId: "u-top", toId: "u-a" },
    { fromId: "u-top", toId: "u-b" },
  ],
  linksOf: new Map([
    ["inst-1001", [link("l1", "inst-1001", "u-a")]],
    ["u-a", [link("l1", "inst-1001", "u-a")]],
  ]),
  outputs: [spec(over)],
  def: OCCUPIED,
});

const TAKEN = new Date("2026-09-01T10:20:00Z");
const rowsOf = (...rows: Record<string, unknown>[]) => new Map([["out", rows]]);

// --- what a measure is made from ------------------------------------------------------

test("a measure is made from the types its selectors name, by name or by role", () => {
  const types = [
    { name: "Bed", simRole: "space" as const },
    { name: "Stretcher", simRole: "space" as const },
    { name: "Census", simRole: null },
  ];
  assert.deepEqual(typesLookedAt(OCCUPIED, types), ["Census"]);
  assert.deepEqual(typesLookedAt({ numerator: { ofRole: "space", inUse: true, agg: "count" }, denominator: { ofRole: "space", agg: "count" } }, types), ["Bed", "Stretcher"]);
  assert.deepEqual(typesLookedAt({ numerator: { ofType: "Census", agg: "sum", property: "a" }, denominator: { ofType: "Bed", agg: "count" } }, types), ["Bed", "Census"]);
  // Neither a type nor a role: it counts everything under a unit, and no one file holds that.
  assert.equal(typesLookedAt({ numerator: { agg: "count" } }, types), null);
});

test("the copies go through the pipeline that writes the measure's objects today, all of them, or through none", () => {
  const node = (kind: string, config: Record<string, unknown> = {}) => ({ id: kind, kind: kind as never, name: kind, x: 0, y: 0, config });
  const input = node("dataset_input", { datasetId: "d1" });
  const census = node("object_output", { objectTypeName: "Census" });
  const live = { name: "Urgences", status: "live" as const, nodes: [input, census] };
  assert.equal(whyNotThrough(live, ["Census"]), null);
  assert.equal(whyNotThrough({ ...live, status: "paused" }, ["Census"]), null);
  assert.match(whyNotThrough({ ...live, status: "draft" }, ["Census"]) ?? "", /is a draft: it does not write the twin today/);
  assert.match(whyNotThrough(live, ["Bed"]) ?? "", /does not write Bed/);
  // Half of the measure from the past and half from now is not a measure.
  assert.match(whyNotThrough(live, ["Bed", "Census"]) ?? "", /does not write Bed, which this measure also reads: its past cannot be rebuilt from one file/);
  assert.match(whyNotThrough({ ...live, nodes: [input, node("extract_snomed"), census] }, ["Census"]) ?? "", /calls the extraction service/);
  assert.match(whyNotThrough({ ...live, nodes: [census] }, ["Census"]) ?? "", /reads no dataset/);
});

test("an object is matched the way a run matches it: the type's own identity trimmed and lower case, the output's as written", () => {
  assert.equal(identityOf({ permit: " HND-01 " }, { identity: ["permit"], declared: true }), '["hnd-01"]');
  assert.equal(identityOf({ permit: " HND-01 " }, { identity: ["permit"], declared: false }), '[" HND-01 "]');
  assert.equal(identityOf({ permit: "" }, { identity: ["permit"], declared: true }), null);
  assert.equal(identityOf({ other: 1 }, { identity: ["permit"], declared: false }), null);
  assert.equal(identityOf({ permit: "x" }, { identity: [], declared: false }), null);
});

// --- one copy, replayed in memory -------------------------------------------------------

test("an object the twin holds today keeps the place it has today, and carries only what the copy said", () => {
  const out = replayObjects(structure(), rowsOf({ No_permis: "1001", Occupees: 12, code: "ignored" }), TAKEN);
  assert.equal(out.instances.length, 1);
  const inst = out.instances[0]!;
  assert.equal(inst.id, "inst-1001", "the same object, so every link it has today applies");
  // The old file had no update time: the property is absent, never today's value.
  assert.deepEqual(inst.properties, { permit: "1001", occupied: "12" });
  assert.equal(inst.updatedAt, TAKEN);
  assert.deepEqual(out.links.map((l) => l.id), ["l1"]);
  assert.deepEqual([out.unmapped, out.unattached], [0, 0]);
});

test("two rows with one identity are one object, the later written over the earlier", () => {
  const out = replayObjects(structure(), rowsOf({ No_permis: "1001", Occupees: 12, Mise_a_jour: "2026-09-01T09:00:00Z" }, { No_permis: "1001", Occupees: 14 }), TAKEN);
  assert.equal(out.instances.length, 1);
  assert.deepEqual(out.instances[0]!.properties, { permit: "1001", occupied: "14", updated: "2026-09-01T09:00:00Z" });
  assert.equal(out.links.length, 1, "its link is listed once");
});

test("an identity that changed from one file to the next is placed by the pipeline's own rule, read against today's twin", () => {
  // The old file called the room 9002; today's twin knows it as another permit. The rule still finds its unit by code.
  const out = replayObjects(structure(), rowsOf({ No_permis: "9002", Occupees: 7, code: " 2002 " }), TAKEN);
  const inst = out.instances[0]!;
  assert.equal(inst.id, 'replayed:Census:["9002"]', "not an object of today's twin");
  assert.deepEqual(out.links.map((l) => [l.fromInstanceId, l.toInstanceId, l.linkTypeName, l.aggregates]), [[inst.id, "u-b", "census_of", "metrics"]]);
  assert.equal(out.unattached, 0);
});

test("a row that names no place the twin holds is counted and left out, never guessed", () => {
  const nowhere = replayObjects(structure(), rowsOf({ No_permis: "9003", Occupees: 5, code: "7777" }, { No_permis: "9004", Occupees: 5 }), TAKEN);
  assert.equal(nowhere.unattached, 2);
  assert.equal(nowhere.links.length, 0);
  // A rule whose link type is not declared attaches nothing: a catch-up never makes one.
  const noType = replayObjects(structure({ links: [{ fromColumn: "code", direction: "out", targetTypeName: "OrgUnit", link: null, targets: new Map([["2002", "u-b"]]) }] }), rowsOf({ No_permis: "9002", Occupees: 7, code: "2002" }), TAKEN);
  assert.deepEqual([noType.unattached, noType.links.length], [1, 0]);
});

test("a row that cannot be an object is counted: no identity, a required property missing", () => {
  const out = replayObjects(
    structure({ schema: [...SCHEMA.slice(0, 1), { ...SCHEMA[1]!, required: true }, SCHEMA[2]!] }),
    rowsOf({ Occupees: 3 }, { No_permis: "1001" }, { No_permis: "1001", Occupees: 9 }),
    TAKEN,
  );
  assert.equal(out.unmapped, 2);
  assert.equal(out.instances.length, 1);
  // An output with no identity at all writes one object per row, as a run does.
  const loose = replayObjects(structure({ identity: [], declared: false }), rowsOf({ Occupees: 3, code: "1001" }, { Occupees: 4, code: "1001" }), TAKEN);
  assert.equal(loose.instances.length, 2);
  assert.equal(loose.links.length, 2);
});

test("a copy is measured over today's units, at the time its source gave", () => {
  const { readings, unmapped, unattached } = replayReadings(
    structure(),
    rowsOf({ No_permis: "1001", Occupees: 12, Mise_a_jour: "2026-09-01T10:00:00Z" }, { No_permis: "9002", Occupees: 7, Mise_a_jour: "2026-09-01T09:45:00Z", code: "2002" }),
    TAKEN,
  );
  const by = new Map(readings.map((r) => [r.unitId, r]));
  assert.deepEqual([unmapped, unattached], [0, 0]);
  assert.equal(readings.length, 4, "every unit is listed, with or without a value");
  assert.ok(readings.every((r) => r.metric === "occupied"));
  assert.equal(by.get("u-a")!.value, 12);
  assert.equal(by.get("u-a")!.observedAt!.toISOString(), "2026-09-01T10:00:00.000Z");
  assert.equal(by.get("u-b")!.value, 7);
  assert.equal(by.get("u-b")!.observedAt!.toISOString(), "2026-09-01T09:45:00.000Z");
  // The parent is its two rooms, summed over what stands under it.
  assert.equal(by.get("u-top")!.value, 19);
  // Nothing ever stood under C: no value. Whether that is a line is decided against what was kept (below).
  assert.equal(by.get("u-c")!.value, null);
  assert.equal(by.get("u-c")!.observedAt, null);
});

test("a copy that gives no time gives a reading with no source time, not an invented one", () => {
  const { readings } = replayReadings(structure(), rowsOf({ No_permis: "1001", Occupees: 12 }), TAKEN);
  const a = readings.find((r) => r.unitId === "u-a")!;
  assert.equal(a.value, 12);
  assert.equal(a.observedAt, null, "the time the copy was taken is kept apart, as when it was written down");
  assert.equal(a.observedBasis, "unreadable");
});

// --- writing down what a copy changed -----------------------------------------------------

/** Answers each statement by the first route that matches it, and keeps every statement. */
function routedDb(routes: [RegExp, (params: unknown[]) => unknown[] | { rows: unknown[]; rowCount: number }][]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db = {
    query: async (q: string, p: unknown[] = []) => {
      const sql = q.replace(/\s+/g, " ").trim();
      calls.push({ sql, params: p });
      for (const [re, answer] of routes) {
        if (!re.test(sql)) continue;
        const out = answer(p);
        return Array.isArray(out) ? { rows: out, rowCount: out.length } : out;
      }
      throw new Error(`unexpected statement: ${sql.slice(0, 140)}`);
    },
  } as unknown as DbClient;
  return { db, calls };
}

test("a caught-up reading is held against what was kept by the time its copy was taken, and marked", async () => {
  const { db, calls } = routedDb([[/INSERT INTO app\.twin_reading/, () => [{ n: 1 }]]]);
  const written = await recordReplayed(
    db,
    "p1",
    [
      { unitId: "u-a", metric: "occupied", value: 12, observedAt: new Date("2026-09-01T10:00:00Z"), observedBasis: "observed" },
      { unitId: "u-c", metric: "occupied", value: null, observedAt: null, observedBasis: null },
    ],
    TAKEN,
  );
  assert.equal(written, 1);
  const q = calls[0]!.sql;
  // Dated at when the copy was taken, and marked.
  assert.match(q, /INSERT INTO app\.twin_reading \(project_id, unit_instance_id, metric, value, observed_at, observed_basis, recorded_at, replayed\) SELECT \$1, x\.unit_id, x\.metric, x\.value, x\.observed_at, x\.observed_basis, \$8, true/);
  // Against the past, not the present: the latest live reading has nothing to say about last September.
  assert.match(q, /WHERE r\.unit_instance_id = x\.unit_id AND r\.metric = x\.metric AND r\.project_id = \$1 AND r\.recorded_at <= \$8 ORDER BY r\.recorded_at DESC LIMIT 1/);
  // A unit that has no value and never had one starts no series.
  assert.match(q, /WHERE \(last\.kept IS NULL AND x\.value IS NOT NULL\)/);
  assert.match(q, /OR \(last\.kept AND last\.value IS DISTINCT FROM x\.value\)/);
  assert.deepEqual(calls[0]!.params, ["p1", ["u-a", "u-c"], ["occupied", "occupied"], [12, null], ["2026-09-01T10:00:00.000Z", null], ["observed", null], SAME_READING_SECONDS, TAKEN.toISOString()]);

  const none = routedDb([]);
  assert.equal(await recordReplayed(none.db, "p1", [], TAKEN), 0);
  assert.equal(none.calls.length, 0);
});

// --- a catch-up, batch after batch -----------------------------------------------------------

const PROJECT = { id: "p1", organizationId: "o1" };
const D_OLD = "0d000000-0000-4000-8000-000000000001";
const D_NEW = "0d000000-0000-4000-8000-000000000002";
const D_XW = "0d000000-0000-4000-8000-000000000003";
const PIPE = "0b000000-0000-4000-8000-000000000001";
const UNTIL = new Date("2026-11-23T15:13:00Z");

interface Held {
  dataset_id: string;
  pipeline_id: string | null;
  in_place_of: string | null;
  until_at: Date;
  through_version: number | null;
  versions_total: number;
  points_written: number;
  copies_left_out: number;
  rows_left_out: number;
  rows_unattached: number;
  last_note: string | null;
}

/** A project whose dataset has three older copies, and the state of one catch-up. */
function world(copyRows: Record<string, Record<string, unknown>[]>, extra: [RegExp, (params: unknown[]) => unknown[] | { rows: unknown[]; rowCount: number }][] = []) {
  const copies = [1, 2, 3].map((v) => ({ id: `copy-${v}`, version: v, created_at: new Date(Date.UTC(2026, 8, v, 10, 20)), row_count: (copyRows[`copy-${v}`] ?? []).length }));
  let held: Held | null = null;
  const remaining = () => copies.filter((c) => c.version > (held?.through_version ?? 0)).length;
  const routed = routedDb([
    ...extra,
    [
      /FROM app\.series_catchup c JOIN app\.dataset d/,
      () =>
        held
          ? [{ id: "cu1", series_key: "k", dataset_name: "Old emergency file", pipeline_name: held.pipeline_id ? "Urgences" : null, in_place_of_name: held.in_place_of ? "Full emergency file" : null, started_at: UNTIL, updated_at: UNTIL, remaining: remaining(), first_copy_at: copies[0]!.created_at, ...held }]
          : [],
    ],
    [
      /INSERT INTO app\.series_catchup/,
      (p) => {
        held = { dataset_id: p[2] as string, pipeline_id: p[3] as string | null, in_place_of: p[4] as string | null, until_at: new Date(p[5] as string), through_version: null, versions_total: p[6] as number, points_written: 0, copies_left_out: 0, rows_left_out: 0, rows_unattached: 0, last_note: null };
        return [];
      },
    ],
    [
      /UPDATE app\.series_catchup SET through_version = GREATEST/,
      (p) => {
        held!.through_version = Math.max(held!.through_version ?? 0, p[1] as number);
        held!.points_written += p[2] as number;
        held!.copies_left_out += p[3] as number;
        held!.rows_left_out += p[4] as number;
        held!.rows_unattached += p[5] as number;
        held!.last_note = (p[6] as string | null) ?? held!.last_note;
        return [];
      },
    ],
    [/UPDATE app\.series_catchup SET finished_at/, () => []],
    [/FROM app\.dataset WHERE project_id = \$1 AND kind = 'table'/, () => [
      { id: D_OLD, name: "Old emergency file", column_schema: [{ name: "No_permis" }, { name: "Occupees" }, { name: "Mise_a_jour" }] },
      { id: D_NEW, name: "Full emergency file", column_schema: [{ name: "No_permis" }, { name: "Occupees" }, { name: "Mise_a_jour" }, { name: "Region" }] },
      { id: D_XW, name: "Permit table", column_schema: [{ name: "permis" }, { name: "code" }] },
    ]],
    [/FROM app\.dataset_version v JOIN app\.dataset d ON d\.id = v\.dataset_id WHERE d\.project_id/, () => [{ dataset_id: D_OLD, n: 3, first: copies[0]!.created_at, last: copies[2]!.created_at }]],
    [/FROM app\.dataset_version WHERE dataset_id = \$1 AND version > \$2 AND created_at < \$3 ORDER BY version ASC LIMIT \$4/, (p) => copies.filter((c) => c.version > (p[1] as number)).slice(0, p[3] as number)],
    [/SELECT data FROM app\.dataset_row WHERE version_id = \$1 ORDER BY id ASC/, (p) => (copyRows[p[0] as string] ?? []).map((data) => ({ data }))],
  ]);
  return { ...routed, state: () => held };
}

const SERIES_ROW = {
  id: "s1",
  project_id: "p1",
  dataset_id: D_OLD,
  key: "occupied_by_room",
  label: "Occupied by room",
  time_column: "Mise_a_jour",
  time_zone: null,
  value_column: "Occupees",
  entity_columns: ["No_permis"],
  step: "hour",
  unit: null,
  last_note: null,
  last_written_at: null,
  since: UNTIL,
};

const seriesRoutes = (points: unknown[][]): [RegExp, (params: unknown[]) => unknown[]][] => [
  [/FROM app\.kept_series s WHERE s\.project_id = \$1 AND s\.key = \$2/, () => [SERIES_ROW]],
  [
    /INSERT INTO app\.series_point/,
    (p) => {
      points.push(p);
      return [{ n: (p[1] as unknown[]).length }];
    },
  ],
];

test("a dataset series is caught up from the copies of its own dataset, oldest first, each dated at when it was taken", async () => {
  const points: unknown[][] = [];
  const w = world(
    {
      "copy-1": [{ No_permis: "1001", Occupees: 12, Mise_a_jour: "2026-09-01T10:00:00Z" }],
      "copy-2": [{ No_permis: "1001", Occupees: 14, Mise_a_jour: "2026-09-02T10:00:00Z" }, { No_permis: "1002", Occupees: 3, Mise_a_jour: "pas d'heure" }],
      "copy-3": [{ No_permis: "1001", Occupees: 9, Mise_a_jour: "2026-09-03T10:00:00Z" }],
    },
    seriesRoutes(points),
  );
  const out = await runCatchup(w.db, PROJECT, "user-1", { key: "occupied_by_room", datasetId: D_OLD, pipelineId: null, inPlaceOf: null });

  assert.equal(out.began, true);
  assert.deepEqual([out.read, out.written], [3, 3]);
  assert.deepEqual([out.state.copies, out.state.read, out.state.done], [3, 3, true]);
  assert.equal(out.state.until, UNTIL.toISOString(), "only copies taken before the series started being kept");
  // A time that cannot be read is counted, never placed.
  assert.equal(out.state.rowsLeftOut, 1);
  // Each copy's points are seen at when that copy was taken, carry its version, and are marked.
  assert.deepEqual(points.map((p) => [p[4], p[5], p[6]]), [
    ["2026-09-01T10:20:00.000Z", "copy-1", true],
    ["2026-09-02T10:20:00.000Z", "copy-2", true],
    ["2026-09-03T10:20:00.000Z", "copy-3", true],
  ]);
  // What a copy of last September lacked says nothing of the series as it is written today.
  assert.ok(!w.calls.some((c) => /UPDATE app\.kept_series/.test(c.sql)));

  // Asked again, it has nothing left to read and writes nothing.
  const before = points.length;
  const again = await runCatchup(w.db, PROJECT, "user-1", { key: "occupied_by_room", datasetId: D_OLD, pipelineId: null, inPlaceOf: null });
  assert.deepEqual([again.began, again.read, again.state.done, points.length], [false, 0, true, before]);
});

test("a batch is bounded, and the next one resumes where it stopped", async () => {
  const points: unknown[][] = [];
  const rows = { "copy-1": [{ No_permis: "1001", Occupees: 1, Mise_a_jour: "2026-09-01T10:00:00Z" }], "copy-2": [{ No_permis: "1001", Occupees: 2, Mise_a_jour: "2026-09-02T10:00:00Z" }], "copy-3": [{ No_permis: "1001", Occupees: 3, Mise_a_jour: "2026-09-03T10:00:00Z" }] };
  const w = world(rows, seriesRoutes(points));
  // A clock that jumps 13 seconds each time it is read: the first copy is always read, the time is up before the second.
  let t = 0;
  const slow = () => (t += 13_000);
  const req = { key: "occupied_by_room", datasetId: D_OLD, pipelineId: null, inPlaceOf: null };

  const first = await runCatchup(w.db, PROJECT, null, req, slow);
  assert.deepEqual([first.read, first.state.read, first.state.done], [1, 1, false]);
  const second = await runCatchup(w.db, PROJECT, null, req, slow);
  assert.deepEqual([second.began, second.read, second.state.read], [false, 1, 2]);
  const third = await runCatchup(w.db, PROJECT, null, req, slow);
  assert.deepEqual([third.state.read, third.state.done, third.state.written], [3, true, 3]);
  assert.deepEqual(points.map((p) => p[5]), ["copy-1", "copy-2", "copy-3"], "no copy is read twice, none is skipped");
  // Time and rows bound a batch; the count is a ceiling high enough that small copies do not mean a call a second.
  assert.ok(BATCH_COPIES >= 100);
});

test("a catch-up is refused with its reason when there is nothing older, or the dataset is not the series' own", async () => {
  const w = world({}, seriesRoutes([]));
  await assert.rejects(runCatchup(w.db, PROJECT, null, { key: "occupied_by_room", datasetId: D_NEW, pipelineId: null, inPlaceOf: null }), /caught up from the copies of its own dataset/);

  const empty = routedDb([
    [/FROM app\.series_catchup c JOIN/, () => []],
    [/FROM app\.kept_series s WHERE/, () => [SERIES_ROW]],
    [/FROM app\.dataset WHERE project_id/, () => [{ id: D_OLD, name: "Old emergency file", column_schema: [] }]],
    [/FROM app\.dataset_version v JOIN app\.dataset d/, () => []],
  ]);
  await assert.rejects(runCatchup(empty.db, PROJECT, null, { key: "occupied_by_room", datasetId: D_OLD, pipelineId: null, inPlaceOf: null }), (err: unknown) => (err as { code?: string }).code === "CATCHUP_REFUSED" && /No copy of “Old emergency file” was taken before 2026-11-23 15:13 UTC/.test((err as Error).message));
  assert.ok(!empty.calls.some((c) => /INSERT/.test(c.sql)), "nothing is begun");
});

// --- a twin measure, through today's pipeline ------------------------------------------------

const PIPELINE_ROW = {
  id: PIPE,
  project_id: "p1",
  name: "Urgences",
  slug: "urgences",
  description: null,
  status: "live",
  last_run_at: null,
  last_status: null,
  last_error: null,
  nodes: [
    { id: "in", kind: "dataset_input", name: "in", x: 0, y: 0, config: { datasetId: D_NEW } },
    { id: "xw", kind: "dataset_input", name: "xw", x: 0, y: 0, config: { datasetId: D_XW } },
    { id: "jn", kind: "join", name: "jn", x: 0, y: 0, config: { kind: "left", leftKey: "No_permis", rightKey: "permis" } },
    {
      id: "out",
      kind: "object_output",
      name: "out",
      x: 0,
      y: 0,
      config: {
        objectTypeName: "Census",
        identityProperties: ["permit"],
        columnMapping: [
          { from: "No_permis", to: "permit" },
          { from: "Occupees", to: "occupied" },
          { from: "Mise_a_jour", to: "updated" },
        ],
        linkRules: [{ linkType: "census_of", targetType: "OrgUnit", fromColumn: "code", targetProperty: "code" }],
      },
    },
  ],
  edges: [
    { from: "in", to: "jn", toPort: "left" },
    { from: "xw", to: "jn", toPort: "right" },
    { from: "jn", to: "out" },
  ],
};

const instanceRow = (id: string, type: string, properties: Record<string, unknown>, schema: PropertyDef[] = []) => ({
  id,
  object_type_id: `t-${type}`,
  type_name: type,
  properties,
  provenance: {},
  property_schema: schema,
  sim_role: null,
  created_at: UNTIL,
  updated_at: UNTIL,
});

const twinRoutes = (readings: unknown[][], pipeline: Record<string, unknown> = PIPELINE_ROW, xwSince = "2026-08-01T00:00:00.000Z"): [RegExp, (params: unknown[]) => unknown[]][] => [
  [/FROM app\.twin_metric WHERE organization_id/, () => [{ id: "m1", organization_id: "o1", key: "occupied", label: "Occupied stretchers", object_type: "OrgUnit", unit: "count", numerator: OCCUPIED.numerator, denominator: null, qualified_by: null, active: true }]],
  [/FROM app\.ontology_object_types WHERE organization_id = \$1/, () => [
    { id: "t-Census", name: "Census", sim_role: null, property_schema: SCHEMA, identity_properties: ["permit"] },
    { id: "t-OrgUnit", name: "OrgUnit", sim_role: null, property_schema: [], identity_properties: [] },
  ]],
  [/FROM app\.pipeline WHERE project_id = \$1/, () => [pipeline]],
  [/SELECT min\(recorded_at\) AS first FROM app\.twin_reading WHERE project_id = \$1 AND metric = \$2 AND NOT replayed/, () => [{ first: UNTIL }]],
  [
    /FROM app\.ontology_object_instances oi JOIN app\.ontology_object_types t/,
    (p) =>
      p[1] === "OrgUnit"
        ? [instanceRow("u-a", "OrgUnit", { name: "Room A", code: "A" }), instanceRow("u-top", "OrgUnit", { name: "Network", code: "TOP" })]
        : [instanceRow("inst-1001", "Census", { permit: "1001", occupied: 40, updated: "2026-11-27T10:00:00Z" }, SCHEMA)],
  ],
  [/FROM app\.ontology_link_instances li/, () => [
    { id: "l-tree", link_type_name: "contains", aggregates: "metrics", aggregate_toward: "source", transitive: true, from_instance_id: "u-top", to_instance_id: "u-a", from_type_name: "OrgUnit", to_type_name: "OrgUnit" },
    { id: "l1", link_type_name: "census_of", aggregates: "metrics", aggregate_toward: "target", transitive: false, from_instance_id: "inst-1001", to_instance_id: "u-a", from_type_name: "Census", to_type_name: "OrgUnit" },
  ]],
  [/FROM app\.ontology_link_types WHERE organization_id = \$1/, () => [{ name: "census_of", aggregates: "metrics", aggregate_toward: "target", transitive: false }]],
  // The pipeline's other input, as it was when each copy was taken: the permit table was first kept on 1 September at noon.
  [/SELECT id FROM app\.dataset_version WHERE dataset_id = \$1 AND created_at <= \$2 ORDER BY version DESC LIMIT 1/, (p) => (p[0] === D_XW && String(p[1]) >= xwSince ? [{ id: "xw-1" }] : [])],
  [
    /INSERT INTO app\.twin_reading/,
    (p) => {
      readings.push(p);
      return [{ n: (p[1] as unknown[]).length }];
    },
  ],
];

test("a twin measure is caught up through today's pipeline, in memory, and nothing is written in the ontology", async () => {
  const readings: unknown[][] = [];
  const w = world(
    {
      "copy-1": [{ No_permis: "1001", Occupees: 12, Mise_a_jour: "2026-09-01T10:00:00Z" }],
      "copy-2": [{ No_permis: "1001", Occupees: 12, Mise_a_jour: "2026-09-01T10:00:00Z" }],
      "copy-3": [{ No_permis: "1001", Occupees: 15, Mise_a_jour: "2026-09-03T10:00:00Z" }],
      "xw-1": [{ permis: "1001", code: "A" }],
    },
    twinRoutes(readings),
  );
  // The old file is not what the pipeline reads today: its copies are read in place of the full file.
  const out = await runCatchup(w.db, PROJECT, "user-1", { key: "twin:occupied", datasetId: D_OLD, pipelineId: PIPE, inPlaceOf: D_NEW });

  assert.equal(out.began, true);
  assert.deepEqual([out.state.copies, out.state.read, out.state.done], [3, 3, true]);
  assert.deepEqual([out.state.pipelineName, out.state.inPlaceOf?.datasetId], ["Urgences", D_NEW]);
  assert.deepEqual([out.state.copiesLeftOut, out.state.rowsLeftOut, out.state.rowsUnattached], [0, 0, 0]);

  // One statement per copy, each dated at when its copy was taken, with the time the source gave.
  assert.equal(readings.length, 3);
  assert.deepEqual(readings.map((p) => p[7]), ["2026-09-01T10:20:00.000Z", "2026-09-02T10:20:00.000Z", "2026-09-03T10:20:00.000Z"]);
  const first = readings[0]!;
  assert.deepEqual(first[1], ["u-a", "u-top"], "today's units: the room, and the network above it");
  assert.deepEqual(first[3], [12, 12], "the copy's value, not the 40 the twin holds today");
  assert.deepEqual(first[4], ["2026-09-01T10:00:00.000Z", "2026-09-01T10:00:00.000Z"]);
  assert.deepEqual(readings[2]![3], [15, 15]);

  // The old dataset's copies were read; the dataset the pipeline reads today never was.
  const read = w.calls.filter((c) => /SELECT data FROM app\.dataset_row/.test(c.sql)).map((c) => c.params[0]);
  assert.deepEqual(read, ["copy-1", "xw-1", "copy-2", "copy-3"], "the other input is read once, as it was then");

  // Nothing but the readings and where the catch-up stands is ever written.
  const writes = w.calls.filter((c) => /^(INSERT|UPDATE|DELETE|WITH written AS \( INSERT)/.test(c.sql));
  assert.ok(writes.length > 0);
  for (const c of writes) {
    assert.match(c.sql, /app\.(twin_reading|series_catchup)/);
    assert.doesNotMatch(c.sql, /ontology_|pipeline_run|dataset_version|dataset_row/);
  }
});

test("a twin catch-up names the pipeline and the input its copies stand in for, or is refused", async () => {
  const req = { key: "twin:occupied", datasetId: D_OLD, pipelineId: PIPE, inPlaceOf: null };
  const w = world({}, twinRoutes([]));
  await assert.rejects(runCatchup(w.db, PROJECT, null, req), /“Urgences” does not read that dataset\. Say which of its inputs these copies are read in place of/);
  await assert.rejects(runCatchup(w.db, PROJECT, null, { ...req, pipelineId: null }), /Name the pipeline the copies go through/);
  await assert.rejects(runCatchup(w.db, PROJECT, null, { ...req, datasetId: D_NEW, inPlaceOf: D_XW }), /stands in place of nothing/);
  // A draft does not write the twin today: the copies do not go through it.
  const draft = world({}, twinRoutes([], { ...PIPELINE_ROW, status: "draft" }));
  await assert.rejects(runCatchup(draft.db, PROJECT, null, { ...req, inPlaceOf: D_NEW }), /is a draft: it does not write the twin today/);
  assert.equal(w.state(), null, "nothing was begun");
});

test("a copy the pipeline cannot run on is stepped over and said, and the catch-up still ends", async () => {
  const readings: unknown[][] = [];
  const w = world({ "copy-1": [{ No_permis: "1001", Occupees: 12 }], "copy-2": [{ No_permis: "1001", Occupees: 13 }], "copy-3": [{ No_permis: "1001", Occupees: 14 }], "xw-1": [{ permis: "1001", code: "A" }] }, [
    // The second copy cannot be read.
    [/SELECT data FROM app\.dataset_row WHERE version_id = \$1 ORDER BY id ASC/, (p) => {
      if (p[0] === "copy-2") throw new Error("the rows of that copy are gone");
      return [];
    }],
    ...twinRoutes(readings),
  ]);
  const out = await runCatchup(w.db, PROJECT, null, { key: "twin:occupied", datasetId: D_OLD, pipelineId: PIPE, inPlaceOf: D_NEW });
  assert.deepEqual([out.state.read, out.state.done, out.state.copiesLeftOut], [3, true, 1]);
  assert.match(out.state.note ?? "", /The pipeline could not run on the copy of 2026-09-02 10:20 UTC: the rows of that copy are gone\. That copy was left out\./);
  assert.equal(readings.length, 2);
});

test("a copy older than the first copy of the pipeline's other input is left out, never measured with a later one", async () => {
  const readings: unknown[][] = [];
  const rows = { "copy-1": [{ No_permis: "1001", Occupees: 12 }], "copy-2": [{ No_permis: "1001", Occupees: 13 }], "copy-3": [{ No_permis: "1001", Occupees: 14 }], "xw-1": [{ permis: "1001", code: "A" }] };
  // The permit table was first kept on 2 September at noon: the old file's first two copies are older than it.
  const w = world(rows, twinRoutes(readings, PIPELINE_ROW, "2026-09-02T12:00:00.000Z"));
  const out = await runCatchup(w.db, PROJECT, null, { key: "twin:occupied", datasetId: D_OLD, pipelineId: PIPE, inPlaceOf: D_NEW });
  assert.deepEqual([out.state.read, out.state.done, out.state.copiesLeftOut], [3, true, 2]);
  assert.match(out.state.note ?? "", /“Permit table” had no copy yet when the copy of 2026-09-02 10:20 UTC was taken.*That copy was left out, rather than measured with a later one\./);
  // Only the third copy was measured, and the first two were never read at all.
  assert.deepEqual(readings.map((p) => p[7]), ["2026-09-03T10:20:00.000Z"]);
  assert.deepEqual(w.calls.filter((c) => /SELECT data FROM app\.dataset_row/.test(c.sql)).map((c) => c.params[0]), ["copy-3", "xw-1"]);
});

// --- what can be caught up, and forgetting it -------------------------------------------------

test("the offer says how many older copies there are, through which pipeline, and which datasets could stand in", async () => {
  const w = world({}, twinRoutes([]));
  const offer = await catchupOffer(w.db, PROJECT, "twin:occupied");
  assert.equal(offer.origin, "twin");
  assert.equal(offer.until, UNTIL.toISOString());
  assert.equal(offer.why, null);
  assert.deepEqual(offer.paths.map((p) => [p.pipelineName, p.inputs.map((i) => [i.datasetName, i.copies])]), [["Urgences", [["Full emergency file", 0], ["Permit table", 0]]]]);
  // The full file has no copy that old; the old file has three, and can be read in its place.
  assert.deepEqual(offer.standIns.map((s) => [s.datasetName, s.copies, s.firstAt, s.columns]), [["Old emergency file", 3, "2026-09-01T10:20:00.000Z", ["No_permis", "Occupees", "Mise_a_jour"]]]);
  assert.ok(!w.calls.some((c) => /^(INSERT|UPDATE|DELETE)/.test(c.sql)), "an offer reads only");

  const series = world({}, seriesRoutes([]));
  const own = await catchupOffer(series.db, PROJECT, "occupied_by_room");
  assert.deepEqual([own.origin, own.paths.length, own.paths[0]!.pipelineId, own.paths[0]!.inputs[0]!.copies, own.standIns.length], ["dataset", 1, null, 3, 0]);
});

test("a measure with no reading yet, or one no pipeline writes, is offered nothing, with the reason", async () => {
  const none = world({}, [[/SELECT min\(recorded_at\) AS first FROM app\.twin_reading/, () => [{ first: null }]], ...twinRoutes([])]);
  const a = await catchupOffer(none.db, PROJECT, "twin:occupied");
  assert.deepEqual([a.paths.length, a.until], [0, null]);
  assert.match(a.why ?? "", /has kept no reading of this measure yet: there is nothing to go back from/);

  const draft = world({}, twinRoutes([], { ...PIPELINE_ROW, status: "draft" }));
  const b = await catchupOffer(draft.db, PROJECT, "twin:occupied");
  assert.equal(b.paths.length, 0);
  assert.match(b.why ?? "", /“Urgences” is a draft/);

  await assert.rejects(catchupOffer(none.db, PROJECT, "twin:unknown"), (err: unknown) => (err as { code?: string }).code === "SERIES_NOT_FOUND");
});

test("forgetting removes only what was caught up, and the catch-ups themselves", async () => {
  const twin = routedDb([
    [/DELETE FROM app\.twin_reading/, () => ({ rows: [], rowCount: 4210 })],
    [/DELETE FROM app\.series_catchup/, () => ({ rows: [], rowCount: 1 })],
  ]);
  assert.deepEqual(await forgetCatchup(twin.db, PROJECT, "twin:occupied"), { removed: 4210 });
  assert.equal(twin.calls[0]!.sql, "DELETE FROM app.twin_reading WHERE project_id = $1 AND metric = $2 AND replayed");
  assert.deepEqual(twin.calls[0]!.params, ["p1", "occupied"]);
  assert.deepEqual(twin.calls[1]!.params, ["p1", "twin:occupied"]);

  const series = routedDb([
    [/FROM app\.kept_series s WHERE/, () => [SERIES_ROW]],
    [/DELETE FROM app\.series_point/, () => ({ rows: [], rowCount: 12 })],
    [/DELETE FROM app\.series_catchup/, () => ({ rows: [], rowCount: 1 })],
  ]);
  assert.deepEqual(await forgetCatchup(series.db, PROJECT, "occupied_by_room"), { removed: 12 });
  assert.equal(series.calls[1]!.sql, "DELETE FROM app.series_point WHERE series_id = $1 AND replayed");
});
