// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/auth";

import type { AnalystStep, EventCandidate, Investigated, InvestigationEvent, InvestigationLine, InvestigationResult } from "../analyst-api";

const api = vi.hoisted(() => ({ investigate: vi.fn(), listInvestigations: vi.fn(), readInvestigation: vi.fn(), acceptEvent: vi.fn(), askAnalyst: vi.fn() }));
vi.mock("../analyst-api", async (orig) => ({ ...(await orig<typeof import("../analyst-api")>()), ...api }));

import InvestigateTab from "./InvestigateTab";
import NetworkAnalyst from "./NetworkAnalyst";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

const UNIT = { id: "11111111-1111-4111-8111-111111111111", name: "CHUM" };
const METRIC = { key: "occupancy", label: "Stretcher occupancy", unit: "percent" as const };

const PASSAGE = {
  step: "s2",
  url: "https://www.quebec.ca/nouvelles/couvre-feu",
  title: "Nouvelles mesures pour freiner la transmission",
  text: "Un couvre-feu sera en vigueur à compter du 31 décembre 2021, de 22 h à 5 h, partout au Québec.",
};
const step = (id: string, tool: string, input: Record<string, unknown> = {}, output: unknown = {}, ok = true): AnalystStep => ({ id, tool, input, ok, output, ms: 1 });
const SERIES = step("p1", "twin_series", { unit: "CHUM", unit_id: UNIT.id, measure: "occupancy" }, { valued: 4, episodes: [{ id: "e1" }], alert_threshold: { op: ">", threshold: 100 } });
const CALENDAR = step("p2", "calendar_events", { from: "2021-12-20", to: "2022-01-10" }, { events: 1 });
const NEIGHBOURS = step("p3", "nearest_units", {}, { placed: true, neighbours: [{ name: "Notre-Dame", km: 1.6, readings: 3, episodes: 1 }] });
const BRIEF = step("p4", "search_brief", {}, { sent: { request: "x", sources: ["quebec.ca"], searches_allowed: 8 } });
const SEARCH = step("s1", "web_search", { query: "couvre-feu Québec décembre 2021" }, { results: [{ url: PASSAGE.url }] });
const CITED = step("s2", "web_passage", { url: PASSAGE.url }, { url: PASSAGE.url, title: PASSAGE.title, cited_text: PASSAGE.text });
const BESIDE = step("p5", "events_beside_series", {}, { compared: [{ event: "c1", episode: "e1" }, { event: "c2", episode: null }, { event: "h:ev1", episode: "e1" }] });
const CHECK = step("p6", "search_check", {}, { candidates: 2, struck: 0 });
const STEPS = [SERIES, CALENDAR, NEIGHBOURS, BRIEF, SEARCH, CITED, BESIDE, CHECK];

const curfew = (over: Partial<EventCandidate> = {}): EventCandidate => ({
  id: "c1",
  title: "Curfew across Québec",
  startDate: "2021-12-31",
  endDate: null,
  datesRemoved: [],
  place: "Québec",
  door: "access",
  url: PASSAGE.url,
  sourceTitle: PASSAGE.title,
  quote: "Un couvre-feu sera en vigueur à compter du 31 décembre 2021",
  quoteReplaced: false,
  passages: [PASSAGE],
  evidence: "published",
  ...over,
});
const STRIKE = curfew({ id: "c2", title: "Transit strike", startDate: null, datesRemoved: ["start"], quote: "les autobus ne rouleront pas" });

