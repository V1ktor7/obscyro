import assert from "node:assert/strict";
import { test } from "node:test";

import type Anthropic from "@anthropic-ai/sdk";

import { ANALYST_MODEL, converse, type AnalystModel } from "./analyst.js";
import { eventSearch, eventsClosing } from "./analyst-events.js";
import { ToolError, type AnalystContext } from "./analyst-tools.js";
import { Ledger } from "./analyst-verify.js";
import type { HealthEvent } from "./health-events.js";
import {
  compareEvents,
  dailyOf,
  episodesOf,
  investigate,
  lineFor,
  nearestTo,
  seriesOf,
  shareEpisodes,
  type EventToPlace,
  type InvestigationEvent,
  type InvestigationReads,
  type PlacedUnit,
  type Search,
  type SeriesPoint,
} from "./investigation.js";
import type { TwinAlertRuleRow } from "./twin.js";
import type { KeptReading, ReadingsBetween } from "./twin-history.js";

const ZONE = "America/Toronto";
/** Noon in Montréal, in winter: a reading that falls on the day it names. */
const noon = (day: string): string => `${day}T17:00:00.000Z`;
const kept = (day: string, value: number | null): KeptReading => ({ value, observedAt: noon(day), observedBasis: "source_timestamp" as KeptReading["observedBasis"], recordedAt: `${day}T17:04:00.000Z` });
const between = (readings: KeptReading[], opening: KeptReading | null = null): ReadingsBetween => ({ opening, readings, cut: false, since: readings[0]?.recordedAt ?? opening?.recordedAt ?? null });
const point = (day: string, value: number | null): SeriesPoint => ({ at: noon(day), value });
const rule = (over: Partial<TwinAlertRuleRow> = {}): TwinAlertRuleRow => ({
  id: "r1",
  environmentId: "p",
  unitKind: null,
  metric: "occupancy",
  op: ">",
  threshold: 100,
  severity: "critical",
  messageTemplate: "",
  recommendationTemplate: "",
  ...over,
});

// --- the series ---------------------------------------------------------------

test("the reading in force when the span begins is the first point, and a reading stands where its source dates it", () => {
  const from = new Date("2021-12-20T05:00:00.000Z");
  const points = seriesOf(
    {
      opening: kept("2021-12-18", 88),
      readings: [
        { value: 91, observedAt: null, observedBasis: null, recordedAt: "2021-12-21T09:00:00.000Z" },
        // Written down inside the span, true before it began: it stands at the span's first instant.
        { value: 90, observedAt: "2021-12-19T23:00:00.000Z", observedBasis: null, recordedAt: "2021-12-20T06:00:00.000Z" },
        kept("2021-12-22", null),
      ],
    },
    from,
  );
  assert.deepEqual(points, [
    { at: "2021-12-20T05:00:00.000Z", value: 88 },
    { at: "2021-12-20T05:00:00.000Z", value: 90 },
    { at: "2021-12-21T09:00:00.000Z", value: 91 },
    { at: noon("2021-12-22"), value: null },
  ]);
});

test("a day is the mean of its readings, keeps the value in force when it has none, and is empty before the first reading", () => {
  const days = dailyOf(
    [
      point("2021-12-21", 90),
      { at: "2021-12-21T20:00:00.000Z", value: 100 },
      point("2021-12-24", null),
      point("2021-12-26", 80),
    ],
    ZONE,
    "2021-12-20",
    "2021-12-27",
  );
  assert.deepEqual(days, [
    { day: "2021-12-20", value: null, readings: 0 },
    { day: "2021-12-21", value: 95, readings: 2 },
    { day: "2021-12-22", value: 100, readings: 0 },
    { day: "2021-12-23", value: 100, readings: 0 },
    // The day the value stops still began with one.
    { day: "2021-12-24", value: 100, readings: 0 },
    // A gap is not a zero.
    { day: "2021-12-25", value: null, readings: 0 },
    { day: "2021-12-26", value: 80, readings: 1 },
    { day: "2021-12-27", value: 80, readings: 0 },
  ]);
});

// --- episodes -----------------------------------------------------------------

test("the alert rule episodes are counted against is the least severe one that covers the unit", () => {
  const rules = [
    rule({ id: "crit", threshold: 120, severity: "critical" }),
    rule({ id: "warn", threshold: 100, severity: "warn" }),
    rule({ id: "wards", threshold: 60, severity: "info", unitKind: "ward" }),
    rule({ id: "other", metric: "waiting", threshold: 5, severity: "info" }),
  ];
  assert.deepEqual(lineFor(rules, "occupancy", "hospital"), { ruleId: "warn", op: ">", threshold: 100, severity: "warn" });
  assert.equal(lineFor(rules, "occupancy", "ward")?.ruleId, "wards");
  assert.equal(lineFor(rules, "length_of_stay", "hospital"), null);
});

