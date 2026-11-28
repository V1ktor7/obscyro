import assert from "node:assert/strict";
import { test } from "node:test";

import type { DbClient } from "../lib/db.js";
import type { ForecastRequest } from "./forecast-contract.js";
import {
  BACKTEST_BUDGET_MS,
  KEY_ENV,
  askModel,
  backtestModel,
  buildRequest,
  calendarValue,
  checkModelDraft,
  floorTo,
  measuredOver,
  modelDraft,
  modelOffer,
  originsOf,
  sentTo,
  verifyModel,
  type DraftContext,
  type ForecastModel,
  type ModelDraft,
} from "./forecast-models.js";

// ---------------------------------------------------------------------------
// Imported models: what they are sent, where it goes, and how they are replayed.
//
// What matters is what does NOT happen: a key that travels, a unit's name that
// leaves the server, a replay that shows a model something written down after
// the instant it is replayed at, a model that broke the contract being scored.
// ---------------------------------------------------------------------------

const PROJECT = { id: "p1", organizationId: "o1" };
const U1 = "00000000-0000-4000-8000-000000000001";
const U2 = "00000000-0000-4000-8000-000000000002";
const U3 = "00000000-0000-4000-8000-000000000003";
const NOW = new Date("2026-11-27T12:20:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const CTX: DraftContext = { metrics: [{ key: "occupancy", label: "Stretcher occupancy" }, { key: "iqa", label: "Air quality index" }], seriesKeys: new Set(["virus_detections"]) };
const draft = (over: Partial<ModelDraft> = {}): ModelDraft =>
  modelDraft.parse({ label: "Chronos-2, occupancy", source: "reference", metric: "occupancy", step: "hour", historySteps: 336, horizonSteps: 72, ...over });
const refusal = (re: RegExp) => (err: unknown) => (err as { code?: string }).code === "MODEL_INVALID" && re.test((err as Error).message);

// --- what a person declares ---------------------------------------------------------------

test("a model says where it comes from, and only what that source needs", () => {
  checkModelDraft(draft(), CTX);
  checkModelDraft(draft({ source: "service", serviceModel: "chronos-2" }), CTX);
  checkModelDraft(draft({ source: "endpoint", endpointUrl: "https://models.example.org/forecast", endpointKeyEnv: "MODEL_KEY_ACME" }), CTX, {});
  assert.throws(() => checkModelDraft(draft({ serviceModel: "chronos-2" }), CTX), refusal(/The reference is built in/));
  assert.throws(() => checkModelDraft(draft({ source: "service" }), CTX), refusal(/Name the open model the model service serves/));
  assert.throws(() => checkModelDraft(draft({ source: "endpoint" }), CTX), refusal(/Give the address that speaks the contract/));
  // The series leave the server on that connection: it is not sent in the clear.
  assert.throws(() => checkModelDraft(draft({ source: "endpoint", endpointUrl: "http://models.example.org/forecast" }), CTX, {}), refusal(/has to start with https:\/\//));
});

test("a key is named by a variable that starts with MODEL_KEY_, and no other variable of the server can travel", () => {
  const withKey = (endpointKeyEnv: string) => draft({ source: "endpoint", endpointUrl: "https://models.example.org/forecast", endpointKeyEnv });
  for (const name of ["DATABASE_URL", "ANTHROPIC_API_KEY", "JWT_SECRET", "model_key_acme", "MODEL_KEY_"]) {
    assert.throws(() => checkModelDraft(withKey(name), CTX, {}), refusal(/its name starts with MODEL_KEY_.*Give that name, never the key/), name);
  }
  assert.ok(KEY_ENV.test("MODEL_KEY_ACME_2"));
});

test("the measure and every companion have to be things the project keeps", () => {
  assert.throws(() => checkModelDraft(draft({ metric: "beds" }), CTX), refusal(/defines no measure called “beds”\. Its measures are: occupancy, iqa/));
  const with_ = (companions: unknown[], more: Partial<ModelDraft> = {}) => draft({ companions: companions as ModelDraft["companions"], ...more });
  checkModelDraft(with_([{ name: "air", kind: "past", series: "twin:iqa" }, { name: "flu", kind: "past", series: "virus_detections", entity: "Quebec | Influenza" }]), CTX);
  assert.throws(() => checkModelDraft(with_([{ name: "wards", kind: "past", series: "twin:ward_beds" }]), CTX), refusal(/defines no measure called “ward_beds”/));
  assert.throws(() => checkModelDraft(with_([{ name: "self", kind: "past", series: "twin:occupancy" }]), CTX), refusal(/not a companion of itself/));
  assert.throws(() => checkModelDraft(with_([{ name: "calls", kind: "past", series: "calls_811", entity: "Montréal" }]), CTX), refusal(/keeps no series called “calls_811”\. Declare it under Data › Kept series first/));
  assert.throws(() => checkModelDraft(with_([{ name: "flu", kind: "past", series: "virus_detections" }]), CTX), refusal(/Say which entity of “virus_detections”/));
  assert.throws(() => checkModelDraft(with_([{ name: "a", kind: "past", series: "twin:iqa" }, { name: "a", kind: "past", series: "twin:iqa" }]), CTX), refusal(/Two companion series are called “a”/));
});

test("what is known ahead is the calendar, read on a named clock", () => {
  const cal = (more: Partial<ModelDraft> = {}) => draft({ companions: [{ name: "hour", kind: "known", series: "calendar:hour", entity: null }], ...more });
  checkModelDraft(cal({ timeZone: "America/Toronto" }), CTX);
  assert.throws(() => checkModelDraft(cal(), CTX), refusal(/The hour of the day is an hour somewhere/));
  assert.throws(() => checkModelDraft(cal({ timeZone: "Montreal" }), CTX), refusal(/“Montreal” is not a time zone this server knows/));
  // A measured series is not known ahead; the calendar is not a thing of the past only.
  assert.throws(() => checkModelDraft(draft({ companions: [{ name: "air", kind: "known", series: "twin:iqa", entity: null }] }), CTX), refusal(/“twin:iqa” is not known ahead of time/));
  assert.throws(() => checkModelDraft(draft({ companions: [{ name: "hour", kind: "past", series: "calendar:hour", entity: null }] }), CTX), refusal(/The calendar is known ahead/));
  // 12:20 UTC on Friday 27 November is 07:20 in Montréal.
  assert.equal(calendarValue("calendar:hour", NOW, "America/Toronto"), 7);
  assert.equal(calendarValue("calendar:weekday", NOW, "America/Toronto"), 5);
  // 02:00 UTC on Saturday is still Friday evening there.
  assert.equal(calendarValue("calendar:weekday", new Date("2026-11-28T02:00:00Z"), "America/Toronto"), 5);
});

test("a draft is read strictly", () => {
  assert.equal(modelDraft.safeParse({ ...draft(), step: "minute" }).success, false);
  assert.equal(modelDraft.safeParse({ ...draft(), horizonSteps: 400 }).success, false);
  assert.equal(modelDraft.safeParse({ ...draft(), units: ["the CHUM"] }).success, false);
  assert.equal(modelDraft.safeParse({ ...draft(), companions: [{ name: "Air Quality", kind: "past", series: "twin:iqa" }] }).success, false);
  assert.throws(() => checkModelDraft(draft({ historySteps: 12 }), CTX), refusal(/at least a day of history: 24 steps/));
  assert.deepEqual([draft().minHistoryDays, draft().holdHours, draft().units, draft().companions], [14, null, null, []]);
});

// --- where a request goes ---------------------------------------------------------------------

test("the screen is told where the series go, and never a path or a key", () => {
  assert.equal(sentTo({ source: "reference", endpointUrl: null, serviceModel: null }), "Nowhere: the reference is computed on this server.");
  assert.equal(sentTo({ source: "service", endpointUrl: null, serviceModel: "chronos-2" }, "https://models.internal.example:8443/base"), "The model service (models.internal.example:8443), model “chronos-2”.");
  assert.match(sentTo({ source: "service", endpointUrl: null, serviceModel: "chronos-2" }, ""), /which is not configured on this server/);
  // A key someone pasted into the address would otherwise be shown back on the screen.
  assert.equal(sentTo({ source: "endpoint", endpointUrl: "https://api.acme.io/v1/forecast?token=SECRET", serviceModel: null }), "api.acme.io, an address outside this platform.");
});

const REQUEST: ForecastRequest = {
  contract: 1,
  step: "hour",
  historyStart: "2026-11-20T00:00:00.000Z",
  origin: "2026-11-20T04:00:00.000Z",
  history: 4,
  horizon: 2,
  series: [{ id: "s1", target: [100, 110, null, 120] }],
};
const GOOD = { contract: 1, model: { name: "acme", version: "3" }, series: [{ id: "s1", low: [100, 100], likely: [110, 110], high: [120, 120] }] };
const jsonResponse = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;
const ENDPOINT = { source: "endpoint" as const, serviceModel: null, endpointUrl: "https://api.acme.io/v1/forecast", endpointKeyEnv: "MODEL_KEY_ACME" };

test("the reference answers on this server: nothing is fetched", async () => {
  let fetched = 0;
  const out = await askModel({ source: "reference", serviceModel: null, endpointUrl: null, endpointKeyEnv: null }, { ...REQUEST, history: 4 }, "percent", { fetch: (async () => (fetched += 1, jsonResponse(GOOD))) as unknown as typeof fetch });
  assert.ok(out.ok);
  assert.equal(fetched, 0);
  assert.deepEqual(out.said, { name: "reference", version: "1" });
  // Four hours of history: nothing was kept at the same hour a day before, and the reference says nothing.
  assert.deepEqual(out.series[0]!.likely, [null, null]);
});

test("an address is sent the request and nothing else, with the key read from the server's own variable", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => (calls.push({ url, init }), jsonResponse(GOOD))) as unknown as typeof fetch;
  const out = await askModel(ENDPOINT, REQUEST, "percent", { fetch: fetchFn, env: { MODEL_KEY_ACME: "k-123", DATABASE_URL: "postgres://secret" }, allow: async () => undefined });
  assert.ok(out.ok);
  assert.deepEqual(out.series, GOOD.series);
  assert.equal(calls[0]!.url, "https://api.acme.io/v1/forecast");
  assert.deepEqual(JSON.parse(calls[0]!.init.body as string), REQUEST, "the body is the request of the contract, whole and alone");
  assert.equal((calls[0]!.init.headers as Record<string, string>).Authorization, "Bearer k-123");
  assert.ok(!JSON.stringify(calls[0]).includes("postgres://secret"));
  // A redirect could carry the series, and the key, somewhere nobody chose.
  assert.equal(calls[0]!.init.redirect, "error");
});

test("a key that an administrator has not set stops the call before anything leaves", async () => {
  let fetched = 0;
  const fetchFn = (async () => (fetched += 1, jsonResponse(GOOD))) as unknown as typeof fetch;
  const unset = await askModel(ENDPOINT, REQUEST, "percent", { fetch: fetchFn, env: {}, allow: async () => undefined });
  assert.deepEqual(unset, { ok: false, why: "The variable MODEL_KEY_ACME is not set on the API: an administrator sets it. No key is typed here." });
  // A row written by hand with another variable's name is refused here too.
  const other = await askModel({ ...ENDPOINT, endpointKeyEnv: "DATABASE_URL" }, REQUEST, "percent", { fetch: fetchFn, env: { DATABASE_URL: "postgres://secret" }, allow: async () => undefined });
  assert.deepEqual(other, { ok: false, why: "The variable named for the key does not start with MODEL_KEY_." });
  // And an address that resolves inside the platform's own network is not called.
  const inside = await askModel({ ...ENDPOINT, endpointKeyEnv: null }, REQUEST, "percent", { fetch: fetchFn, env: {}, allow: async () => Promise.reject(new Error("“10.0.0.4” resolves to a private address.")) });
  assert.deepEqual(inside, { ok: false, why: "“10.0.0.4” resolves to a private address." });
  assert.equal(fetched, 0);
});

test("a served model needs the model service; without it only the reference can run, and the answer says so", async () => {
  const model = { source: "service" as const, serviceModel: "chronos-2", endpointUrl: null, endpointKeyEnv: null };
  const none = await askModel(model, REQUEST, "percent", { serviceUrl: "" });
  assert.match(none.ok ? "" : none.why, /The model service is not configured on this server \(MODEL_SERVICE_URL\): only the reference can run/);
  const calls: { url: string; body: unknown }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => (calls.push({ url, body: JSON.parse(init.body as string) }), jsonResponse(GOOD))) as unknown as typeof fetch;
  const out = await askModel(model, REQUEST, "percent", { serviceUrl: "https://models.example.org", fetch: fetchFn });
  assert.ok(out.ok);
  assert.deepEqual(calls, [{ url: "https://models.example.org/v1/forecast", body: { model: "chronos-2", request: REQUEST } }]);
});

