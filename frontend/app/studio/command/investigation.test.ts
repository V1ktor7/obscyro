import { describe, expect, it } from "vitest";

import type { Comparison, Investigated } from "../analyst-api";
import { dayOn, doubtText, measuredLines, pairingOf, proposedRequest, signedChange, spanFrom, spanLabel, stagesOf, verdictOf } from "./investigation";

const cmp = (over: Partial<Comparison> = {}): Comparison => ({
  ref: "c1",
  from: "candidate",
  title: "Curfew across Québec",
  startsOn: "2021-12-31",
  endsOn: null,
  episode: null,
  leadDays: null,
  before: { mean: 93.7, days: 3 },
  after: { mean: 101.9, days: 3 },
  delta: 8.2,
  doubts: [],
  ...over,
});
const LINE = { ruleId: "r1", op: ">", threshold: 100, severity: "critical" as const };
const EPISODE = { id: "e2", startsAt: "", endsAt: null, startDay: "2022-01-02", endDay: "2022-01-07", peak: 141, peakAt: "", readings: 3, sharedWith: [] };
const inv = (over: Partial<Pick<Investigated, "line" | "episodes">> = {}): Pick<Investigated, "line" | "episodes"> => ({ line: LINE, episodes: [EPISODE], ...over });

describe("the span of an investigation", () => {
  it("ends now and starts the chosen number of hours before", () => {
    expect(spanFrom(72, new Date("2026-11-24T18:00:00.000Z"))).toEqual({ from: "2026-11-21T18:00:00.000Z", to: "2026-11-24T18:00:00.000Z" });
  });

  it("is named the way its button names it", () => {
    expect([24, 72, 168, 720].map(spanLabel)).toEqual(["24 h", "72 h", "7 d", "30 d"]);
    expect(spanLabel(48)).toBe("48 h");
    expect(spanLabel(240)).toBe("10 d");
  });

  it("counts a day on the clock it is given", () => {
    // 02:30 UTC on the 24th is still the 23rd in Montréal.
    expect(dayOn("2026-11-24T02:30:00.000Z", "America/Toronto")).toBe("2026-11-23");
    expect(dayOn("2026-11-24T02:30:00.000Z", null)).toBe("2026-11-24");
    expect(dayOn("2026-11-24T02:30:00.000Z", "Not/AZone")).toBe("2026-11-24");
  });
});

describe("the sentence proposed for a search", () => {
  it("names the unit and the dates, and nothing the twin measured", () => {
    const s = proposedRequest("CHUM", "2026-11-21", "2026-11-24");
    expect(s).toBe("What public health measures, closures, weather warnings, outbreaks or major incidents were reported in or around CHUM between 2026-11-21 and 2026-11-24?");
    // Whole, so nothing else can slip into it: the unit's name, two dates, and the kinds of event.
    expect(s.replace("CHUM", "").replace(/\d{4}-\d{2}-\d{2}/g, "")).not.toMatch(/\d/);
  });

  it("says one day as one day", () => {
    expect(proposedRequest("CHUM", "2026-11-24", "2026-11-24")).toMatch(/in or around CHUM on 2026-11-24\?$/);
  });
});

describe("where an investigation stands", () => {
  const step = (tool: string, ok = true) => ({ tool, ok });
  const states = (steps: { tool: string; ok: boolean }[], ended = false) => stagesOf(steps, ended).map((s) => `${s.key}:${s.state}`);

  it("starts on the series and has reached nothing else", () => {
    expect(states([])).toEqual(["series:now", "calendar:todo", "neighbours:todo", "search:todo", "passages:todo", "compare:todo", "check:todo"]);
  });

  it("moves on as each step arrives, and keeps the searches open until a passage is written", () => {
    const read = [step("twin_series"), step("calendar_events"), step("nearest_units"), step("search_brief")];
    expect(states(read).slice(0, 4)).toEqual(["series:done", "calendar:done", "neighbours:done", "search:now"]);
    expect(states([...read, step("web_search")]).slice(3, 5)).toEqual(["search:now", "passages:todo"]);
    expect(states([...read, step("web_search"), step("web_passage")]).slice(3, 6)).toEqual(["search:done", "passages:now", "compare:todo"]);
    expect(states([...read, step("web_search"), step("web_passage"), step("events_beside_series")]).slice(3)).toEqual(["search:done", "passages:done", "compare:done", "check:now"]);
  });

  it("shows a read that failed, and goes on", () => {
    expect(states([step("twin_series"), step("calendar_events", false)]).slice(0, 3)).toEqual(["series:done", "calendar:failed", "neighbours:now"]);
  });

  it("animates nothing once the stream has ended: what was not reached stays not reached", () => {
    expect(states([step("twin_series")], true)).toEqual(["series:done", "calendar:todo", "neighbours:todo", "search:todo", "passages:todo", "compare:todo", "check:todo"]);
    const all = ["twin_series", "calendar_events", "nearest_units", "search_brief", "web_search", "web_passage", "events_beside_series", "search_check"].map((t) => step(t));
    expect(states(all, true).every((s) => s.endsWith(":done"))).toBe(true);
  });
});

