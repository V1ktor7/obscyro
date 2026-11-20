// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/auth";

import type { AnalystStep, OptionFigures, OptionsEvent, OptionsProposal, OptionsResult, ProposedOption, RunDigest } from "../../analyst-api";

const api = vi.hoisted(() => ({ proposeOptions: vi.fn(), recordDecision: vi.fn() }));
vi.mock("../../analyst-api", async (orig) => ({ ...(await orig<typeof import("../../analyst-api")>()), ...api }));

import OptionsTab from "./OptionsTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const figures = (over: Partial<OptionFigures> = {}): OptionFigures => ({
  peakOccupancy: 0.941,
  peakDay: 24,
  sitesWithQueue: 8,
  sitesWithActivity: 34,
  firstQueueDay: 12,
  waitingDays: 7316.4,
  peakWaiting: 410,
  peakWaitingDay: 27,
  strandedWaitingDays: null,
  ...over,
});

const option = (over: Partial<ProposedOption> = {}): ProposedOption => ({
  step: "s2",
  label: "Open 40 beds at Lakeshore from day 10",
  stamps: [{ body: { kind: "capacity", facility: "f:lake", activity: "lit", amount: 40 }, start: 10, days: 50 }],
  figures: figures({ peakOccupancy: 0.93, sitesWithQueue: 3, firstQueueDay: 15, waitingDays: 267 }),
  sites: [],
  basis: [
    { element: "+40 lit at Lakeshore from day 10, open and staffed", evidence: "assumption", from: "option" },
    { element: "Lakeshore holds 234 lit today", evidence: "measured", from: "twin" },
  ],
  arrivals: { hospitalisation: [1, 2, 3] },
  notes: [],
  mechanism: "The west's patients can only go to Lakeshore, so beds there are the only ones they reach.",
  notTested: ["Whether 40 beds can be staffed."],
  ...over,
});

const TEST: AnalystStep = { id: "s2", tool: "test_option", input: { label: "Open 40 beds at Lakeshore from day 10" }, ok: true, output: { option: "Open 40 beds at Lakeshore from day 10" }, ms: 4200 };
const READ: AnalystStep = { id: "s1", tool: "read_run", input: { part: "sites" }, ok: true, output: {}, ms: 3 };

function proposal(over: Partial<OptionsProposal> = {}): OptionsProposal {
  return {
    objective: "Nobody should wait at Lakeshore.",
    horizon: 60,
    activity: "lit",
    asItIs: figures(),
    options: [option(), option({ step: "s3", label: "Open 80 beds at Lakeshore from day 5", figures: figures({ sitesWithQueue: 0, firstQueueDay: null, waitingDays: 0, peakOccupancy: 0.9 }) })],
    basis: [
      { element: "34 sites provide lit, 4,120 units in all", evidence: "measured", from: "twin" },
      { element: "Heat wave, days 20 to 23: +0.08 urgence arrivals per 1,000 residents per day (INRS–INSPQ, hottest days in Québec)", evidence: "published", from: "scenario" },
      { element: "Usual occupancy: 85 % of lit already in use at every site", evidence: "assumption", from: "scenario" },
    ],
    reading: [{ text: "Only the second option ends the queue at Lakeshore.", sources: ["s2"] }],
    humanChoices: ["Twice the beds for the last of the waiting."],
    limits: ["The twin holds no staff."],
    focusSites: ["f:lake", "f:gone"],
    ...over,
  };
}

function result(over: Partial<OptionsResult> = {}): OptionsResult {
  return {
    status: "answered",
    verified: true,
    struck: [],
    steps: [READ, TEST],
    message: null,
    model: "claude-opus-5-5",
    usage: { requests: 5, inputTokens: 30000, outputTokens: 2000 },
    answer: proposal(),
    ...over,
  };
}

function proposing(events: OptionsEvent[]) {
  api.proposeOptions.mockImplementation(async (_env: string, _body: unknown, onEvent: (e: OptionsEvent) => void) => {
    for (const e of events) onEvent(e);
  });
}

const RUN = {
  horizon: 60,
  activity: "lit",
  stale: false,
  ranAt: "",
  sites: [
    { id: "f:a", name: "Alpha", capacity: 100, full: { firstDay: 20, waitingDays: 40 }, events: {}, daily: null },
    { id: "f:lake", name: "Lakeshore", capacity: 234, full: { firstDay: 12, waitingDays: 900 }, events: {}, daily: null },
    { id: "f:b", name: "Beta", capacity: 50, full: { firstDay: null, waitingDays: 0 }, events: {}, daily: null },
  ],
} as unknown as RunDigest;