test("what a model answers is held against the contract, and its failures are said in a sentence", async () => {
  const ask = (res: Response | Error) =>
    askModel({ ...ENDPOINT, endpointKeyEnv: null }, REQUEST, "percent", {
      fetch: (async () => {
        if (res instanceof Error) throw res;
        return res;
      }) as unknown as typeof fetch,
      allow: async () => undefined,
      timeoutMs: 5000,
    });
  const short = await ask(jsonResponse({ ...GOOD, series: [{ id: "s1", low: [100], likely: [110], high: [120] }] }));
  assert.match(short.ok ? "" : short.why, /Series “s1” has 1 low value, where the horizon is 2 steps/);
  const negative = await ask(jsonResponse({ ...GOOD, series: [{ id: "s1", low: [-5, 100], likely: [110, 110], high: [120, 120] }] }));
  assert.match(negative.ok ? "" : negative.why, /-5 is below 0, which this measure cannot be/);
  const refusedThere = await ask(jsonResponse({ detail: "history too short for this model" }, 422));
  assert.deepEqual(refusedThere, { ok: false, why: "The model answered 422: history too short for this model" });
  const down = await ask(new Error("connect ECONNREFUSED"));
  assert.deepEqual(down, { ok: false, why: "The model could not be reached: connect ECONNREFUSED" });
  // A request that does not keep the contract never leaves.
  const bad = await askModel(ENDPOINT, { ...REQUEST, series: [] }, "percent", { fetch: (async () => assert.fail("nothing is fetched")) as unknown as typeof fetch });
  assert.deepEqual(bad, { ok: false, why: "There is no series to forecast." });
});

