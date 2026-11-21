/**
 * The page and the server give the same figures for the same scenario.
 *
 * The analyst tests an option by running the scenario on the server
 * (`backend/src/services/scenario-run.ts`), and a person who adds that option
 * to the scenario and presses Run must see the figures the test showed. The two
 * run the scenario with their own code, so the agreement is held here: the
 * fixture is a recording of the real engine — what a run asks of it, what it
 * answers, the summary that comes out — and this test replays it through the
 * page's `runScenario` and `runDigest`. The server's test
 * (`backend/src/services/scenario-run.unit.test.ts`) replays the same file.
 *
 * The page reaches the engine through three routes of the API, the server goes
 * straight to it, so what each sends is compared in a form that belongs to
 * neither: the seeds, the measures, the effects, the starting occupancy.
 *
 * Regenerate the fixture with `backend/scripts/make-scenario-run-fixture.ts`
 * when the engine or the translation changes, then run both suites.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SimDataset, SimEffect, SimExport } from "@/lib/platform-api";

import type { RunDigest } from "../../analyst-api";
import type { ScenarioOverride } from "../../scenarios-api";

const api = vi.hoisted(() => ({
  listSimEvents: vi.fn(),
  runSimulation: vi.fn(),
  runSpread: vi.fn(),
  saveSimEvent: vi.fn(),
}));
vi.mock("@/lib/platform-api", async (orig) => ({ ...(await orig<typeof import("@/lib/platform-api")>()), ...api }));

import { runScenario } from "./engine";
import { runDigest } from "./run-digest";
import { stampFromOverride, twinContext, type Stamp } from "./stamps";

interface RecordedCall {
  call: "spread" | "simulate";
  request: Record<string, unknown>;
  response: { effects?: SimEffect[]; datasets?: SimDataset[] };
}
interface Recorded {
  overrides: ScenarioOverride[];
  calls: RecordedCall[];
  digest: RunDigest;
}

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../../../backend/src/services/scenario-run-parity.fixture.json", import.meta.url)), "utf8"),
) as {
  twin: SimExport;
  scenario: { id: string; name: string };
  horizon: number;
  activity: string;
  ranAt: string;
  asItIs: Recorded;
  withOption: Recorded;
  withReplacement: Recorded & { retired: string[]; added: ScenarioOverride[] };
  /** A recorded response the organisation wrote, placed on a day: a transfer of patients. */
  withResponse: Recorded & { added: ScenarioOverride[] };
  /** A response the engine writes itself from the network. */
  withBuiltIn: Recorded & { added: ScenarioOverride[] };
};

const ctx = twinContext(fixture.twin);

/** The stamps as the page holds them after reading a scenario's overrides. */
const stampsOf = (overrides: ScenarioOverride[]): Stamp[] =>
  overrides
    .map(stampFromOverride)
    .filter((s): s is Stamp => s !== null)
    .sort((a, b) => a.start - b.start);

/**
 * The API, answering from the recording, and noting what it was asked in the
 * recording's own form: a spread as the route receives it, a run as the stored
 * event and the run's settings together.
 */
function replay(recorded: RecordedCall[]) {
  const asked: { call: string; request: unknown }[] = [];
  const events = new Map<string, { horizon: number; effects: SimEffect[] }>();
  let next = 0;
  const answer = (call: RecordedCall["call"], request: unknown) => {
    asked.push({ call, request });
    const r = recorded[next++];
    if (!r || r.call !== call) throw new Error(`The page made a ${call} call the recording does not hold at position ${next}.`);
    return r.response;
  };
  api.listSimEvents.mockResolvedValue({ events: [] });
  api.runSpread.mockImplementation(async (_env: string, body: { seeds: unknown; horizon: number; changes: Record<string, unknown>[]; twinScenarioId?: string }) => {
    expect(body.twinScenarioId).toBe(fixture.scenario.id);
    const { effects } = answer("spread", { seeds: body.seeds, horizon: body.horizon, changes: body.changes });
    return { event: { id: "spread", name: "", description: "", horizon: body.horizon, effects }, states: [], vocabulary: { states: [], couplings: [] }, populations: [], gaps: [], saved: null };
  });
  api.saveSimEvent.mockImplementation(async (_env: string, body: { name: string; horizon: number; effects: SimEffect[]; twinScenarioId: string | null }) => {
    expect(body.twinScenarioId).toBe(fixture.scenario.id);
    const id = `event-${events.size + 1}`;
    events.set(id, { horizon: body.horizon, effects: body.effects });
    return { id, ...body };
  });
  api.runSimulation.mockImplementation(
    async (
      _env: string,
      body: {
        eventId: string;
        policies: string[];
        customPolicies?: Record<string, unknown>[];
        populationSizes: Record<string, number>;
        routeCapacity: number;
        censusAcuity?: string;
        baselineOccupancy?: Record<string, number>;
        twinScenarioId?: string;
        collect: string[];
      },
    ) => {
      expect(body.twinScenarioId).toBe(fixture.scenario.id);
      const event = events.get(body.eventId)!;
      const { datasets } = answer("simulate", {
        horizon: event.horizon,
        effects: event.effects,
        populationSizes: body.populationSizes,
        routeCapacity: body.routeCapacity,
        censusAcuity: body.censusAcuity ?? null,
        // Absent and empty mean the same to the route, which fills in an empty object.
        baselineOccupancy: body.baselineOccupancy ?? {},
        policies: body.policies,
        // Recorded only when the run follows a response the scenario holds, as the server records it.
        ...(body.customPolicies?.length ? { customPolicies: body.customPolicies } : {}),
        collect: body.collect,
      });
      return { event: { id: body.eventId, name: "" }, rows: [], facilities: 0, horizon: event.horizon, activities: [], weights: {}, datasets };
    },
  );
  return asked;
}

