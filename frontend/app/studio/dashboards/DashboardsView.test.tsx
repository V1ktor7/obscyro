// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * The two destructive moments on this screen.
 *
 * Both used to be native dialogs. `window.prompt` and `window.confirm` cannot
 * be styled, cannot say what they are about to destroy, and are the one part of
 * a screen that cannot be shown to anybody — which for a tool whose whole claim
 * is "everything is reachable from the interface" is the wrong place to stop.
 */

const api = vi.hoisted(() => ({
  listDashboards: vi.fn(),
  readDashboard: vi.fn(),
  createDashboard: vi.fn(),
  deleteDashboard: vi.fn(),
  listChartable: vi.fn(),
  listDashboardSources: vi.fn(),
  addCard: vi.fn(),
  deleteCard: vi.fn(),
  moveCard: vi.fn(),
}));

vi.mock("../dashboards-api", () => api);
vi.mock("../StudioShell", () => ({
  useStudio: () => ({ hasKey: true, selectedEnv: "montreal" }),
}));

import DashboardsView from "./DashboardsView";

const BOARD = {
  id: "11111111-1111-1111-1111-111111111111",
  projectId: "p",
  name: "Urgences",
  description: "",
  cardCount: 3,
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
};

// Auto-cleanup only happens with `globals: true`, which this project does not
// set. Without it each render stacks on the last and every query finds two.
afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  api.listDashboards.mockResolvedValue({ dashboards: [] });
  api.readDashboard.mockResolvedValue({ dashboard: BOARD, cards: [] });
  api.listChartable.mockResolvedValue({ datasets: [] });
  api.listDashboardSources.mockResolvedValue(NO_SOURCES);
});

/** A project with nothing but tables: no twin, no runs, no models. */
const NO_SOURCES = {
  metrics: [],
  scenarios: [],
  runs: [],
  forecasters: [],
  sitesWithCoordinates: 0,
};