test("an episode runs from the first reading beyond the threshold to the first reading back within it", () => {
  const to = new Date(noon("2022-01-10"));
  const episodes = episodesOf(
    [point("2021-12-30", 90), point("2022-01-02", 112), point("2022-01-03", 131), point("2022-01-04", 118), point("2022-01-07", 95)],
    { op: ">", threshold: 100 },
    to,
    ZONE,
  );
  assert.deepEqual(episodes, [
    {
      id: "e1",
      startsAt: noon("2022-01-02"),
      endsAt: noon("2022-01-07"),
      startDay: "2022-01-02",
      endDay: "2022-01-07",
      peak: 131,
      peakAt: noon("2022-01-03"),
      readings: 3,
      sharedWith: [],
    },
  ]);
});

test("a dip shorter than a day does not end an episode; a longer one does; an episode still open has no end", () => {
  const to = new Date(noon("2022-01-12"));
  const episodes = episodesOf(
    [
      point("2022-01-02", 110),
      { at: "2022-01-03T02:00:00.000Z", value: 98 },
      { at: "2022-01-03T09:00:00.000Z", value: 125 },
      point("2022-01-04", 90),
      point("2022-01-08", 104),
      // No value closes it too: a gap is not a reading beyond the threshold.
      point("2022-01-09", null),
      point("2022-01-11", 140),
    ],
    { op: ">", threshold: 100 },
    to,
    ZONE,
  );
  assert.deepEqual(
    episodes.map((e) => [e.id, e.startDay, e.endsAt, e.endDay, e.peak, e.readings]),
    [
      ["e1", "2022-01-02", noon("2022-01-04"), "2022-01-04", 125, 2],
      ["e2", "2022-01-08", noon("2022-01-09"), "2022-01-09", 104, 1],
      ["e3", "2022-01-11", null, "2022-01-12", 140, 1],
    ],
  );
});

test("a rule that alerts below a threshold marks the stretches below it", () => {
  const episodes = episodesOf([point("2022-01-02", 12), point("2022-01-03", 3), point("2022-01-04", 1), point("2022-01-05", 9)], { op: "<", threshold: 5 }, new Date(noon("2022-01-06")), ZONE);
  assert.deepEqual(episodes.map((e) => [e.startDay, e.endDay, e.peak]), [["2022-01-03", "2022-01-05", 1]]);
});

// --- neighbours ---------------------------------------------------------------

const PLACED: PlacedUnit[] = [
  { id: "chum", name: "CHUM", latitude: 45.5115, longitude: -73.5575, measures: true },
  { id: "nd", name: "Notre-Dame", latitude: 45.5257, longitude: -73.5626, measures: true },
  { id: "verdun", name: "Verdun", latitude: 45.4627, longitude: -73.5658, measures: true },
  { id: "hgj", name: "Hôpital général juif", latitude: 45.4975, longitude: -73.6295, measures: true },
  { id: "hmr", name: "Maisonneuve-Rosemont", latitude: 45.5737, longitude: -73.5587, measures: true },
  { id: "clsc", name: "CLSC des Faubourgs", latitude: 45.5152, longitude: -73.5561, measures: false },
  { id: "nowhere", name: "No place", latitude: null, longitude: null, measures: true },
];

test("the neighbours are the nearest units that report the measure, nearest first", () => {
  const near = nearestTo("chum", PLACED);
  assert.equal(near.placed, true);
  assert.deepEqual(near.units.map((u) => u.name), ["Notre-Dame", "Verdun", "Hôpital général juif"]);
  assert.ok(near.units[0]!.km > 1 && near.units[0]!.km < 2.5, `Notre-Dame is ${near.units[0]!.km} km away`);
});

test("a unit with no place on the map has no neighbour, and none is guessed", () => {
  assert.deepEqual(nearestTo("nowhere", PLACED), { placed: false, units: [] });
  assert.deepEqual(nearestTo("absent", PLACED), { placed: false, units: [] });
});

