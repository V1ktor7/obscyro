import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { offersFor, readColumns, whyNoChart, type ColumnSpec } from "./chartable.js";

/**
 * What the picker is allowed to offer.
 *
 * The declared schema types a column `string | number | boolean | object` and
 * nothing more, so a date arrives as a string and a permit number arrives as a
 * number. A picker that trusted the declaration would turn the first into a
 * category with ninety values and offer to sum the second.
 */

/** The emergency file, as the sync lands it. */
const URGENCES: ColumnSpec[] = [
  { name: "No_permis_installation", type: "string" },
  { name: "Nom_installation", type: "string" },
  { name: "Nombre_de_civieres_fonctionnelles", type: "string" },
  { name: "Mise_a_jour", type: "string" },
];
const URGENCES_ROWS = [
  { No_permis_installation: "51236297", Nom_installation: "CHUM", Nombre_de_civieres_fonctionnelles: "51", Mise_a_jour: "2026-08-25T16:45" },
  { No_permis_installation: "51222800", Nom_installation: "Sainte-Justine", Nombre_de_civieres_fonctionnelles: "16", Mise_a_jour: "2026-08-25T16:45" },
  { No_permis_installation: "51218980", Nom_installation: "Verdun", Nombre_de_civieres_fonctionnelles: "26", Mise_a_jour: "2026-08-25T16:45" },
  { No_permis_installation: "51224392", Nom_installation: "LaSalle", Nombre_de_civieres_fonctionnelles: "15", Mise_a_jour: "2026-08-25T16:45" },
  { No_permis_installation: "51230011", Nom_installation: "Lakeshore", Nombre_de_civieres_fonctionnelles: "31", Mise_a_jour: "2026-08-25T16:45" },
  { No_permis_installation: "51230012", Nom_installation: "Royal Victoria", Nombre_de_civieres_fonctionnelles: "33", Mise_a_jour: "2026-08-25T16:45" },
  { No_permis_installation: "51230013", Nom_installation: "Notre-Dame", Nombre_de_civieres_fonctionnelles: "35", Mise_a_jour: "2026-08-25T16:45" },
  { No_permis_installation: "51230014", Nom_installation: "Maisonneuve", Nombre_de_civieres_fonctionnelles: "54", Mise_a_jour: "2026-08-25T16:45" },
];

describe("reading what is actually in a column", () => {
  const fits = readColumns(URGENCES, URGENCES_ROWS);
  const of = (n: string) => fits.find((f) => f.name === n)!;

  it("sees dates in a column the schema calls text", () => {
    assert.equal(of("Mise_a_jour").role, "time");
  });

  it("sees numbers in a column the schema calls text", () => {
    // Every CSV column arrives as a string. Trusting the declaration would
    // leave a whole imported file unchartable.
    assert.equal(of("Nombre_de_civieres_fonctionnelles").role, "quantity");
  });

  it("refuses to call a permit number a measurement", () => {
    // Whole numbers that never repeat are an identifier. Summing them is
    // arithmetic that runs and means nothing.
    const f = of("No_permis_installation");
    assert.equal(f.role, "identifier");
    assert.match(f.reason, /identifiant/);
  });

  it("keeps names as a category", () => {
    assert.equal(of("Nom_installation").role, "category");
  });

  it("does not mistake small integers for dates", () => {
    // Date.parse accepts "2" and "Dec". Anchoring on the ISO shape is what
    // stops a column of counts becoming a timeline.
    const fits2 = readColumns([{ name: "n", type: "string" }], [{ n: "2" }, { n: "3" }, { n: "12" }]);
    assert.equal(fits2[0]!.role, "quantity");
  });

  it("says a column is unusable rather than guessing at an empty one", () => {
    const fits2 = readColumns([{ name: "vide", type: "string" }], [{ vide: "" }, { vide: null }]);
    assert.equal(fits2[0]!.role, "unusable");
  });

  it("tolerates a few bad cells without losing the column", () => {
    // "pas d'information disponible" appears in four of sixteen emergency rows.
    // One such value must not demote a numeric column to text.
    const rows = [{ n: "1" }, { n: "2" }, { n: "3" }, { n: "4" }, { n: "5" },
                  { n: "6" }, { n: "7" }, { n: "8" }, { n: "9" }, { n: "pas d'information disponible" }];
    assert.equal(readColumns([{ name: "n", type: "string" }], rows)[0]!.role, "quantity");
  });
});

describe("what the picker offers", () => {
  it("offers a curve when there is a date and a measure", () => {
    const offers = offersFor(readColumns(URGENCES, URGENCES_ROWS));
    const line = offers.find((o) => o.kind === "line")!;
    assert.equal(line.x, "Mise_a_jour");
    assert.equal(line.y, "Nombre_de_civieres_fonctionnelles");
  });

  it("offers bars when a category is short enough to read", () => {
    const bar = offersFor(readColumns(URGENCES, URGENCES_ROWS)).find((o) => o.kind === "bar")!;
    assert.equal(bar.x, "Nom_installation");
    assert.match(bar.why, /8 barres/);
  });

  it("does not offer bars over a category nobody could read", () => {
    // Three hundred installations is a wall of ticks, not a chart.
    const many = Array.from({ length: 300 }, (_, i) => ({ nom: `site ${i}`, n: String(i % 7) }));
    const offers = offersFor(
      readColumns([{ name: "nom", type: "string" }, { name: "n", type: "string" }], many),
    );
    assert.ok(!offers.some((o) => o.kind === "bar"));
  });

  it("always leaves a table available", () => {
    // It asks nothing of the data, so it is the honest fallback.
    const offers = offersFor(readColumns([{ name: "x", type: "string" }], [{ x: "a" }]));
    assert.deepEqual(offers.map((o) => o.kind), ["table"]);
  });

  it("says why nothing better than a table was possible", () => {
    // An empty picker is a dead end; a named reason is a next step.
    const fits = readColumns(
      [{ name: "code", type: "string" }],
      Array.from({ length: 10 }, (_, i) => ({ code: String(51000000 + i) })),
    );
    assert.match(String(whyNoChart(fits)), /identifiant/);
  });

  it("says nothing when a measure exists", () => {
    assert.equal(whyNoChart(readColumns(URGENCES, URGENCES_ROWS)), null);
  });

  it("blames the empty preview when the table has no rows", () => {
    assert.match(String(whyNoChart(readColumns([{ name: "a", type: "string" }], []))), /vide/);
  });
});