const investigated = (over: Partial<Investigated> = {}): Investigated => ({
  unit: UNIT,
  metric: "occupancy",
  from: "2021-12-20T05:00:00.000Z",
  to: "2022-01-10T05:00:00.000Z",
  zone: "America/Toronto",
  series: { readings: 4, valued: 4, low: 93.7, high: 141.3, firstDay: "2021-12-22", since: "2021-12-22T17:04:00.000Z", cut: false },
  line: { ruleId: "r1", op: ">", threshold: 100, severity: "critical" },
  episodes: [{ id: "e1", startsAt: "2022-01-02T17:00:00.000Z", endsAt: "2022-01-07T17:00:00.000Z", startDay: "2022-01-02", endDay: "2022-01-07", peak: 141.3, peakAt: "2022-01-03T17:00:00.000Z", readings: 2, sharedWith: ["Notre-Dame"] }],
  neighbours: [{ id: "nd", name: "Notre-Dame", km: 1.6, readings: 3, episodes: [] }],
  calendar: [{ id: "ev1", title: "Schools closed", startsOn: "2022-01-03", endsOn: null, url: "https://www.quebec.ca/education" }],
  compared: [
    { ref: "c1", from: "candidate", title: "Curfew across Québec", startsOn: "2021-12-31", endsOn: null, episode: "e1", leadDays: 2, before: { mean: 93.7, days: 3 }, after: { mean: 101.9, days: 3 }, delta: 8.2, doubts: [{ kind: "shared", with: ["h:ev1"] }] },
    { ref: "c2", from: "candidate", title: "Transit strike", startsOn: null, endsOn: null, episode: null, leadDays: null, before: null, after: null, delta: null, doubts: [{ kind: "no_date" }] },
    { ref: "h:ev1", from: "calendar", title: "Schools closed", startsOn: "2022-01-03", endsOn: null, episode: "e1", leadDays: -1, before: { mean: 100, days: 3 }, after: { mean: 130, days: 3 }, delta: 30, doubts: [{ kind: "starts_after", days: 1 }] },
  ],
  limits: ["An event that goes with an episode coincides with it in time. Nothing here establishes that one caused the other."],
  ...over,
});

function result(over: Partial<InvestigationResult> = {}, inv: Partial<Investigated> = {}): InvestigationResult {
  return {
    status: "answered",
    verified: true,
    struck: [],
    steps: STEPS,
    message: null,
    model: "claude-haiku-5-5",
    usage: { requests: 2, inputTokens: 21000, outputTokens: 900, webSearches: 1 },
    answer: { request: "x", sources: ["quebec.ca"], searches: 1, candidates: [curfew(), STRIKE], notFound: [], limits: ["No source gave the end of the curfew."], investigation: investigated(inv) },
    ...over,
  };
}

/** The stream, as the test plays it. */
function streaming(events: InvestigationEvent[]) {
  api.investigate.mockImplementation(async (_env: string, _body: unknown, onEvent: (e: InvestigationEvent) => void) => {
    for (const e of events) onEvent(e);
  });
}

const shown = vi.fn();
const hours = vi.fn();
function tab(props: Partial<Parameters<typeof InvestigateTab>[0]> = {}) {
  return render(<InvestigateTab env="mtl" unit={UNIT} several={false} metric={METRIC} kept hours={72} onHours={hours} onOff={vi.fn()} onInvestigation={shown} {...props} />);
}
const box = () => screen.getByLabelText("The only thing that goes to the web") as HTMLTextAreaElement;

async function investigated1(over: Partial<InvestigationResult> = {}, inv: Partial<Investigated> = {}) {
  streaming([...STEPS.map((s): InvestigationEvent => ({ type: "step", step: s })), { type: "done", result: result(over, inv), exchangeId: "0a1b2c3d-0000-4000-8000-000000000000" }]);
  tab();
  fireEvent.click(screen.getByRole("button", { name: /Investigate this span/ }));
  await screen.findByText("Found · 2 candidates");
}

beforeEach(() => {
  api.listInvestigations.mockResolvedValue({ investigations: [] });
});