test("an episode names the neighbours that were in one of their own over the same days", () => {
  const own = episodesOf([point("2022-01-02", 120), point("2022-01-07", 90)], { op: ">", threshold: 100 }, new Date(noon("2022-01-10")), ZONE);
  const shared = shareEpisodes(own, [
    { id: "nd", name: "Notre-Dame", km: 1.6, readings: 4, episodes: [{ startsAt: noon("2022-01-06"), endsAt: null, startDay: "2022-01-06", endDay: "2022-01-10", peak: 111 }] },
    { id: "verdun", name: "Verdun", km: 5.5, readings: 4, episodes: [{ startsAt: noon("2021-12-22"), endsAt: noon("2021-12-24"), startDay: "2021-12-22", endDay: "2021-12-24", peak: 105 }] },
  ]);
  assert.deepEqual(shared[0]!.sharedWith, ["Notre-Dame"]);
});

// --- an event beside the series -----------------------------------------------

const DAYS = dailyOf(
  [point("2021-12-22", 90), point("2022-01-02", 120), point("2022-01-07", 96)],
  ZONE,
  "2021-12-20",
  "2022-01-10",
);
const EPISODES = episodesOf([point("2021-12-22", 90), point("2022-01-02", 120), point("2022-01-07", 96)], { op: ">", threshold: 100 }, new Date(noon("2022-01-10")), ZONE);
const SPAN = { fromDay: "2021-12-20", toDay: "2022-01-10" };
const event = (ref: string, startsOn: string | null): EventToPlace => ({ ref, from: "candidate", title: ref, startsOn, endsOn: null });

test("an event that starts a few days before an episode goes with it, with the means of the days around it", () => {
  const [c] = compareEvents([event("c1", "2021-12-31")], DAYS, EPISODES, SPAN);
  assert.equal(c!.episode, "e1");
  assert.equal(c!.leadDays, 2);
  assert.deepEqual(c!.before, { mean: 90, days: 3 });
  // 31 December and 1 January still hold 90; 2 January reads 120.
  assert.deepEqual(c!.after, { mean: 100, days: 3 });
  assert.equal(c!.delta, 10);
  assert.deepEqual(c!.doubts, []);
});

test("an event that starts inside an episode cannot have started it, and the comparison says so", () => {
  const [c] = compareEvents([event("c1", "2022-01-04")], DAYS, EPISODES, SPAN);
  assert.equal(c!.episode, "e1");
  assert.equal(c!.leadDays, -2);
  assert.deepEqual(c!.doubts, [{ kind: "starts_after", days: 2 }]);
});

test("an event more than a week before an episode, or after it ended, goes with none", () => {
  const out = compareEvents([event("early", "2021-12-24"), event("late", "2022-01-09")], DAYS, EPISODES, SPAN);
  assert.deepEqual(out.map((c) => [c.ref, c.episode, c.leadDays]), [["early", null, null], ["late", null, null]]);
  // It is still set beside the days around it.
  assert.deepEqual(out[1]!.before, { mean: 104, days: 3 });
});

test("two events before the same episode are each told the series cannot tell them apart", () => {
  const out = compareEvents([event("c1", "2021-12-31"), event("c2", "2022-01-01"), event("c3", "2021-12-23")], DAYS, EPISODES, SPAN);
  assert.deepEqual(out[0]!.doubts, [{ kind: "shared", with: ["c2"] }]);
  assert.deepEqual(out[1]!.doubts, [{ kind: "shared", with: ["c1"] }]);
  assert.deepEqual(out[2]!.doubts, []);
});

test("an event without a date, or outside the span, is not placed on the series", () => {
  const out = compareEvents([event("undated", null), event("before", "2021-12-01"), event("after", "2022-02-01")], DAYS, EPISODES, SPAN);
  assert.deepEqual(out.map((c) => c.doubts), [[{ kind: "no_date" }], [{ kind: "outside_span", side: "before" }], [{ kind: "outside_span", side: "after" }]]);
  for (const c of out) assert.deepEqual([c.episode, c.leadDays, c.before, c.after, c.delta], [null, null, null, null, null]);
});

test("an event before the series began has no mean before it, and no change is computed", () => {
  const [c] = compareEvents([event("c1", "2021-12-21")], DAYS, EPISODES, SPAN);
  assert.deepEqual(c!.before, { mean: null, days: 0 });
  assert.deepEqual(c!.after, { mean: 90, days: 2 });
  assert.equal(c!.delta, null);
  assert.deepEqual(c!.doubts, [{ kind: "nothing_before" }]);
});

// --- the investigation, start to end -----------------------------------------

type Message = Anthropic.Beta.BetaMessage;
type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;
type Block = Anthropic.Beta.BetaContentBlock;

