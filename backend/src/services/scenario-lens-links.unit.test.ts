import assert from "node:assert/strict";
import { test } from "node:test";

import type { DbClient } from "../lib/db.js";
import { listLinksForEnv } from "./ontology.js";

/**
 * A twin read through a scenario keeps the links of its oldest objects.
 *
 * The units of a twin are usually created first and their beds afterwards, so
 * a read that keeps the newest N instances drops the units before anything
 * else. Every link touching a unit then looks like it points at something the
 * scenario deleted, and the network arrives at the engine with no capacity.
 */

const SCENARIO = "00000000-0000-0000-0000-0000000000aa";
const T0 = new Date("2026-01-01T00:00:00Z").getTime();

function fakeDb(instanceCount: number): DbClient {
  // The unit is the oldest instance; the bed placed in it is the newest.
  const rows = Array.from({ length: instanceCount }, (_, i) => ({
    id: i === 0 ? "unit" : i === instanceCount - 1 ? "bed" : `filler-${i}`,
    object_type_id: i === 0 ? "t-unit" : "t-bed",
    type_name: i === 0 ? "OrgUnit" : "Bed",
    properties: {},
    provenance: {},
    property_schema: [],
    sim_role: i === 0 ? null : "space",
    created_at: new Date(T0 + i * 1000),
    updated_at: new Date(T0 + i * 1000),
  }));
  const newestFirst = [...rows].reverse();

  const query = async (sql: string, params: unknown[] = []) => {
    if (/FROM app\.ontology_link_instances/.test(sql)) {
      return {
        rows: [{
          id: "l1", link_type_name: "located_in", aggregates: "metrics", aggregate_toward: "target",
          transitive: false, from_instance_id: "bed", to_instance_id: "unit",
          from_type_name: "Bed", to_type_name: "OrgUnit",
        }],
        rowCount: 1,
      };
    }
    if (/FROM app\.ontology_object_instances/.test(sql)) {
      const limit = Number(params[params.length - 1]);
      const out = newestFirst.slice(0, limit);
      return { rows: out, rowCount: out.length };
    }
    if (/FROM app\.scenario_override/.test(sql)) return { rows: [], rowCount: 0 };
    if (/FROM app\.scenario/.test(sql)) {
      return {
        rows: [{
          id: SCENARIO, project_id: "p", name: "s", description: null, parent_scenario_id: null,
          base_as_of: null, status: "draft", created_at: new Date(T0),
        }],
        rowCount: 1,
      };
    }
    throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
  };
  return { query } as unknown as DbClient;
}

test("a bed stays in its unit when the twin is larger than 20 000 instances", async () => {
  const links = await listLinksForEnv(fakeDb(25_566), "env", { scenarioId: SCENARIO, atOffsetHours: 0 });
  assert.equal(links.length, 1, "the unit is the oldest instance; it must still be read");
  assert.equal(links[0]!.toInstanceId, "unit");
});

test("without a scenario the link is returned as stored", async () => {
  const links = await listLinksForEnv(fakeDb(25_566), "env");
  assert.equal(links.length, 1);
});