describe("before an investigation", () => {
  it("proposes a sentence that names the unit and the dates of the span, and nothing it measured", () => {
    tab();
    expect(box().value).toMatch(/^What public health measures, closures, weather warnings, outbreaks or major incidents were reported in or around CHUM between \d{4}-\d{2}-\d{2} and \d{4}-\d{2}-\d{2}\?$/);
    expect(screen.getByText("It names the unit and the dates. None of its figures is sent.")).toBeTruthy();
  });

  it("follows the span until the person writes their own sentence, then leaves it alone", () => {
    const view = tab();
    const first = box().value;
    view.rerender(<InvestigateTab env="mtl" unit={UNIT} several={false} metric={METRIC} kept hours={720} onHours={hours} onOff={vi.fn()} />);
    expect(box().value).not.toBe(first);
    fireEvent.change(box(), { target: { value: "Was there an ice storm in Montréal?" } });
    view.rerender(<InvestigateTab env="mtl" unit={UNIT} several={false} metric={METRIC} kept hours={24} onHours={hours} onOff={vi.fn()} />);
    expect(box().value).toBe("Was there an ice storm in Montréal?");
  });

  it("changes the span through the page, which shares it with the timeline", () => {
    tab();
    fireEvent.click(screen.getByRole("button", { name: "30 d" }));
    expect(hours).toHaveBeenCalledWith(720);
    expect(screen.getByRole("button", { name: "72 h" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("says what is missing instead of offering a search that cannot be made", () => {
    tab({ unit: null });
    expect(screen.getByText(/Select a site on the map/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Investigate this span/ })).toBeNull();
    cleanup();
    tab({ unit: null, several: true });
    expect(screen.getByText(/This site counts several units/)).toBeTruthy();
    cleanup();
    tab({ kept: false });
    expect(screen.getByText(/Stretcher occupancy is counted on the spot and not kept over time/)).toBeTruthy();
  });
});

describe("an investigation at work", () => {
  it("sends the unit, the measure, the span and the sentence, and the clock days are counted on", async () => {
    await investigated1();
    const [env, body] = api.investigate.mock.calls[0]!;
    expect(env).toBe("mtl");
    expect(body.unitId).toBe(UNIT.id);
    expect(body.metric).toBe("occupancy");
    expect(body.request).toMatch(/in or around CHUM between/);
    expect(Date.parse(body.to) - Date.parse(body.from)).toBe(72 * 3_600_000);
    expect(typeof body.zone === "string" || body.zone === null).toBe(true);
  });

  it("shows each step as it lands, and where the work stands, before anything is delivered", async () => {
    let release!: () => void;
    api.investigate.mockImplementation(async (_env: string, _body: unknown, onEvent: (e: InvestigationEvent) => void) => {
      onEvent({ type: "status", message: "Reading the nearest units" });
      onEvent({ type: "step", step: SERIES });
      onEvent({ type: "step", step: CALENDAR });
      await new Promise<void>((r) => (release = r));
    });
    tab();
    fireEvent.click(screen.getByRole("button", { name: /Investigate this span/ }));

    expect(await screen.findByText("Reading the nearest units…")).toBeTruthy();
    expect(screen.getByText("2 of 7 pieces of work done")).toBeTruthy();
    expect(screen.getByText("Neighbours")).toBeTruthy();
    // The trace is open while it works: the steps are read as they are written.
    expect(screen.getByText("Series kept by the twin: occupancy at CHUM · 4 readings · 1 episode beyond the alert threshold")).toBeTruthy();
    expect(screen.getByText("Calendar of validated events, 2021-12-20 to 2022-01-10: 1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    expect(screen.queryByText(/Found ·/)).toBeNull();
    release();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Stop" })).toBeNull());
  });

  it("says what was read of the series, measured, before the events", async () => {
    await investigated1();
    expect(screen.getByText("Stretcher occupancy at CHUM")).toBeTruthy();
    expect(screen.getByText("4 readings · lowest 94% · highest 141%")).toBeTruthy();
    expect(screen.getByText("1 episode beyond the alert threshold (> 100%)")).toBeTruthy();
    expect(screen.getByText("Nearest units read: Notre-Dame (1.6 km).")).toBeTruthy();
    expect(screen.getByText("7 of 7 pieces of work done")).toBeTruthy();
  });

  it("lists each candidate in two lines: what it is, and how it sits beside the series", async () => {
    await investigated1();
    const row = screen.getByRole("listitem", { name: "Curfew across Québec" });
    expect(within(row).getByText("2021-12-31 · Goes with episode 1: it starts 2 days before.")).toBeTruthy();
    const undated = screen.getByRole("listitem", { name: "Transit strike" });
    expect(within(undated).getByText("no date · No date: it cannot be placed on the series.")).toBeTruthy();
    // Folded on arrival: the detail is one click away, not on the page.
    expect(within(row).queryByText("Published")).toBeNull();
  });

  it("opens a candidate on what was published, what was measured and the reasons to doubt, kept apart", async () => {
    await investigated1();
    const row = screen.getByRole("listitem", { name: "Curfew across Québec" });
    fireEvent.click(within(row).getByRole("button", { expanded: false }));

    expect(within(row).getByText("Published")).toBeTruthy();
    expect(within(row).getByText(/“Un couvre-feu sera en vigueur à compter du 31 décembre 2021”/)).toBeTruthy();
    expect(within(row).getAllByRole("link").every((a) => a.getAttribute("rel") === "noopener noreferrer")).toBe(true);

    expect(within(row).getByText("Measured")).toBeTruthy();
    expect(within(row).getByText("The 3 days before: 94% on average, over 3 days")).toBeTruthy();
    expect(within(row).getByText("The 3 days from its start: 102% on average, over 3 days")).toBeTruthy();
    expect(within(row).getByText("Change: +8.2 points")).toBeTruthy();
    expect(within(row).getByText(/Episode 1: 2022-01-02 to 2022-01-07, furthest at\s+141%\s+· also at Notre-Dame/)).toBeTruthy();

    expect(within(row).getByText("Reasons to doubt")).toBeTruthy();
    expect(within(row).getByText("1 other event goes with the same episode (Schools closed). The series cannot tell them apart.")).toBeTruthy();
  });

  it("sets the events already in the calendar beside the series too, and never as a cause", async () => {
    await investigated1();
    expect(screen.getByText("Already in the calendar for this span · 1")).toBeTruthy();
    expect(screen.getByText("2022-01-03 · Falls inside episode 1, which had begun 1 day earlier.")).toBeTruthy();
    expect(screen.getByText(/Nothing here establishes that one caused the other/)).toBeTruthy();
    // The search's own limit is listed with the program's.
    expect(screen.getByText("No source gave the end of the curfew.")).toBeTruthy();
    expect(screen.queryByText(/caused by|because of|explains/i)).toBeNull();
  });

  it("keeps the trace: every step of the program and of the search, and the journal's name for it", async () => {
    await investigated1();
    expect(screen.getByText(/8 steps · 1 web search · 21,900 tokens · claude-haiku-5-5\. Kept in the journal as 0a1b2c3d, every step included/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /What it read · 8 steps/ }));
    expect(screen.getByText("What goes to the web: your sentence, to 1 allowed source, in at most 8 searches. The series stays here")).toBeTruthy();
    expect(screen.getByText("Web search: “couvre-feu Québec décembre 2021” · 1 page")).toBeTruthy();
    expect(screen.getByText("Each event set beside the series: 3 events, 2 with an episode")).toBeTruthy();
    expect(screen.getByText("Check of what the search delivered: 2 candidates, nothing taken out")).toBeTruthy();
  });

  it("hands the page what it delivered, so the timeline can draw it", async () => {
    await investigated1();
    const last = shown.mock.calls.at(-1)![0];
    expect(last.unitId).toBe(UNIT.id);
    expect(last.metric).toBe("occupancy");
    expect(last.result.answer.investigation.episodes).toHaveLength(1);
    // Cleared first, when the investigation started.
    expect(shown.mock.calls[0]![0]).toBeNull();
  });

  it("says there is no series instead of showing an empty result", async () => {
    streaming([
      { type: "step", step: step("p1", "twin_series", { unit: "CHUM", measure: "occupancy" }, { valued: 0, episodes: [], alert_threshold: null }) },
      { type: "done", result: result({ status: "incomplete", answer: null, steps: [], message: "Nothing was kept for this measure at this unit over the span you gave: its history starts on 2026-11-22. No search was made. Pick a span that reaches it." }), exchangeId: "ex-2" },
    ]);
    tab();
    fireEvent.click(screen.getByRole("button", { name: /Investigate this span/ }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/its history starts on 2026-11-22\. No search was made/);
    expect(screen.queryByText(/Found ·/)).toBeNull();
    expect(shown.mock.calls.at(-1)![0]).toBeNull();
  });

  it("says so when the analyst is switched off or the stream fails", async () => {
    const off = vi.fn();
    api.investigate.mockRejectedValue(new ApiError(503, "ANALYST_NOT_CONFIGURED", "The analyst is not switched on for this server."));
    tab({ onOff: off });
    fireEvent.click(screen.getByRole("button", { name: /Investigate this span/ }));
    expect((await screen.findByRole("alert")).textContent).toBe("The analyst is not switched on for this server.");
    expect(off).toHaveBeenCalled();
    cleanup();

    streaming([{ type: "failed", message: "The analyst's model could not be reached. Try again." }]);
    tab();
    fireEvent.click(screen.getByRole("button", { name: /Investigate this span/ }));
    expect((await screen.findByRole("alert")).textContent).toBe("The analyst's model could not be reached. Try again.");
  });
});

describe("accepting or rejecting what was found", () => {
  it("accepts a candidate from the journalled investigation, on the dates on screen", async () => {
    api.acceptEvent.mockResolvedValue({ startsOn: "2021-12-31", endsOn: null });
    await investigated1();
    const row = screen.getByRole("listitem", { name: "Curfew across Québec" });
    fireEvent.click(within(row).getByRole("button", { expanded: false }));
    fireEvent.click(within(row).getByRole("button", { name: /Accept into the calendar/ }));
    await within(row).findByText(/In the calendar: 2021-12-31/);
    expect(api.acceptEvent).toHaveBeenCalledWith("mtl", { exchangeId: "0a1b2c3d-0000-4000-8000-000000000000", candidate: "c1", startsOn: "2021-12-31", endsOn: null });
  });

  it("asks for the date a passage did not state before accepting", async () => {
    await investigated1();
    const row = screen.getByRole("listitem", { name: "Transit strike" });
    fireEvent.click(within(row).getByRole("button", { expanded: false }));
    expect(within(row).getByText(/The passage does not state the start date the analyst gave, so it was taken out/)).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: /Accept into the calendar/ }));
    expect(within(row).getByRole("alert").textContent).toBe("Enter the start date from the source before accepting.");
    expect(api.acceptEvent).not.toHaveBeenCalled();
  });

  it("rejects without calling anything, and can undo", async () => {
    await investigated1();
    const row = screen.getByRole("listitem", { name: "Curfew across Québec" });
    fireEvent.click(within(row).getByRole("button", { expanded: false }));
    fireEvent.click(within(row).getByRole("button", { name: /Reject/ }));
    expect(screen.getByText("Rejected, not recorded: Curfew across Québec")).toBeTruthy();
    expect(api.acceptEvent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("listitem", { name: "Curfew across Québec" })).toBeTruthy();
  });
});

describe("the investigations kept in the journal", () => {
  const LINE: InvestigationLine = {
    id: "9f8e7d6c-0000-4000-8000-000000000000",
    askedAt: "2026-11-24T15:00:00.000Z",
    request: "What happened around CHUM between 2021-12-20 and 2022-01-10?",
    status: "answered",
    message: null,
    unit: UNIT,
    metric: "occupancy",
    from: "2021-12-20T05:00:00.000Z",
    to: "2022-01-10T05:00:00.000Z",
    candidates: 2,
    episodes: 1,
  };

  it("lists those of the selected unit, and reads one again as it was delivered", async () => {
    api.listInvestigations.mockResolvedValue({ investigations: [LINE, { ...LINE, id: "x2", status: "incomplete", message: "Nothing was kept.", candidates: 0, episodes: 0 }] });
    api.readInvestigation.mockResolvedValue({ exchangeId: LINE.id, askedAt: LINE.askedAt, request: LINE.request, result: result() });
    tab();

    fireEvent.click(await screen.findByRole("button", { name: /Kept in the journal · 2 investigations of this unit/ }));
    expect(api.listInvestigations).toHaveBeenCalledWith("mtl", UNIT.id);
    expect(screen.getByText("2 candidates · 1 episode")).toBeTruthy();
    expect(screen.getByText("Nothing was kept.")).toBeTruthy();

    fireEvent.click(screen.getByText("2 candidates · 1 episode"));
    await screen.findByText("Found · 2 candidates");
    expect(api.readInvestigation).toHaveBeenCalledWith("mtl", LINE.id);
    expect(api.investigate).not.toHaveBeenCalled();
    expect(screen.getByText(/Read again from the journal, as it was delivered on/)).toBeTruthy();
    expect(screen.getByText(LINE.request)).toBeTruthy();
    // What is read again can still be drawn, and a candidate still accepted from it.
    expect(shown.mock.calls.at(-1)![0].from).toBe(LINE.from);
    expect(screen.getByText(/Kept in the journal as 9f8e7d6c/)).toBeTruthy();
  });

  it("shows no list when the unit has none, and a new investigation does not need one", async () => {
    api.listInvestigations.mockRejectedValue(new Error("offline"));
    tab();
    await waitFor(() => expect(api.listInvestigations).toHaveBeenCalled());
    expect(screen.queryByText(/Kept in the journal ·/)).toBeNull();
    expect(screen.getByRole("button", { name: /Investigate this span/ })).toBeTruthy();
  });
});

describe("the analyst on the network map", () => {
  const panel = (open: boolean, toggle = vi.fn()) => (
    <NetworkAnalyst env="mtl" open={open} onToggle={toggle} unit={UNIT} several={false} metric={METRIC} kept hours={72} onHours={hours} />
  );

  it("is one folding panel with two tabs, and opens on Investigate", () => {
    render(panel(true));
    expect(screen.getByRole("button", { name: /Analyst\s*about CHUM/ }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Ask", "Investigate"]);
    expect(screen.getByRole("tab", { name: "Investigate" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: /Investigate this span/ })).toBeTruthy();
  });

  it("keeps an investigation while the panel is folded or the other tab is shown", async () => {
    streaming([...STEPS.map((s): InvestigationEvent => ({ type: "step", step: s })), { type: "done", result: result(), exchangeId: "ex-1" }]);
    const view = render(panel(true));
    fireEvent.click(screen.getByRole("button", { name: /Investigate this span/ }));
    await screen.findByText("Found · 2 candidates");

    fireEvent.click(screen.getByRole("tab", { name: "Ask" }));
    fireEvent.click(screen.getByRole("tab", { name: "Investigate" }));
    expect(screen.getByText("Found · 2 candidates")).toBeTruthy();

    view.rerender(panel(false));
    expect(screen.getByRole("button", { name: /Analyst\s*about CHUM/ }).getAttribute("aria-expanded")).toBe("false");
    view.rerender(panel(true));
    expect(screen.getByText("Found · 2 candidates")).toBeTruthy();
    expect(api.investigate).toHaveBeenCalledTimes(1);
  });

  it("keeps its title bar whole when folded, and shares the column when open", () => {
    const view = render(panel(false));
    const section = () => screen.getByRole("button", { name: /Analyst\s*about CHUM/ }).closest("section")!;
    // Folded, it must not shrink: an open inspector above it would squeeze its title out of sight.
    expect(section().className).toContain("shrink-0");
    view.rerender(panel(true));
    expect(section().className).not.toContain("shrink-0");
    expect(section().className).toContain("min-h-[12rem]");
  });

  it("builds nothing until it is first opened", () => {
    render(panel(false));
    expect(screen.queryByRole("tab")).toBeNull();
    expect(api.listInvestigations).not.toHaveBeenCalled();
  });
});
