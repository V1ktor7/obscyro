// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/auth";

import type { AnalystEvent, AnalystResult, AnalystStep } from "../../analyst-api";

const api = vi.hoisted(() => ({ fetchAnalyst: vi.fn(), askAnalyst: vi.fn(), listDecisions: vi.fn(), fetchWebSources: vi.fn() }));
vi.mock("../../analyst-api", async (orig) => ({ ...(await orig<typeof import("../../analyst-api")>()), ...api }));

import AnalystPanel from "./AnalystPanel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const S1: AnalystStep = {
  id: "s1",
  tool: "compare_catchments",
  input: { world: "scenario", activity: "lit" },
  ok: true,
  output: { catchments: [{ name: "West", units_per_1000_residents: 1.04 }] },
  ms: 12,
};
const S2: AnalystStep = { id: "s2", tool: "get_site", input: { world: "scenario", site: "Sacré-Cœur" }, ok: false, output: { error: "No site matches." }, ms: 1 };

function result(over: Partial<AnalystResult> = {}): AnalystResult {
  return {
    status: "answered",
    verified: true,
    struck: [],
    steps: [S1, S2],
    message: null,
    model: "claude-opus-5-5",
    usage: { requests: 3, inputTokens: 9000, outputTokens: 500 },
    answer: {
      paragraphs: [{ text: "West has 1.04 beds per 1,000 residents, the fewest.", sources: ["s1"] }],
      assumptions: ["Usual occupancy is assumed at 85 %."],
      limits: ["The twin holds no staff."],
      followUps: ["Which sites serve West?"],
      focusSites: ["f:a", "f:gone"],
    },
    ...over,
  };
}

/** Answer a question with a script of events. */
function answering(events: AnalystEvent[]) {
  api.askAnalyst.mockImplementation(async (_env: string, _body: unknown, onEvent: (e: AnalystEvent) => void) => {
    for (const e of events) onEvent(e);
  });
}

const focus = vi.fn();
function panel(props: Partial<Parameters<typeof AnalystPanel>[0]> = {}) {
  return render(
    <AnalystPanel
      env="mtl"
      scenario={{ id: "sc1", name: "Omicron" }}
      run={null}
      siteName={(id) => (id === "f:a" ? "Hôpital Alpha" : null)}
      onFocusSite={focus}
      {...props}
    />,
  );
}

beforeEach(() => {
  api.fetchAnalyst.mockResolvedValue({ configured: true, model: "claude-opus-5-5" });
  api.fetchWebSources.mockResolvedValue({ domains: ["quebec.ca"], isDefault: true, defaults: ["quebec.ca"], max: 20 });
});

