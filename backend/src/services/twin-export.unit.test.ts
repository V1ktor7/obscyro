import assert from "node:assert/strict";
import { test } from "node:test";

import { bindsAnyMechanic, populationsFrom } from "./twin-export.js";

test("a twin that has declared a care model is not told it has none", () => {
  // `NO_CARE_MODEL` used to be pushed on every export, from back when a care
  // model could only come from the scenario. Montréal declared one as two
  // `Protocole` instances and the export still reported the gap — the single
  // gap that decides whether a run means anything was the one that never
  // changed.
  const declared = [
    { properties: [{ key: "nom" }, { mechanic: "serves_severity" as const }] },
    { properties: [{ key: "status" }] },
  ];
  assert.equal(bindsAnyMechanic(declared), true);
});

test("a twin that has declared nothing is told so", () => {
  const bare = [{ properties: [{ key: "status", mechanic: null }] }, { properties: [] }];
  assert.equal(bindsAnyMechanic(bare), false);
});

test("a property whose mechanic was cleared does not count", () => {
  // Unbinding is how an institution retracts a care model, and a retraction
  // that leaves the engine still thinking it has one is worse than never
  // having declared it.
  assert.equal(bindsAnyMechanic([{ properties: [{ mechanic: null }] }]), false);
});


const TERRITOIRE = [
  {
    name: "Territoire",
    properties: [{ key: "nom" }, { key: "population", mechanic: "scales_incidence" as const }],
  },
  { name: "OrgUnit", properties: [{ key: "name", mechanic: null }] },
];

test("a declared catchment carries its head count and who it serves", () => {
  const { populations } = populationsFrom(
    TERRITOIRE,
    [{ id: "t1", typeName: "Territoire", properties: { name: "RLS des Faubourgs", population: 170146 } }],
    new Map([["t1", ["u1", "u2"]]]),
  );
  assert.equal(populations.length, 1);
  assert.equal(populations[0]!.size, 170146);
  assert.deepEqual(populations[0]!.served_by, ["u1", "u2"]);
});

test("the property is found by its mechanic, not by its name", () => {
  // The whole point. A transit authority calling it `usagers_desservis` gets
  // the same export, and nothing in this file learns the word `population`.
  const types = [
    { name: "Bassin", properties: [{ key: "usagers_desservis", mechanic: "scales_incidence" as const }] },
  ];
  const { populations } = populationsFrom(
    types,
    [{ id: "b1", typeName: "Bassin", properties: { name: "Ligne verte", usagers_desservis: 4000 } }],
    new Map(),
  );
  assert.equal(populations[0]!.size, 4000);
});

test("a catchment nobody sized still appears, at zero", () => {
  // Dropping it would make the run quietly smaller — an epidemic that never
  // reaches a third of the island because nobody typed its population. At zero
  // it is visible in the gap list and in every result table.
  const { populations, unsized } = populationsFrom(
    TERRITOIRE,
    [{ id: "t2", typeName: "Territoire", properties: { name: "RLS de Hochelaga" } }],
    new Map(),
  );
  assert.equal(populations.length, 1);
  assert.equal(populations[0]!.size, 0);
  assert.deepEqual(unsized, ["RLS de Hochelaga"]);
});

test("a negative head count is a typo, not a smaller population", () => {
  const { populations, unsized } = populationsFrom(
    TERRITOIRE,
    [{ id: "t3", typeName: "Territoire", properties: { name: "X", population: -5 } }],
    new Map(),
  );
  assert.equal(populations[0]!.size, 0);
  assert.deepEqual(unsized, ["X"]);
});

test("a type that binds nothing is not a population", () => {
  const { populations } = populationsFrom(
    TERRITOIRE,
    [{ id: "u1", typeName: "OrgUnit", properties: { name: "HÔPITAL NOTRE-DAME", population: 300 } }],
    new Map(),
  );
  assert.equal(populations.length, 0);
});

test("a unit linked twice is served once", () => {
  // `situe_dans` is walked from both ends so a catchment declared either way
  // round is read the same, which means the same pair can arrive twice.
  const { populations } = populationsFrom(
    TERRITOIRE,
    [{ id: "t4", typeName: "Territoire", properties: { name: "Y", population: 10 } }],
    new Map([["t4", ["u1", "u1", "u2"]]]),
  );
  assert.deepEqual(populations[0]!.served_by, ["u1", "u2"]);
});


test("a catchment carries the layers it declared, by the names it chose", () => {
  // The layer's name is the property key, so the keys travel with the values: a
  // transition says it couples along `ecole`, and the only thing that can
  // answer is a property called `ecole`. Nothing here knows what a school is.
  const types = [
    {
      name: "Territoire",
      properties: [
        { key: "population", mechanic: "scales_incidence" as const },
        { key: "ecole", mechanic: "couples_at" as const },
        { key: "menage", mechanic: "couples_at" as const },
        { key: "superficie_km2", mechanic: null },
      ],
    },
  ];
  const { populations } = populationsFrom(
    types,
    [
      {
        id: "t1",
        typeName: "Territoire",
        properties: { name: "RLS", population: 170146, ecole: 1.6, menage: 1.2, superficie_km2: 15 },
      },
    ],
    new Map(),
  );
  assert.deepEqual(populations[0]!.couples, { ecole: 1.6, menage: 1.2 });
});

test("a layer left blank is left out rather than sent as zero", () => {
  // Zero is a statement — nobody meets anybody there — and an empty field is
  // not. Sending it would make a coupled transition inert while looking set.
  const types = [
    {
      name: "Territoire",
      properties: [
        { key: "population", mechanic: "scales_incidence" as const },
        { key: "travail", mechanic: "couples_at" as const },
      ],
    },
  ];
  const { populations } = populationsFrom(
    types,
    [{ id: "t1", typeName: "Territoire", properties: { name: "RLS", population: 100 } }],
    new Map(),
  );
  assert.deepEqual(populations[0]!.couples, {});
});

test("a twin with no spreading model ships no couplings rather than a set of zeros", () => {
  const types = [
    { name: "Territoire", properties: [{ key: "population", mechanic: "scales_incidence" as const }] },
  ];
  const { populations } = populationsFrom(
    types,
    [{ id: "t1", typeName: "Territoire", properties: { name: "RLS", population: 100 } }],
    new Map(),
  );
  assert.deepEqual(populations[0]!.couples, {});
});