const reply = (content: Block[], stop: Message["stop_reason"], searches = 0): Message =>
  ({
    id: "msg",
    type: "message",
    role: "assistant",
    model: ANALYST_MODEL,
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20, server_tool_use: { web_search_requests: searches } },
  }) as unknown as Message;

function scripted(turns: Message[]): AnalystModel & { seen: Params[] } {
  const seen: Params[] = [];
  return {
    seen,
    async create(params) {
      seen.push(JSON.parse(JSON.stringify(params)) as Params);
      const next = turns.shift();
      if (!next) throw new Error("The script ran out: the loop asked for a turn the test did not expect.");
      return next;
    },
  };
}

const CURFEW = {
  url: "https://www.quebec.ca/nouvelles/couvre-feu",
  title: "Nouvelles mesures pour freiner la transmission",
  text: "Un couvre-feu sera en vigueur à compter du 31 décembre 2021, de 22 h à 5 h, partout au Québec.",
};
const researched = (): Message =>
  reply(
    [
      { type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "mesures sanitaires Montréal décembre 2021" } } as Block,
      { type: "web_search_tool_result", tool_use_id: "srv_1", content: [{ type: "web_search_result", url: CURFEW.url, title: CURFEW.title, page_age: null, encrypted_content: "enc" }] } as Block,
      { type: "text", text: "According to the page, a curfew began.", citations: [{ type: "web_search_result_location", url: CURFEW.url, title: CURFEW.title, cited_text: CURFEW.text, encrypted_index: "idx" }] } as Block,
    ],
    "end_turn",
    1,
  );
const delivered = (): Message =>
  reply(
    [
      {
        type: "tool_use",
        id: "tu_1",
        name: "give_events",
        input: {
          candidates: [
            { title: "Curfew across Québec", start_date: "2021-12-31", end_date: "", place: "Québec", door: "access", passages: ["s2"], quote: "Un couvre-feu sera en vigueur à compter du 31 décembre 2021" },
          ],
          not_found: [],
          limits: [],
        },
      } as Block,
    ],
    "tool_use",
  );

const DOMAINS = ["quebec.ca"];
const REQUEST = "What measures were in force in Montréal between 2021-12-20 and 2022-01-10?";

// A context that can read nothing: the search fails loudly if it is ever handed the twin.
const sealed = (): AnalystContext => {
  const never = async (): Promise<never> => {
    throw new ToolError("The search must not read the twin.");
  };
  return { environment: "ile", scenario: null, run: null, known: new Ledger(), world: never, datasets: never, rows: never, events: never, live: never };
};
const searchWith =
  (model: AnalystModel): Search =>
  (onEvent) =>
    converse(model, sealed(), eventsClosing({ request: REQUEST, domains: DOMAINS, today: "2026-11-24" }), onEvent, [], undefined, eventSearch(DOMAINS));

const SERIES: Record<string, ReadingsBetween> = {
  chum: between([kept("2021-12-22", 93.7), kept("2022-01-02", 118.4), kept("2022-01-03", 141.3), kept("2022-01-07", 96.2)]),
  nd: between([kept("2021-12-22", 80), kept("2022-01-03", 109.9), kept("2022-01-06", 85)]),
  verdun: between([kept("2021-12-22", 70)]),
  hgj: between([]),
};
const SCHOOLS = { id: "ev1", title: "Schools closed", startsOn: "2022-01-03", endsOn: null, sourceUrl: "https://www.quebec.ca/education" } as HealthEvent;
const reads = (over: Partial<InvestigationReads> = {}): InvestigationReads & { asked: string[] } => {
  const asked: string[] = [];
  return {
    asked,
    async series(unitId) {
      asked.push(unitId);
      return SERIES[unitId] ?? between([]);
    },
    rules: async () => [rule()],
    calendar: async () => [SCHOOLS],
    placed: async () => PLACED,
    ...over,
  };
};
const INPUT = {
  unit: { id: "chum", name: "CHUM", kind: "hospital" },
  metric: "occupancy",
  from: new Date("2021-12-20T05:00:00.000Z"),
  to: new Date("2022-01-10T05:00:00.000Z"),
  zone: ZONE,
  request: REQUEST,
  domains: DOMAINS,
};

