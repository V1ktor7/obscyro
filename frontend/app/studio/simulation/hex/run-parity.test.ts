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
});
