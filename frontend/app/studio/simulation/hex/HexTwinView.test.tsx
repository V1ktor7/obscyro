// @vitest-environment jsdom

/**
 * The Scenarios page, driven the way a planner drives it: open a scenario that
 * holds conditions, run it, read where it breaks, look at one site, check it
 * against what was observed. The map itself is stubbed — it needs WebGL — and
 * everything around it is the real page, the real translation to the engine
 * and the real reading of what the engine sends back.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { forwardRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SimExport } from "@/lib/platform-api";
import type { ScenarioOverride } from "../../scenarios-api";

const api = vi.hoisted(() => ({
  fetchSimExport: vi.fn(),
  fetchTwinTree: vi.fn(),
  listGeoShapes: vi.fn(),
  listTwinMetrics: vi.fn(),
  listSimEvents: vi.fn(),
  runSimulation: vi.fn(),
  runSpread: vi.fn(),
  saveSimEvent: vi.fn(),
  fetchObservedSeries: vi.fn(),
}));
const scenarios = vi.hoisted(() => ({
  listOverlayScenarios: vi.fn(),
  listScenarioOverrides: vi.fn(),
  addScenarioOverride: vi.fn(),
  deleteScenarioOverride: vi.fn(),
  createOverlayScenario: vi.fn(),
  updateOverlayScenario: vi.fn(),
}));

vi.mock("@/lib/platform-api", async (orig) => ({ ...(await orig<typeof import("@/lib/platform-api")>()), ...api }));
vi.mock("../../scenarios-api", () => scenarios);
vi.mock("../../StudioShell", () => ({ useStudio: () => ({ hasKey: true, selectedEnv: "mtl" }) }));
vi.mock("../../datasets-api", () => ({ listDatasets: vi.fn().mockResolvedValue({ datasets: [] }) }));
vi.mock("./layers-api", () => ({ listTwinLayers: vi.fn().mockResolvedValue({ layers: [] }) }));
vi.mock("./AddDataPanel", () => ({ default: () => null }));
vi.mock("./HexGlobe", () => ({
  default: forwardRef(function Globe() {
    return <div data-testid="globe" />;
  }),
  GlobeControls: () => null,
}));

import HexTwinView from "./HexTwinView";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const EXPORT = {
  environment: "mtl",
  scenario_id: null,
  generated_at: "",
  facilities: [
    { id: "f:a", name: "Hôpital Alpha", location: [45.5, -73.6], census: {}, resources: { lit: { id: "lit", category: "space", quantity: 100, capacity: 100, enables: ["lit"] }, civiere: { id: "civiere", category: "space", quantity: 10, capacity: 10, enables: ["civiere"] } } },
    { id: "f:b", name: "Hôpital Beta", location: [45.6, -73.5], census: {}, resources: { lit: { id: "lit", category: "space", quantity: 40, capacity: 40, enables: ["lit"] } } },
  ],
  object_types: [
    { name: "Transition", role: null, properties: [
      { key: "de", mechanic: "leaves_state" }, { key: "vers", mechanic: "enters_state" }, { key: "pousse", mechanic: "driven_by_state" },
      { key: "voie", mechanic: "couples_along" }, { key: "devient", mechanic: "produces_demand" },
    ] },
    { name: "Protocole", role: null, properties: [{ key: "severite", mechanic: "serves_severity" }, { key: "ressource", mechanic: "consumes_activity" }] },
  ],
  objects: [
    { id: "t1", type: "Transition", role: null, at: null, properties: { de: "sain", vers: "malade", pousse: "malade", voie: "ecole" } },
    { id: "t2", type: "Transition", role: null, at: null, properties: { de: "malade", vers: "retabli_hospitalise", devient: "hospitalisation" } },
    { id: "t3", type: "Transition", role: null, at: null, properties: { de: "malade", vers: "retabli" } },
    { id: "p1", type: "Protocole", role: null, at: null, properties: { severite: "hospitalisation", ressource: "lit" } },
  ],
  object_rules: { unavailable_keys: [], unavailable_values: [] },
  populations: [
    { id: "pop:w", name: "West", size: 1000, served_by: ["f:a"] },
    { id: "pop:e", name: "East", size: 3000, served_by: ["f:b"] },
  ],
  edges: [],
  gaps: [],
} as unknown as SimExport;

let seq = 0;
function override(key: string, value: unknown, start = 0, days = 60): ScenarioOverride {
  seq += 1;
  return {
    id: `o${seq}`, scenarioId: "sc1", seq, targetType: "param", targetId: null, targetLocalKey: key, op: "set_param",
    payload: { key, value }, effectiveOffsetHours: start * 24, durationHours: days * 24, note: null,
  };
}

function overrides(): ScenarioOverride[] {
  seq = 0;
  return [
    override("stamp:1", { kind: "seed", at: { lat: 45.5, lon: -73.6 }, population: "pop:w", count: 50 }, 0, 1),
    override("stamp:2", { kind: "occupancy", activity: "lit", share: 0.85 }),
    override("stamp:3", { kind: "immunity", share: 0.8 }),
    override("stamp:4", { kind: "variant", factor: 3.5 }),
    override("stamp:5", { kind: "capacity", facility: "f:b", activity: "lit", amount: 20 }, 10, 50),
    override("reality", { datasetId: "d1", datasetName: "INSPQ — Admissions", when: "date", value: "admissions_hopital", origin: "2021-12-13", acuity: "hospitalisation" }),
  ];
}

/** Sixty days: Beta is full with a queue from day 5 in the events-only run; the added beds end it. */
function simulation(withBeds: boolean) {
  const facilities: Array<Array<string | number>> = [];
  const steps: Array<Array<string | number>> = [];
  for (let t = 0; t < 60; t++) {
    facilities.push(["null", t, "f:a", "Hôpital Alpha", "lit", 0.9, 0]);
    facilities.push(["null", t, "f:a", "Hôpital Alpha", "civiere", 0.2, 0]);
    const queue = t >= 5 && !(withBeds && t >= 10) ? 12 : 0;
    facilities.push(["null", t, "f:b", "Hôpital Beta", "lit", t >= 5 ? 1 : 0.9, queue]);
    steps.push(["null", t, 0, 0, 10 + t, 10, 0]);
  }
  return {
    event: { id: "e", name: "e" }, rows: [], facilities: 2, horizon: 60, activities: ["lit", "civiere"], weights: {},
    datasets: [
      { name: "facilities", label: "", description: "", columns: ["policy", "step", "facility_id", "facility", "activity", "occupancy", "waiting"], rows: facilities },
      { name: "steps", label: "", description: "", columns: ["policy", "step", "deaths", "cost", "arrived_hospitalisation", "served_hospitalisation", "unmet_hospitalisation"], rows: steps },
    ],
  };
}

