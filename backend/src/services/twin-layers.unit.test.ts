import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  combine,
  groupByKey,
  layerKey,
  normalizeKey,
  placeables,
  rankMatches,
  withLayerProperty,
  type Placeable,
} from "./twin-layers.js";
import type { PropertyDef } from "./property-schema.js";

describe("a key is spelled one way", () => {
  it("forgives what a spreadsheet and an ontology disagree on", () => {
    assert.equal(normalizeKey("0611"), normalizeKey(611));
    assert.equal(normalizeKey("53324349.0"), "53324349");
    assert.equal(normalizeKey("  Hôpital   Fleury "), "hopital fleury");
    assert.equal(normalizeKey("HOPITAL FLEURY"), "hopital fleury");
  });

  it("keeps a zero that is the whole value, and refuses nothing", () => {
    assert.equal(normalizeKey("0"), "0");
    assert.equal(normalizeKey(""), null);
    assert.equal(normalizeKey(null), null);
    assert.equal(normalizeKey({ a: 1 }), null);
  });
});

describe("values that meet on one place", () => {
  it("combine the way the layer declares", () => {
    assert.equal(combine([120, 80], "sum"), 200);
    assert.equal(combine([120, 80], "mean"), 100);
    assert.equal(combine([120, 80], "max"), 120);
    assert.equal(combine([120, 80], "count"), 2);
  });

  it("group by the key the file names, spelled loosely", () => {
    const g = groupByKey(
      [
        { match: "0611", value: 10 },
        { match: "611", value: 5 },
        { match: "0612", value: 1 },
        { match: "", value: 99 },
      ],
      "sum",
    );
    assert.deepEqual(Object.fromEntries(g), { "611": 15, "612": 1 });
  });
});

describe("the property a layer is stored under", () => {
  it("is plain and marked as a layer", () => {
    assert.equal(layerKey("Long-term care beds"), "layer_long_term_care_beds");
    assert.equal(layerKey("Lits CHSLD (permanents)"), "layer_lits_chsld_permanents");
    assert.equal(layerKey("!!!"), "layer_value");
  });

  it("replaces an earlier load of itself, and never an ordinary property", () => {
    const layer = { role: "capacity", aggregate: "sum" } as const;
    const def: PropertyDef = { key: "layer_x", type: "number", layer };
    const first = withLayerProperty([{ key: "name", type: "string" }], def);
    assert.equal(first.replaced, false);
    assert.equal(first.schema.length, 2);
    const again = withLayerProperty(first.schema, { ...def, label: "X" });
    assert.equal(again.replaced, true);
    assert.equal(again.schema.length, 2);
    assert.throws(() => withLayerProperty([{ key: "layer_x", type: "number" }], def), /not added as a layer/);
  });
});

const SITE = (id: string, code: string | number, name: string): Placeable => ({
  id,
  typeName: "Installation",
  properties: { code_installation: code, name, latitude: 45.5, longitude: -73.6 },
  target: "site",
});

describe("which column names which places", () => {
  const places = [SITE("a", "53324349", "Manoir de l'Ouest"), SITE("b", 51230118, "Château sur le Lac"), SITE("c", "51223204", "Vigi")];

  it("is counted, and the counting column wins over a better-named one", () => {
    const ranked = rankMatches(
      [
        { name: "code", values: ["x1", "x2", "x3"] },
        { name: "numero", values: ["53324349", "51230118", "99999999"] },
      ],
      places,
    );
    assert.equal(ranked[0]!.column, "numero");
    assert.equal(ranked[0]!.property, "code_installation");
    assert.equal(ranked[0]!.matched, 2);
    assert.equal(ranked[0]!.distinct, 3);
    assert.deepEqual(ranked[0]!.unmatched, ["99999999"]);
    assert.equal(ranked.some((c) => c.column === "code"), false);
  });

  it("never matches on coordinates", () => {
    const ranked = rankMatches([{ name: "lat", values: ["45.5"] }], places);
    assert.deepEqual(ranked, []);
  });

  it("places sites by coordinates and catchments by a declared head count", () => {
    const out = placeables([
      { id: "s", typeName: "Site", properties: { lat: 45, lon: -73 }, propertySchema: [] },
      { id: "c", typeName: "RLS", properties: { code: "0611" }, propertySchema: [{ key: "pop", type: "number", mechanic: "scales_incidence" }] },
      { id: "x", typeName: "Note", properties: { code: "0611" }, propertySchema: [] },
    ]);
    assert.deepEqual(out.map((p) => [p.id, p.target]), [["s", "site"], ["c", "catchment"]]);
  });
});
