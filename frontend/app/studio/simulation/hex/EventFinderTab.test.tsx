// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/auth";

import type { AnalystStep, EventCandidate, EventsEvent, EventsResult, HealthEvent } from "../../analyst-api";

const api = vi.hoisted(() => ({ findEvents: vi.fn(), acceptEvent: vi.fn(), fetchWebSources: vi.fn(), saveWebSources: vi.fn() }));
vi.mock("../../analyst-api", async (orig) => ({ ...(await orig<typeof import("../../analyst-api")>()), ...api }));

import EventFinderTab from "./EventFinderTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const PASSAGE = {
  step: "s2",
  url: "https://www.quebec.ca/nouvelles/couvre-feu",
  title: "Nouvelles mesures pour freiner la transmission",
  text: "Un couvre-feu sera en vigueur à compter du 31 décembre 2021, de 22 h à 5 h, partout au Québec.",
};
const SEARCH: AnalystStep = {
  id: "s1",
  tool: "web_search",
  input: { query: "couvre-feu Québec décembre 2021" },
  ok: true,
  output: { results: [{ url: PASSAGE.url, title: PASSAGE.title, page_age: null }] },
  ms: 0,
};
const CITED: AnalystStep = { id: "s2", tool: "web_passage", input: { url: PASSAGE.url }, ok: true, output: { url: PASSAGE.url, title: PASSAGE.title, cited_text: PASSAGE.text }, ms: 0 };

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
const SCHOOLS = curfew({
  id: "c2",
  title: "Schools closed",
  startDate: null,
  datesRemoved: ["start"],
  url: "https://www.quebec.ca/education",
  sourceTitle: "",
  quote: "les écoles demeureront fermées",
});

const REQUEST = "What measures were in force in Montréal between 2021-12-01 and 2022-02-28?";

function result(over: Partial<EventsResult> = {}): EventsResult {
  return {
    status: "answered",
    verified: true,
    struck: [],
    steps: [SEARCH, CITED],
    message: null,
    model: "claude-opus-5-5",
    usage: { requests: 2, inputTokens: 21000, outputTokens: 900, webSearches: 1 },
    answer: { request: REQUEST, sources: ["quebec.ca"], searches: 1, candidates: [curfew(), SCHOOLS], notFound: ["No source gave the end of the curfew."], limits: [] },
    ...over,
  };
}

function finding(events: EventsEvent[]) {
  api.findEvents.mockImplementation(async (_env: string, _body: unknown, onEvent: (e: EventsEvent) => void) => {
    for (const e of events) onEvent(e);
  });
}

const accepted = vi.fn();
function tab(props: Partial<Parameters<typeof EventFinderTab>[0]> = {}) {
  return render(<EventFinderTab env="mtl" scenario={{ id: "sc1", name: "Omicron" }} period={null} onAccepted={accepted} onOff={vi.fn()} {...props} />);
}