test("an investigation reads the series, searches, and sets each event beside the series, step by step", async () => {
  const model = scripted([researched(), delivered()]);
  const events: InvestigationEvent[] = [];
  const out = await investigate(INPUT, reads(), searchWith(model), (e) => events.push(e));

  assert.equal(out.status, "answered");
  // The program's steps frame the search's, in the order the work was done.
  assert.deepEqual(
    out.steps.map((s) => `${s.id}:${s.tool}`),
    ["p1:twin_series", "p2:calendar_events", "p3:nearest_units", "p4:search_brief", "s1:web_search", "s2:web_passage", "p5:events_beside_series", "p6:search_check"],
  );
  // Each step was written to the stream as it ended, then one last line.
  assert.deepEqual(events.filter((e) => e.type === "step").map((e) => (e.type === "step" ? e.step.id : "")), out.steps.map((s) => s.id));
  assert.equal(events.filter((e) => e.type === "done").length, 1);
  assert.equal(events.at(-1)!.type, "done");

  const inv = out.answer!.investigation;
  assert.deepEqual(inv.series, { readings: 4, valued: 4, low: 93.7, high: 141.3, firstDay: "2021-12-22", since: "2021-12-22T17:04:00.000Z", cut: false });
  assert.deepEqual(inv.line, { ruleId: "r1", op: ">", threshold: 100, severity: "critical" });
  assert.deepEqual(inv.episodes.map((e) => [e.id, e.startDay, e.endDay, e.peak, e.sharedWith]), [["e1", "2022-01-02", "2022-01-07", 141.3, ["Notre-Dame"]]]);
  assert.deepEqual(inv.neighbours.map((n) => [n.name, n.readings, n.episodes.length]), [["Notre-Dame", 3, 1], ["Verdun", 1, 0], ["Hôpital général juif", 0, 0]]);
  assert.deepEqual(inv.calendar, [{ id: "ev1", title: "Schools closed", startsOn: "2022-01-03", endsOn: null, url: "https://www.quebec.ca/education" }]);

  // The candidate of the search and the event of the calendar, each beside the series.
  assert.deepEqual(
    inv.compared.map((c) => [c.ref, c.from, c.episode, c.leadDays, c.doubts]),
    [
      ["c1", "candidate", "e1", 2, [{ kind: "shared", with: ["h:ev1"] }]],
      ["h:ev1", "calendar", "e1", -1, [{ kind: "starts_after", days: 1 }, { kind: "shared", with: ["c1"] }]],
    ],
  );
  assert.equal(inv.compared[0]!.before!.mean, 93.7);
  assert.ok(Math.abs(inv.compared[0]!.delta! - (118.4 - 93.7) / 3) < 1e-9);
  assert.match(inv.limits[0]!, /Nothing here establishes that one caused the other/);
  assert.match(inv.limits.join(" "), /The series starts on 2021-12-22/);

  // The candidate is the search's, untouched: an acceptance reads it from the journal as before.
  assert.equal(out.answer!.candidates[0]!.id, "c1");
  assert.equal(out.answer!.candidates[0]!.startDate, "2021-12-31");
});

test("nothing the program read reaches the model: the search is sent the person's sentence and nothing of the series", async () => {
  const model = scripted([researched(), delivered()]);
  await investigate(INPUT, reads(), searchWith(model), () => {});
  const sent = JSON.stringify(model.seen);
  for (const figure of ["93.7", "118.4", "141.3", "96.2", "109.9", "CHUM", "Notre-Dame", "Schools closed", "occupancy"]) {
    assert.ok(!sent.includes(figure), `"${figure}" was sent to the model`);
  }
  assert.ok(sent.includes("between 2021-12-20 and 2022-01-10"));
});

test("the step that precedes the search says what leaves for the web and what stays", async () => {
  const model = scripted([researched(), delivered()]);
  const out = await investigate(INPUT, reads(), searchWith(model), () => {});
  assert.deepEqual(out.steps.find((s) => s.tool === "search_brief")!.output, {
    sent: { request: REQUEST, sources: DOMAINS, searches_allowed: 8 },
    kept_here: ["the series", "the alert threshold", "the calendar", "the neighbours"],
  });
});

test("the series the comparison was made on is kept beside the step that read it", async () => {
  const model = scripted([researched(), delivered()]);
  const out = await investigate(INPUT, reads(), searchWith(model), () => {});
  const record = out.steps[0]!.record as { points: SeriesPoint[] };
  assert.deepEqual(record.points.map((p) => p.value), [93.7, 118.4, 141.3, 96.2]);
});

