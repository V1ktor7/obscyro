import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CONTRACT_VERSION,
  HORIZON_MAX,
  beatsReference,
  boundsOf,
  checkForecast,
  checkRequest,
  emptyTally,
  lastValueOf,
  referenceForecast,
  referenceOf,
  scoreOf,
  tallyInto,
  type Cell,
  type ForecastRequest,
} from "./forecast-contract.js";

// ---------------------------------------------------------------------------
// The contract of an imported model, and the rule it has to beat.
//
// What matters is what is refused: a forecast with a value missing, a range out
// of order or a value the measure cannot take is not repaired into a forecast.
// And what the reference does not do: make a value up where none was kept.
// ---------------------------------------------------------------------------

const request = (over: Partial<ForecastRequest> = {}): ForecastRequest => ({
  contract: CONTRACT_VERSION,
  step: "hour",
  historyStart: "2026-11-20T00:00:00.000Z",
  origin: "2026-11-20T04:00:00.000Z",
  history: 4,
  horizon: 3,
  series: [
    { id: "s1", target: [100, 110, null, 120] },
    { id: "s2", target: [40, 42, 41, 43] },
  ],
  ...over,
});
const answer = (over: Record<string, unknown> = {}) => ({
  contract: 1,
  model: { name: "chronos-2", version: "2025-10" },
  series: [
    { id: "s1", low: [100, 101, 102], likely: [110, 111, 112], high: [120, 121, 122] },
    { id: "s2", low: [38, 38, 38], likely: [42, 42, 42], high: [47, 47, 47] },
  ],
  ...over,
});
const refused = (out: ReturnType<typeof checkForecast>): string => {
  assert.equal(out.ok, false);
  return out.ok ? "" : out.why;
};

// --- what a model sends back ------------------------------------------------------------

test("an answer that keeps the contract is taken as it is, with what the model says of itself", () => {
  const out = checkForecast(request(), answer(), boundsOf("percent"));
  assert.ok(out.ok);
  assert.deepEqual(out.response.model, { name: "chronos-2", version: "2025-10" });
  assert.deepEqual(out.response.series[0], { id: "s1", low: [100, 101, 102], likely: [110, 111, 112], high: [120, 121, 122] });
  // Nothing else travels back: a field the contract does not name is dropped.
  const extra = checkForecast(request(), { ...answer(), notes: "trust me", series: [...answer().series.map((s) => ({ ...s, confidence: 0.99 }))] });
  assert.ok(extra.ok);
  assert.deepEqual(Object.keys(extra.response.series[0]!), ["id", "low", "likely", "high"]);
  assert.ok(!("notes" in extra.response));
});

test("an answer in another version of the contract, or that is not one, is refused", () => {
  assert.match(refused(checkForecast(request(), "ok")), /did not answer with an object/);
  assert.match(refused(checkForecast(request(), answer({ contract: 2 }))), /answers in version 2 of the contract; this platform speaks version 1/);
  assert.match(refused(checkForecast(request(), { series: [] })), /answers in version null/);
  assert.match(refused(checkForecast(request(), answer({ series: "none" }))), /has no list of series/);
});

test("every series sent has to come back, once, and no other", () => {
  const [s1, s2] = answer().series as { id: string; low: number[]; likely: number[]; high: number[] }[];
  assert.match(refused(checkForecast(request(), answer({ series: [s1] }))), /no forecast for the series “s2”: 1 of 2 came back/);
  assert.match(refused(checkForecast(request(), answer({ series: [s1, s2, { ...s2!, id: "s9" }] }))), /a series called “s9”, which was not sent/);
  assert.match(refused(checkForecast(request(), answer({ series: [s1, s1] }))), /holds the series “s1” twice/);
  assert.match(refused(checkForecast(request(), answer({ series: [{ low: [], likely: [], high: [] }] }))), /has no label/);
});

test("a forecast has one value per step of the horizon, and each is a number", () => {
  const [s1, s2] = answer().series as { id: string; low: number[]; likely: number[]; high: number[] }[];
  assert.match(refused(checkForecast(request(), answer({ series: [{ ...s1!, likely: [110, 111] }, s2] }))), /Series “s1” has 2 likely values, where the horizon is 3 steps/);
  assert.match(refused(checkForecast(request(), answer({ series: [{ ...s1!, high: undefined }, s2] }))), /Series “s1” has no high values/);
  assert.match(refused(checkForecast(request(), answer({ series: [{ ...s1!, low: [100, null, 102] }, s2] }))), /the low value of step 2 is not a number/);
  assert.match(refused(checkForecast(request(), answer({ series: [{ ...s1!, likely: [110, Number.NaN, 112] }, s2] }))), /the likely value of step 2 is not a number/);
});