describe("an event beside the series, in a sentence", () => {
  it("says it goes with an episode, and how many days before", () => {
    expect(verdictOf(cmp({ episode: "e2", leadDays: 2 }), inv())).toBe("Goes with episode 2: it starts 2 days before.");
    expect(verdictOf(cmp({ episode: "e2", leadDays: 1 }), inv())).toBe("Goes with episode 2: it starts 1 day before.");
    expect(verdictOf(cmp({ episode: "e2", leadDays: 0 }), inv())).toBe("Goes with episode 2: it starts the same day.");
  });

  it("never says an event that came after started the episode", () => {
    const c = cmp({ episode: "e2", leadDays: -3, doubts: [{ kind: "starts_after", days: 3 }] });
    expect(verdictOf(c, inv())).toBe("Falls inside episode 2, which had begun 3 days earlier.");
    expect(pairingOf(c)).toBe("inside");
    expect(doubtText(c.doubts[0]!, () => "")).toBe("The episode had begun 3 days before this event: the event cannot have started it.");
  });

  it("says why there is no pairing: no episode, no threshold, no date, outside the span", () => {
    expect(verdictOf(cmp(), inv())).toBe("Goes with no episode.");
    expect(verdictOf(cmp(), inv({ episodes: [] }))).toBe("The series has no episode over this span.");
    expect(verdictOf(cmp(), inv({ line: null, episodes: [] }))).toBe("No alert threshold on this measure, so no episode to set it beside.");
    expect(verdictOf(cmp({ startsOn: null, before: null, after: null, delta: null, doubts: [{ kind: "no_date" }] }), inv())).toBe("No date: it cannot be placed on the series.");
    expect(verdictOf(cmp({ doubts: [{ kind: "outside_span", side: "before" }] }), inv())).toBe("Starts before the span that was read.");
    expect(verdictOf(cmp({ doubts: [{ kind: "outside_span", side: "after" }] }), inv())).toBe("Starts after the span that was read.");
  });

  it("sorts a row by how it sits beside the series", () => {
    expect(pairingOf(cmp({ episode: "e1", leadDays: 2 }))).toBe("before");
    expect(pairingOf(cmp())).toBe("none");
    expect(pairingOf(cmp({ doubts: [{ kind: "no_date" }] }))).toBe("unplaced");
    expect(pairingOf(cmp({ episode: "e1", leadDays: 2, doubts: [{ kind: "outside_span", side: "before" }] }))).toBe("unplaced");
  });

  it("names the other events that go with the same episode", () => {
    const titles: Record<string, string> = { c2: "Schools closed", "h:ev1": "Ice storm warning" };
    expect(doubtText({ kind: "shared", with: ["c2", "h:ev1"] }, (r) => titles[r] ?? r)).toBe(
      "2 other events go with the same episode (Schools closed; Ice storm warning). The series cannot tell them apart.",
    );
    expect(doubtText({ kind: "shared", with: ["c2"] }, (r) => titles[r] ?? r)).toMatch(/^1 other event goes with the same episode \(Schools closed\)/);
  });

  it("says what could not be measured", () => {
    expect(doubtText({ kind: "nothing_before" }, () => "")).toMatch(/No reading was kept for the days before it/);
    expect(doubtText({ kind: "nothing_after" }, () => "")).toMatch(/No reading was kept for the days from its start/);
    expect(doubtText({ kind: "no_date" }, () => "")).toMatch(/The passage states no day/);
  });
});

describe("what was measured around an event", () => {
  const percent = (v: number) => `${Math.round(v)}%`;
  const points = (d: number) => signedChange(d, "percent");

  it("gives the two means, the days each is made of, and what separates them", () => {
    expect(measuredLines(cmp(), percent, points)).toEqual([
      "The 3 days before: 94% on average, over 3 days",
      "The 3 days from its start: 102% on average, over 3 days",
      "Change: +8.2 points",
    ]);
  });

  it("says a side has no reading rather than showing a zero, and computes no change", () => {
    expect(measuredLines(cmp({ before: { mean: null, days: 0 }, after: { mean: 90, days: 1 }, delta: null }), percent, points)).toEqual([
      "The 3 days before: no reading kept",
      "The 3 days from its start: 90% on average, over 1 day",
    ]);
  });

  it("is absent for an event that could not be placed", () => {
    expect(measuredLines(cmp({ before: null, after: null, delta: null }), percent, points)).toBeNull();
  });

  it("writes a change with its sign and in the measure's unit", () => {
    expect(signedChange(8.23, "percent")).toBe("+8.2 points");
    expect(signedChange(-1, "percent")).toBe("−1.0 point");
    expect(signedChange(-12.4, "count")).toBe("−12");
    expect(signedChange(0.75, "hours")).toBe("+0.8");
    expect(signedChange(0.01, "percent")).toBe("none");
  });
});