// --- a small twin, kept hour by hour ------------------------------------------------------------

interface Reading {
  unit: string;
  at: number;
  seenAt: number;
  value: number | null;
}

/** The value a room shows at an instant: a weekly shape, and a slow rise of 0.1 an hour. */
const shape = (ms: number, base: number): number => Math.round((base + ((ms / HOUR) % 168) * 0.5 + (ms / HOUR - Date.UTC(2026, 9, 1) / HOUR) * 0.1) * 100) / 100;

/** Rooms 1 and 2 kept since 1 October, hour by hour, each reading written down ten minutes late; room 3 for five days only. */
function readings(): Reading[] {
  const out: Reading[] = [];
  const end = floorTo(NOW, "hour").getTime();
  for (let t = Date.UTC(2026, 9, 1); t <= end; t += HOUR) {
    out.push({ unit: U1, at: t, seenAt: t + 600_000, value: shape(t, 100) });
    out.push({ unit: U2, at: t, seenAt: t + 600_000, value: shape(t, 60) });
    if (t >= end - 5 * DAY) out.push({ unit: U3, at: t, seenAt: t + 600_000, value: 50 });
  }
  return out;
}

/** A database that answers the reads of a kept twin series the way Postgres does, from the readings above. */
function twinDb(all: Reading[] = readings()) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const ms = (v: unknown) => new Date(v as string).getTime();
  const row = (r: Reading) => ({ entity: r.unit, value: r.value, at: new Date(r.at), seen_at: new Date(r.seenAt), replayed: false });
  const db = {
    query: async (q: string, p: unknown[] = []) => {
      const sql = q.replace(/\s+/g, " ").trim();
      calls.push({ sql, params: p });
      const rows = ((): unknown[] => {
        if (/FROM app\.twin_metric/.test(sql)) return [{ id: "m1", organization_id: "o1", key: "occupancy", label: "Stretcher occupancy", object_type: "OrgUnit", unit: "percent", numerator: {}, denominator: null, qualified_by: null, active: true }];
        if (/FROM app\.ontology_object_instances oi/.test(sql)) {
          return [[U1, "Room One"], [U2, "Room Two"], [U3, "Room Three"]].map(([id, name]) => ({ id, object_type_id: "t", type_name: "OrgUnit", properties: { name }, provenance: {}, property_schema: [], sim_role: null, created_at: NOW, updated_at: NOW }));
        }
        if (/FROM app\.ontology_link_instances li/.test(sql)) return [];
        if (/SELECT DISTINCT unit_instance_id AS unit FROM app\.twin_reading/.test(sql)) return [...new Set(all.map((r) => r.unit))].sort().map((unit) => ({ unit }));
        if (/FROM app\.twin_reading WHERE project_id = \$1 AND metric = \$2 AND unit_instance_id = ANY/.test(sql)) {
          const units = new Set(p[2] as string[]);
          const known = all.filter((r) => units.has(r.unit) && r.seenAt <= ms(p[3]));
          if (/^SELECT DISTINCT ON/.test(sql)) {
            const last = new Map<string, Reading>();
            for (const r of known) if (r.at < ms(p[4]) && (!last.has(r.unit) || last.get(r.unit)!.at < r.at)) last.set(r.unit, r);
            return [...last.values()].map(row);
          }
          if (/min\(/.test(sql)) {
            const first = new Map<string, number>();
            for (const r of known) first.set(r.unit, Math.min(first.get(r.unit) ?? Infinity, r.at));
            return [...first].map(([entity, at]) => ({ entity, first_at: new Date(at) }));
          }
          return known.filter((r) => r.at >= ms(p[4]) && r.at < ms(p[5])).map(row);
        }
        if (/^UPDATE app\.forecast_model/.test(sql)) return [];
        throw new Error(`unexpected statement: ${sql.slice(0, 120)}`);
      })();
      return { rows, rowCount: rows.length };
    },
  } as unknown as DbClient;
  return { db, calls };
}