describe("naming a new dashboard", () => {
  it("asks in the page, not in a browser dialog", async () => {
    const prompt = vi.spyOn(window, "prompt");
    const user = userEvent.setup();
    render(<DashboardsView />);

    await user.click(await screen.findByTitle("New dashboard"));
    expect(await screen.findByLabelText("Dashboard name")).toBeTruthy();
    expect(prompt).not.toHaveBeenCalled();
  });

  it("creates the board with what was typed", async () => {
    api.createDashboard.mockResolvedValue({ ...BOARD, name: "Capacité", cardCount: 0 });
    const user = userEvent.setup();
    render(<DashboardsView />);

    await user.click(await screen.findByTitle("New dashboard"));
    await user.type(await screen.findByLabelText("Dashboard name"), "Capacité");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(api.createDashboard).toHaveBeenCalledWith("montreal", { name: "Capacité" }),
    );
  });

  it("refuses to create one with a blank name", async () => {
    const user = userEvent.setup();
    render(<DashboardsView />);

    await user.click(await screen.findByTitle("New dashboard"));
    await user.type(await screen.findByLabelText("Dashboard name"), "   ");
    expect((screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("closes the field on Escape without creating anything", async () => {
    const user = userEvent.setup();
    render(<DashboardsView />);

    await user.click(await screen.findByTitle("New dashboard"));
    await user.type(await screen.findByLabelText("Dashboard name"), "x{Escape}");

    await waitFor(() => expect(screen.queryByLabelText("Dashboard name")).toBeNull());
    expect(api.createDashboard).not.toHaveBeenCalled();
  });
});

describe("deleting a dashboard", () => {
  beforeEach(() => {
    api.listDashboards.mockResolvedValue({ dashboards: [BOARD] });
  });

  it("does not delete on the first click", async () => {
    const user = userEvent.setup();
    render(<DashboardsView />);

    await user.click(await screen.findByRole("button", { name: "Delete" }));
    expect(api.deleteDashboard).not.toHaveBeenCalled();
  });

  it("names what it is about to destroy", async () => {
    // A native confirm cannot do this, which is the whole reason it went.
    const user = userEvent.setup();
    render(<DashboardsView />);

    await user.click(await screen.findByRole("button", { name: "Delete" }));
    // The board's name also sits in the rail, so the assertion is on the
    // button: it is the button that has to say what it destroys.
    const confirm = await screen.findByRole("button", { name: /Delete “/ });
    expect(confirm.textContent).toMatch(/Urgences/);
    expect(confirm.textContent).toMatch(/3 cards/);
  });

  it("deletes on the second click", async () => {
    api.deleteDashboard.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<DashboardsView />);

    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await user.click(await screen.findByRole("button", { name: /Delete “/ }));

    await waitFor(() => expect(api.deleteDashboard).toHaveBeenCalledWith(BOARD.id));
  });
});

describe("what the empty board says", () => {
  it("points at the picker rather than showing a blank page", async () => {
    api.listDashboards.mockResolvedValue({ dashboards: [BOARD] });
    render(<DashboardsView />);
    expect(await screen.findByText(/This dashboard is empty/)).toBeTruthy();
  });

  it("says the values are read now, not stored", async () => {
    // The claim the whole design rests on, made on the screen itself.
    api.listDashboards.mockResolvedValue({ dashboards: [BOARD] });
    render(<DashboardsView />);
    expect(await screen.findByText(/read now, not stored/)).toBeTruthy();
  });
});

describe("the picker's catalogue", () => {
  it("is read again every time the drawer opens", async () => {
    // Cached for the life of the page, it went stale: a dataset imported or
    // corrected while the tab was open stayed invisible, and the picker went on
    // offering chart types for data that had since changed.
    api.listDashboards.mockResolvedValue({ dashboards: [BOARD] });
    const user = userEvent.setup();
    render(<DashboardsView />);

    await user.click(await screen.findByRole("button", { name: "Add a card" }));
    await waitFor(() => expect(api.listChartable).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(await screen.findByRole("button", { name: "Add a card" }));
    await waitFor(() => expect(api.listChartable).toHaveBeenCalledTimes(2));
  });

  it("does not read it before the drawer is opened", async () => {
    // Two hundred rows of every dataset in the project is not a page load.
    api.listDashboards.mockResolvedValue({ dashboards: [BOARD] });
    render(<DashboardsView />);
    await screen.findByText(/This dashboard is empty/);
    expect(api.listChartable).not.toHaveBeenCalled();
  });
});

/**
 * The three families that do not read a table.
 *
 * Each one can be offered on a project that has nothing to point it at, and
 * each one then draws an empty rectangle that reads as an empty network. So the
 * picker says what is missing, in the place the options would have been.
 */
describe("building a card from something other than a table", () => {
  const SOURCES = {
    metrics: [{ key: "occupancy", label: "Occupation", unit: "percent" }],
    scenarios: [
      { id: "sc1", name: "Vague hiver", predictedUnits: 12, properties: ["lits_occupes"] },
    ],
    runs: [
      {
        id: "run-1",
        scenarioId: "sc1",
        scenarioName: "Vague hiver",
        createdAt: "2026-03-01T00:00:00.000Z",
        horizonDays: 60,
        steps: [0, 4, 9],
      },
    ],
    forecasters: [
      {
        id: "m1",
        name: "Admissions 7j",
        target: "admissions",
        datasetName: "MSSS",
        mase: 0.62,
      },
    ],
    sitesWithCoordinates: 22,
  };

  beforeEach(() => {
    api.listDashboards.mockResolvedValue({ dashboards: [BOARD] });
    api.listDashboardSources.mockResolvedValue(SOURCES);
  });

  async function openPicker(user: ReturnType<typeof userEvent.setup>, family: string) {
    render(<DashboardsView />);
    await user.click(await screen.findByRole("button", { name: "Add a card" }));
    await user.click(await screen.findByRole("button", { name: family }));
  }

  it("says what is missing rather than offering a map with nothing to place", async () => {
    api.listDashboardSources.mockResolvedValue({ ...SOURCES, sitesWithCoordinates: 0 });
    const user = userEvent.setup();
    await openPicker(user, "Twin");
    expect(await screen.findByText(/carries coordinates/)).toBeTruthy();
  });

  it("offers only the days an execution actually recorded", async () => {
    // A run stores threshold breaches, not a reading per site per day. Offering
    // 0 to the horizon lets somebody freeze the map on a day the run never
    // spoke about, and the empty result reads as a calm network.
    const user = userEvent.setup();
    await openPicker(user, "Twin");
    await user.selectOptions(await screen.findByLabelText(/Metric/), "occupancy");
    await user.click(screen.getByRole("button", { name: /A day of a run/ }));
    await user.selectOptions(await screen.findByLabelText(/Run/), "run-1");

    const days = (await screen.findByLabelText(/Day —/)) as HTMLSelectElement;
    expect(Array.from(days.options).map((o) => o.textContent)).toEqual([
      "Choose…",
      "Day 0",
      "Day 4",
      "Day 9",
    ]);
  });

  it("sends a frozen map with the run and the day it was given", async () => {
    api.addCard.mockResolvedValue({});
    const user = userEvent.setup();
    await openPicker(user, "Twin");
    await user.selectOptions(await screen.findByLabelText(/Metric/), "occupancy");
    await user.click(screen.getByRole("button", { name: /A day of a run/ }));
    await user.selectOptions(await screen.findByLabelText(/Run/), "run-1");
    await user.selectOptions(await screen.findByLabelText(/Day —/), "4");
    await user.type(screen.getByLabelText("Title"), "Occupation au jour 4");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(api.addCard).toHaveBeenCalled());
    expect(api.addCard.mock.calls[0]![1]).toMatchObject({
      kind: "map",
      sourceKind: "twin",
      config: { metric: "occupancy", state: "run", runId: "run-1", step: 4 },
    });
  });

  it("refuses to add a frozen map with no day chosen", async () => {
    const user = userEvent.setup();
    await openPicker(user, "Twin");
    await user.selectOptions(await screen.findByLabelText(/Metric/), "occupancy");
    await user.click(screen.getByRole("button", { name: /A day of a run/ }));
    await user.selectOptions(await screen.findByLabelText(/Run/), "run-1");
    await user.type(screen.getByLabelText("Title"), "Sans jour");
    expect((screen.getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("asks for an observed series only when the run is being compared to one", async () => {
    const user = userEvent.setup();
    await openPicker(user, "Simulation");
    await user.selectOptions(await screen.findByLabelText(/Run/), "run-1");
    expect(screen.queryByLabelText(/Observed dataset/)).toBeNull();

    await user.click(screen.getByRole("checkbox", { name: /Compare against an observed series/ }));
    expect(await screen.findByLabelText(/Observed dataset/)).toBeTruthy();
  });

  it("sends a trajectory card with the measure it was given", async () => {
    api.addCard.mockResolvedValue({});
    const user = userEvent.setup();
    await openPicker(user, "Simulation");
    await user.selectOptions(await screen.findByLabelText(/Run/), "run-1");
    await user.selectOptions(screen.getByLabelText(/Trajectory/), "isolationDemand");
    await user.type(screen.getByLabelText("Title"), "Isolement");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(api.addCard).toHaveBeenCalled());
    expect(api.addCard.mock.calls[0]![1]).toMatchObject({
      kind: "series",
      sourceKind: "simulation",
      sourceId: "run-1",
      config: { measure: "isolationDemand" },
    });
  });

  it("warns before a model that does not beat repeating the last value is boarded", async () => {
    api.listDashboardSources.mockResolvedValue({
      ...SOURCES,
      forecasters: [{ ...SOURCES.forecasters[0], mase: 1.3 }],
    });
    const user = userEvent.setup();
    await openPicker(user, "Model");
    await user.selectOptions(await screen.findByLabelText(/^Model/), "m1");
    expect(await screen.findByText(/adds nothing/)).toBeTruthy();
  });

  it("says where to go when there is no forecaster at all", async () => {
    api.listDashboardSources.mockResolvedValue({ ...SOURCES, forecasters: [] });
    const user = userEvent.setup();
    await openPicker(user, "Model");
    expect(await screen.findByText(/Forecast tab/)).toBeTruthy();
  });

  it("offers the properties a run wrote, not the twin's metric keys", async () => {
    // A metric is computed over instances; a prediction is a property written
    // onto one. Offering "Occupation" here would build a card that looks
    // configured and finds nothing on every site.
    const user = userEvent.setup();
    await openPicker(user, "Twin");
    await user.click(screen.getByRole("button", { name: /Prediction/ }));
    await user.selectOptions(await screen.findByLabelText(/Branch/), "sc1");

    const props = (await screen.findByLabelText(/Predicted property/)) as HTMLSelectElement;
    expect(Array.from(props.options).map((o) => o.value)).toEqual(["", "lits_occupes"]);
    expect(screen.queryByLabelText(/^Metric/)).toBeNull();
  });

  it("forgets the choice when crossing into the prediction vocabulary", async () => {
    const user = userEvent.setup();
    await openPicker(user, "Twin");
    await user.selectOptions(await screen.findByLabelText(/Metric/), "occupancy");
    await user.click(screen.getByRole("button", { name: /Prediction/ }));
    await user.click(screen.getByRole("button", { name: /^Now/ }));
    expect((screen.getByLabelText(/Metric/) as HTMLSelectElement).value).toBe("");
  });

  it("keeps it between now and a day of a run, which read the same metrics", async () => {
    // Clearing here would be friction with no reason: both states colour by a
    // twin metric.
    const user = userEvent.setup();
    await openPicker(user, "Twin");
    await user.selectOptions(await screen.findByLabelText(/Metric/), "occupancy");
    await user.click(screen.getByRole("button", { name: /A day of a run/ }));
    expect((screen.getByLabelText(/Metric/) as HTMLSelectElement).value).toBe("occupancy");
  });
});
