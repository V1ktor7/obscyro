import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { DbClient } from "../lib/db.js";
import type { ForecastRequest, Score } from "./forecast-contract.js";
import { floorTo, modelDraft, type ForecastModel } from "./forecast-models.js";
import {
  DISPLAY_MIN_STEPS,
  TRIAL_LATE_MINUTES,
  computeStanding,
  displayRule,
  dueOrigin,
  nextRunAt,
  runTrial,
  scoreFrozen,
  setTrial,
  shownForecasts,
  type FrozenRow,
} from "./forecast-trial.js";

// ---------------------------------------------------------------------------
// A model on trial.
//
// What matters is what cannot happen: a frozen forecast being rewritten, a
// forecast made after its hour, a model shown that did not beat both rules.
// ---------------------------------------------------------------------------

const PROJECT = { id: "p1", organizationId: "o1" };
const U1 = "00000000-0000-4000-8000-000000000001";
const U2 = "00000000-0000-4000-8000-000000000002";
const HOUR = 3_600_000;
// 12:40 UTC: the origin of 12:00 has been due for a quarter of an hour.
const NOW = new Date("2026-11-27T12:40:00.000Z");

const model = (over: Partial<ForecastModel> = {}): ForecastModel => ({
  ...modelDraft.parse({ label: "Acme", source: "endpoint", endpointUrl: "https://api.acme.io/f", metric: "occupancy", step: "hour", historySteps: 336, horizonSteps: 24 }),
  id: "fm1",
  projectId: "p1",
  key: "acme",
  state: "on_trial",
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

// --- when a trial runs ----------------------------------------------------------------------

test("a trial owes a forecast for the latest slot whose data has had time to arrive", () => {
  const at = (iso: string) => new Date(iso);
  // Every six hours from midnight UTC, twenty-five minutes after the hour.
  assert.equal(dueOrigin(at("2026-11-27T12:40:00Z"), "hour", 6).toISOString(), "2026-11-27T12:00:00.000Z");
  assert.equal(dueOrigin(at("2026-11-27T12:10:00Z"), "hour", 6).toISOString(), "2026-11-27T06:00:00.000Z", "the hour's data has not arrived yet");
  assert.equal(dueOrigin(at("2026-11-27T12:40:00Z"), "hour", 1).toISOString(), "2026-11-27T12:00:00.000Z");
  assert.equal(dueOrigin(at("2026-11-27T12:40:00Z"), "day", 6).toISOString(), "2026-11-27T00:00:00.000Z");
  assert.equal(nextRunAt(at("2026-11-27T12:40:00Z"), "hour", 6).toISOString(), "2026-11-27T18:25:00.000Z");
  assert.equal(nextRunAt(at("2026-11-27T12:10:00Z"), "hour", 6).toISOString(), "2026-11-27T12:25:00.000Z");
});

test("a model goes on trial only once it was tried on the past, at one of the rhythms", async () => {
  const sql: { q: string; p: unknown[] }[] = [];
  const db = { query: async (q: string, p: unknown[] = []) => (sql.push({ q: q.replace(/\s+/g, " ").trim(), p }), { rows: [], rowCount: 0 }) } as unknown as DbClient;
  const refusal = (re: RegExp) => (err: unknown) => (err as { code?: string }).code === "TRIAL_REFUSED" && re.test((err as Error).message);
  await assert.rejects(setTrial(db, PROJECT, model({ state: "imported" }), true), refusal(/Replay the model on the past first/));
  await assert.rejects(setTrial(db, PROJECT, model({ state: "verified" }), true), refusal(/Replay the model on the past first/));
  await assert.rejects(setTrial(db, PROJECT, model({ state: "tried" }), true, 5), refusal(/A trial runs every 1, 3, 6, 12, 24 hours/));
  assert.equal(sql.length, 0, "nothing is written by a refusal");

  await setTrial(db, PROJECT, model({ state: "tried" }), true, 3);
  assert.match(sql[0]!.q, /^UPDATE app\.forecast_model SET state = 'on_trial', trial_every_hours = \$3, trial_started_at = COALESCE\(trial_started_at, NOW\(\)\)/);
  assert.deepEqual(sql[0]!.p, ["p1", "acme", 3]);
  // Off trial: it stops making forecasts, and nothing it froze is touched.
  await setTrial(db, PROJECT, model(), false);
  assert.match(sql[1]!.q, /^UPDATE app\.forecast_model SET state = 'tried', updated_at = NOW\(\) WHERE project_id = \$1 AND key = \$2 AND state = 'on_trial'/);
  assert.ok(!sql.some((s) => /forecast_issued/.test(s.q)));
});

// --- a small twin, and a run ------------------------------------------------------------------

/** Two rooms kept hour by hour since 1 November; the value is the hour of the week, plus 100 or 60. */
function twinDb(frozenAlready = 0) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const value = (ms: number, base: number) => base + ((ms / HOUR) % 168);
  const all: { unit: string; at: number; seenAt: number; value: number }[] = [];
  for (let t = Date.UTC(2026, 10, 1); t <= floorTo(NOW, "hour").getTime(); t += HOUR) {
    all.push({ unit: U1, at: t, seenAt: t + 600_000, value: value(t, 100) }, { unit: U2, at: t, seenAt: t + 600_000, value: value(t, 60) });
  }
  const ms = (v: unknown) => new Date(v as string).getTime();
  const row = (r: (typeof all)[number]) => ({ entity: r.unit, value: r.value, at: new Date(r.at), seen_at: new Date(r.seenAt), replayed: false });
  const db = {
    query: async (q: string, p: unknown[] = []) => {
      const sql = q.replace(/\s+/g, " ").trim();
      calls.push({ sql, params: p });
      const rows = ((): unknown[] => {
        if (/FROM app\.forecast_issued WHERE model_id = \$1 AND origin = \$2/.test(sql)) return [{ n: frozenAlready }];
        if (/INSERT INTO app\.forecast_issued/.test(sql)) return [{ n: (JSON.parse(p[4] as string) as unknown[]).length }];
        if (/FROM app\.twin_metric/.test(sql)) return [{ id: "m1", organization_id: "o1", key: "occupancy", label: "Stretcher occupancy", object_type: "OrgUnit", unit: "percent", numerator: {}, denominator: null, qualified_by: null, active: true }];
        if (/FROM app\.ontology_object_instances oi/.test(sql)) return [[U1, "Room One"], [U2, "Room Two"]].map(([id, name]) => ({ id, object_type_id: "t", type_name: "OrgUnit", properties: { name }, provenance: {}, property_schema: [], sim_role: null, created_at: NOW, updated_at: NOW }));
        if (/FROM app\.ontology_link_instances li/.test(sql)) return [];
        if (/SELECT DISTINCT unit_instance_id AS unit FROM app\.twin_reading/.test(sql)) return [{ unit: U1 }, { unit: U2 }];
        if (/FROM app\.twin_reading WHERE project_id = \$1 AND metric = \$2 AND unit_instance_id = ANY/.test(sql)) {
          const units = new Set(p[2] as string[]);
          const known = all.filter((r) => units.has(r.unit) && r.seenAt <= ms(p[3]));
          if (/^SELECT DISTINCT ON/.test(sql)) return [];
          if (/min\(/.test(sql)) return [...units].map((entity) => ({ entity, first_at: new Date(Date.UTC(2026, 10, 1)) }));
          return known.filter((r) => r.at >= ms(p[4]) && r.at < ms(p[5])).map(row);
        }
        if (/^UPDATE app\.forecast_model/.test(sql)) return [];
        throw new Error(`unexpected statement: ${sql.slice(0, 120)}`);
      })();
      return { rows, rowCount: rows.length };
    },
  } as unknown as DbClient;
  return { db, calls, value };
}

const jsonResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
/** A model that answers every series with 100, between 90 and 110. */
const flat = (seen: ForecastRequest[] = []) =>
  (async (_url: string, init: RequestInit) => {
    const req = JSON.parse(init.body as string) as ForecastRequest;
    seen.push(req);
    return jsonResponse({ contract: 1, model: { name: "acme", version: "3" }, series: req.series.map((s) => ({ id: s.id, low: Array(req.horizon).fill(90), likely: Array(req.horizon).fill(100), high: Array(req.horizon).fill(110) })) });
  }) as unknown as typeof fetch;

test("a run freezes one forecast per unit, with what the two rules said at the same instant", async () => {
  const { db, calls, value } = twinDb();
  const seen: ForecastRequest[] = [];
  const run = await runTrial(db, PROJECT, model(), { now: () => NOW, fetch: flat(seen), allow: async () => undefined });
  assert.deepEqual(run, { origin: "2026-11-27T12:00:00.000Z", frozen: 2, why: null, missed: false });
  assert.equal(seen[0]!.origin, "2026-11-27T12:00:00.000Z");

  const insert = calls.find((c) => /INSERT INTO app\.forecast_issued/.test(c.sql))!;
  // Written once: a second write for the same model, unit and origin is ignored.
  assert.match(insert.sql, /ON CONFLICT \(model_id, unit_instance_id, origin\) DO NOTHING/);
  assert.deepEqual([insert.params[0], insert.params[1], insert.params[2], insert.params[3]], ["fm1", "p1", "2026-11-27T12:00:00.000Z", "hour"]);
  assert.deepEqual(JSON.parse(insert.params[5] as string), { name: "acme", version: "3" });
  const rows = JSON.parse(insert.params[4] as string) as { unit: string; low: number[]; likely: number[]; high: number[]; ref_likely: number[]; held: number }[];
  assert.deepEqual(rows.map((r) => r.unit), [U1, U2], "the unit comes back from the label on this side");
  assert.deepEqual([rows[0]!.likely.length, rows[0]!.likely[0], rows[0]!.low[0], rows[0]!.high[0]], [24, 100, 90, 110]);
  // The week before, at the same hour: the same value, since the shape repeats every week.
  const origin = Date.parse("2026-11-27T12:00:00.000Z");
  assert.equal(rows[0]!.ref_likely[0], value(origin - 168 * HOUR, 100));
  // The last value known at the origin: the hour before.
  assert.equal(rows[0]!.held, value(origin - HOUR, 100));
  assert.deepEqual(calls.at(-1)!.params, ["fm1", null]);
});

test("an origin already frozen is left alone, and a forecast is never made late", async () => {
  const frozen = twinDb(2);
  let fetched = 0;
  const count = (async () => (fetched += 1, jsonResponse({}))) as unknown as typeof fetch;
  const again = await runTrial(frozen.db, PROJECT, model(), { now: () => NOW, fetch: count, allow: async () => undefined });
  assert.deepEqual(again, { origin: "2026-11-27T12:00:00.000Z", frozen: 0, why: null, missed: false });
  assert.ok(!frozen.calls.some((c) => /INSERT/.test(c.sql)));

  // Three hours after its origin, the forecast would have seen the start of its own horizon: it is not made.
  const late = twinDb();
  const missed = await runTrial(late.db, PROJECT, model(), { now: () => new Date("2026-11-27T15:00:00.000Z"), fetch: count, allow: async () => undefined });
  assert.deepEqual(missed, { origin: "2026-11-27T12:00:00.000Z", frozen: 0, why: null, missed: true });
  assert.equal(late.calls.length, 0, "nothing is read, asked or written for a missed origin");
  assert.equal(fetched, 0);
  assert.equal(TRIAL_LATE_MINUTES, 90);
});

test("a model that fails freezes nothing: the reason is kept on it, and the trial goes on", async () => {
  const { db, calls } = twinDb();
  const broken = (async () => jsonResponse({ contract: 1, series: [] })) as unknown as typeof fetch;
  const run = await runTrial(db, PROJECT, model(), { now: () => NOW, fetch: broken, allow: async () => undefined });
  assert.equal(run.frozen, 0);
  assert.match(run.why ?? "", /The answer has no forecast for the series “s1”/);
  assert.ok(!calls.some((c) => /INSERT/.test(c.sql)));
  assert.deepEqual(calls.at(-1)!.params, ["fm1", run.why]);
});

test("a frozen forecast is never modified: no statement of the trial updates or deletes one", () => {
  // The database refuses it too (a trigger, migration 075). This holds the code to the same rule.
  const source = readFileSync(fileURLToPath(new URL("./forecast-trial.ts", import.meta.url)), "utf8") + readFileSync(fileURLToPath(new URL("./forecast-models.ts", import.meta.url)), "utf8");
  assert.doesNotMatch(source, /UPDATE\s+app\.forecast_issued/i);
  assert.doesNotMatch(source, /DELETE\s+FROM\s+app\.forecast_issued/i);
  assert.match(source, /INSERT INTO app\.forecast_issued[\s\S]+ON CONFLICT \(model_id, unit_instance_id, origin\) DO NOTHING/);
  const migration = readFileSync(fileURLToPath(new URL("../../scripts/migrations/075_forecast_issued.sql", import.meta.url)), "utf8");
  assert.match(migration, /BEFORE UPDATE ON app\.forecast_issued/);
});

// --- the rule that says whether a model is shown --------------------------------------------------

const score = (over: Partial<Score> = {}): Score => ({ n: 4000, model: 6.2, reference: 29.4, held: 8.3, inside: 0.8, ...over });

test("a model is shown only while it is on trial, has enough measured, and beats the better of the two rules", () => {
  assert.deepEqual(displayRule("service", "on_trial", score(), 12), { shown: true, why: "Its error is 6.2, under both rules: 8.3 for “the last value holds” and 29.4 for “the same hour a week before”, over 4,000 steps." });
  // Better than the week before, worse than the last value: it does worse than the screen as it is.
  const worse = displayRule("service", "on_trial", score({ model: 12 }), 12);
  assert.equal(worse.shown, false);
  assert.match(worse.why, /not under 8.3 for “the last value holds”, the better of the two rules/);
  assert.equal(displayRule("endpoint", "on_trial", score({ model: 8.3 }), 12).shown, false, "a tie is not better");
  // Too little measured to say anything.
  const early = displayRule("service", "on_trial", score({ n: DISPLAY_MIN_STEPS - 1 }), 1);
  assert.deepEqual(early, { shown: false, why: "Only 199 steps of its frozen forecasts have been measured so far. It is judged from 200." });
  assert.match(displayRule("service", "on_trial", score({ n: 0, model: null, reference: null, held: null, inside: null }), 0).why, /No forecast has been frozen yet/);
  // Off trial, nothing it forecast is being frozen: a replay on the past never earns a place on a screen.
  for (const state of ["imported", "verified", "tried"] as const) assert.equal(displayRule("service", state, score(), 12).shown, false);
  // The reference is the bar, not a model that cleared it.
  const bar = displayRule("reference", "on_trial", score({ model: 29.4 }), 12);
  assert.equal(bar.shown, false);
  assert.match(bar.why, /This is the reference rule itself/);
});

test("frozen forecasts are scored against what was measured since, step by step of the horizon", () => {
  const origin = new Date("2026-11-27T00:00:00.000Z");
  const rows: FrozenRow[] = [{ unit: U1, origin, low: [90, 90, 90], likely: [100, 100, 100], high: [110, 110, 110], ref_likely: [104, 104, null], held: 101 }];
  // Measured from the origin on: 102, 130, 100. The third step has no week rule: it does not count.
  const out = scoreFrozen(rows, new Map([[U1, [102, 130, 100]]]), origin.getTime(), HOUR, 3);
  assert.deepEqual(out.byHorizon.map((s) => s.n), [1, 1, 0]);
  assert.deepEqual(out.overall, { n: 2, model: 16, reference: 14, held: 15, inside: 0.5 });
  // A unit that was not measured is not scored, and a horizon not reached yet is not either.
  assert.equal(scoreFrozen(rows, new Map(), origin.getTime(), HOUR, 3).overall.n, 0);
  assert.equal(scoreFrozen(rows, new Map([[U1, [102]]]), origin.getTime(), HOUR, 3).overall.n, 1);
});

test("where a model stands is computed from its frozen forecasts, and kept on it as a cache", async () => {
  const origin = floorTo(new Date(NOW.getTime() - 24 * HOUR), "hour");
  const twin = twinDb();
  const calls: { sql: string; params: unknown[] }[] = [];
  const db = {
    query: async (q: string, p: unknown[] = []) => {
      const sql = q.replace(/\s+/g, " ").trim();
      calls.push({ sql, params: p });
      if (/FROM app\.forecast_issued WHERE model_id = \$1 AND origin >= \$2/.test(sql)) {
        return { rows: [U1, U2].map((unit) => ({ unit, origin, low: Array(24).fill(0), likely: Array(24).fill(0), high: Array(24).fill(1000), ref_likely: Array(24).fill(0), held: 0 })) };
      }
      if (/^UPDATE app\.forecast_model SET standing/.test(sql)) return { rows: [] };
      return twin.db.query(q, p);
    },
  } as unknown as DbClient;
  const standing = await computeStanding(db, PROJECT, model({ source: "service", serviceModel: "chronos-2", endpointUrl: null }), NOW);
  // Two rooms, 24 hours each, all measured since.
  assert.deepEqual([standing.forecasts, standing.origins, standing.overall.n, standing.windowDays, standing.unit], [2, 1, 48, 14, "percent"]);
  assert.equal(standing.overall.inside, 1);
  // 48 steps is under 200: it is not judged yet, and so not shown.
  assert.equal(standing.shown, false);
  assert.match(standing.why, /Only 48 steps of its frozen forecasts have been measured so far/);
  const update = calls.at(-1)!;
  assert.equal(update.sql, "UPDATE app.forecast_model SET standing = $2::jsonb WHERE id = $1");
  assert.equal((JSON.parse(update.params[1] as string) as { shown: boolean }).shown, false);
});

// --- what a screen is given ----------------------------------------------------------------------

test("a screen is given the latest frozen forecast of a model the rule lets through, and nothing else", async () => {
  const base = { ...modelDraft.parse({ label: "x", source: "service", serviceModel: "chronos-2", metric: "occupancy", step: "hour", historySteps: 336, horizonSteps: 3 }) };
  const row = (key: string, source: string, standing: unknown) => ({
    id: key, project_id: "p1", key, label: `Model ${key}`, source, service_model: base.serviceModel, endpoint_url: null, endpoint_key_env: null, metric: "occupancy", units: null, step: "hour",
    history_steps: 336, horizon_steps: 3, hold_hours: null, min_history_days: 14, companions: [], time_zone: null, state: "on_trial", verified_at: null, tried_at: null, backtest: null, last_error: null,
    trial_every_hours: 6, trial_started_at: null, last_run_at: null, standing, created_at: NOW, updated_at: NOW,
    f_origin: new Date("2026-11-27T12:00:00.000Z"), f_issued_at: new Date("2026-11-27T12:26:00.000Z"), f_low: [90, 91, 92], f_likely: [100, 101, 102], f_high: [110, 111, 112], f_said: { name: "chronos-2" },
  });
  const good = { shown: true, why: "Its error is 6.2, under both rules.", overall: score(), windowDays: 14, unit: "percent" };
  const sql: string[] = [];
  const db = {
    query: async (q: string) => {
      sql.push(q.replace(/\s+/g, " ").trim());
      return { rows: [row("good", "service", good), row("losing", "service", { ...good, shown: false }), row("new", "endpoint", null), row("bar", "reference", good)] };
    },
  } as unknown as DbClient;
  const out = await shownForecasts(db, PROJECT, U1);
  // Only models on trial are read at all, and only their latest forecast for this unit.
  assert.match(sql[0]!, /WHERE m\.project_id = \$1 AND m\.state = 'on_trial'/);
  assert.match(sql[0]!, /WHERE model_id = m\.id AND unit_instance_id = \$2 ORDER BY origin DESC LIMIT 1/);
  // The one that lost to the rules, the one never judged and the reference give nothing.
  assert.deepEqual(out.map((f) => f.model.key), ["good"]);
  assert.deepEqual(out[0], {
    model: { key: "good", label: "Model good", source: "service", said: { name: "chronos-2" } },
    metric: "occupancy",
    unit: "percent",
    step: "hour",
    origin: "2026-11-27T12:00:00.000Z",
    issuedAt: "2026-11-27T12:26:00.000Z",
    low: [90, 91, 92],
    likely: [100, 101, 102],
    high: [110, 111, 112],
    record: { overall: score(), why: "Its error is 6.2, under both rules.", windowDays: 14 },
  });
});