const model = (over: Partial<ForecastModel> = {}): ForecastModel => ({
  ...draft(),
  id: "fm1",
  projectId: "p1",
  key: "occupancy_model",
  state: "imported",
  verifiedAt: null,
  triedAt: null,
  backtest: null,
  lastError: null,
  trialEveryHours: 6,
  trialStartedAt: null,
  lastRunAt: null,
  standing: null,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  ...over,
});

test("a model is sent the history on a regular grid, under labels that name no unit", async () => {
  const { db } = twinDb();
  const origin = floorTo(NOW, "hour");
  const built = await buildRequest(db, PROJECT, model({ historySteps: 48, horizonSteps: 24 }), origin, null);
  assert.deepEqual([built.request.contract, built.request.step, built.request.history, built.request.horizon], [1, "hour", 48, 24]);
  assert.equal(built.request.origin, "2026-11-27T12:00:00.000Z");
  assert.equal(built.request.historyStart, "2026-11-25T12:00:00.000Z");
  assert.deepEqual(built.request.series.map((s) => [s.id, s.target.length]), [["s1", 48], ["s2", 48]]);
  assert.equal(built.request.series[0]!.target[47], shape(origin.getTime() - HOUR, 100), "the last hour of the history is the hour before the origin");
  // Which room a label stands for stays on this side.
  assert.deepEqual(built.units, [{ label: "s1", unitId: U1, name: "Room One" }, { label: "s2", unitId: U2, name: "Room Two" }]);
  const sent = JSON.stringify(built.request);
  for (const secret of [U1, U2, "Room One", "Room Two", "p1", "o1"]) assert.ok(!sent.includes(secret), `${secret} does not leave the server`);
});