async function pageDigest(overrides: ScenarioOverride[]): Promise<RunDigest> {
  const run = await runScenario({
    env: "parity",
    scenario: fixture.scenario,
    stamps: stampsOf(overrides),
    ctx,
    horizon: fixture.horizon,
    activity: fixture.activity,
  });
  // When it ran is the one thing a replay cannot reproduce.
  return { ...runDigest(run, ctx, false), ranAt: fixture.ranAt };
}

const requests = (calls: RecordedCall[]) => calls.map((c) => ({ call: c.call, request: c.request }));

beforeEach(() => vi.clearAllMocks());

describe("a scenario run on the page and on the server", () => {
  it("sends the engine the same thing and reads the same figures, for the scenario as it is", async () => {
    const asked = replay(fixture.asItIs.calls);
    const digest = await pageDigest(fixture.asItIs.overrides);
    expect(asked).toEqual(requests(fixture.asItIs.calls));
    expect(digest).toEqual(fixture.asItIs.digest);
    expect(digest.full.sitesWithQueue).toBe(1);
    expect(digest.full.firstQueueDay).toBe(16);
  });

  it("gives the figures the analyst's test gave, once the option's stamps are in the scenario", async () => {
    const asked = replay(fixture.withOption.calls);
    const digest = await pageDigest(fixture.withOption.overrides);
    expect(asked).toEqual(requests(fixture.withOption.calls));
    expect(digest).toEqual(fixture.withOption.digest);
    expect(digest.full.sitesWithQueue).toBe(0);
  });

  it("gives the figures the analyst's test gave for a replacement, once the recipe holds the new stamp and not the old", async () => {
    // What "Apply to scenario" leaves: the scenario's overrides, the replaced one deleted, the new one written.
    const { retired, added, overrides } = fixture.withReplacement;
    expect(overrides).toEqual([...fixture.asItIs.overrides.filter((o) => !retired.includes(o.id)), ...added]);
    const beds = stampsOf(overrides).filter((s) => s.kind === "capacity");
    // One stamp for that choice: three beds from day 6, where the scenario had five from day 8.
    expect(beds.map((s) => [s.start, s.kind === "capacity" ? s.amount : null])).toEqual([[6, 3]]);

    const asked = replay(fixture.withReplacement.calls);
    const digest = await pageDigest(overrides);
    expect(asked).toEqual(requests(fixture.withReplacement.calls));
    expect(digest).toEqual(fixture.withReplacement.digest);
    expect(digest.full.island).not.toEqual(fixture.asItIs.digest.full.island);
  });
});

describe("a recorded response placed in the scenario", () => {
  it("is run by the page as the server ran it: the same rules, made to start on its day, and the same figures", async () => {
    const { added, overrides } = fixture.withResponse;
    expect(overrides).toEqual([...fixture.asItIs.overrides, ...added]);
    const placed = stampsOf(overrides).filter((s) => s.kind === "response");
    expect(placed.map((s) => [s.start, s.kind === "response" ? s.name : null])).toEqual([[12, "Send Lakeshore's queue to Nord"]]);

    const asked = replay(fixture.withResponse.calls);
    const digest = await pageDigest(overrides);
    expect(asked).toEqual(requests(fixture.withResponse.calls));
    expect(digest).toEqual(fixture.withResponse.digest);

    // The events-only run follows nobody; the full run follows the response, in place of the do-nothing one.
    const runs = api.runSimulation.mock.calls.map(([, body]) => body as { policies: string[]; customPolicies?: { id: string; rules: { trigger: unknown }[] }[] });
    expect(runs.map((r) => r.policies)).toEqual([["null"], []]);
    expect(runs[0]!.customPolicies).toBeUndefined();
    expect(runs[1]!.customPolicies!.map((p) => [p.id, p.rules.map((r) => r.trigger)])).toEqual([["placed-response", [{ when: "from_tick", start: 12, end: null }]]]);

    // Patients sent from Lakeshore to Nord wait less than in the scenario as it is.
    expect(fixture.asItIs.digest.full.waitingDays).toBe(76.48);
    expect(digest.full.waitingDays).toBe(11.2);
    expect(digest.events).toEqual(fixture.asItIs.digest.events);
  });

  it("goes by its name when the engine writes its rules itself", async () => {
    const asked = replay(fixture.withBuiltIn.calls);
    const digest = await pageDigest(fixture.withBuiltIn.overrides);
    expect(asked).toEqual(requests(fixture.withBuiltIn.calls));
    expect(digest).toEqual(fixture.withBuiltIn.digest);
    const runs = api.runSimulation.mock.calls.map(([, body]) => body as { policies: string[]; customPolicies?: unknown });
    expect(runs.map((r) => r.policies)).toEqual([["null"], ["load-balance"]]);
    expect(runs[1]!.customPolicies).toBeUndefined();
  });
});
