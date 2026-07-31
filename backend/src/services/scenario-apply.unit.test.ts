import assert from "node:assert/strict";
import { test } from "node:test";

import type { EnvInstanceRow, EnvLinkRow } from "./ontology.js";
import {
  applyOverridesToInstances,
  applyOverridesToLinks,
  scenarioParams,
  syntheticId,
} from "./scenario-apply.js";
import type { ScenarioOverride } from "./scenario-overrides.js";

const SCEN = "11111111-1111-1111-1111-111111111111";

function inst(id: string, typeName: string, props: Record<string, unknown> = {}): EnvInstanceRow {
  return {
    id,
    typeId: `type-${typeName}`,
    typeName,
    properties: props,
    provenance: {},
    propertySchema: [{ key: "name", type: "string" }],
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function ov(p: Partial<ScenarioOverride> & { id: string }): ScenarioOverride {
  return {
    scenarioId: SCEN,
    seq: 1,
    targetType: "instance",
    targetId: null,
    targetLocalKey: null,
    op: "set_property",
    payload: {},
    effectiveOffsetHours: 0,
    durationHours: null,
    note: null,
    ...p,
  };
}

const BASE = [
  inst("u1", "OrgUnit", { name: "6 Ouest", beds: 24, status: "open" }),
  inst("u2", "OrgUnit", { name: "Soins intensifs", beds: 12, status: "open" }),
  inst("p1", "Patient", { mrn: "MRN-1" }),
];

// --- synthetic ids -----------------------------------------------------------

test("a created instance gets a stable id, not a fresh one per read", () => {
  // The twin keys its tree, rollups and alert state by instance id. A ward that
  // changed id between two SSE ticks would appear and disappear.
  const a = syntheticId(SCEN, "new_ward");
  const b = syntheticId(SCEN, "new_ward");
  assert.equal(a, b);
  assert.notEqual(a, syntheticId(SCEN, "other_ward"));
  assert.notEqual(a, syntheticId("22222222-2222-2222-2222-222222222222", "new_ward"));
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

// --- instances ---------------------------------------------------------------

test("no overrides leaves the base untouched", () => {
  const out = applyOverridesToInstances(BASE, [], SCEN);
  assert.equal(out.length, 3);
  assert.equal(out.find((i) => i.id === "u1")!.properties.beds, 24);
});

test("set_property changes one field and leaves the rest", () => {
  const out = applyOverridesToInstances(
    BASE,
    [ov({ id: "a", targetId: "u1", payload: { property: "status", value: "closed" } })],
    SCEN,
  );
  const u1 = out.find((i) => i.id === "u1")!;
  assert.equal(u1.properties.status, "closed");
  assert.equal(u1.properties.beds, 24, "untouched properties survive");
});

test("the base rows are not mutated — a scenario read must not corrupt reality", () => {
  applyOverridesToInstances(
    BASE,
    [ov({ id: "a", targetId: "u1", payload: { property: "status", value: "closed" } })],
    SCEN,
  );
  assert.equal(BASE[0]!.properties.status, "open");
});

test("set_property with a properties object sets several at once", () => {
  const out = applyOverridesToInstances(
    BASE,
    [ov({ id: "a", targetId: "u2", payload: { properties: { beds: 24, status: "surge" } } })],
    SCEN,
  );
  const u2 = out.find((i) => i.id === "u2")!;
  assert.equal(u2.properties.beds, 24);
  assert.equal(u2.properties.status, "surge");
});

test("delete removes the instance", () => {
  const out = applyOverridesToInstances(
    BASE,
    [ov({ id: "a", targetId: "u2", op: "delete" })],
    SCEN,
  );
  assert.equal(out.length, 2);
  assert.equal(out.find((i) => i.id === "u2"), undefined);
});

test("create adds an instance and borrows the schema of its type", () => {
  const out = applyOverridesToInstances(
    BASE,
    [
      ov({
        id: "a",
        op: "create",
        targetLocalKey: "iso_b",
        payload: { objectType: "OrgUnit", properties: { name: "Isolation B", beds: 12 } },
      }),
    ],
    SCEN,
  );
  const made = out.find((i) => i.id === syntheticId(SCEN, "iso_b"))!;
  assert.equal(made.typeName, "OrgUnit");
  assert.equal(made.properties.name, "Isolation B");
  assert.equal(made.typeId, "type-OrgUnit", "shares the real type id");
  assert.deepEqual(made.propertySchema, BASE[0]!.propertySchema);
  assert.equal(made.provenance.scenarioId, SCEN);
});

test("a later edit wins over an earlier one on the same property", () => {
  const out = applyOverridesToInstances(
    BASE,
    [
      ov({ id: "a", seq: 1, targetId: "u1", payload: { property: "beds", value: 30 } }),
      ov({ id: "b", seq: 2, targetId: "u1", payload: { property: "beds", value: 36 } }),
    ],
    SCEN,
  );
  assert.equal(out.find((i) => i.id === "u1")!.properties.beds, 36);
});

test("editing something already deleted does nothing rather than resurrecting it", () => {
  const out = applyOverridesToInstances(
    BASE,
    [
      ov({ id: "a", seq: 1, targetId: "u2", op: "delete" }),
      ov({ id: "b", seq: 2, targetId: "u2", payload: { property: "beds", value: 99 } }),
    ],
    SCEN,
  );
  assert.equal(out.find((i) => i.id === "u2"), undefined);
});

test("editing an instance outside the base is ignored, not an error", () => {
  const out = applyOverridesToInstances(
    BASE,
    [ov({ id: "a", targetId: "not-here", payload: { property: "x", value: 1 } })],
    SCEN,
  );
  assert.equal(out.length, 3);
});

// --- links -------------------------------------------------------------------

const LINKS: EnvLinkRow[] = [
  {
    id: "l1",
    linkTypeName: "located_in",
    fromInstanceId: "p1",
    toInstanceId: "u1",
    fromTypeName: "Patient",
    toTypeName: "OrgUnit",
  },
];

test("link adds an edge, resolving a local key on the far side", () => {
  const overrides = [
    ov({
      id: "mk",
      seq: 1,
      op: "create",
      targetLocalKey: "iso_b",
      payload: { objectType: "OrgUnit", properties: { name: "Isolation B" } },
    }),
    ov({
      id: "ln",
      seq: 2,
      targetType: "link",
      op: "link",
      targetId: "p1",
      payload: { linkType: "located_in", toLocalKey: "iso_b" },
    }),
  ];
  const instances = applyOverridesToInstances(BASE, overrides, SCEN);
  const out = applyOverridesToLinks(LINKS, overrides, SCEN, instances);
  const made = out.find((l) => l.toInstanceId === syntheticId(SCEN, "iso_b"))!;
  assert.ok(made, "the new link exists");
  assert.equal(made.fromTypeName, "Patient");
  assert.equal(made.toTypeName, "OrgUnit", "type names resolve through the created instance");
});

test("unlink removes an existing edge", () => {
  const overrides = [
    ov({
      id: "un",
      targetType: "link",
      op: "unlink",
      targetId: "p1",
      payload: { linkType: "located_in", toId: "u1" },
    }),
  ];
  const out = applyOverridesToLinks(LINKS, overrides, SCEN, BASE);
  assert.equal(out.length, 0);
});

test("a link whose endpoint the scenario deleted is dropped", () => {
  // Otherwise the twin counts a patient into a ward that no longer exists.
  const overrides = [ov({ id: "d", targetId: "u1", op: "delete" })];
  const instances = applyOverridesToInstances(BASE, overrides, SCEN);
  const out = applyOverridesToLinks(LINKS, overrides, SCEN, instances);
  assert.equal(out.length, 0);
});

test("re-linking the same pair does not duplicate the edge", () => {
  const overrides = [
    ov({
      id: "ln",
      targetType: "link",
      op: "link",
      targetId: "p1",
      payload: { linkType: "located_in", toId: "u1" },
    }),
  ];
  const out = applyOverridesToLinks(LINKS, overrides, SCEN, BASE);
  assert.equal(out.length, 1);
});

// --- params ------------------------------------------------------------------

test("param overrides are collected for the engine, not the ontology", () => {
  const params = scenarioParams([
    ov({ id: "a", targetType: "param", op: "set_param", payload: { key: "r0", value: 2.4 } }),
    ov({ id: "b", targetId: "u1", payload: { property: "beds", value: 30 } }),
  ]);
  assert.deepEqual(params, { r0: 2.4 });
});