test("a unit with too short a history is left out with its reason, never sent padded", async () => {
  const { db } = twinDb();
  const built = await buildRequest(db, PROJECT, model({ historySteps: 48 }), floorTo(NOW, "hour"), null);
  assert.deepEqual(built.leftOut, [{ unitId: U3, name: "Room Three", why: "Its history starts 5 days before: the model asks for 14." }]);
  // The threshold is a setting: at three days, the room is sent.
  const lower = await buildRequest(db, PROJECT, model({ historySteps: 48, minHistoryDays: 3 }), floorTo(NOW, "hour"), null);
  assert.deepEqual([lower.leftOut, lower.request.series.length], [[], 3]);
  // And a sample is a few units, not all of them.
  assert.equal((await buildRequest(db, PROJECT, model({ historySteps: 48 }), floorTo(NOW, "hour"), null, 1)).request.series.length, 1);
});

test("companions travel beside the target: a measure at the same unit, and the calendar over the horizon too", async () => {
  const { db, calls } = twinDb();
  const m = model({
    historySteps: 24,
    horizonSteps: 6,
    timeZone: "America/Toronto",
    companions: [
      { name: "air", kind: "past", series: "twin:iqa", entity: null },
      { name: "hour", kind: "known", series: "calendar:hour", entity: null },
    ],
  });
  const built = await buildRequest(db, PROJECT, m, floorTo(NOW, "hour"), null);
  const s1 = built.request.series[0]!;
  assert.equal(s1.past!.air!.length, 24);
  assert.equal(s1.known!.hour!.length, 30);
  // 12:00 UTC the day before is 07:00 in Montréal; the last value is the fifth hour ahead of the origin.
  assert.deepEqual([s1.known!.hour![0], s1.known!.hour![24], s1.known!.hour![29]], [7, 7, 12]);
  // The companion is read for the units that are sent, not for the one left out.
  const air = calls.filter((c) => /FROM app\.twin_reading WHERE project_id/.test(c.sql) && c.params[1] === "iqa");
  assert.ok(air.length > 0 && air.every((c) => JSON.stringify(c.params[2]) === JSON.stringify([U1, U2])));
});

// --- checking the contract on a sample -----------------------------------------------------------

