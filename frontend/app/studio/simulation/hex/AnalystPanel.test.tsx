// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/auth";

import type { AnalystEvent, AnalystResult, AnalystStep } from "../../analyst-api";

const api = vi.hoisted(() => ({ fetchAnalyst: vi.fn(), askAnalyst: vi.fn() }));
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