async function searched(over: Partial<EventsResult> = {}) {
  finding([{ type: "step", step: SEARCH }, { type: "step", step: CITED }, { type: "done", result: result(over), exchangeId: "ex-1" }]);
  tab();
  fireEvent.change(screen.getByLabelText("What to look for in official sources"), { target: { value: REQUEST } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await screen.findByText("Curfew across Québec");
}

beforeEach(() => {
  api.fetchWebSources.mockResolvedValue({ domains: ["inspq.qc.ca", "quebec.ca"], isDefault: true, defaults: ["inspq.qc.ca", "quebec.ca"], max: 20 });
});

describe("the event finder", () => {
  it("sends the request and nothing of the twin, the scenario's recipe or the run", async () => {
    await searched();
    expect(api.findEvents.mock.calls[0]!.slice(0, 2)).toEqual(["mtl", { request: REQUEST, scenarioId: "sc1" }]);
    expect(screen.getByText(/Only your request goes into a search: nothing from the twin, the scenario or a run is sent/)).toBeTruthy();
    expect(screen.getByText(/Written by claude-opus-5-5 from 2 steps · 1 web search · 21,900 tokens/)).toBeTruthy();
  });

  it("shows each candidate as a published proposal, with its link and its quoted passage", async () => {
    await searched();
    expect(screen.getByText(/Each candidate is a proposal\s+until you accept it/)).toBeTruthy();
    const card = screen.getByRole("listitem", { name: "Curfew across Québec" });
    expect(within(card).getByText("Published")).toBeTruthy();
    expect(within(card).getByText("Access")).toBeTruthy();
    expect(within(card).getByText(/“Un couvre-feu sera en vigueur à compter du 31 décembre 2021”/)).toBeTruthy();
    const links = within(card).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([PASSAGE.url, PASSAGE.url]);
    expect(links[0]!.textContent).toMatch(/WEB\s*quebec\.ca/);
    expect(links.every((a) => a.getAttribute("rel") === "noopener noreferrer")).toBe(true);
    expect(screen.getByText("No source gave the end of the curfew.")).toBeTruthy();

    // The search and the passage it was cited to are steps like any other reading.
    fireEvent.click(screen.getByRole("button", { name: /What it read · 2 steps/ }));
    expect(screen.getByText("Web search: “couvre-feu Québec décembre 2021” · 1 page")).toBeTruthy();
    expect(screen.getByText("Passage cited from quebec.ca")).toBeTruthy();
  });

  it("accepts a candidate by naming it, with the dates the person validated", async () => {
    const event = { id: "e1", startsOn: "2021-12-31", endsOn: "2022-01-17" } as HealthEvent;
    api.acceptEvent.mockResolvedValue(event);
    await searched();
    const card = screen.getByRole("listitem", { name: "Curfew across Québec" });
    expect((within(card).getByLabelText("Starts") as HTMLInputElement).value).toBe("2021-12-31");
    // The passage gave no end: the person read the source and adds it.
    fireEvent.change(within(card).getByLabelText("Ends"), { target: { value: "2022-01-17" } });
    expect(within(card).getByText(/You changed the dates\. Proposed: 2021-12-31\. Both are kept\./)).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "Accept" }));

    await within(card).findByText(/In the calendar: 2021-12-31 to 2022-01-17/);
    // No title, no link, no passage: the server copies those from its journal.
    expect(api.acceptEvent).toHaveBeenCalledWith("mtl", { exchangeId: "ex-1", candidate: "c1", startsOn: "2021-12-31", endsOn: "2022-01-17" });
    expect(accepted).toHaveBeenCalledWith(event);
    expect(within(card).queryByRole("button", { name: "Accept" })).toBeNull();
  });

  it("rejects a candidate without telling anyone", async () => {
    await searched();
    const card = screen.getByRole("listitem", { name: "Curfew across Québec" });
    fireEvent.click(within(card).getByRole("button", { name: "Reject" }));
    expect(screen.getByText("Rejected, not recorded: Curfew across Québec")).toBeTruthy();
    expect(api.acceptEvent).not.toHaveBeenCalled();
    expect(accepted).not.toHaveBeenCalled();
    // A rejection is a click on this screen and nothing else: it can be taken back.
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("listitem", { name: "Curfew across Québec" })).toBeTruthy();
    expect(screen.getByText(/a rejected one is recorded nowhere/)).toBeTruthy();
  });

  it("asks for the date a passage did not state before it lets a candidate in", async () => {
    api.acceptEvent.mockResolvedValue({ id: "e2", startsOn: "2021-12-20", endsOn: null } as HealthEvent);
    await searched({ verified: false, struck: [{ where: "start_date", candidate: 1, index: 0, figures: ["2021-12-21"] }] });
    expect(screen.getByText(/1 thing the analyst wrote could not be found in the passages and\s+was taken out/)).toBeTruthy();
    const card = screen.getByRole("listitem", { name: "Schools closed" });
    expect(within(card).getByText(/The passage does not state the start date the analyst gave, so it was taken out/)).toBeTruthy();
    expect((within(card).getByLabelText("Starts") as HTMLInputElement).value).toBe("");

    fireEvent.click(within(card).getByRole("button", { name: "Accept" }));
    expect(within(card).getByRole("alert").textContent).toBe("Enter the start date from the source before accepting.");
    expect(api.acceptEvent).not.toHaveBeenCalled();

    fireEvent.change(within(card).getByLabelText("Starts"), { target: { value: "2021-12-20" } });
    fireEvent.click(within(card).getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(api.acceptEvent).toHaveBeenCalledWith("mtl", { exchangeId: "ex-1", candidate: "c2", startsOn: "2021-12-20", endsOn: null }));
  });

  it("refuses an end before its start, and shows what the server refused", async () => {
    api.acceptEvent.mockRejectedValue(new ApiError(400, "NOT_A_CANDIDATE", "\"c1\" is not a candidate this search delivered."));
    await searched();
    const card = screen.getByRole("listitem", { name: "Curfew across Québec" });
    fireEvent.change(within(card).getByLabelText("Ends"), { target: { value: "2021-12-01" } });
    fireEvent.click(within(card).getByRole("button", { name: "Accept" }));
    expect(within(card).getByRole("alert").textContent).toBe("The event ends before it starts. Correct the dates.");
    expect(api.acceptEvent).not.toHaveBeenCalled();

    fireEvent.change(within(card).getByLabelText("Ends"), { target: { value: "" } });
    fireEvent.click(within(card).getByRole("button", { name: "Accept" }));
    expect((await within(card).findByRole("alert")).textContent).toBe("\"c1\" is not a candidate this search delivered.");
    expect(accepted).not.toHaveBeenCalled();
  });

  it("says when a quotation is the passage's own words and not the analyst's", async () => {
    await searched({ answer: { request: REQUEST, sources: ["quebec.ca"], searches: 1, candidates: [curfew({ quoteReplaced: true })], notFound: [], limits: [] } });
    expect(screen.getByText(/The analyst’s quotation was not in the passage/)).toBeTruthy();
  });

  it("says so when nothing was found, and makes nothing up", async () => {
    finding([{ type: "done", result: result({ answer: { request: REQUEST, sources: ["quebec.ca"], searches: 3, candidates: [], notFound: ["No allowed source returned a curfew."], limits: [] } }), exchangeId: "ex-1" }]);
    tab();
    fireEvent.change(screen.getByLabelText("What to look for in official sources"), { target: { value: REQUEST } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText(/No candidate event was found in the allowed sources\. Nothing was made up in its place\./)).toBeTruthy();
    expect(screen.getByText("No allowed source returned a curfew.")).toBeTruthy();
  });

  it("suggests a request over the scenario's own dates, and waits for the place before searching", async () => {
    tab({ period: { origin: "2021-12-13", horizon: 60 } });
    fireEvent.click(screen.getByRole("button", { name: "What public health measures were in force in [place] between 2021-12-13 and 2022-02-10?" }));
    const box = screen.getByLabelText("What to look for in official sources") as HTMLTextAreaElement;
    expect(box.value).toMatch(/in \[place\] between 2021-12-13 and 2022-02-10/);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByText("Replace [place] and [date] with the place and the dates you mean.")).toBeTruthy();
    expect(api.findEvents).not.toHaveBeenCalled();
  });

  it("shows the sources the search is restricted to, and lets the project change them", async () => {
    api.saveWebSources.mockResolvedValue({ domains: ["quebec.ca", "montreal.ca"], isDefault: false, defaults: ["inspq.qc.ca", "quebec.ca"], max: 20 });
    tab();
    expect(await screen.findByText(/Sources searched \(starting list\):/)).toBeTruthy();
    expect(screen.getByText(/inspq\.qc\.ca, quebec\.ca\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.change(screen.getByLabelText(/Sources the search may use/), { target: { value: "quebec.ca\nmontreal.ca\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.saveWebSources).toHaveBeenCalledWith("mtl", ["quebec.ca", "montreal.ca"]));
    expect(await screen.findByText(/quebec\.ca, montreal\.ca\./)).toBeTruthy();
    expect(screen.queryByText(/starting list\)/)).toBeNull();
  });

  it("shows why a list of sources was refused", async () => {
    api.saveWebSources.mockRejectedValue(new ApiError(400, "WEB_SOURCE_INVALID", "\"*.quebec.ca\" is not a domain."));
    tab();
    fireEvent.click(await screen.findByRole("button", { name: "Change" }));
    fireEvent.change(screen.getByLabelText(/Sources the search may use/), { target: { value: "*.quebec.ca" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toBe("\"*.quebec.ca\" is not a domain.");
  });
});