test("a contract is checked on three units as they stand now, and the screen is told what left", async () => {
  const { db, calls } = twinDb();
  const out = await verifyModel(db, PROJECT, model({ historySteps: 336 }), { now: () => NOW });
  assert.equal(out.verification.ok, true);
  assert.deepEqual(
    { ...out.verification.sent, bytes: out.verification.sent.bytes > 1000 },
    { to: "Nowhere: the reference is computed on this server.", series: 2, history: 336, horizon: 72, step: "hour", companions: [], bytes: true },
  );
  assert.equal(out.verification.leftOut.length, 1);
  assert.equal(out.verification.sample!.unit, "Room One");
  assert.equal(out.verification.sample!.likely.length, 6);
  // The reference of the first hour ahead is the same hour a week before.
  assert.equal(out.verification.sample!.likely[0], shape(floorTo(NOW, "hour").getTime() - 7 * DAY, 100));
  const update = calls.find((c) => /^UPDATE app\.forecast_model/.test(c.sql))!;
  assert.match(update.sql, /SET state = CASE WHEN \$3 AND state = 'imported' THEN 'verified' ELSE state END/);
  assert.deepEqual(update.params, ["p1", "occupancy_model", true, null]);
});

test("a model that breaks the contract is not verified, and the reason is kept on it", async () => {
  const { db, calls } = twinDb();
  const broken = { contract: 1, series: [{ id: "s1", low: [1], likely: [1], high: [1] }] };
  const out = await verifyModel(db, PROJECT, model({ source: "endpoint", endpointUrl: "https://api.acme.io/f" }), {
    now: () => NOW,
    fetch: (async () => jsonResponse(broken)) as unknown as typeof fetch,
    allow: async () => undefined,
  });
  assert.equal(out.verification.ok, false);
  assert.match(out.verification.why ?? "", /Series “s1” has 1 low value, where the horizon is 72 steps/);
  assert.equal(out.verification.sent.to, "api.acme.io, an address outside this platform.");
  const update = calls.find((c) => /^UPDATE app\.forecast_model/.test(c.sql))!;
  assert.deepEqual(update.params.slice(2), [false, out.verification.why]);
});

test("with no unit that has enough history, nothing is sent and the reason is the unit's own", async () => {
  const { db } = twinDb(readings().filter((r) => r.unit === U3));
  let fetched = 0;
  const out = await verifyModel(db, PROJECT, model({ source: "endpoint", endpointUrl: "https://api.acme.io/f" }), { now: () => NOW, fetch: (async () => (fetched += 1, jsonResponse({}))) as unknown as typeof fetch, allow: async () => undefined });
  assert.equal(out.verification.ok, false);
  assert.equal(out.verification.why, "No unit has enough history to show the model. Room Three: Its history starts 5 days before: the model asks for 14.");
  assert.deepEqual([fetched, out.verification.sent.bytes, out.verification.sent.series], [0, 0, 0]);
});

// --- the replay on the past --------------------------------------------------------------------------

test("a replay has one origin a day, at the hour of the last whole step, the most recent a day old", () => {
  const origins = originsOf(NOW, "hour", 3).map((d) => d.toISOString());
  assert.deepEqual(origins, ["2026-11-24T12:00:00.000Z", "2026-11-25T12:00:00.000Z", "2026-11-26T12:00:00.000Z"]);
  assert.deepEqual(originsOf(NOW, "day", 2).map((d) => d.toISOString()), ["2026-11-25T00:00:00.000Z", "2026-11-26T00:00:00.000Z"]);
  // What was measured over a horizon is cut from one grid; past its end, nothing was measured yet.
  assert.deepEqual(measuredOver([1, 2, 3, 4, 5], 0, HOUR, new Date(3 * HOUR), 4), [4, 5, null, null]);
});

test("at each origin of a replay, the model is shown only what had been written down by then", async () => {
  const { db, calls } = twinDb();
  const seen: ForecastRequest[] = [];
  const fetchFn = (async (_url: string, init: RequestInit) => {
    const req = JSON.parse(init.body as string) as ForecastRequest;
    seen.push(req);
    return jsonResponse({ contract: 1, series: req.series.map((s) => ({ id: s.id, low: Array(req.horizon).fill(0), likely: Array(req.horizon).fill(100), high: Array(req.horizon).fill(500) })) });
  }) as unknown as typeof fetch;
  const m = model({ source: "endpoint", endpointUrl: "https://api.acme.io/f", historySteps: 48, horizonSteps: 24 });
  await backtestModel(db, PROJECT, m, { days: 3 }, { now: () => NOW, fetch: fetchFn, allow: async () => undefined });

  assert.deepEqual(seen.map((r) => r.origin), ["2026-11-24T12:00:00.000Z", "2026-11-25T12:00:00.000Z", "2026-11-26T12:00:00.000Z"]);
  for (const req of seen) {
    const origin = Date.parse(req.origin);
    // The reading about the hour before the origin was written down ten minutes into that hour: it was known.
    assert.equal(req.series[0]!.target[47], shape(origin - HOUR, 100));
    assert.equal(req.series[0]!.target.length, 48);
    // Every read made to build this request was made as of its origin, and none later.
    const reads = calls.filter((c) => /FROM app\.twin_reading WHERE project_id/.test(c.sql) && c.params[5] === req.origin);
    assert.ok(reads.length > 0 && reads.every((c) => c.params[3] === req.origin), "read as known at the origin");
  }
  // A reading about an hour before the origin, but written down after it, is not shown.
  const late = readings().map((r) => (r.unit === U1 && r.at === Date.parse("2026-11-26T11:00:00.000Z") ? { ...r, seenAt: Date.parse("2026-11-26T12:30:00.000Z") } : r));
  const again = twinDb(late);
  const seenLate: ForecastRequest[] = [];
  await backtestModel(again.db, PROJECT, m, { days: 1 }, { now: () => NOW, fetch: (async (_u: string, init: RequestInit) => (seenLate.push(JSON.parse(init.body as string)), jsonResponse({ contract: 1, series: [] }))) as unknown as typeof fetch, allow: async () => undefined });
  // The value in force over that hour is the one of the hour before, which holds: the late one is not there.
  assert.equal(seenLate[0]!.series[0]!.target[47], shape(Date.parse("2026-11-26T10:00:00.000Z"), 100));
});

