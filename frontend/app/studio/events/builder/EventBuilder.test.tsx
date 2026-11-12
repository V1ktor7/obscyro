// @vitest-environment jsdom

/**
 * The builder, used the way a person uses it: pick a change, say how much,
 * name the event, save. What reaches `onSave` is what the engine will run.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SimEffect, SimEvent, SimExport, SimTarget } from "@/lib/platform-api";
import EventBuilder from "./EventBuilder";

afterEach(cleanup);

const TARGETS: SimTarget[] = [
  { path: "resource.capacity", label: "Capacity", help: "", selector: ["facility", "category", "activity"], ops: ["multiply", "add", "set"], compose: "baseline", minimum: 0, maximum: null, unit: "units" },
];

/** Two regions far apart, as in the builder's own tests: nothing here is Montréal. */
function snapshot(): SimExport {
  const res = (activity: string, capacity: number) => ({ [activity]: { id: activity, category: "space" as const, quantity: capacity, capacity, enables: [activity] } });
  return {
    environment: "test", scenario_id: null, generated_at: "2026-11-12T00:00:00Z",
    facilities: [
      { id: "north", name: "Hôpital du Nord", location: [48.45, -68.52], resources: res("lit", 200), census: {} },
      { id: "south", name: "Hôpital du Sud", location: [45.40, -71.89], resources: res("lit", 300), census: {} },
    ],
    objects: [
      { id: "p1", type: "Protocole", role: null, properties: { severite: "urgence", ressource: "civiere", sejour: 0.8 }, at: null },
      { id: "p2", type: "Protocole", role: null, properties: { severite: "hospitalisation", ressource: "lit", sejour: 7 }, at: null },
    ],
    object_types: [{ name: "Protocole", role: null, properties: [
      { key: "severite", type: "string", label: null, unit: null, min: null, max: null, behaviour: "state", mechanic: "serves_severity" },
      { key: "ressource", type: "string", label: null, unit: null, min: null, max: null, behaviour: "state", mechanic: "consumes_activity" },
      { key: "sejour", type: "number", label: null, unit: null, min: 0, max: null, behaviour: "level", mechanic: "occupies_for" },
    ] }],
    object_rules: { unavailable_keys: ["status"], unavailable_values: ["occupied"] },
    populations: [
      { id: "rimouski", name: "Rimouski", size: 50000, served_by: ["north"] },
      { id: "sherbrooke", name: "Sherbrooke", size: 170000, served_by: ["south"] },
    ],
    edges: [], gaps: [],
  } as unknown as SimExport;
}

function builder(initial: SimEvent | null = null) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<EventBuilder env="test" snapshot={snapshot()} targets={TARGETS} initial={initial} twinScenarioId={null} onSave={onSave} onDelete={null} onClose={vi.fn()} />);
  return { onSave };
}
const saved = (onSave: ReturnType<typeof vi.fn>) => (onSave.mock.calls[0]![0] as { effects: SimEffect[] }).effects;

describe("writing an event", () => {
  it("cannot be saved without a name or a change", () => {
    builder();
    expect((screen.getByRole("button", { name: "Create event" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Name the event.")).toBeTruthy();
  });

  it("turns “drops by 30 %” into a multiply by 0.7", async () => {
    const { onSave } = builder();
    fireEvent.click(screen.getByRole("button", { name: /Add a change/ }));
    fireEvent.change(screen.getByRole("searchbox", { name: "What changes?" }), { target: { value: "capacity" } });
    fireEvent.click(screen.getByRole("button", { name: /Capacity of lit/ }));
    // A new change does nothing until it is given a number, and says so.
    expect(screen.getAllByText(/changes nothing yet/).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Amount" }), { target: { value: "30" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Event name" }), { target: { value: "Wing closed" } });
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [e] = saved(onSave);
    expect(e).toMatchObject({ target: "resource.capacity", op: "multiply", value: 0.7, select: { activity: ["lit"] } });
    // Both hospitals hold beds, 500 in all: the line says what that becomes.
    expect(screen.getAllByText(/500 → 350/).length).toBeGreaterThan(0);
  });

  it("sends an exposure as arrival changes that carry the helper's inputs", async () => {
    const { onSave } = builder();
    fireEvent.click(screen.getByRole("button", { name: /Add a change/ }));
    fireEvent.change(screen.getByRole("searchbox", { name: "What changes?" }), { target: { value: "smoke" } });
    fireEvent.click(screen.getAllByRole("button", { name: /Asthma ER visits/ })[0]!);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Rise" }), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: /usual rate of asthma ER visits… what is it/ }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Usual rate" }), { target: { value: "0.0137" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Event name" }), { target: { value: "Smoke" } });
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const effects = saved(onSave);
    expect(effects.length).toBeGreaterThan(0);
    expect(effects.every((e) => e.target === "demand.incidence" && e.builder?.kind === "exposure")).toBe(true);
    expect(effects[0]!.builder!.inputs).toMatchObject({ coef: "smoke-asthma-er" });
    // Every territory, and the severity read off the care protocols.
    expect(effects[0]!.select.acuity).toEqual(["urgence"]);
  });

  it("reopens a saved helper as the one line it was", () => {
    const x: SimEffect[] = [
      { id: "smoke-asthma-1-a", target: "demand.incidence", select: { acuity: ["urgence"] }, op: "add", value: 0.002, profile: { start: 5, end: 6, shape: "step", peak: 1 },
        builder: { group: "smoke-asthma-1", kind: "exposure", inputs: { coef: "smoke-asthma-er", start: 5, days: 2, rise: { mode: "same", value: 50, series: "", usual: null, episode: null }, base: { value: 0.0137, unit: "day1000", source: "test" } } } },
      { id: "smoke-asthma-1-b", target: "demand.incidence", select: { acuity: ["urgence"] }, op: "add", value: 0.001, profile: { start: 7, end: 7, shape: "step", peak: 1 }, builder: { group: "smoke-asthma-1", kind: "exposure" } },
    ];
    builder({ id: "e1", name: "Smoke", description: "", horizon: 60, effects: x, twinScenarioId: null, createdAt: "", updatedAt: "" });
    const list = screen.getByText("What happens").closest("section")!;
    expect(within(list).getAllByRole("button", { name: /PM2\.5 → asthma ER visits/ })).toHaveLength(1);
  });
});
