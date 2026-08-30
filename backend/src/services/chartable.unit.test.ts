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

describe("a column that has the shape of a date but not the meaning", () => {
  // Straight from the INSPQ Rt series as it sits in the platform: 112 of 200
  // sampled values carry a month between 13 and 31. Day and month are the
  // wrong way round, and the only rows that survive the swap are the ones
  // where the day is twelve or less — so the fault hides behind a column that
  // looks two-thirds fine.
  const RT = [{ name: "date", type: "string" as const }];
  const rows = [
    ...["2020-01-07", "2020-02-07", "2020-03-07", "2020-11-07", "2020-12-07"].map((date) => ({ date })),
    ...["2020-13-07", "2020-14-07", "2020-25-07", "2020-31-12"].map((date) => ({ date })),
  ];

  it("does not call it a timeline", () => {
    // Plotted, half the points land nowhere and the curve is a lie.
    assert.notEqual(readColumns(RT, rows)[0]!.role, "time");
  });

  it("does not quietly file it under text either", () => {
    // "du texte, 200 valeurs distinctes" hides a broken import behind a
    // missing chart type.
    const f = readColumns(RT, rows)[0]!;
    assert.equal(f.role, "unusable");
    assert.match(f.reason, /forme d'une date/);
  });

  it("counts how many are impossible and shows one", () => {
    const f = readColumns(RT, rows)[0]!;
    assert.match(f.reason, /^4 valeurs/);
    assert.match(f.reason, /2020-13-07/);
  });

  it("names the likely cause without asserting it", () => {
    assert.match(readColumns(RT, rows)[0]!.reason, /jour et mois inversés \?/);
  });

  it("carries the finding up into the picker", () => {
    // The one place somebody is looking when they wonder why there is no curve.
    assert.match(String(whyNoChart(readColumns(RT, rows))), /date/);
  });

  it("still accepts a column where every date is real", () => {
    const ok = ["2020-01-07", "2020-07-13", "2020-12-31"].map((date) => ({ date }));
    assert.equal(readColumns(RT, ok)[0]!.role, "time");
  });
});

describe("a date column whose day and month could be swapped", () => {
  // The case the Rt series would have been if every true day had fallen on the
  // twelfth or earlier: every value parses, every chart draws, and the curve is
  // wrong by up to eleven months with nothing anywhere to say so.
  const COL = [{ name: "date", type: "string" as const }];
  const rows = (dates: string[]) => dates.map((date) => ({ date }));

  const swapped: string[] = [];
  for (let mois = 1; mois <= 12; mois++) {
    for (let jour = 1; jour <= 5; jour++) {
      swapped.push(`2021-${String(jour).padStart(2, "0")}-${String(mois).padStart(2, "0")}`);
    }
  }

  it("still calls it a time column, because it does plot", () => {
    // The ambiguity is a question about the source, not a fault in the values.
    assert.equal(readColumns(COL, rows(swapped))[0]!.role, "time");
  });

  it("says the two fields cannot be told apart", () => {
    assert.match(readColumns(COL, rows(swapped))[0]!.reason, /indistinguables/);
  });

  it("stays quiet on a real daily series", () => {
    // Any run of more than a fortnight crosses the 13th of some month.
    const jours = Array.from({ length: 60 }, (_, i) => {
      const d = new Date(Date.UTC(2021, 0, 1 + i));
      return d.toISOString().slice(0, 10);
    });
    assert.equal(readColumns(COL, rows(jours))[0]!.reason, "des dates");
  });

  it("stays quiet on monthly data stamped on the first", () => {
    // The day never varies, so the two fields are not interchangeable — this
    // was the false positive the rule had to avoid.
    const mois = Array.from({ length: 36 }, (_, i) =>
      `${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`,
    );
    assert.equal(readColumns(COL, rows(mois))[0]!.reason, "des dates");
  });

  it("stays quiet when there is too little to judge", () => {
    // Four dates prove nothing, and a warning nobody can act on is noise.
    assert.equal(
      readColumns(COL, rows(["2021-01-02", "2021-02-03", "2021-03-04", "2021-04-05"]))[0]!.reason,
      "des dates",
    );
  });
});
