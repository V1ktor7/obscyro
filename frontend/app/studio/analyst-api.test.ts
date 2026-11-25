import { describe, expect, it } from "vitest";

import { hostOf, isWebLink, listedEvents, parseLines, stepLabel } from "./analyst-api";

describe("the analyst's stream", () => {
  it("yields whole lines and keeps the unfinished one for later", () => {
    const first = parseLines('{"type":"status","message":"Reading"}\n{"type":"pi');
    expect(first.events).toEqual([{ type: "status", message: "Reading" }]);
    expect(first.remainder).toBe('{"type":"pi');
    const second = parseLines(`${first.remainder}ng"}\n\n`);
    expect(second.events).toEqual([{ type: "ping" }]);
    expect(second.remainder).toBe("");
  });

  it("drops a line that is not JSON rather than stopping", () => {
    expect(parseLines('oops\n{"type":"ping"}\n').events).toEqual([{ type: "ping" }]);
  });
});

describe("a step in a planner's words", () => {
  const label = (tool: string, input: Record<string, unknown>, output: unknown = {}, ok = true) => stepLabel({ tool, input, output, ok });

  it("names what was read and in which world", () => {
    expect(label("describe_twin", { world: "reality" })).toBe("Overview of the twin, as it stands");
    expect(label("find_sites", { world: "scenario", activity: "lit", catchment: "West" })).toBe("Sites providing lit, serving West, with the scenario");
    expect(label("find_sites", { world: "reality" })).toBe("Sites of the network, as it stands");
    expect(label("get_site", { world: "reality", site: "Lakeshore" })).toBe("One site: Lakeshore, as it stands");
    expect(label("read_run", { part: "site", site: "Lakeshore" })).toBe("The run, day by day at Lakeshore");
    expect(label("read_run", { part: "summary" })).toBe("The run: summary of both runs");
    expect(label("read_series", { dataset: "INSPQ", value_column: "admissions" })).toBe("Series admissions of INSPQ");
  });

  it("names a tool declared in the project by its own label, and says it is the project's", () => {
    const step = { tool: "ventilators_available_by_site", input: { site: "CHUM" }, output: {}, ok: true };
    expect(stepLabel({ ...step, label: "Ventilators available by site" })).toBe("Ventilators available by site (declared in this project)");
    // A tool this screen does not know and that carries no label shows its name.
    expect(stepLabel(step)).toBe("ventilators_available_by_site");
  });

  it("shows a calculation with its result, and without one when it was refused", () => {
    const input = { label: "Share spared", expression: "round((7316 - 267) / 7316 * 100, 1)" };
    expect(label("calculate", input, { result: 96.4 })).toBe("Share spared: round((7316 - 267) / 7316 * 100, 1) = 96.4");
    expect(label("calculate", input, { error: "no" }, false)).toBe("Share spared: round((7316 - 267) / 7316 * 100, 1)");
  });

  it("says what was searched, what was cited and which validated events were read", () => {
    expect(label("web_search", { query: "couvre-feu Québec" }, { results: [{}, {}] })).toBe("Web search: “couvre-feu Québec” · 2 pages");
    expect(label("web_search", { query: "couvre-feu Québec" }, { results: [{}] })).toBe("Web search: “couvre-feu Québec” · 1 page");
    expect(label("web_search", { query: "x" }, { error: "used up" }, false)).toBe("Web search: “x”");
    expect(label("web_passage", { url: "https://www.quebec.ca/nouvelles/couvre-feu" })).toBe("Passage cited from quebec.ca");
    expect(label("list_events", {}, { events: [{}, {}, {}] })).toBe("Validated events from official sources: 3");
    expect(label("list_events", { from_day: 30, to_day: 40 }, { events: [{}] })).toBe("Validated events from official sources, days 30 to 40 of the run: 1");
    expect(label("list_events", { from_date: "2021-12-01" }, { events: [] })).toBe("Validated events from official sources, 2021-12-01 to …: 0");
  });

  it("says the price list was read, in which world, and how many prices it holds", () => {
    expect(label("list_prices", { world: "scenario" }, { prices: [{}, {}] })).toBe("The twin’s price list, with the scenario: 2 prices");
    expect(label("list_prices", { world: "reality" }, { prices: [{}] })).toBe("The twin’s price list, as it stands: 1 price");
    // A twin that declares none: the step says so by its count, not by a missing label.
    expect(label("list_prices", { world: "scenario" }, { prices: [] })).toBe("The twin’s price list, with the scenario: 0 prices");
    expect(label("list_prices", { world: "scenario" }, { error: "no" }, false)).toBe("The twin’s price list, with the scenario");
  });

  it("says each piece of an investigation's own work, with what it found", () => {
    const at = { unit: "CHUM", measure: "occupancy" };
    expect(label("twin_series", at, { valued: 4, episodes: [{}], alert_threshold: { op: ">", threshold: 100 } })).toBe(
      "Series kept by the twin: occupancy at CHUM · 4 readings · 1 episode beyond the alert threshold",
    );
    expect(label("twin_series", at, { valued: 1, episodes: [], alert_threshold: null })).toBe("Series kept by the twin: occupancy at CHUM · 1 reading · no alert threshold on this measure");
    expect(label("twin_series", at, { error: "no" }, false)).toBe("Series kept by the twin: occupancy at CHUM");
    expect(label("calendar_events", { from: "2021-12-20", to: "2022-01-10" }, { events: 2 })).toBe("Calendar of validated events, 2021-12-20 to 2022-01-10: 2");
    expect(label("nearest_units", {}, { placed: true, neighbours: [{ name: "Notre-Dame" }, { name: "Verdun" }] })).toBe("Nearest units reporting the same measure: Notre-Dame, Verdun");
    expect(label("nearest_units", {}, { placed: false, neighbours: [] })).toBe("Nearest units: this unit has no place on the map");
    expect(label("nearest_units", {}, { placed: true, neighbours: [] })).toBe("Nearest units: none reports this measure");
    expect(label("nearest_units", {}, { neighbours: [], why: "The series has no episode over the span." })).toBe("Nearest units: not read. The series has no episode over the span.");
    // What leaves for the web is said in the trace, before it leaves.
    expect(label("search_brief", {}, { sent: { request: "x", sources: ["quebec.ca", "inspq.qc.ca"], searches_allowed: 8 } })).toBe(
      "What goes to the web: your sentence, to 2 allowed sources, in at most 8 searches. The series stays here",
    );
    expect(label("events_beside_series", {}, { compared: [{ episode: "e1" }, { episode: null }] })).toBe("Each event set beside the series: 2 events, 1 with an episode");
    expect(label("search_check", {}, { candidates: 3, struck: 2 })).toBe("Check of what the search delivered: 3 candidates, 2 things taken out");
    expect(label("search_check", {}, { candidates: 1, struck: 0 })).toBe("Check of what the search delivered: 1 candidate, nothing taken out");
    // A dataset's column, read by the ask loop, keeps its own label.
    expect(label("read_series", { dataset: "INSPQ", value_column: "admissions" })).toBe("Series admissions of INSPQ");
  });

  it("says the project's action types were read, and how many are switched off", () => {
    expect(label("list_actions", {}, { action_types: [{}, {}, {}], switched_off_in_this_project: ["Measures"] })).toBe("What this project lets it propose: 3 action types, 1 switched off");
    expect(label("list_actions", {}, { action_types: [{}] })).toBe("What this project lets it propose: 1 action type");
    expect(label("list_actions", {}, { error: "no" }, false)).toBe("What this project lets it propose");
  });

  it("falls back to the tool's name for one it does not know", () => {
    expect(label("something_new", {})).toBe("something_new");
  });
});

