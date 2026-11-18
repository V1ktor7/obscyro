import assert from "node:assert/strict";
import { test } from "node:test";

import { READ_TOOLS, ToolError, type AnalystContext, type AnalystScenario, type RunDigest } from "./analyst-tools.js";
import { Ledger } from "./analyst-verify.js";
import type { DatasetRow } from "./datasets.js";
import type { ScenarioOverride } from "./scenario-overrides.js";
import type { SimExport } from "./twin-export.js";

// A small island: three hospitals, one clinic with nothing, three catchments,
// one of which no hospital serves.
const beds = (capacity: number, free = capacity) => ({
  id: "litsantephysique",
  category: "space",
  quantity: free,
  capacity,
  enables: ["litsantephysique"],
});

const TWIN: SimExport = {
  environment: "ile",
  scenario_id: null,
  generated_at: "2026-11-17T12:00:00.000Z",
  facilities: [
    {
      id: "u1",
      name: "Hôpital général du Lakeshore",
      location: [45.45, -73.83],
      resources: { litsantephysique: beds(234), civiere: { id: "civiere", category: "space", quantity: 30, capacity: 40, enables: ["civiere"] } },
      census: {},
    },
    { id: "u2", name: "Hôpital de Verdun", location: [45.46, -73.57], resources: { litsantephysique: beds(244, 200) }, census: {} },
    { id: "u3", name: "CLSC de Pierrefonds", location: null, resources: {}, census: {} },
    { id: "u4", name: "Hôpital de LaSalle", location: [45.42, -73.62], resources: { litsantephysique: beds(120) }, census: {} },
  ],
  objects: [
    { id: "o1", type: "Protocole", role: null, properties: { name: "Hospitalisation", gravite: "hospitalisation", activite: "litsantephysique", duree: 7 }, at: null },
    { id: "b1", type: "Lit", role: "space", properties: {}, at: "u1" },
    { id: "b2", type: "Lit", role: "space", properties: {}, at: "u1" },
  ],
  object_types: [
    {
      name: "Protocole",
      role: null,
      properties: [
        { key: "gravite", type: "string", label: null, unit: null, min: null, max: null, behaviour: null, mechanic: "serves_severity" },
        { key: "activite", type: "string", label: null, unit: null, min: null, max: null, behaviour: null, mechanic: "consumes_activity" },
        { key: "duree", type: "number", label: null, unit: "days", min: null, max: null, behaviour: "level", mechanic: "occupies_for" },
      ],
    },
    { name: "Lit", role: "space", properties: [] },
  ],
  object_rules: { unavailable_keys: [], unavailable_values: [] },
  populations: [
    { id: "pop:t1", name: "RLS de l'Ouest-de-l'Île", size: 225710, served_by: ["u1", "u3"], couples: {} },
    { id: "pop:t2", name: "RLS du Sud-Ouest – Verdun", size: 150000, served_by: ["u2", "u4"], couples: {} },
    { id: "pop:t3", name: "RLS de la Pointe", size: 100000, served_by: ["u3"], couples: {} },
  ],
  edges: [],
  gaps: [{ code: "ROUTE_WITHOUT_CAPACITY", message: "No relationship carries a throughput.", subjects: ["transfere_vers"] }],
} as unknown as SimExport;

const override = (o: Partial<ScenarioOverride>): ScenarioOverride => ({
  id: "x",
  scenarioId: "sc1",
  seq: 0,
  targetType: "param",
  targetId: null,
  targetLocalKey: null,
  op: "set_param",
  payload: {},
  effectiveOffsetHours: 0,
  durationHours: null,
  note: null,
  ...o,
});
const stamp = (value: Record<string, unknown>, startDay = 0, days: number | null = null) =>
  override({ payload: { key: "stamp:abc", value }, effectiveOffsetHours: startDay * 24, durationHours: days === null ? null : days * 24 });

const SCENARIO: AnalystScenario = {
  id: "sc1",
  name: "Omicron",
  description: null,
  overrides: [
    stamp({ kind: "occupancy", activity: "litsantephysique", share: 0.85 }),
    stamp({ kind: "immunity", share: 0.83 }),
    stamp({ kind: "variant", factor: 3.6 }),
    stamp({ kind: "seed", at: { lat: 45, lon: -73 }, population: "pop:t1", count: 500 }, 0, 1),
    stamp({ kind: "capacity", facility: "u1", activity: "litsantephysique", amount: 60 }, 10, 50),
    override({ targetType: "link", targetId: "u2", op: "link", payload: { linkType: "situe_dans", toId: "t3" } }),
    override({
      payload: { key: "reality", value: { datasetId: "d1", datasetName: "INSPQ", when: "date", value: "admissions", origin: "2021-12-13", acuity: "hospitalisation" } },
    }),
  ],
};