test("a replay gives the model's error beside the reference's, over the very same steps, in all and by horizon", async () => {
  const { db, calls } = twinDb();
  // A model that knows the weekly shape and the rise: last week's value, plus a week of rise.
  const fetchFn = (async (_url: string, init: RequestInit) => {
    const req = JSON.parse(init.body as string) as ForecastRequest;
    const ahead = (s: ForecastRequest["series"][number]) => Array.from({ length: req.horizon }, (_, h) => Math.round(((s.target[req.history + h - 168] ?? 0) + 16.8) * 100) / 100);
    return jsonResponse({ contract: 1, model: { name: "acme", version: "3" }, series: req.series.map((s) => ({ id: s.id, low: ahead(s).map((v) => v - 1), likely: ahead(s), high: ahead(s).map((v) => v + 1) })) });
  }) as unknown as typeof fetch;
  const m = model({ source: "endpoint", endpointUrl: "https://api.acme.io/f", historySteps: 336, horizonSteps: 24 });
  const { backtest } = await backtestModel(db, PROJECT, m, { days: 4 }, { now: () => NOW, fetch: fetchFn, allow: async () => undefined });

  assert.deepEqual([backtest.days, backtest.step, backtest.horizon, backtest.partial, backtest.stopped, backtest.unit], [4, "hour", 24, false, null, "percent"]);
  assert.deepEqual(backtest.said, { name: "acme", version: "3" });
  // Four origins, two rooms, 24 hours each, all measured since: 192 steps.
  assert.equal(backtest.overall.n, 192);
  // The week before repeats last week and misses the rise: 16.8 an hour. The model does not.
  assert.deepEqual([backtest.overall.model, backtest.overall.reference, backtest.overall.inside], [0, 16.8, 1]);
  assert.equal(backtest.byHorizon.length, 24);
  // An hour ahead, the last value is off by one hour of the weekly shape and of the rise: 0.6.
  assert.deepEqual(backtest.byHorizon[0], { n: 8, model: 0, reference: 16.8, held: 0.6, inside: 1 });
  // Further ahead it drifts: the last value is the harder rule close by, and loses its edge with the hours.
  assert.ok(backtest.byHorizon[23]!.held! > backtest.byHorizon[0]!.held!);
  assert.ok(backtest.overall.held! > 0 && backtest.overall.held! < backtest.overall.reference!);
  assert.deepEqual(backtest.origins.map((o) => [o.origin.slice(0, 13), o.series, o.leftOut, o.score.n]), [
    ["2026-11-23T12", 2, 1, 48],
    ["2026-11-24T12", 2, 1, 48],
    ["2026-11-25T12", 2, 1, 48],
    ["2026-11-26T12", 2, 1, 48],
  ]);
  assert.equal(backtest.verdict.beats, true);
  assert.match(backtest.verdict.why, /^Its error is 0, under both rules: [\d.]+ for “the last value holds” and 16.8 for “the same hour a week before”, over 192 steps\.$/);
  const update = calls.find((c) => /^UPDATE app\.forecast_model/.test(c.sql))!;
  assert.match(update.sql, /SET state = CASE WHEN \$4 AND state IN \('imported', 'verified'\) THEN 'tried' ELSE state END/);
  assert.deepEqual([update.params[3], update.params[4]], [true, null]);
  // Nothing is kept as a forecast: a replay writes its result on the model, and nothing else.
  assert.equal(calls.filter((c) => /^(INSERT|UPDATE|DELETE)/.test(c.sql)).length, 1);
});

