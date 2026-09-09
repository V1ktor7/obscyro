import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyLatest } from "./pipeline.js";

/**
 * Reducing a published series to the current reading.
 *
 * The two real files that forced this node: Montreal's air quality CSV, which
 * carries one row per station per hour of the day, and the federal wastewater
 * aggregate, which carries three hundred weeks per site and measure. Before
 * this, the only way to get one row per entity was to write them all and let
 * the last one in file order win — correct exactly as long as the publisher
 * keeps sorting the file the way it happens to sort it today.
 */

const rows = (...r: Record<string, unknown>[]) => r;

describe("one row per key, the latest one", () => {
  it("keeps the highest hour for each station", () => {
    const out = applyLatest(
      rows(
        { st: "3", h: 0, iqa: 15 },
        { st: "3", h: 11, iqa: 9 },
        { st: "80", h: 0, iqa: 15 },
        { st: "80", h: 11, iqa: 9 },
      ),
      { keys: ["st"], orderBy: "h" },
    );
    assert.equal(out.length, 2);
    assert.deepEqual(out.map((r) => [r.st, r.h]), [["3", 11], ["80", 11]]);
  });

  it("compares hours as numbers, not as text", () => {
    // The trap this node exists to close. As text "11" sorts below "9", so a
    // string comparison hands back the nine o'clock reading at eleven — an
    // off-by-two-hours air quality figure that never announces itself.
    const out = applyLatest(
      rows({ st: "3", h: "9", iqa: 40 }, { st: "3", h: "11", iqa: 8 }),
      { keys: ["st"], orderBy: "h" },
    );
    assert.deepEqual(out, [{ st: "3", h: "11", iqa: 8 }]);
  });

  it("compares ISO dates as text, which orders them correctly", () => {
    const out = applyLatest(
      rows(
        { site: "Montreal North", m: "covN2", weekstart: "2026-08-16", v: 2.38 },
        { site: "Montreal North", m: "covN2", weekstart: "2022-10-30", v: 3.37 },
        { site: "Montreal North", m: "covN2", weekstart: "2026-01-04", v: 1.1 },
      ),
      { keys: ["site", "m"], orderBy: "weekstart" },
    );
    assert.deepEqual(out.map((r) => r.weekstart), ["2026-08-16"]);
  });

  it("separates entities by every key column, not just the first", () => {
    // Four measures share one site and are not interchangeable: their values
    // live on scales with no common unit.
    const out = applyLatest(
      rows(
        { site: "S", m: "covN2", w: "2026-08-16", v: 2.38 },
        { site: "S", m: "fluA", w: "2026-08-16", v: 0.36 },
        { site: "S", m: "fluB", w: "2026-08-16", v: 0.009 },
        { site: "S", m: "rsv", w: "2026-08-16", v: 0.008 },
      ),
      { keys: ["site", "m"], orderBy: "w" },
    );
    assert.equal(out.length, 4);
  });

  it("does not merge two entities because one is unlabelled", () => {
    const out = applyLatest(
      rows({ site: null, w: 1 }, { site: "Montreal South", w: 1 }),
      { keys: ["site"], orderBy: "w" },
    );
    assert.equal(out.length, 2);
  });
});

describe("what happens when the order value is missing", () => {
  it("prefers a row that has one", () => {
    const out = applyLatest(
      rows({ st: "3", h: null, iqa: 99 }, { st: "3", h: 4, iqa: 9 }),
      { keys: ["st"], orderBy: "h" },
    );
    assert.deepEqual(out, [{ st: "3", h: 4, iqa: 9 }]);
  });

  it("still keeps a row when the whole key has none", () => {
    // A station that stopped stamping its readings must not disappear from the
    // map. Losing the entity turns a reporting gap into a place that does not
    // exist, which reads as calm rather than as unknown.
    const out = applyLatest(
      rows({ st: "3", h: null, iqa: 12 }, { st: "3", h: "", iqa: 13 }),
      { keys: ["st"], orderBy: "h" },
    );
    assert.equal(out.length, 1);
    assert.equal(out[0]!.st, "3");
  });

  it("treats an empty string as missing, not as a value below zero", () => {
    const out = applyLatest(
      rows({ st: "3", h: "" }, { st: "3", h: 0 }),
      { keys: ["st"], orderBy: "h" },
    );
    assert.equal(out[0]!.h, 0);
  });
});

describe("determinism", () => {
  it("resolves a tie by input order, every time", () => {
    const input = rows({ st: "3", h: 5, tag: "a" }, { st: "3", h: 5, tag: "b" });
    for (let i = 0; i < 5; i++) {
      assert.equal(applyLatest(input, { keys: ["st"], orderBy: "h" })[0]!.tag, "a");
    }
  });

  it("returns keys in the order they first appeared", () => {
    const out = applyLatest(
      rows({ st: "80", h: 1 }, { st: "3", h: 1 }, { st: "80", h: 2 }),
      { keys: ["st"], orderBy: "h" },
    );
    assert.deepEqual(out.map((r) => r.st), ["80", "3"]);
  });

  it("does not reorder a column that is numeric except for one stray value", () => {
    // The comparison is chosen once for the column. If it were chosen per pair,
    // the same input could reduce differently depending on which rows met.
    const a = applyLatest(
      rows({ k: "x", o: "2" }, { k: "x", o: "10" }, { k: "x", o: "n/a" }),
      { keys: ["k"], orderBy: "o" },
    );
    const b = applyLatest(
      rows({ k: "x", o: "n/a" }, { k: "x", o: "10" }, { k: "x", o: "2" }),
      { keys: ["k"], orderBy: "o" },
    );
    assert.equal(a.length, 1);
    assert.deepEqual(a, b, "the same rows reduce the same way whatever their order");
  });
});

describe("a misconfigured node refuses rather than passes everything through", () => {
  it("refuses with no key column", () => {
    // Silently returning the input would deliver the whole series to the object
    // writer — the exact failure this node was built to prevent.
    assert.throws(() => applyLatest(rows({ a: 1 }), { orderBy: "h" }), /key/i);
  });

  it("refuses with no ordering column", () => {
    assert.throws(() => applyLatest(rows({ a: 1 }), { keys: ["a"] }), /orders/i);
  });

  it("refuses when the key list is empty", () => {
    assert.throws(() => applyLatest(rows({ a: 1 }), { keys: [], orderBy: "h" }), /key/i);
  });
});

describe("the shape of the real files", () => {
  it("reduces ten stations across twelve hours to ten rows", () => {
    const input: Record<string, unknown>[] = [];
    for (let h = 0; h <= 11; h++) {
      for (const st of ["3", "6", "17", "31", "55", "80", "99", "103"]) {
        input.push({ st, h, iqa: h === 11 ? 9 : 15 });
      }
    }
    const out = applyLatest(input, { keys: ["st"], orderBy: "h" });
    assert.equal(out.length, 8);
    assert.ok(out.every((r) => r.h === 11), "every station on the current hour");
    assert.ok(out.every((r) => r.iqa === 9));
  });
});
