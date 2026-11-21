import { isDeepStrictEqual } from "node:util";

import type { ComparePayload, ScenarioEngine, SimDataset } from "./scenario-run.js";
import type { SimEffect } from "./scenario-stamps.js";
import type { SpreadPayload } from "./spread-payload.js";

/**
 * What a run asked of the engine and what the engine answered, written down.
 *
 * The page and the server each run a scenario their own way: the page through
 * three routes of this API, the server straight to the simulation service. To
 * say the two agree, their requests have to be compared, and they are not
 * shaped alike. A recorded call is neither's: it keeps what both must have
 * decided — the seeds, the measures, the effects, the starting occupancy — in
 * one neutral form, without the twin they were sent beside.
 *
 * `recordingEngine` writes these from a real engine; `replayEngine` answers
 * from them, and refuses a request the recording does not hold. The fixture
 * `scenario-run-parity.fixture.json` is such a recording, replayed by the
 * server's test and by the page's.
 */

export interface RecordedSpread {
  call: "spread";
  request: {
    seeds: Record<string, Record<string, number>>;
    horizon: number;
    changes: { layer: string; factor: number; fromStep: number; toStep: number | null; populations?: string[] }[];
  };
  response: { effects: SimEffect[] };
}

export interface RecordedSimulate {
  call: "simulate";
  request: {
    horizon: number;
    effects: SimEffect[];
    populationSizes: Record<string, number>;
    routeCapacity: number;
    censusAcuity: string | null;
    baselineOccupancy: Record<string, number>;
    /** The response run, by name: the do-nothing one, or one the engine writes itself. Empty when rules are sent. */
    policies: string[];
    /** A recorded response the scenario holds, as its rules were sent. Absent when the run follows none. */
    customPolicies?: { id: string; name: string; rules: Record<string, unknown>[] }[];
    /** The tables asked back. */
    collect: string[];
  };
  response: { datasets: SimDataset[] };
}

export type RecordedCall = RecordedSpread | RecordedSimulate;

export function spreadRequestOf(p: SpreadPayload): RecordedSpread["request"] {
  return {
    seeds: p.seeds,
    horizon: p.horizon,
    changes: p.changes.map((c) => ({
      layer: c.layer,
      factor: c.factor,
      fromStep: c.from_step,
      toStep: c.to_step,
      ...(c.populations ? { populations: c.populations } : {}),
    })),
  };
}

export function simulateRequestOf(p: ComparePayload): RecordedSimulate["request"] {
  return {
    horizon: p.event.horizon,
    effects: p.event.effects,
    populationSizes: p.population_sizes,
    routeCapacity: p.route_capacity,
    censusAcuity: p.census_acuity,
    baselineOccupancy: p.baseline_occupancy,
    policies: p.policies,
    // Only when there is one: a run that follows none is recorded as it always was.
    ...(p.custom_policies.length ? { customPolicies: p.custom_policies } : {}),
    collect: p.collect,
  };
}

/** An engine that keeps what was asked and answered. Only the tables a run reads are kept. */
export function recordingEngine(inner: ScenarioEngine): ScenarioEngine & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    async spread(payload) {
      const out = await inner.spread(payload);
      calls.push({ call: "spread", request: spreadRequestOf(payload), response: { effects: out.event.effects } });
      return out;
    },
    async compare(payload) {
      const out = await inner.compare(payload);
      const datasets = (out.datasets ?? [])
        .filter((d) => d.name === "facilities" || d.name === "steps")
        .map((d) => ({ name: d.name, columns: d.columns, rows: d.rows }));
      calls.push({ call: "simulate", request: simulateRequestOf(payload), response: { datasets } });
      return out;
    },
  };
}

// JSON has no `undefined`: compare what would travel, not what a spread left behind.
const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** An engine that answers from a recording, and keeps the requests it was sent. */
export function replayEngine(recorded: RecordedCall[]): ScenarioEngine & { asked: Pick<RecordedCall, "call" | "request">[] } {
  const asked: Pick<RecordedCall, "call" | "request">[] = [];
  const find = <C extends RecordedCall>(call: C["call"], request: C["request"]): C => {
    const sent = wire(request);
    asked.push({ call, request: sent });
    const hit = recorded.find((r) => r.call === call && isDeepStrictEqual(r.request, sent));
    if (!hit) throw new Error(`The recording holds no ${call} call with this request: ${JSON.stringify(sent).slice(0, 400)}`);
    return hit as C;
  };
  return {
    asked,
    async spread(payload) {
      return { event: { effects: find<RecordedSpread>("spread", spreadRequestOf(payload)).response.effects } };
    },
    async compare(payload) {
      return { datasets: find<RecordedSimulate>("simulate", simulateRequestOf(payload)).response.datasets };
    },
  };
}
