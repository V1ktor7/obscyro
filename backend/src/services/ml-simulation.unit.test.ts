import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSimPayload,
  mechanisticFallback,
  type GraphSpec,
} from "./ml-simulation.js";
import type { ScenarioInstanceRow, ScenarioLinkRow } from "./twin-clone.js";

function sampleCopy(): { instances: ScenarioInstanceRow[]; links: ScenarioLinkRow[] } {
  const instances: ScenarioInstanceRow[] = [
    { id: "u1", scenarioId: "s", sourceInstanceId: null, objectTypeName: "OrgUnit", properties: { kind: "ward" } },
    ...Array.from({ length: 12 }, (_, i) => ({
      id: `p${i}`,
      scenarioId: "s",
      sourceInstanceId: null,
      objectTypeName: "Patient",
      properties: {} as Record<string, unknown>,
    })),
  ];
  const links: ScenarioLinkRow[] = [];
  for (let i = 0; i < 12; i++) {
    links.push({ id: `l-loc-${i}`, scenarioId: "s", linkTypeName: "located_in", fromId: `p${i}`, toId: "u1" });
    links.push({ id: `l-c-${i}`, scenarioId: "s", linkTypeName: "contact", fromId: `p${i}`, toId: `p${(i + 1) % 12}` });
  }
  return { instances, links };
}

describe("buildSimPayload", () => {
  it("projects instances and links into the cross-service contract", () => {
    const { instances, links } = sampleCopy();
    const payload = buildSimPayload({
      scenarioId: "scenario-1",
      instances,
      links,
      params: { r0: 3, horizonDays: 30, runs: 10 },
      seed: 42,
    });

    assert.equal(payload.scenario_id, "scenario-1");
    assert.equal(payload.seed, 42);
    assert.equal(payload.graph.nodes.length, instances.length);
    assert.equal(payload.graph.links.length, links.length);
    // Node shape uses `type` (from objectTypeName) and carries properties.
    const unit = payload.graph.nodes.find((n) => n.id === "u1");
    assert.ok(unit);
    assert.equal(unit!.type, "OrgUnit");
    assert.deepEqual(unit!.properties, { kind: "ward" });
    // Links keep the contact/location distinction the service needs.
    assert.ok(payload.graph.links.some((l) => l.linkTypeName === "located_in"));
    assert.ok(payload.graph.links.some((l) => l.linkTypeName === "contact"));
    assert.equal(payload.params.r0, 3);
  });

  it("passes through an explicit graph spec and intervention", () => {
    const { instances, links } = sampleCopy();
    const graphSpec: GraphSpec = {
      nodes: [
        { id: "seir", type: "mechanistic_seir" },
        { id: "ude", type: "neural_ode_ude", inputs: ["seir"] },
      ],
      output: "ude",
    };
    const payload = buildSimPayload({
      scenarioId: "s2",
      instances,
      links,
      params: {},
      seed: 1,
      graphSpec,
      intervention: { kind: "close_unit", unitId: "u1" },
      model: { id: "m1", version: "0.1.0" },
    });
    assert.deepEqual(payload.graph_spec, graphSpec);
    assert.equal(payload.intervention?.kind, "close_unit");
    assert.equal(payload.model?.version, "0.1.0");
  });
});

describe("mechanisticFallback", () => {
  it("returns a complete SimResponse tagged as a fallback", () => {
    const { instances, links } = sampleCopy();
    const res = mechanisticFallback({
      scenarioId: "s",
      instances,
      links,
      params: { r0: 4, horizonDays: 40, runs: 8 },
      seed: 7,
    });

    assert.equal(res.engine, "ml");
    assert.equal(res.model.fallback, true);
    assert.equal(res.model.type, "mechanistic_seir");
    // Quantile bands and baseline are populated; ML-vs-baseline error is zero.
    assert.ok(res.quantiles.p50.length > 0);
    assert.deepEqual(res.quantiles, res.baseline);
    assert.equal(res.ml_baseline_error.rmse, 0);
    assert.equal(res.horizonDays, 40);
  });

  it("is reproducible for the same seed", () => {
    const { instances, links } = sampleCopy();
    const opts = {
      scenarioId: "s",
      instances,
      links,
      params: { r0: 3.5, horizonDays: 30, runs: 8 },
      seed: 99,
    };
    const a = mechanisticFallback(opts);
    const b = mechanisticFallback(opts);
    assert.deepEqual(
      a.quantiles.p50.map((d) => d.I),
      b.quantiles.p50.map((d) => d.I),
    );
  });
});