test("a range out of order is refused, not sorted", () => {
  const [s1, s2] = answer().series as { id: string; low: number[]; likely: number[]; high: number[] }[];
  assert.match(refused(checkForecast(request(), answer({ series: [{ ...s1!, low: [100, 115, 102] }, s2] }))), /Series “s1”, step 2: the range is out of order \(low 115, likely 111, high 121\)/);
  assert.match(refused(checkForecast(request(), answer({ series: [s1, { ...s2!, high: [47, 47, 41] }] }))), /Series “s2”, step 3: the range is out of order/);
});

test("a value the measure cannot take is refused, not clipped", () => {
  const [s1, s2] = answer().series as { id: string; low: number[]; likely: number[]; high: number[] }[];
  const below = answer({ series: [s1, { ...s2!, low: [38, -2, 38] }] });
  assert.match(refused(checkForecast(request(), below, boundsOf("percent"))), /Series “s2”, step 2: -2 is below 0, which this measure cannot be/);
  assert.match(refused(checkForecast(request(), below, boundsOf("count"))), /below 0/);
  // A plain number has no bound this side can know.
  assert.ok(checkForecast(request(), below, boundsOf("number")).ok);
  // An occupancy can pass 100 %: stretchers in corridors are what it is there to show.
  assert.deepEqual(boundsOf("percent"), { min: 0, max: null });
  assert.deepEqual(boundsOf(null), { min: null, max: null });
  assert.match(refused(checkForecast(request(), answer(), { min: null, max: 120 })), /Series “s1”, step 2: 121 is above 120/);
});

// --- what a model is sent -----------------------------------------------------------------

test("a request is held against the contract before it leaves", () => {
  assert.equal(checkRequest(request()), null);
  assert.match(checkRequest(request({ series: [] })) ?? "", /no series to forecast/);
  assert.match(checkRequest(request({ horizon: HORIZON_MAX + 1 })) ?? "", /A horizon is 1 to 336 steps/);
  assert.match(checkRequest(request({ series: [{ id: "s1", target: [1, 2] }] })) ?? "", /carries 2 values of history, where 4 were announced/);
  assert.match(checkRequest(request({ series: [{ id: "s1", target: [1, 2, 3, 4], past: { air: [1, 2] } }] })) ?? "", /the companion “air” does not cover the history/);
  // A companion known ahead covers the history and the horizon.
  assert.match(checkRequest(request({ series: [{ id: "s1", target: [1, 2, 3, 4], known: { hour: [0, 1, 2, 3] } }] })) ?? "", /“hour” does not cover the history and the horizon/);
  assert.equal(checkRequest(request({ series: [{ id: "s1", target: [1, 2, 3, 4], known: { hour: [0, 1, 2, 3, 4, 5, 6] } }] })), null);
});

// --- the reference --------------------------------------------------------------------------

/** Two weeks of hourly history: the value is the hour of the week, plus 1,000 for the second week. */
const twoWeeks = (): Cell[] => Array.from({ length: 336 }, (_, i) => (i % 168) + (i >= 168 ? 1000 : 0));

test("the reference is the same hour, a week before", () => {
  const ref = referenceOf(twoWeeks(), 72, "hour");
  // The first hour to forecast is hour 0 of a week: last week's hour 0 was 1000.
  assert.deepEqual(ref.likely.slice(0, 3), [1000, 1001, 1002]);
  assert.equal(ref.likely[71], 1071);
  assert.ok(ref.rule.every((r) => r === "week"));
  // The range is not a model's: the lowest and the highest kept at that hour over the weeks before.
  assert.deepEqual([ref.low[0], ref.high[0]], [0, 1000]);
});

test("when last week's hour was a gap, the week before it is used; a gap is never made into a value", () => {
  const history = twoWeeks();
  history[168] = null;
  const ref = referenceOf(history, 2, "hour");
  assert.deepEqual([ref.likely[0], ref.low[0], ref.high[0], ref.rule[0]], [0, 0, 0, "week"]);
  assert.equal(ref.likely[1], 1001);
});

test("with less than a week of history, the reference is the same hour the day before", () => {
  // Three days: the value is the hour of the day, plus 100 a day.
  const three = Array.from({ length: 72 }, (_, i) => (i % 24) + Math.floor(i / 24) * 100);
  const ref = referenceOf(three, 30, "hour");
  assert.deepEqual(ref.rule.slice(0, 2), ["day", "day"]);
  assert.deepEqual(ref.likely.slice(0, 2), [200, 201]);
  // Past a day ahead, the same hour of the last day that was kept.
  assert.equal(ref.likely[24], 200);
  assert.deepEqual([ref.low[0], ref.high[0]], [0, 200]);
});