test("the most recent origins are scored on the part of their horizon that has been measured", async () => {
  const { db } = twinDb();
  const { backtest } = await backtestModel(db, PROJECT, model({ historySteps: 336, horizonSteps: 72 }), { days: 2 }, { now: () => NOW });
  // Yesterday's forecast looked 72 hours ahead; 24 of them have happened. The day before's: 48.
  assert.deepEqual(backtest.origins.map((o) => o.score.n), [96, 48]);
  assert.equal(backtest.byHorizon[60]!.n, 0);
  // This is the reference itself: it is not compared with itself.
  assert.equal(backtest.verdict.beats, null);
  assert.match(backtest.verdict.why, /This is the reference itself/);
});

test("a model that breaks the contract stops the replay there, and is not counted as tried", async () => {
  const { db, calls } = twinDb();
  let n = 0;
  const fetchFn = (async (_url: string, init: RequestInit) => {
    const req = JSON.parse(init.body as string) as ForecastRequest;
    n += 1;
    const series = req.series.map((s) => ({ id: s.id, low: Array(req.horizon).fill(1), likely: Array(req.horizon).fill(n === 2 ? 0 : 2), high: Array(req.horizon).fill(3) }));
    return jsonResponse({ contract: 1, series });
  }) as unknown as typeof fetch;
  const m = model({ source: "endpoint", endpointUrl: "https://api.acme.io/f", historySteps: 48, horizonSteps: 24 });
  const { backtest } = await backtestModel(db, PROJECT, m, { days: 3 }, { now: () => NOW, fetch: fetchFn, allow: async () => undefined });
  assert.equal(backtest.partial, true);
  assert.match(backtest.stopped ?? "", /^At the origin of 2026-11-25 12:00 UTC: Series “s1”, step 1: the range is out of order \(low 1, likely 0, high 3\)/);
  assert.equal(backtest.origins.length, 1);
  const update = calls.find((c) => /^UPDATE app\.forecast_model/.test(c.sql))!;
  assert.deepEqual([update.params[3], update.params[4]], [false, backtest.stopped]);
});

test("a replay that runs too long stops and says how far it got", async () => {
  const { db } = twinDb();
  let t = 0;
  const { backtest } = await backtestModel(db, PROJECT, model({ historySteps: 48, horizonSteps: 24 }), { days: 5 }, { now: () => NOW, clock: () => (t += BACKTEST_BUDGET_MS * 0.6) });
  assert.equal(backtest.partial, true);
  assert.equal(backtest.stopped, "The replay took more than 120 seconds and stopped after 1 of 5 origins.");
  assert.equal(backtest.origins.length, 1);
});

// --- what can be imported --------------------------------------------------------------------------

test("the offer says what a model can be given, and that without the model service only the reference runs", async () => {
  const db = {
    query: async (q: string) => {
      const sql = q.replace(/\s+/g, " ").trim();
      if (/FROM app\.twin_metric/.test(sql)) return { rows: [{ key: "occupancy", label: "Stretcher occupancy", unit: "percent" }, { key: "never_read", label: "Never read", unit: "count" }] };
      if (/FROM app\.twin_reading WHERE project_id = \$1 GROUP BY metric/.test(sql)) return { rows: [{ metric: "occupancy", units: 107, since: new Date("2026-09-09T14:45:00Z") }] };
      if (/FROM app\.kept_series WHERE project_id/.test(sql)) return { rows: [{ id: "s1", key: "virus_detections", label: "Virus detections" }] };
      if (/FROM app\.series_point p JOIN app\.kept_series/.test(sql)) return { rows: [{ series_id: "s1", entity: "Quebec | Influenza" }, { series_id: "s1", entity: "Quebec | RSV" }] };
      throw new Error(sql);
    },
  } as unknown as DbClient;
  const off = await modelOffer(db, PROJECT, "");
  // A measure nothing was ever kept for cannot be forecast: it is not offered.
  assert.deepEqual(off.measures, [{ key: "occupancy", label: "Stretcher occupancy", unit: "percent", units: 107, since: "2026-09-09T14:45:00.000Z" }]);
  assert.deepEqual(off.series, [{ key: "virus_detections", label: "Virus detections", entities: ["Quebec | Influenza", "Quebec | RSV"] }]);
  assert.deepEqual([off.service.configured, off.keyPrefix, off.contract], [false, "MODEL_KEY_", 1]);
  assert.match(off.service.says, /Everything works with the built-in reference; an open model cannot be called until an administrator sets it/);
  assert.equal((await modelOffer(db, PROJECT, "https://models.example.org")).service.configured, true);
});