test("without a reading over the span no search is made, and the person is told where the history starts", async () => {
  const model = scripted([]);
  const events: InvestigationEvent[] = [];
  const late = between([]);
  late.since = "2026-11-22T21:43:00.000Z";
  const out = await investigate(INPUT, reads({ series: async () => late }), searchWith(model), (e) => events.push(e));

  assert.equal(model.seen.length, 0);
  assert.equal(out.status, "incomplete");
  assert.equal(out.answer, null);
  assert.equal(out.usage.requests, 0);
  assert.match(out.message!, /its history starts on 2026-11-22\. No search was made/);
  assert.deepEqual(out.steps.map((s) => s.tool), ["twin_series"]);
  assert.equal(events.at(-1)!.type, "done");

  const never = await investigate(INPUT, reads({ series: async () => between([]) }), searchWith(scripted([])), () => {});
  assert.match(never.message!, /Nothing was ever kept for this measure at this unit/);
});

test("a measure with no alert rule has no episode: events are set beside the days around them, and the limit is said", async () => {
  const model = scripted([researched(), delivered()]);
  const r = reads({ rules: async () => [rule({ metric: "waiting" })] });
  const out = await investigate(INPUT, r, searchWith(model), () => {});
  const inv = out.answer!.investigation;

  assert.equal(inv.line, null);
  assert.deepEqual(inv.episodes, []);
  assert.deepEqual(inv.compared.map((c) => [c.ref, c.episode, c.leadDays]), [["c1", null, null], ["h:ev1", null, null]]);
  assert.equal(inv.compared[0]!.before!.mean, 93.7);
  assert.match(inv.limits.join(" "), /No alert rule covers this measure at this unit/);
  // No neighbour is read when there is no episode to look for.
  assert.deepEqual(r.asked, ["chum"]);
  assert.match((out.steps.find((s) => s.tool === "nearest_units")!.output as { why: string }).why, /No alert rule covers this measure/);
});

test("a calendar that cannot be read is a failed step and a stated limit, not a stopped investigation", async () => {
  const model = scripted([researched(), delivered()]);
  const out = await investigate(
    INPUT,
    reads({
      calendar: async () => {
        throw new Error("relation does not exist");
      },
    }),
    searchWith(model),
    () => {},
  );
  const step = out.steps.find((s) => s.tool === "calendar_events")!;
  assert.equal(step.ok, false);
  assert.equal(out.status, "answered");
  assert.deepEqual(out.answer!.investigation.calendar, []);
  assert.deepEqual(out.answer!.investigation.compared.map((c) => c.ref), ["c1"]);
  assert.match(out.answer!.investigation.limits.join(" "), /The calendar could not be read/);
});

test("a unit with no place on the map is investigated without neighbours, and the result says why", async () => {
  const model = scripted([researched(), delivered()]);
  const out = await investigate(INPUT, reads({ placed: async () => PLACED.filter((u) => u.id !== "chum") }), searchWith(model), () => {});
  assert.deepEqual(out.answer!.investigation.neighbours, []);
  assert.deepEqual(out.answer!.investigation.episodes[0]!.sharedWith, []);
  assert.match(out.answer!.investigation.limits.join(" "), /no place on the map/);
});

test("a search that delivers nothing ends the investigation with what was read, and no comparison", async () => {
  const refusal = reply([{ type: "text", text: "I cannot help with that.", citations: null } as Block], "refusal");
  const model = scripted([refusal]);
  const events: InvestigationEvent[] = [];
  const out = await investigate(INPUT, reads(), searchWith(model), (e) => events.push(e));

  assert.notEqual(out.status, "answered");
  assert.equal(out.answer, null);
  assert.deepEqual(out.steps.filter((s) => s.id.startsWith("p")).map((s) => s.tool), ["twin_series", "calendar_events", "nearest_units", "search_brief"]);
  assert.equal(events.filter((e) => e.type === "done").length, 1);
});

test("a series made of readings caught up from kept copies says so, as a limit", async () => {
  const caught = (day: string, value: number): KeptReading => ({ ...kept(day, value), replayed: true });
  const series = between([caught("2021-12-22", 93.7), caught("2022-01-02", 118.4), kept("2022-01-03", 141.3), kept("2022-01-07", 96.2)]);
  const out = await investigate(INPUT, reads({ series: async () => series }), searchWith(scripted([researched(), delivered()])), () => undefined);
  const first = out.steps[0]!;
  assert.equal((first.output as { caughtUp?: number }).caughtUp, 2);
  assert.match(out.answer!.investigation!.limits.join(" "), /2 of the 4 readings of the series were caught up afterwards from kept copies of the source, with the measure as it is defined today: the twin did not show them at the time\./);
});