test("with nothing kept at that hour, the reference says nothing", () => {
  const ref = referenceOf([null, null, null, null], 2, "hour");
  assert.deepEqual(ref, { low: [null, null], likely: [null, null], high: [null, null], rule: [null, null] });
  // One value an hour ago is not "the same hour the day before".
  assert.deepEqual(referenceOf([5], 1, "hour").likely, [null]);
});

test("by the day, the reference is the same weekday a week before, then the day before", () => {
  const days = [10, 20, 30, 40, 50, 60, 70, 11, 21, 31];
  const ref = referenceOf(days, 3, "day");
  // Ten days kept: the next three days are a Thursday, Friday, Saturday of the week before.
  assert.deepEqual(ref.likely, [40, 50, 60]);
  assert.deepEqual(ref.rule, ["week", "week", "week"]);
  const short = referenceOf([10, 20, 30], 2, "day");
  assert.deepEqual([short.likely, short.rule], [[30, 30], ["day", "day"]]);
});

test("a horizon longer than a week repeats the last week that was kept", () => {
  const ref = referenceOf(twoWeeks(), 170, "hour");
  assert.equal(ref.likely[167], 1167);
  assert.equal(ref.likely[168], 1000, "the hour after a full week ahead is the same hour of the last week kept");
});

test("the reference is computed for every series of a request, with no model", () => {
  const out = referenceForecast(request({ history: 336, horizon: 2, series: [{ id: "s1", target: twoWeeks() }, { id: "s2", target: Array.from({ length: 336 }, () => null) }] }));
  assert.deepEqual(out.map((s) => [s.id, s.likely]), [["s1", [1000, 1001]], ["s2", [null, null]]]);
});

// --- scoring -----------------------------------------------------------------------------------

test("the last value holds: the last value kept, flat over the horizon, and nothing when there is none", () => {
  assert.deepEqual(lastValueOf([100, 110, 120], 3), [120, 120, 120]);
  // A gap at the end does not erase what a person last read off the screen.
  assert.deepEqual(lastValueOf([100, 110, null, null], 2), [110, 110]);
  assert.deepEqual(lastValueOf([null, null], 2), [null, null]);
  assert.deepEqual(lastValueOf([], 1), [null]);
});

test("a step is scored only where the model, both rules and the measure all have a value", () => {
  const tallies = [emptyTally(), emptyTally(), emptyTally(), emptyTally(), emptyTally()];
  tallyInto(
    tallies,
    { low: [90, 90, 90, 90, 90], likely: [100, 100, 100, 100, 100], high: [110, 110, 110, 110, 110] },
    { likely: [104, null, 104, 104, 104] },
    [101, 101, 101, 101, null],
    [102, 102, null, 130, 102],
  );
  // Step 2 has no week rule, step 3 no measure, step 5 no last value: none counts, for any side.
  assert.deepEqual(tallies.map((t) => t.n), [1, 0, 0, 1, 0]);
  const all = scoreOf(tallies);
  assert.deepEqual(all, { n: 2, model: 16, reference: 14, held: 15, inside: 0.5 });
  assert.deepEqual(scoreOf([tallies[0]!]), { n: 1, model: 2, reference: 2, held: 1, inside: 1 });
  assert.deepEqual(scoreOf([]), { n: 0, model: null, reference: null, held: null, inside: null });
});

test("a model is shown only when it does strictly better than the better of the two rules", () => {
  assert.deepEqual(beatsReference({ n: 400, model: 6.2, reference: 29.4, held: 8.3, inside: 0.8 }), {
    beats: true,
    why: "Its error is 6.2, under both rules: 8.3 for “the last value holds” and 29.4 for “the same hour a week before”, over 400 steps.",
  });
  // Better than the week before, worse than doing nothing: it does worse than the screen as it is.
  assert.deepEqual(beatsReference({ n: 1200, model: 12, reference: 29.4, held: 8.3, inside: 0.5 }), {
    beats: false,
    why: "Its error is 12, which is not under 8.3 for “the last value holds”, the better of the two rules, over 1,200 steps.",
  });
  // Further ahead the week before can be the harder rule: it is then the bar.
  assert.match(beatsReference({ n: 90, model: 21, reference: 20, held: 26, inside: 0.5 }).why, /not under 20 for “the same hour a week before”, the better of the two rules/);
  // A tie is not better: a rule a person could apply by hand does as well.
  assert.equal(beatsReference({ n: 400, model: 8.3, reference: 29.4, held: 8.3, inside: 0.8 }).beats, false);
  // With nothing compared, nothing is concluded.
  assert.deepEqual(beatsReference({ n: 0, model: null, reference: null, held: null, inside: null }).beats, null);
});