const brk = (firstDay: number | null, waitingDays = 0) => ({
  firstDay,
  days: firstDay === null ? 0 : 3,
  peakWaiting: firstDay === null ? 0 : 103,
  peakDay: firstDay === null ? 0 : 3,
  waitingDays,
  peakOccupancy: firstDay === null ? 0.8 : 1,
});
const half = (island: number[], sitesWithQueue: number, waitingDays: number): RunDigest["events"] => ({
  island,
  sitesWithQueue,
  sitesWithActivity: 3,
  firstQueueDay: sitesWithQueue ? 2 : null,
  waitingDays,
  peakWaiting: sitesWithQueue ? 103 : 0,
  peakWaitingDay: 3,
  strandedWaitingDays: null,
  arrivals: { hospitalisation: [10, 20, 30, 20, 10] },
  notes: [],
});
const RUN: RunDigest = {
  ranAt: "2026-11-17T12:05:00.000Z",
  stale: false,
  horizon: 5,
  activity: "litsantephysique",
  events: half([0.85, 0.9, 0.94, 0.93, 0.9], 1, 7316),
  full: half([0.85, 0.9, 0.93, 0.92, 0.9], 0, 0),
  sites: [
    {
      id: "u1",
      name: "Hôpital général du Lakeshore",
      capacity: 234,
      events: brk(2, 7316),
      full: brk(null),
      daily: {
        occupancyEvents: [0.85, 0.95, 1, 1, 1],
        occupancyFull: [0.85, 0.9, 0.8, 0.8, 0.8],
        waitingEvents: [0, 0, 40, 103, 60],
        waitingFull: [0, 0, 0, 0, 0],
      },
    },
    { id: "u2", name: "Hôpital de Verdun", capacity: 244, events: brk(null), full: brk(null), daily: null },
  ],
  stranded: { names: ["RLS de la Pointe"], residents: 100000 },
};

const DATASET = {
  id: "d1",
  projectId: "p",
  name: "INSPQ — Admissions",
  slug: "inspq",
  kind: "table",
  description: null,
  path: "/",
  columnSchema: [
    { name: "date", type: "string", nullable: false },
    { name: "region", type: "string", nullable: false },
    { name: "admissions", type: "number", nullable: true },
  ],
  rowCount: 6,
  retentionDays: 0,
  sourceId: null,
  lastWrittenAt: null,
  createdAt: "",
  updatedAt: "",
} as unknown as DatasetRow;
const ROWS = [
  { date: "2021-12-13", region: "06 - Montréal", admissions: "41" },
  { date: "2021-12-14", region: "06 - Montréal", admissions: "55" },
  { date: "2021-12-15", region: "06 - Montréal", admissions: "" },
  { date: "2021-12-13", region: "03 - Capitale-Nationale", admissions: "9" },
  { date: "2021-12-14", region: "03 - Capitale-Nationale", admissions: "12" },
  { date: "2021-12-15", region: "03 - Capitale-Nationale", admissions: "14" },
];

