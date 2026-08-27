import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseDelimited, sniffDelimiter } from "./rest-connector.js";

/**
 * Which character separates the fields, decided by counting rather than by
 * asking whether one is present.
 *
 * The presence test read a single stray tab as "this whole file is
 * tab-separated". One real file does exactly that: the ministry's hourly
 * emergency-department release pads the inside of a column name with tabs. Nine
 * columns came back as three, and nothing complained — splitting on the wrong
 * character always succeeds.
 */

/** The real header, as the ministry publishes it, tabs and all. */
const MSSS =
  "Nom_etablissement,Nom_installation,No_permis_installation," +
  "Nombre_de_civieres_fonctionnelles,Nombre_de_civieres_occupees\t\t                 ," +
  "Nombre_de_patients_sur_civiere_plus_de_24_heures," +
  "Nombre_de_patients_sur_civiere_plus_de_48_heures," +
  "Heure_de_l'extraction_(image),Mise_a_jour\n" +
  "SANTÉ QUÉBEC BAS-SAINT-LAURENT,HÔPITAL DE MATANE,51218980,7,9,2,0,15:00:00,2026-08-25T15:45\n";

describe("choosing the separator", () => {
  it("keeps the comma when a header merely contains a tab", () => {
    // Eight commas against two tabs. Presence picked the tabs.
    assert.equal(sniffDelimiter(MSSS), ",");
  });

  it("reads that file as the nine columns it has", () => {
    const rows = parseDelimited(MSSS);
    assert.equal(rows.length, 1);
    assert.equal(Object.keys(rows[0]!).length, 9);
    assert.equal(rows[0]!["No_permis_installation"], "51218980");
    assert.equal(rows[0]!["Nombre_de_civieres_fonctionnelles"], "7");
  });

  it("still reads a real tab-separated file as one", () => {
    const tsv = "a\tb\tc\n1\t2\t3\n";
    assert.equal(sniffDelimiter(tsv), "\t");
    assert.deepEqual(parseDelimited(tsv), [{ a: "1", b: "2", c: "3" }]);
  });

  it("takes semicolons when they outnumber both", () => {
    // Several European exports use them, often alongside decimal commas.
    const eu = "nom;valeur;unite\nlit;3,5;m\n";
    assert.equal(sniffDelimiter(eu), ";");
    assert.equal(parseDelimited(eu)[0]!["valeur"], "3,5");
  });

  it("does not let a decimal comma outvote the semicolon", () => {
    // Three semicolons, four commas inside the numbers. Counting alone would
    // pick the comma and shred the file.
    const eu = "a;b;c;d\n1,5;2,5;3,5;4,5\n";
    assert.equal(sniffDelimiter(eu), ";");
  });

  it("defaults to the comma on a header with no separator at all", () => {
    assert.equal(sniffDelimiter("colonne_unique\nvaleur\n"), ",");
  });

  it("reads a single-line response without a trailing newline", () => {
    assert.equal(sniffDelimiter("a,b,c"), ",");
  });
});