beforeEach(() => {
  api.fetchSimExport.mockResolvedValue(EXPORT);
  api.listGeoShapes.mockResolvedValue({ shapes: [] });
  api.listTwinMetrics.mockResolvedValue({ metrics: [] });
  api.fetchTwinTree.mockResolvedValue({ nodes: [], edges: [], roots: [] });
  api.listSimEvents.mockResolvedValue({ events: [] });
  api.saveSimEvent.mockImplementation(async (_env: string, body: { name: string }) => ({ id: body.name.includes("events only") ? "ev-events" : "ev-full" }));
  api.runSpread.mockResolvedValue({ event: { effects: [] }, states: [], vocabulary: { states: [], couplings: [] }, populations: [], gaps: [], saved: null });
  api.runSimulation.mockImplementation(async (_env: string, body: { eventId: string }) => simulation(body.eventId === "ev-full"));
  api.fetchObservedSeries.mockResolvedValue({
    dataset: { id: "d1", name: "INSPQ — Admissions" }, series: Array.from({ length: 60 }, (_, t) => 12 + t), reported: 60,
    fit: { n: 60, meanAbsoluteError: 2, peakSimulated: { step: 59, value: 69 }, peakObserved: { step: 59, value: 71 }, peakOffset: 0, correlation: 0.99 },
  });
  scenarios.listOverlayScenarios.mockResolvedValue({ scenarios: [{ id: "sc1", projectId: "p", name: "Omicron", description: null, parentScenarioId: null, baseAsOf: null, status: "draft", createdAt: "", overrideCount: 6 }] });
  scenarios.listScenarioOverrides.mockImplementation(async () => ({ overrides: overrides(), issues: [] }));
  scenarios.addScenarioOverride.mockResolvedValue({ id: "new" });
  scenarios.deleteScenarioOverride.mockResolvedValue({ deleted: true });
});

async function opened() {
  render(<HexTwinView />);
  await screen.findByTestId("globe");
  // The scenario holds beds, so the page opens on beds rather than on stretchers.
  await waitFor(() => expect((screen.getByLabelText("Capacity read") as HTMLSelectElement).value).toBe("lit"));
}