function ctxOf(over: Partial<AnalystContext> = {}): AnalystContext {
  return {
    environment: "ile",
    scenario: null,
    run: null,
    known: new Ledger(),
    world: async (name) => {
      if (name === "scenario" && !over.scenario) throw new ToolError("No scenario is open.");
      return TWIN;
    },
    datasets: async () => [DATASET],
    rows: async () => ROWS,
    ...over,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(name: string, input: unknown, ctx = ctxOf()): Promise<any> {
  const tool = READ_TOOLS.find((t) => t.name === name)!;
  return tool.run(ctx, tool.parse.parse(input));
}

test("the overview counts what the twin holds and repeats what it is missing", async () => {
  const out = await call("describe_twin", { world: "reality" });
  assert.deepEqual(out.sites, { total: 4, with_a_location: 3, with_some_capacity: 3 });
  assert.deepEqual(
    out.activities.find((a: { activity: string }) => a.activity === "litsantephysique"),
    { activity: "litsantephysique", kind: "space", sites: 3, units: 598, marked_in_use: 44 },
  );
  assert.equal(out.catchments.count, 3);
  assert.equal(out.catchments.residents, 475710);
  assert.deepEqual(out.declared_model, [
    { type: "Protocole", name: "Hospitalisation", serves_severity: "hospitalisation", consumes_activity: "litsantephysique", occupies_for: "7 days" },
  ]);
  assert.equal(out.missing[0].code, "ROUTE_WITHOUT_CAPACITY");
});

test("sites are found by activity, by words of their name and by catchment, largest first", async () => {
  const byActivity = await call("find_sites", { world: "reality", activity: "litsantephysique" });
  assert.deepEqual(byActivity.sites.map((s: { name: string; units: number }) => [s.name, s.units]), [
    ["Hôpital de Verdun", 244],
    ["Hôpital général du Lakeshore", 234],
    ["Hôpital de LaSalle", 120],
  ]);
  const byName = await call("find_sites", { world: "reality", name: "hopital LAKESHORE" });
  assert.deepEqual(byName.sites.map((s: { id: string }) => s.id), ["u1"]);
  assert.deepEqual(byName.sites[0].catchments, ["RLS de l'Ouest-de-l'Île"]);
  const byCatchment = await call("find_sites", { world: "reality", catchment: "sud-ouest", limit: 1 });
  assert.equal(byCatchment.matching, 2);
  assert.equal(byCatchment.not_shown, 1);
});

test("an activity the twin does not have is refused with the ones it has", async () => {
  await assert.rejects(call("find_sites", { world: "reality", activity: "lits" }), (err: Error) => {
    assert.ok(err instanceof ToolError);
    assert.match(err.message, /civiere, litsantephysique/);
    return true;
  });
});

test("a site is read by name, and two sites by one name is a question, not a guess", async () => {
  const site = await call("get_site", { world: "reality", site: "lakeshore" });
  assert.equal(site.id, "u1");
  assert.deepEqual(site.capacity.find((c: { activity: string }) => c.activity === "civiere"), {
    activity: "civiere",
    kind: "space",
    units: 40,
    marked_in_use: 10,
    free: 30,
  });
  assert.deepEqual(site.catchments, [{ id: "pop:t1", name: "RLS de l'Ouest-de-l'Île", residents: 225710 }]);
  assert.deepEqual(site.objects_attached, [{ type: "Lit", count: 2 }]);
  await assert.rejects(call("get_site", { world: "reality", site: "hopital" }), /3 sites match "hopital".*Use an id/);
  await assert.rejects(call("get_site", { world: "reality", site: "Sacré-Cœur" }), /No site matches/);
});

test("in the scenario world a site says what the scenario adds there", async () => {
  const site = await call("get_site", { world: "scenario", site: "u1" }, ctxOf({ scenario: SCENARIO }));
  assert.deepEqual(site.scenario_changes_here, [
    { what: "capacity", site: "Hôpital général du Lakeshore", site_id: "u1", activity: "litsantephysique", units_added: 60, from_day: 10 },
  ]);
});

test("catchments are compared per 1,000 residents, least provided first", async () => {
  const out = await call("compare_catchments", { world: "reality", activity: "litsantephysique" });
  assert.deepEqual(
    out.catchments.map((c: { name: string; units: number; units_per_1000_residents: number }) => [c.name, c.units, c.units_per_1000_residents]),
    [
      ["RLS de la Pointe", 0, 0],
      ["RLS de l'Ouest-de-l'Île", 234, 1.04],
      ["RLS du Sud-Ouest – Verdun", 364, 2.43],
    ],
  );
  assert.deepEqual(out.whole_network, { residents: 475710, sites_providing_it: 3, units: 598, units_per_1000_residents: 1.26 });
});

test("the recipe sorts conditions, events, choices and network edits, with names", async () => {
  await assert.rejects(call("scenario_recipe", {}), /No scenario is open/);
  const out = await call("scenario_recipe", {}, ctxOf({ scenario: SCENARIO }));
  assert.deepEqual(out.starting_conditions, [
    { what: "usual occupancy", activity: "litsantephysique", share_in_use_pct: 85, applies: "every site, whole run" },
    { what: "prior immunity", share_of_residents_pct: 83, applies: "every catchment, from day 0" },
    { what: "transmissibility", contacts_multiplied_by: 3.6, applies: "every contact layer, whole run" },
  ]);
  assert.deepEqual(out.events, [{ what: "outbreak", catchment: "RLS de l'Ouest-de-l'Île", people_sick: 500, on_day: 0 }]);
  assert.equal(out.choices[0].units_added, 60);
  assert.deepEqual(out.network_edits[0], {
    what: "site linked to a catchment",
    site: "Hôpital de Verdun",
    site_id: "u2",
    catchment: "RLS de la Pointe",
    relationship: "situe_dans",
    note: null,
  });
  assert.equal(out.compared_with.day_0_is, "2021-12-13");
  assert.equal(out.other_edits, 0);
});

test("without a run on screen, the run is not estimated", async () => {
  await assert.rejects(call("read_run", { part: "summary" }), /no run on screen.*press Run/s);
});

test("the run is read as the engine counted it, both ways it was run", async () => {
  const ctx = ctxOf({ run: RUN });
  const summary = await call("read_run", { part: "summary" }, ctx);
  assert.deepEqual(summary.events_only.peak_occupancy_across_all_sites, { occupancy_pct: 94, on_day: 2 });
  assert.equal(summary.events_only.patient_days_waiting, 7316);
  assert.equal(summary.with_choices.sites_where_somebody_waits, 0);
  assert.deepEqual(summary.events_only.arrivals_over_the_run, { hospitalisation: 90 });
  assert.equal(summary.warning, undefined);

  const sites = await call("read_run", { part: "sites" }, ctx);
  assert.equal(sites.sites_where_somebody_waits_in_either_run.length, 1);
  assert.equal(sites.sites_where_somebody_waits_in_either_run[0].events_only.from_day, 2);
  assert.deepEqual(sites.sites_where_somebody_waits_in_either_run[0].with_choices, { somebody_waits: false, peak_occupancy_pct: 80 });
  assert.equal(sites.sites_that_never_queue, 1);

  const site = await call("read_run", { part: "site", site: "lakeshore", from_day: 2, to_day: 3 }, ctx);
  assert.deepEqual(site.events_only.people_waiting_by_day, [40, 103]);
  assert.deepEqual(site.with_choices.occupancy_pct_by_day, [80, 80]);

  const quiet = await call("read_run", { part: "site", site: "verdun" }, ctx);
  assert.equal(quiet.somebody_waits, false);

  const daily = await call("read_run", { part: "daily", from_day: 1, to_day: 2 }, ctx);
  assert.deepEqual(daily.events_only.occupancy_pct_by_day, [90, 94]);
  assert.deepEqual(daily.with_choices.arrivals_by_day, { hospitalisation: [20, 30] });
});

test("the sites where somebody waits come in the order they break, counted once as the screen counts", async () => {
  const late = { ...RUN.sites[0]!, id: "u9", name: "Hôpital tardif", events: { ...brk(4, 12.46), peakWaiting: 103.46 }, full: brk(null) };
  const out = await call("read_run", { part: "sites" }, ctxOf({ run: { ...RUN, sites: [late, ...RUN.sites] } }));
  const rows = out.sites_where_somebody_waits_in_either_run;
  assert.deepEqual(rows.map((r: { order: number; name: string }) => [r.order, r.name]), [
    [1, "Hôpital général du Lakeshore"],
    [2, "Hôpital tardif"],
  ]);
  assert.match(out.ordered_by, /earliest first/);
  // 103.46 is 103 on the Result panel. Handed over as 103.5 it became "about 104" in a sentence.
  assert.equal(rows[1].events_only.most_waiting_at_once, 103);
  assert.equal(rows[1].events_only.patient_days_waiting, 12);
});

test("a run that the scenario has moved on from says so", async () => {
  const summary = await call("read_run", { part: "summary" }, ctxOf({ run: { ...RUN, stale: true } }));
  assert.match(summary.warning, /edited after this run/);
});

test("a table holding several series has to be told which one", async () => {
  await assert.rejects(
    call("read_series", { dataset: "inspq", date_column: "date", value_column: "admissions" }),
    /several series.*region = 03 - Capitale-Nationale \| 06 - Montréal/s,
  );
  const out = await call("read_series", {
    dataset: "inspq",
    date_column: "date",
    value_column: "admissions",
    where_column: "region",
    where_equals: "06 - Montréal",
  });
  // The blank on the 15th is a day not reported, not a day with none.
  assert.equal(out.days_reported, 2);
  assert.equal(out.total, 96);
  assert.deepEqual(out.highest, { value: 55, on: "2021-12-14" });
  assert.deepEqual(out.values, [
    { date: "2021-12-13", value: 41 },
    { date: "2021-12-14", value: 55 },
  ]);
});

test("a wrong column or a wrong value is refused with what exists", async () => {
  await assert.rejects(call("read_series", { dataset: "inspq", date_column: "jour", value_column: "admissions" }), /Its columns: date, region, admissions/);
  await assert.rejects(
    call("read_series", { dataset: "inspq", date_column: "date", value_column: "admissions", where_column: "region", where_equals: "Montréal" }),
    /It takes these values: 03 - Capitale-Nationale; 06 - Montréal/,
  );
});

test("a dataset preview shows its first rows and what its categories are", async () => {
  const out = await call("preview_dataset", { dataset: "d1" });
  assert.equal(out.rows, 6);
  assert.deepEqual(out.category_values, { region: ["03 - Capitale-Nationale", "06 - Montréal"] });
});

test("arithmetic is done only on figures that were read, or that the person gave", async () => {
  const ctx = ctxOf();
  await assert.rejects(call("calculate", { label: "share", expression: "(7316 - 267) / 7316 * 100" }, ctx), /"7316", "267", "7316" are not in anything read so far/);
  ctx.known.addJson({ waiting_before: 7316, waiting_after: 267 });
  const out = await call("calculate", { label: "share", expression: "round((7316 - 267) / 7316 * 100, 1)" }, ctx);
  assert.equal(out.result, 96.4);
  await assert.rejects(call("calculate", { label: "x", expression: "7316 +" }, ctx), ToolError);
});
