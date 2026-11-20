import assert from "node:assert/strict";
import { test } from "node:test";

import type { EnvInstanceRow, EnvLinkRow } from "./ontology.js";
import type { SimRole } from "./property-schema.js";
import { facilitiesFrom } from "./twin-export.js";
import type { MetricDef } from "./twin-metrics.js";
import { rollupFrom, type TwinTreeEdge } from "./twin.js";

// ---------------------------------------------------------------------------
// One twin, read both ways.
//
// The unit page shows a roll-up (`rollupFrom`). The analyst's site tools read
// the simulation export (`facilitiesFrom`). Both count the same beds, through
// code that shares nothing but the test for "in use", and until this file
// nothing held the two together: a person could read 7 on the page and be told
// 2 by the analyst, each of them right about a different thing.
//
// What is held here:
//   - at a unit with nothing under it, the two give the same figure;
//   - at a unit with units under it, the page adds the whole subtree and the
//     export only what is attached to the unit itself, and the page's figure is
//     exactly the sum of the export's over that subtree.
//
// The second is why the analyst reads a unit's live figures from the roll-up
// (`unit_now`), not from the export: it has to give the number the screen gives.
// ---------------------------------------------------------------------------

const AT = new Date("2026-11-20T12:00:00Z");

const inst = (id: string, typeName: string, simRole: SimRole | null, properties: Record<string, unknown> = {}): EnvInstanceRow => ({
  id,
  typeId: `type:${typeName}`,
  typeName,
  properties,
  provenance: {},
  propertySchema: [],
  simRole,
  createdAt: AT,
  updatedAt: AT,
});

/** `parent contains child`: the hierarchy, flowing toward its source. */
const contains = (parent: string, child: string): EnvLinkRow => ({
  id: `${parent}>${child}`,
  linkTypeName: "contains",
  aggregates: "metrics",
  aggregateToward: "source",
  transitive: true,
  fromInstanceId: parent,
  toInstanceId: child,
  fromTypeName: "OrgUnit",
  toTypeName: "OrgUnit",
});

/** `thing located_in unit`: a placement, flowing toward its target. */
const placed = (thing: EnvInstanceRow, unit: string): EnvLinkRow => ({
  id: `${thing.id}@${unit}`,
  linkTypeName: "located_in",
  aggregates: "metrics",
  aggregateToward: "target",
  transitive: false,
  fromInstanceId: thing.id,
  toInstanceId: unit,
  fromTypeName: thing.typeName,
  toTypeName: "OrgUnit",
});

// A hospital with two wards. Beds stand in the wards; two stretchers stand in
// the hospital itself, under no ward.
const UNITS = [
  { id: "H", name: "Hôpital" },
  { id: "W1", name: "Médecine" },
  { id: "W2", name: "Chirurgie" },
];
const EDGES: TwinTreeEdge[] = [
  { fromId: "H", toId: "W1" },
  { fromId: "H", toId: "W2" },
];
const CHILDREN: Record<string, string[]> = { H: ["H", "W1", "W2"], W1: ["W1"], W2: ["W2"] };

const AT_W1 = [
  inst("b1", "Lit", "space", { status: "occupied" }),
  inst("b2", "Lit", "space", { status: "available" }),
  inst("b3", "Lit", "space"),
  // A person in a bed is demand, not capacity.
  inst("p1", "Patient", "demand"),
  // A type that declares no role: on the page, never in a run.
  inst("n1", "Note", null),
];
const AT_W2 = [inst("b4", "Lit", "space", { etat: "occupé" }), inst("b5", "Lit", "space", { status: "in_use" })];
const AT_H = [inst("c1", "Civière", "space"), inst("c2", "Civière", "space", { status: "occupied" })];

const INSTANCES: EnvInstanceRow[] = [...UNITS.map((u) => inst(u.id, "OrgUnit", null, { name: u.name })), ...AT_W1, ...AT_W2, ...AT_H];
const LINKS: EnvLinkRow[] = [
  contains("H", "W1"),
  contains("H", "W2"),
  ...AT_W1.map((i) => placed(i, "W1")),
  ...AT_W2.map((i) => placed(i, "W2")),
  ...AT_H.map((i) => placed(i, "H")),
];
const ROLES = new Map<string, SimRole | null>([
  ["OrgUnit", null],
  ["Lit", "space"],
  ["Civière", "space"],
  ["Patient", "demand"],
  ["Note", null],
]);

/** Occupancy the way an institution defines it: capacity spoken for, over capacity. */
const OCCUPANCY: MetricDef = {
  key: "occupancy",
  label: "Occupancy",
  objectType: "OrgUnit",
  unit: "percent",
  numerator: { ofRole: "space", inUse: true, agg: "count" },
  denominator: { ofRole: "space", agg: "count" },
};