describe("what comes from the web", () => {
  it("names a source by its site, and only a web page becomes a link", () => {
    expect(hostOf("https://www.quebec.ca/nouvelles/couvre-feu")).toBe("quebec.ca");
    expect(hostOf("not an address")).toBe("not an address");
    expect(isWebLink("https://www.quebec.ca/x")).toBe(true);
    expect(isWebLink("http://inspq.qc.ca")).toBe(true);
    expect(isWebLink("javascript:alert(1)")).toBe(false);
    expect(isWebLink("data:text/html,x")).toBe(false);
    expect(isWebLink("")).toBe(false);
  });

  it("reads the validated events a step kept for the screen, and none from any other step", () => {
    const event = { id: "e1", title: "Curfew", url: "https://www.quebec.ca/x", startsOn: "2021-12-31", endsOn: null, place: "Québec", door: "access", sourceTitle: null, passage: "…" };
    expect(listedEvents({ tool: "list_events", ok: true, record: { events: [event, { id: "broken" }] } })).toEqual([event]);
    expect(listedEvents({ tool: "list_events", ok: false, record: { events: [event] } })).toEqual([]);
    expect(listedEvents({ tool: "get_site", ok: true, record: { events: [event] } })).toEqual([]);
    expect(listedEvents({ tool: "list_events", ok: true })).toEqual([]);
    expect(listedEvents(undefined)).toEqual([]);
  });
});
