import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { buildMapProperties } from "./channel-runner.js";
import { applyCast, applyFilter } from "./pipeline.js";
import { decodeBody, parseDelimited } from "./rest-connector.js";

// ---------------------------------------------------------------------------
// The ministry's full hourly emergency file, read as it is served.
//
// `Releve_horaire_urgences_7jours_nbpers.csv` carries what the short file does
// and eight columns more: the region, the people present, the people waiting to
// see a doctor, and two average lengths of stay. The fixture is seven rows cut
// from the real file, byte for byte: Latin-1 with no charset declared, tabs
// inside three column names, a space before the last one, and the two things
// that must never become an emergency room or a zero:
//
//   - a "Total régional" row and the "Ensemble du Québec" row, with no permit;
//   - a room whose every figure reads "pas d'information disponible".
//
// To cut it again: scratch script `make-urgences-fixture.cjs` fetches the file
// and keeps one row of each kind.
// ---------------------------------------------------------------------------

const bytes = readFileSync(new URL("./__fixtures__/msss-urgences-nbpers.csv", import.meta.url));
const read = () => {
  const { text, charset } = decodeBody(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "text/csv");
  return { rows: parseDelimited(text), charset };
};

const COLUMNS = [
  "RSS",
  "Region",
  "Nom_etablissement",
  "Nom_installation",
  "No_permis_installation",
  "Nombre_de_civieres_fonctionnelles",
  "Nombre_de_civieres_occupees",
  "Nombre_de_patients_sur_civiere_plus_de_24_heures",
  "Nombre_de_patients_sur_civiere_plus_de_48_heures",
  "Nombre_total_de_patients_presents_a_lurgence",
  "Nombre_total_de_patients_en_attente_de_PEC",
  "DMS_sur_civiere",
  "DMS_ambulatoire",
  "DMS_sur_civiere_horaire",
  "DMS_ambulatoire_horaire",
  "Heure_de_l'extraction_(image)",
  "Mise_a_jour",
];

/** The figures, as the pipeline casts them: a cell that is not a number costs the cell, never the row. */
const FIGURES = COLUMNS.slice(5, 13);
const CAST = {
  trim: ["No_permis_installation", "Mise_a_jour"],
  casts: FIGURES.map((column) => ({ column, to: "number" })),
  onError: "null",
};
/** A row with no permit is a total the ministry computed, not a place. */
const ONLY_ROOMS = { column: "No_permis_installation", op: "not_null" };

const rooms = () => applyFilter(applyCast(read().rows, CAST).rows, ONLY_ROOMS);

test("the full file reads into its seventeen columns, accents and all", () => {
  const { rows, charset } = read();
  // No charset is declared and the bytes are not UTF-8: decoded as what they are.
  assert.equal(charset, "windows-1252");
  assert.equal(rows.length, 7);
  // Tabs pad three names and a space leads the last: the names come out clean.
  assert.deepEqual(Object.keys(rows[0]!), COLUMNS);
  assert.ok(rows.some((r) => r.Nom_installation === "HÔPITAL GÉNÉRAL JUIF"));
});

test("a total is not an emergency room", () => {
  const { rows } = read();
  assert.equal(rows.filter((r) => r.Nom_installation === "Total régional").length, 2);
  assert.equal(rows.filter((r) => r.Nom_installation === "Ensemble du Québec").length, 1);
  const kept = rooms();
  // Four places: two rooms of the Bas-Saint-Laurent, one that published nothing, one of Montréal.
  assert.equal(kept.length, 4);
  assert.ok(kept.every((r) => /^\d+$/.test(String(r.No_permis_installation))));
  assert.ok(!kept.some((r) => /Total|Ensemble/.test(String(r.Nom_installation))));
});

test("a room that published no information keeps its row and loses its figures", () => {
  const cast = applyCast(read().rows, CAST);
  // Nothing is dropped: words where a figure goes cost the figure.
  assert.equal(cast.dropped, 0);
  const silent = rooms().find((r) => r.Region === "Mauricie et Centre-du-Québec")!;
  assert.ok(silent, "the room is still there");
  for (const column of FIGURES) assert.equal(silent[column], null, column);
  // Its region and its stamp are still read.
  assert.match(String(silent.Mise_a_jour), /^2026-\d{2}-\d{2}T\d{1,2}:45$/);
});

test("the figures of a room are the published ones, and the lengths of stay are decimal hours", () => {
  const jgh = rooms().find((r) => r.Nom_installation === "HÔPITAL GÉNÉRAL JUIF")!;
  assert.equal(jgh.RSS, "06");
  assert.equal(jgh.Region, "Montréal");
  assert.deepEqual(
    FIGURES.map((c) => jgh[c]),
    [53, 111, 43, 20, 146, 37, 14.62, 5.99],
  );
  // The same durations, as the file also writes them.
  assert.deepEqual([jgh.DMS_sur_civiere_horaire, jgh.DMS_ambulatoire_horaire], ["14:37", "5:59"]);
});

test("written to the ontology, a missing figure replaces the last one with nothing", () => {
  const rules = [
    { from: "No_permis_installation", to: "code_installation", coerce: "string" as const },
    { from: "RSS", to: "rss", coerce: "string" as const },
    { from: "Region", to: "region", coerce: "string" as const },
    { from: "Nombre_total_de_patients_presents_a_lurgence", to: "patients_presents", coerce: "number" as const },
    { from: "Nombre_total_de_patients_en_attente_de_PEC", to: "en_attente_prise_en_charge", coerce: "number" as const },
    { from: "DMS_ambulatoire", to: "dms_ambulatoire_heures", coerce: "number" as const },
    { from: "DMS_sur_civiere", to: "dms_civiere_heures", coerce: "number" as const },
  ];
  const silent = rooms().find((r) => r.Region === "Mauricie et Centre-du-Québec")!;
  const built = buildMapProperties(silent, rules, []);
  // No issue, so the row is written; and each figure is written as null, which
  // is what takes last hour's number off the object. Left out, it would stay.
  assert.deepEqual(built.issues, []);
  assert.equal(built.properties.region, "Mauricie et Centre-du-Québec");
  for (const key of ["patients_presents", "en_attente_prise_en_charge", "dms_ambulatoire_heures", "dms_civiere_heures"]) {
    assert.ok(key in built.properties, key);
    assert.equal(built.properties[key], null, key);
  }
  const jgh = buildMapProperties(rooms().find((r) => r.Nom_installation === "HÔPITAL GÉNÉRAL JUIF")!, rules, []);
  assert.deepEqual(
    [jgh.properties.patients_presents, jgh.properties.en_attente_prise_en_charge, jgh.properties.dms_ambulatoire_heures],
    [146, 37, 5.99],
  );
});
