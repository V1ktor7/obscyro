import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyExpand } from "./pipeline.js";

/**
 * Turning a published count into the units a twin reasons about.
 *
 * Every capacity register publishes "this installation is licensed for 30
 * permanent beds". The twin reasons about beds, because a bed is either free or
 * holding someone and a number cannot be either. Closing that gap in a
 * spreadsheet before upload means the file that arrives is no longer the file
 * the ministry published — which is exactly the objection this node exists to
 * answer.
 */
describe("expanding a count into units", () => {
  const rows = [
    { installation: "Notre-Dame", service: "CHSGS", capacite: "3" },
    { installation: "Verdun", service: "CHSLD", capacite: "2" },
  ];

  it("makes one row per unit", () => {
    const out = applyExpand(rows, { countColumn: "capacite" });
    assert.equal(out.rows.length, 5);
    assert.equal(out.rows.filter((r) => r.installation === "Notre-Dame").length, 3);
  });

  it("numbers them, so an upsert does not collapse them back into one", () => {
    // The rows are otherwise identical. Keyed on the source columns alone,
    // thirty beds would upsert onto each other and the twin would hold one.
    const out = applyExpand(rows, { countColumn: "capacite" });
    const nd = out.rows.filter((r) => r.installation === "Notre-Dame");
    assert.deepEqual(
      nd.map((r) => r.unit_index),
      [1, 2, 3],
    );
  });

  it("keeps every column the row arrived with", () => {
    const [first] = applyExpand(rows, { countColumn: "capacite" }).rows;
    assert.equal(first!.service, "CHSGS");
  });

  it("lets the index column be named", () => {
    const out = applyExpand(rows, { countColumn: "capacite", indexColumn: "lit" });
    assert.equal(out.rows[0]!.lit, 1);
  });

  it("drops a blank count rather than passing it through as one", () => {
    // Passed through, a licence with no capacity recorded becomes a single bed
    // that nobody declared, and it counts against occupancy forever.
    const out = applyExpand([{ installation: "X", capacite: "" }], { countColumn: "capacite" });
    assert.equal(out.rows.length, 0);
    assert.equal(out.dropped, 1);
  });

  it("drops a count that is not a number", () => {
    const out = applyExpand([{ installation: "X", capacite: "s.o." }], {
      countColumn: "capacite",
    });
    assert.equal(out.rows.length, 0);
  });

  it("takes the whole units of a fractional count", () => {
    // Half a bed is not half admissible. Rounding up would invent capacity.
    const out = applyExpand([{ c: "2.7" }], { countColumn: "c" });
    assert.equal(out.rows.length, 2);
  });

  it("refuses one absurd row and says which, rather than taking the run down", () => {
    // A column read as capacity that is actually an amount in dollars would
    // expand to four million rows. Naming the row is what lets the author fix
    // the mapping; failing the run only says the file is bad.
    const out = applyExpand(
      [
        { nom: "Notre-Dame", c: "4000000" },
        { nom: "Verdun", c: "4" },
      ],
      { countColumn: "c", labelColumn: "nom" },
    );
    assert.equal(out.rows.length, 4, "the sane row still expanded");
    assert.equal(out.dropped, 1);
    assert.match(String(out.issue), /Notre-Dame/);
    assert.match(String(out.issue), /4,000,000/);
  });

  it("lets the ceiling be raised when the count really is that large", () => {
    const out = applyExpand([{ c: "8000" }], { countColumn: "c", maxPerRow: 10000 });
    assert.equal(out.rows.length, 8000);
    assert.equal(out.issue, null);
  });

  it("passes everything through untouched when no column is named", () => {
    // Half-configured, the node does nothing rather than guessing at a column.
    // Guessing wrong would silently multiply the ontology.
    const out = applyExpand(rows, {});
    assert.equal(out.rows.length, 2);
    assert.equal(out.issue, null);
  });

  it("leaves the rows it was given untouched", () => {
    const given = [{ c: "2" }];
    applyExpand(given, { countColumn: "c" });
    assert.deepEqual(given, [{ c: "2" }]);
  });
});