describe("the analyst panel", () => {
  it("says what it will read, and that there is no run to ask about", async () => {
    panel();
    expect(screen.getByText(/The twin with “Omicron” applied · no run on screen: press Run to ask about results/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reality" }));
    expect(screen.getByText(/The twin as it stands today/)).toBeTruthy();
    // No run: no question about one is suggested.
    expect(screen.queryByRole("button", { name: "What did my choices change?" })).toBeNull();
  });

  it("shows the answer, what each paragraph rests on, and what was read", async () => {
    answering([{ type: "status", message: "Reading the question" }, { type: "step", step: S1 }, { type: "step", step: S2 }, { type: "done", result: result() }]);
    panel();
    fireEvent.change(screen.getByLabelText("Question for the analyst"), { target: { value: "Which catchment has the fewest beds?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await screen.findByText("West has 1.04 beds per 1,000 residents, the fewest.");
    expect(api.askAnalyst.mock.calls[0]![1]).toEqual({ question: "Which catchment has the fewest beds?", scenarioId: "sc1", looking: "scenario", run: null });
    expect(screen.getByText("Every figure below was found in the steps its paragraph cites.")).toBeTruthy();
    expect(screen.getByText("Usual occupancy is assumed at 85 %.")).toBeTruthy();
    expect(screen.getByText("The twin holds no staff.")).toBeTruthy();
    expect(screen.getByText(/Written by claude-opus-5-5 from 2 steps · 9,500 tokens/)).toBeTruthy();

    // The source chip opens the step it names, with what the tool returned.
    fireEvent.click(screen.getByRole("button", { name: /s1\s*compare catchments/ }));
    const trace = screen.getByRole("button", { name: /What it read · 2 steps/ }).parentElement!;
    expect(within(trace).getByText("Catchments compared on lit, with the scenario")).toBeTruthy();
    expect(within(trace).getByText(/"units_per_1000_residents": 1.04/)).toBeTruthy();
    // A refusal is shown as one, not hidden.
    expect(within(trace).getByText(/refused/)).toBeTruthy();

    // Only a site the map shows is offered; the other id is dropped.
    fireEvent.click(screen.getByRole("button", { name: "Hôpital Alpha" }));
    expect(focus).toHaveBeenCalledWith("f:a");
    expect(screen.queryByRole("button", { name: "f:gone" })).toBeNull();
  });

  it("asks the next question when a follow-up is tapped", async () => {
    answering([{ type: "done", result: result() }]);
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Which catchment is least provided for?" }));
    fireEvent.click(await screen.findByRole("button", { name: "Which sites serve West?" }));
    await waitFor(() => expect(api.askAnalyst).toHaveBeenCalledTimes(2));
    expect(api.askAnalyst.mock.calls[1]![1].question).toBe("Which sites serve West?");
  });

  it("shows where a figure was removed, and says how many", async () => {
    answering([
      {
        type: "done",
        result: result({
          verified: false,
          struck: [{ where: "paragraph", index: 0, figures: ["412"] }],
          answer: { paragraphs: [{ text: "Alpha has 100 beds and [unverified] staff.", sources: ["s1"] }], assumptions: [], limits: [], followUps: [], focusSites: [] },
        }),
      },
    ]);
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Which catchment is least provided for?" }));
    await screen.findByText(/1 figure was removed from this answer/);
    expect(screen.getByText("figure removed")).toBeTruthy();
    expect(screen.queryByText(/\[unverified\]/)).toBeNull();
    expect(screen.queryByText(/Every figure below/)).toBeNull();
  });

  it("says so when there is no answer, and keeps what was read", async () => {
    answering([{ type: "step", step: S1 }, { type: "done", result: result({ status: "declined", answer: null, verified: false, steps: [S1], message: "The model declined to answer this question." }) }]);
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Which catchment is least provided for?" }));
    await screen.findByText("The model declined to answer this question.");
    expect(screen.getByText("Catchments compared on lit, with the scenario")).toBeTruthy();
  });

  it("reports a failure after the question started", async () => {
    answering([{ type: "failed", message: "The analyst's model could not be reached. Try again." }]);
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Which catchment is least provided for?" }));
    await screen.findByText("The analyst's model could not be reached. Try again.");
  });

  it("explains what to do when the server has no key for it", async () => {
    api.askAnalyst.mockRejectedValue(new ApiError(503, "ANALYST_NOT_CONFIGURED", "The analyst is not switched on for this server."));
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Which catchment is least provided for?" }));
    await screen.findByText("The analyst is not switched on for this server.");
    expect(screen.getByText("ANTHROPIC_API_KEY")).toBeTruthy();
    expect(screen.queryByLabelText("Question for the analyst")).toBeNull();
  });

  it("does not offer a question box at all when the server says it is off", async () => {
    api.fetchAnalyst.mockResolvedValue({ configured: false, model: "claude-opus-5-5" });
    panel();
    await screen.findByText("The analyst is not switched on for this server.");
  });

  it("without a scenario there is one world and no toggle", async () => {
    answering([{ type: "done", result: result() }]);
    panel({ scenario: null });
    expect(screen.queryByRole("group", { name: "What the analyst reads" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Which catchment is least provided for?" }));
    await waitFor(() => expect(api.askAnalyst).toHaveBeenCalled());
    expect(api.askAnalyst.mock.calls[0]![1]).toMatchObject({ scenarioId: null, looking: "reality" });
  });
});

describe("an answer that rests on published events", () => {
  const CURFEW = {
    id: "e1",
    title: "Curfew across Québec",
    startsOn: "2021-12-31",
    endsOn: "2022-01-17",
    place: "Québec",
    door: "access",
    url: "https://www.quebec.ca/nouvelles/couvre-feu",
    sourceTitle: "Nouvelles mesures",
    passage: "Un couvre-feu sera en vigueur à compter du 31 décembre 2021",
  };
  const EVENTS: AnalystStep = {
    id: "s3",
    tool: "list_events",
    input: { from_day: 34, to_day: 34 },
    ok: true,
    output: { day_0_is: "2021-12-13", events: [{ title: "Curfew across Québec", from_day: 18, to_day: 35 }] },
    // The links are kept beside the result, for the screen.
    record: { events: [CURFEW, { ...CURFEW, id: "e2", title: "Not a web page", url: "javascript:alert(1)" }] },
    ms: 3,
  };
  const answered = (paragraphs: { text: string; sources: string[] }[]) =>
    answering([
      { type: "done", result: result({ steps: [S1, S2, EVENTS], answer: { paragraphs, assumptions: [], limits: [], followUps: [], focusSites: [] } }) },
    ]);

  it("carries a WEB chip with the link and the Published level, never passed off as the twin's", async () => {
    answered([
      { text: "According to quebec.ca, a curfew was in force from day 18 to day 35.", sources: ["s3"] },
      { text: "West has 1.04 beds per 1,000 residents.", sources: ["s1"] },
    ]);
    panel();
    fireEvent.click(await screen.findByRole("button", { name: "What does this scenario assume?" }));
    await screen.findByText(/According to quebec\.ca, a curfew was in force/);

    const web = screen.getByLabelText("Published sources this paragraph rests on");
    expect(within(web).getByText("Published")).toBeTruthy();
    expect(within(web).getByText(/Not measured by the twin/)).toBeTruthy();
    const link = within(web).getByRole("link");
    expect(link.getAttribute("href")).toBe("https://www.quebec.ca/nouvelles/couvre-feu");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.textContent).toMatch(/WEB\s*quebec\.ca/);
    expect(link.getAttribute("title")).toMatch(/Curfew across Québec — “Un couvre-feu/);
    // An address that is not a web page is shown, and is not a link.
    expect(within(web).getAllByText("WEB").length).toBe(2);
    expect(within(web).getAllByRole("link").length).toBe(1);
    // The paragraph read from the twin has no such row.
    expect(screen.getAllByLabelText("Published sources this paragraph rests on").length).toBe(1);
    // The step itself reads in a planner's words.
    fireEvent.click(screen.getByRole("button", { name: /What it read · 3 steps/ }));
    expect(screen.getByText("Validated events from official sources, days 34 to 34 of the run: 1")).toBeTruthy();
  });
});

describe("the analyst's tabs", () => {
  const tabs = () => screen.getAllByRole("tab").map((t) => [t.textContent, t.getAttribute("aria-selected")]);

  it("opens on Ask, and keeps what was asked when another tab is visited", async () => {
    answering([{ type: "done", result: result() }]);
    panel();
    expect(tabs()).toEqual([["Ask", "true"], ["Event finder", "false"], ["Options", "false"], ["Decisions", "false"]]);
    fireEvent.click(await screen.findByRole("button", { name: "What does this scenario assume?" }));
    await screen.findByText(/West has 1.04 beds/);

    fireEvent.click(screen.getByRole("tab", { name: "Options" }));
    expect(tabs()).toEqual([["Ask", "false"], ["Event finder", "false"], ["Options", "true"], ["Decisions", "false"]]);
    expect(screen.getByLabelText("Objective for the options")).toBeTruthy();
    expect(screen.getByText(/Tested on “Omicron” over 60 days/)).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Ask" }));
    expect(screen.getByText(/West has 1.04 beds/)).toBeTruthy();
  });

  it("offers a search of official sources over the scenario's own dates", async () => {
    panel({ period: { origin: "2021-12-13", horizon: 60 } });
    fireEvent.click(screen.getByRole("tab", { name: "Event finder" }));
    expect(screen.getByLabelText("What to look for in official sources")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^What public health measures were in force in \[place\] between 2021-12-13 and 2022-02-10\?$/ })).toBeTruthy();
    expect(await screen.findByText(/Sources searched \(starting list\):/)).toBeTruthy();
  });

  it("offers nothing to test when the server has no key, but still lists decisions", async () => {
    api.fetchAnalyst.mockResolvedValue({ configured: false, model: "claude-opus-5-5" });
    api.listDecisions.mockResolvedValue({ decisions: [] });
    panel();
    await screen.findByText("The analyst is not switched on for this server.");
    fireEvent.click(screen.getByRole("tab", { name: "Options" }));
    expect(screen.queryByLabelText("Objective for the options")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Event finder" }));
    expect(screen.queryByLabelText("What to look for in official sources")).toBeNull();
    // A decision is a record, not an answer: it reads without the model.
    fireEvent.click(screen.getByRole("tab", { name: "Decisions" }));
    expect(await screen.findByText("No decision recorded in this project yet.")).toBeTruthy();
  });
});