const add = vi.fn();
const recorded = vi.fn();
const focus = vi.fn();
const off = vi.fn();
function tab(props: Partial<Parameters<typeof OptionsTab>[0]> = {}) {
  return render(
    <OptionsTab
      env="mtl"
      scenario={{ id: "sc1", name: "Omicron" }}
      run={null}
      horizon={60}
      activity="lit"
      scenarioKey="k1"
      siteName={(id) => (id === "f:lake" ? "Lakeshore" : null)}
      onFocusSite={focus}
      onAdd={add}
      onRecorded={recorded}
      onOff={off}
      {...props}
    />,
  );
}

async function tested(events: OptionsEvent[] = [{ type: "done", result: result(), exchangeId: "ex-1" }], props: Partial<Parameters<typeof OptionsTab>[0]> = {}) {
  proposing(events);
  const view = tab(props);
  fireEvent.change(screen.getByLabelText("Objective for the options"), { target: { value: "Nobody should wait at Lakeshore." } });
  fireEvent.click(screen.getByRole("button", { name: "Test options" }));
  await waitFor(() => expect(api.proposeOptions).toHaveBeenCalled());
  return view;
}

describe("the options tab", () => {
  it("says what an option is tested on, and offers objectives drawn from the run on screen", () => {
    tab({ run: RUN });
    expect(screen.getByText(/Tested on “Omicron” over 60 days, reading lit/)).toBeTruthy();
    expect(screen.getByText(/Nothing is added to the scenario until you add it/)).toBeTruthy();
    // The site that waits the most in the run, not the first in the list.
    expect(screen.getByRole("button", { name: "Nobody should wait at Lakeshore." })).toBeTruthy();
  });

  it("needs a scenario: an option is something added to one", () => {
    tab({ scenario: null });
    expect(screen.getByText("Options are tested on a scenario.")).toBeTruthy();
    expect(screen.queryByLabelText("Objective for the options")).toBeNull();
  });

  it("sends the objective with the page's own horizon and activity", async () => {
    await tested(undefined, { run: RUN, horizon: 90, activity: "civiere" });
    const [env, body] = api.proposeOptions.mock.calls[0]!;
    expect(env).toBe("mtl");
    expect(body).toMatchObject({ objective: "Nobody should wait at Lakeshore.", scenarioId: "sc1", horizon: 90, activity: "civiere" });
    expect(body.run).toBe(RUN);
  });

  it("shows the scenario as it is beside each tested option, in the engine's own counts", async () => {
    await tested();
    const table = await screen.findByRole("table", { name: "The scenario as it is beside each tested option" });
    const cells = (name: string) =>
      within(within(table).getByRole("row", { name: new RegExp(`^${name}`) }))
        .getAllByRole("cell")
        .map((c) => c.textContent);
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["", "As it is", "Option A", "Option B"]);
    expect(cells("Peak occupancy")).toEqual(["94 %day 24", "93 %day 24", "90 %day 24"]);
    expect(cells("Sites with a queue")).toEqual(["8 of 34", "3 of 34", "0 of 34"]);
    expect(cells("Patient-days waiting")).toEqual(["7,316", "267", "0"]);
    expect(cells("First day somebody waits")).toEqual(["day 12", "day 15", "nobody waits"]);
    // Said where the figures are: these are runs, in the order tested, and nothing ranks them.
    expect(screen.getByText(/Tested by the engine · 60 days · lit · not a forecast/)).toBeTruthy();
    expect(screen.getByText(/In the order tested; nothing here ranks them/)).toBeTruthy();
    expect(screen.getByText(/The table is the engine’s own counts, and every figure in the text was found/)).toBeTruthy();
  });

  it("gives each thing an option rests on its level of evidence, and keeps the three apart", async () => {
    await tested();
    const a = await screen.findByRole("region", { name: /^Option A: Open 40 beds/ });
    expect(within(a).getByText(/only go to Lakeshore/)).toBeTruthy();
    const items = within(a).getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toContain("Assumption+40 lit at Lakeshore from day 10, open and staffed");
    expect(items).toContain("MeasuredLakeshore holds 234 lit today");
    expect(items).toContain("Whether 40 beds can be staffed.");

    // What every column shares is one click away, with all three levels.
    fireEvent.click(screen.getByRole("button", { name: /What every column rests on · 3/ }));
    expect(screen.getByText(/^34 sites provide lit/).previousSibling?.textContent).toBe("Measured");
    expect(screen.getByText(/^Heat wave/).previousSibling?.textContent).toBe("Published");
    expect(screen.getByText(/^Usual occupancy/).previousSibling?.textContent).toBe("Assumption");
  });

  it("leaves the trade-offs to the person, and says so", async () => {
    await tested();
    expect(await screen.findByText(/Yours to weigh · the tool does not settle these/)).toBeTruthy();
    expect(screen.getByText("Twice the beds for the last of the waiting.")).toBeTruthy();
    expect(screen.getByText("The twin holds no staff.")).toBeTruthy();
    // A site the map shows can be pointed at; one it does not is left out.
    fireEvent.click(screen.getByRole("button", { name: "Lakeshore" }));
    expect(focus).toHaveBeenCalledWith("f:lake");
  });

  it("adds an option to the scenario only on a click, and says what Run should then show", async () => {
    add.mockResolvedValue(undefined);
    await tested();
    const a = await screen.findByRole("region", { name: /^Option A/ });
    expect(add).not.toHaveBeenCalled();
    fireEvent.click(within(a).getByRole("button", { name: "Add to scenario" }));
    await within(a).findByRole("button", { name: "Added to the scenario" });
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0]![0]).toMatchObject({ step: "s2", stamps: [{ body: { kind: "capacity", facility: "f:lake", activity: "lit", amount: 40 }, start: 10, days: 50 }] });
    expect(within(a).getByText(/Press Run: the result should show the figures of this column/)).toBeTruthy();
    // It cannot be added twice.
    expect((within(a).getByRole("button", { name: "Added to the scenario" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says what an option replaces or removes, in the server's words, and applies rather than adds", async () => {
    add.mockResolvedValue(undefined);
    const fewer = option({
      label: "40 beds at Lakeshore instead of 60",
      retires: [{ id: "st-60", stamp: { body: { kind: "capacity", facility: "f:lake", activity: "lit", amount: 60 }, start: 10, days: 50 }, text: "+60 lit at Lakeshore from day 10", replacedBy: 0 }],
      changes: [{ does: "replaces", now: "+40 lit at Lakeshore from day 10", was: "+60 lit at Lakeshore from day 10" }],
      basis: [
        { element: "+40 lit at Lakeshore from day 10, open and staffed", evidence: "assumption", from: "option" },
        { element: "Takes out of the scenario: +60 lit at Lakeshore from day 10", evidence: "assumption", from: "option" },
      ],
    });
    const without = option({
      step: "s3",
      label: "Without the school closure",
      stamps: [],
      retires: [{ id: "st-school", stamp: { body: { kind: "measure" }, start: 8, days: 10 }, text: "Schools closed in Centre, days 8 to 17", replacedBy: null }],
      changes: [{ does: "removes", now: null, was: "Schools closed in Centre, days 8 to 17" }],
    });
    await tested([{ type: "done", result: result({ answer: proposal({ options: [fewer, without] }) }), exchangeId: "ex-1" }]);

    const a = await screen.findByRole("region", { name: /^Option A: 40 beds at Lakeshore instead of 60/ });
    expect(within(a).getByText("What it does to the scenario")).toBeTruthy();
    expect(within(a).getAllByRole("listitem").map((li) => li.textContent)).toContain("Replaces +60 lit at Lakeshore from day 10 with +40 lit at Lakeshore from day 10");
    // Taking a choice out is one of the things the option rests on, with its level.
    expect(within(a).getAllByRole("listitem").map((li) => li.textContent)).toContain("AssumptionTakes out of the scenario: +60 lit at Lakeshore from day 10");
    const b = screen.getByRole("region", { name: /^Option B: Without the school closure/ });
    expect(within(b).getAllByRole("listitem").map((li) => li.textContent)).toContain("Removes Schools closed in Centre, days 8 to 17");

    // "Add" would be the wrong word: it takes a choice out.
    expect(within(a).queryByRole("button", { name: "Add to scenario" })).toBeNull();
    fireEvent.click(within(a).getByRole("button", { name: "Apply to scenario" }));
    await within(a).findByRole("button", { name: "Applied to the scenario" });
    // The page is handed what to take out, by the id the test named.
    expect(add.mock.calls[0]![0]).toMatchObject({ step: "s2", retires: [{ id: "st-60", replacedBy: 0 }] });
    expect(within(a).getByText(/in place of the choices it replaced or removed\. Press Run/)).toBeTruthy();

    // And the table says its columns are not all additions.
    expect(screen.getByText(/a choice of the scenario replaced or removed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /What every column rests on/ }));
    expect(screen.getByText(/is in “As it is” and not in that option’s column/)).toBeTruthy();
  });

  it("writes nothing and says why when a choice the option replaces is gone from the scenario", async () => {
    add.mockRejectedValue(new Error("the scenario no longer holds “+60 lit at Lakeshore from day 10”, which this option replaces. Nothing was written. State the objective again to test against the scenario as it is now."));
    const fewer = option({
      label: "40 beds at Lakeshore instead of 60",
      retires: [{ id: "st-60", stamp: { body: { kind: "capacity" }, start: 10, days: 50 }, text: "+60 lit at Lakeshore from day 10", replacedBy: 0 }],
      changes: [{ does: "replaces", now: "+40 lit at Lakeshore from day 10", was: "+60 lit at Lakeshore from day 10" }],
    });
    await tested([{ type: "done", result: result({ answer: proposal({ options: [fewer] }) }), exchangeId: "ex-1" }]);
    const a = await screen.findByRole("region", { name: /^Option A/ });
    fireEvent.click(within(a).getByRole("button", { name: "Apply to scenario" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "“40 beds at Lakeshore instead of 60” was not applied: the scenario no longer holds “+60 lit at Lakeshore from day 10”, which this option replaces. Nothing was written. State the objective again to test against the scenario as it is now.",
    );
    // Still to do: the button did not turn into "Applied".
    expect(within(a).getByRole("button", { name: "Apply to scenario" })).toBeTruthy();
  });

  it("shows no list of changes for an option that only adds: its card already says what it adds", async () => {
    await tested([
      { type: "done", result: result({ answer: proposal({ options: [option({ changes: [{ does: "adds", now: "+40 lit at Lakeshore from day 10", was: null }], retires: [] })] }) }), exchangeId: "ex-1" },
    ]);
    const a = await screen.findByRole("region", { name: /^Option A/ });
    expect(within(a).queryByText("What it does to the scenario")).toBeNull();
    expect(within(a).getByRole("button", { name: "Add to scenario" })).toBeTruthy();
  });

  it("says so when the scenario was edited elsewhere after the tests", async () => {
    const view = await tested();
    await screen.findByRole("table");
    expect(screen.queryByText(/The scenario was edited since these options were tested/)).toBeNull();
    view.rerender(
      <OptionsTab env="mtl" scenario={{ id: "sc1", name: "Omicron" }} run={null} horizon={60} activity="lit" scenarioKey="k2" siteName={() => null} onFocusSite={focus} onAdd={add} onRecorded={recorded} onOff={off} />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/The scenario was edited since these options were tested/);
  });

  it("tells an option it added itself from an edit made elsewhere, and from two options added together", async () => {
    // The page writes the stamps, and the recipe it reads back has a new key.
    const view = await tested();
    const writes = (key: string) =>
      add.mockImplementationOnce(async () => {
        view.rerender(
          <OptionsTab env="mtl" scenario={{ id: "sc1", name: "Omicron" }} run={null} horizon={60} activity="lit" scenarioKey={key} siteName={() => null} onFocusSite={focus} onAdd={add} onRecorded={recorded} onOff={off} />,
        );
      });
    const a = await screen.findByRole("region", { name: /^Option A/ });
    const b = screen.getByRole("region", { name: /^Option B/ });

    writes("k1+a");
    fireEvent.click(within(a).getByRole("button", { name: "Add to scenario" }));
    await within(a).findByRole("button", { name: "Added to the scenario" });
    // Not a warning: this is what the test was for.
    expect(screen.getByText(/“Open 40 beds at Lakeshore from day 10” is now in the scenario: Run should give the figures of its column/)).toBeTruthy();
    expect(screen.queryByText(/The scenario was edited since/)).toBeNull();

    writes("k1+a+b");
    fireEvent.click(within(b).getByRole("button", { name: "Add to scenario" }));
    await within(b).findByRole("button", { name: "Added to the scenario" });
    expect(screen.getByRole("alert").textContent).toMatch(/2 options are now in the scenario together. No test covered them together/);

    // Taken out of the recipe again: the scenario is the one that was tested, and both can be added afresh.
    view.rerender(
      <OptionsTab env="mtl" scenario={{ id: "sc1", name: "Omicron" }} run={null} horizon={60} activity="lit" scenarioKey="k1" siteName={() => null} onFocusSite={focus} onAdd={add} onRecorded={recorded} onOff={off} />,
    );
    await waitFor(() => expect(within(a).getByRole("button", { name: "Add to scenario" })).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/is now in the scenario/)).toBeNull();
  });

  it("records a decision by naming the exchange and the step, and sends no figure", async () => {
    api.recordDecision.mockResolvedValue({ id: "d1" });
    await tested();
    const b = await screen.findByRole("region", { name: /^Option B/ });
    fireEvent.click(within(b).getByRole("button", { name: "Record decision" }));
    await within(b).findByRole("button", { name: "Decision recorded" });
    expect(api.recordDecision).toHaveBeenCalledWith("mtl", { exchangeId: "ex-1", step: "s3" });
    expect(recorded).toHaveBeenCalledTimes(1);
    expect(within(b).getByText(/Kept under Decisions, with these figures as what is expected/)).toBeTruthy();
  });

  it("says why when a click could not be carried out", async () => {
    add.mockRejectedValue(new Error("No scenario is open to add it to."));
    api.recordDecision.mockRejectedValue(new ApiError(404, "EXCHANGE_NOT_FOUND", "That test is not in this project's journal."));
    await tested();
    const a = await screen.findByRole("region", { name: /^Option A/ });
    fireEvent.click(within(a).getByRole("button", { name: "Add to scenario" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/was not added: No scenario is open/);
    fireEvent.click(within(a).getByRole("button", { name: "Record decision" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/not recorded: That test is not in this project's journal/));
    expect(within(a).getByRole("button", { name: "Add to scenario" })).toBeTruthy();
  });

  it("cannot record from a test the server did not journal", async () => {
    await tested([{ type: "done", result: result() }]);
    const a = await screen.findByRole("region", { name: /^Option A/ });
    expect((within(a).getByRole("button", { name: "Record decision" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows where a figure was removed from the text, and that the table is not affected", async () => {
    await tested([
      {
        type: "done",
        exchangeId: "ex-1",
        result: result({
          verified: false,
          struck: [{ where: "mechanism", option: "s2", index: 0, figures: ["45"] }],
          answer: proposal({ options: [option({ mechanism: "It frees [unverified] beds a day." })] }),
        }),
      },
    ]);
    expect((await screen.findByText(/1 figure was removed from the text/)).textContent).toMatch(/The table is the engine’s own counts and is not affected/);
    expect(screen.getByText("figure removed")).toBeTruthy();
  });

  it("shows the tests as they run, and no table when nothing was delivered", async () => {
    await tested([
      { type: "status", message: "Testing an option in the engine" },
      { type: "step", step: TEST },
      { type: "done", result: result({ status: "incomplete", answer: null, message: "The analyst read for too long without delivering options.", steps: [TEST] }) },
    ]);
    expect((await screen.findByRole("alert")).textContent).toMatch(/read for too long/);
    expect(screen.queryByRole("table")).toBeNull();
    // What was tested is still there to read.
    expect(screen.getByText(/Option tested in the engine: Open 40 beds at Lakeshore from day 10/)).toBeTruthy();
  });

  it("reports a failure of the engine or the model, and switches off with the server", async () => {
    await tested([{ type: "failed", message: "The simulation service could not be reached, so no option could be tested." }]);
    expect((await screen.findByRole("alert")).textContent).toMatch(/no option could be tested/);
    cleanup();

    api.proposeOptions.mockRejectedValue(new ApiError(503, "ANALYST_NOT_CONFIGURED", "The analyst is not switched on for this server."));
    tab();
    fireEvent.click(screen.getByRole("button", { name: "Push back the first day somebody waits." }));
    await waitFor(() => expect(off).toHaveBeenCalled());
  });
});