describe("a scenario with starting conditions", () => {
  it("runs both variants from the usual occupancy, the prior immunity and the variant", async () => {
    await opened();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(api.runSimulation).toHaveBeenCalledTimes(2));

    for (const call of api.runSimulation.mock.calls) {
      expect(call[1]).toMatchObject({ baselineOccupancy: { lit: 0.85 }, collect: ["facilities", "steps"], policies: ["null"] });
    }
    for (const call of api.runSpread.mock.calls) {
      expect(call[1].seeds).toEqual({ "pop:w": { sain: 150, malade: 50, retabli: 800 }, "pop:e": { sain: 600, retabli: 2400 } });
      expect(call[1].changes).toEqual([{ layer: "ecole", factor: 3.5, fromStep: 0, toStep: null }]);
    }
    // The added beds travel in the planner's run only.
    const saved = api.saveSimEvent.mock.calls.map((c) => c[1] as { name: string; effects: { target: string }[] });
    expect(saved.find((e) => e.name.endsWith("events only"))!.effects.some((e) => e.target === "resource.capacity")).toBe(false);
    expect(saved.find((e) => e.name.endsWith("with your measures"))!.effects.some((e) => e.target === "resource.capacity")).toBe(true);
  });

  it("says where it breaks in each run, and shows one site's own curve", async () => {
    await opened();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    const heading = await screen.findByText(/Where it breaks/);
    const panel = heading.parentElement!;
    // Beta queues 12 a day from day 5: to the end without the beds (55 days), to day 9 with them (5 days).
    expect(within(panel).getAllByText("1 of 2 sites")).toHaveLength(2);
    expect(within(panel).getByText("660 patient-days waiting")).toBeTruthy();
    expect(within(panel).getByText("60 patient-days waiting")).toBeTruthy();
    expect(within(panel).getByText(/Your choices spare 600 patient-days of waiting \(91 %\)/)).toBeTruthy();

    const row = within(panel).getByRole("button", { name: /Hôpital Beta/ });
    expect(row.textContent).toContain("from day 5");
    fireEvent.click(row);
    // The timeline opens on that site, and can go back.
    const back = await screen.findByRole("button", { name: "Back to every site" });
    expect(screen.getByRole("img", { name: /Occupancy of lit at Hôpital Beta/ })).toBeTruthy();
    fireEvent.click(back);
    expect(screen.getByRole("img", { name: /Occupancy of lit at every site/ })).toBeTruthy();
  });

  it("reads the run against the observed series the scenario names", async () => {
    await opened();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await screen.findByText(/Reality check · hospitalisation arrivals a day/);
    await waitFor(() => expect(api.fetchObservedSeries.mock.calls.some((c) => Array.isArray(c[1].simulated))).toBe(true));
    const withRun = api.fetchObservedSeries.mock.calls.find((c) => Array.isArray(c[1].simulated))![1];
    expect(withRun).toMatchObject({ datasetId: "d1", when: "date", value: "admissions_hopital", origin: "2021-12-13", horizon: 60 });
    // The engine's own count of arrivals, day by day.
    expect(withRun.simulated.slice(0, 3)).toEqual([10, 11, 12]);
    await waitFor(() => expect(screen.getAllByText(/2 a day off on average over 60 days, peak on the same day/).length).toBe(2));
    expect(screen.getByText(/day 0 is Dec 13, 2021/)).toBeTruthy();
  });

  it("replaces a condition when it is set again, rather than stacking a second one", async () => {
    await opened();
    fireEvent.click(screen.getByRole("button", { name: "Starting conditions" }));
    fireEvent.change(screen.getByLabelText("Already immune"), { target: { value: "83" } });
    const set = screen.getByLabelText("Already immune").parentElement!;
    fireEvent.click(within(set).getByRole("button", { name: "Set" }));
    await waitFor(() => expect(scenarios.addScenarioOverride).toHaveBeenCalled());
    const [id, body] = scenarios.addScenarioOverride.mock.calls[0]!;
    expect(id).toBe("sc1");
    expect(body.payload.value).toEqual({ kind: "immunity", share: 0.83 });
    expect(body.note).toBe("83 % already immune, everywhere");
    // The earlier 80 % is the third override the scenario listed.
    await waitFor(() => expect(scenarios.deleteScenarioOverride).toHaveBeenCalledWith("sc1", "o3"));
  });

  it("lists the conditions first in the recipe, and offers no day to move them to", async () => {
    await opened();
    fireEvent.click(screen.getByRole("button", { name: /Recipe/ }));
    const usual = await screen.findByRole("button", { name: /Usual occupancy: 85 % of lit already in use/ });
    fireEvent.click(usual);
    expect(screen.getByText(/"baselineOccupancy"/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "+ 1 day" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
  });
});