const page = rollupFrom(UNITS, EDGES, INSTANCES, LINKS, [OCCUPANCY], AT.getTime());
const { facilities, typesWithoutRole } = facilitiesFrom(UNITS, INSTANCES, LINKS, ROLES);
const site = (id: string) => facilities.find((f) => f.id === id)!;

/** What the export holds at one unit: capacity and units in use, over every resource, and its census. */
function exported(id: string) {
  const f = site(id);
  const resources = Object.values(f.resources);
  return {
    capacity: resources.reduce((a, r) => a + r.capacity, 0),
    inUse: resources.reduce((a, r) => a + (r.capacity - r.quantity), 0),
    census: Object.values(f.census).reduce((a, n) => a + n, 0),
  };
}

test("at a ward, the unit page and the export give the same beds", () => {
  for (const [ward, beds, used] of [
    ["W1", 3, 1],
    ["W2", 2, 2],
  ] as const) {
    const onPage = page.get(ward)!;
    const inExport = site(ward).resources.lit!;
    assert.equal(onPage.instanceCountByType.Lit, beds);
    assert.equal(inExport.capacity, beds);
    // Free units, in the export; the page says the share in use. Same beds, same test for "in use".
    assert.equal(inExport.capacity - inExport.quantity, used);
    assert.equal(onPage.values.occupancy, (used / beds) * 100);
    assert.equal(onPage.occupancyPct, onPage.values.occupancy);
  }
});

test("a patient is counted as present on both, and as capacity on neither", () => {
  assert.equal(page.get("W1")!.instanceCountByType.Patient, 1);
  assert.deepEqual(site("W1").census, { patient: 1 });
  assert.equal(site("W1").resources.patient, undefined);
  // Three beds, one of them occupied: the patient did not make the ward a fourth unit of capacity.
  assert.equal(exported("W1").capacity, 3);
});

test("a type with no role is on the page and not in the export, and the export says so", () => {
  assert.equal(page.get("W1")!.instanceCountByType.Note, 1);
  assert.deepEqual(Object.keys(site("W1").resources), ["lit"]);
  assert.deepEqual([...typesWithoutRole], ["Note"]);
});

test("at a hospital, the page adds its wards and the export does not", () => {
  const onPage = page.get("H")!;
  // The page: everything under the hospital.
  assert.deepEqual(onPage.instanceCountByType, { Civière: 2, Lit: 5, Patient: 1, Note: 1 });
  assert.equal(onPage.values.occupancy, (4 / 7) * 100);
  // The export: what stands in the hospital itself. Its wards are sites of their own.
  assert.deepEqual(Object.keys(site("H").resources), ["civière"]);
  assert.deepEqual(exported("H"), { capacity: 2, inUse: 1, census: 0 });
  // Two right figures for two different things: this is the gap a reader would fall into.
  assert.notEqual(exported("H").capacity, onPage.instanceCountByType.Lit! + onPage.instanceCountByType.Civière!);
});

test("the page's figure for a unit is the export's, added over everything under it", () => {
  for (const unit of UNITS) {
    const under = CHILDREN[unit.id]!.map(exported);
    const capacity = under.reduce((a, x) => a + x.capacity, 0);
    const inUse = under.reduce((a, x) => a + x.inUse, 0);
    const census = under.reduce((a, x) => a + x.census, 0);
    const onPage = page.get(unit.id)!;
    const counted = onPage.instanceCountByType;
    assert.equal((counted.Lit ?? 0) + (counted.Civière ?? 0), capacity, `capacity under ${unit.name}`);
    assert.equal(counted.Patient ?? 0, census, `census under ${unit.name}`);
    assert.equal(onPage.values.occupancy, (inUse / capacity) * 100, `occupancy under ${unit.name}`);
  }
});

test("a unit with nothing standing in it is empty on both, not zero on one", () => {
  const bare = [...UNITS, { id: "X", name: "Annexe" }];
  const withBare = [...INSTANCES, inst("X", "OrgUnit", null, { name: "Annexe" })];
  const onPage = rollupFrom(bare, EDGES, withBare, LINKS, [OCCUPANCY], AT.getTime()).get("X")!;
  const inExport = facilitiesFrom(bare, withBare, LINKS, ROLES).facilities.find((f) => f.id === "X")!;
  assert.deepEqual(onPage.instanceCountByType, {});
  // No beds is no occupancy, not 0 %.
  assert.equal(onPage.values.occupancy, null);
  assert.deepEqual(inExport.resources, {});
});
