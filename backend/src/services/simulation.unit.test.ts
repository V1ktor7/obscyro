import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AppError } from "../lib/errors.js";
import {
  buildContactGraphFromCopy,
  countContactEdges,
  runOutbreakSimulation,
  validateOutbreakParams,
} from "./simulation.js";
import type { ScenarioInstanceRow, ScenarioLinkRow } from "./twin-clone.js";

function buildSampleGraph() {
  const instances: ScenarioInstanceRow[] = [
    { id: "u1", scenarioId: "s", sourceInstanceId: null, objectTypeName: "OrgUnit", properties: { kind: "ward" } },
    ...Array.from({ length: 20 }, (_, i) => ({
      id: `p${i}`,
      scenarioId: "s",
      sourceInstanceId: null,
      objectTypeName: "Patient",
      properties: {} as Record<string, unknown>,
    })),
  ];
  const links: ScenarioLinkRow[] = [];
  // Locate every patient in the ward.
  for (let i = 0; i < 20; i++) {
    links.push({ id: `l${i}`, scenarioId: "s", linkTypeName: "located_in", fromId: `p${i}`, toId: "u1" });
  }
  // Contact chain between consecutive patients.
  for (let i = 0; i < 19; i++) {
    links.push({ id: `c${i}`, scenarioId: "s", linkTypeName: "contact", fromId: `p${i}`, toId: `p${i + 1}` });
  }
  return buildContactGraphFromCopy(instances, links);
}

describe("simulation determinism", () => {
  it("reproduces identical trajectories from the same seed", () => {
    const graph = buildSampleGraph();
    const params = { r0: 2.5, runs: 8, horizonDays: 30, indexNodeIds: ["p0"] };
    const a = runOutbreakSimulation(graph, params, 12345, []);
    const b = runOutbreakSimulation(graph, params, 12345, []);
    assert.deepEqual(a.trajectories, b.trajectories);
    assert.deepEqual(a.summary, b.summary);
  });

  it("produces different trajectories for different seeds", () => {
    const graph = buildSampleGraph();
    const params = { r0: 2.5, runs: 8, horizonDays: 30, indexNodeIds: ["p0"] };
    const a = runOutbreakSimulation(graph, params, 1, []);
    const b = runOutbreakSimulation(graph, params, 999, []);
    assert.notDeepEqual(a.trajectories, b.trajectories);
  });

  it("counts contact edges, excluding location links", () => {
    const graph = buildSampleGraph();
    assert.equal(countContactEdges(graph), 19);
  });
});

describe("validateOutbreakParams", () => {
  it("rejects out-of-range beta", () => {
    assert.throws(() => validateOutbreakParams({ beta: 5 }), (e) => e instanceof AppError && e.code === "SIM_INVALID_PARAMS");
  });
  it("rejects non-positive r0", () => {
    assert.throws(() => validateOutbreakParams({ r0: 0 }), (e) => e instanceof AppError);
  });
  it("accepts valid params", () => {
    assert.doesNotThrow(() => validateOutbreakParams({ beta: 0.1, r0: 2.5, runs: 10, horizonDays: 60 }));
  });
});
