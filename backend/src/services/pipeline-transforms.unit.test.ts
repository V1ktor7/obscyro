import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyCast,
  applyDerive,
  applyFilter,
  applyJoin,
  applySelect,
  type Row,
} from "./pipeline.js";

// Rows shaped like the INSPQ variant surveillance data actually loaded.
const ROWS: Row[] = [
  { Date: "2024-12-29", Croisement: "KP.3.1.1", nbrvar: "12", proportion: "9.6" },
  { Date: "2024-12-29", Croisement: "Autres", nbrvar: "2", proportion: "1,6" },
  { Date: "2024-12-29", Croisement: "LF.7", nbrvar: "0", proportion: "0" },
  { Date: "2025-01-05", Croisement: "MC.1.2", nbrvar: "19", proportion: "15.2" },
];

test("filter compares numerically when both sides are numbers", () => {
  // "12" > "2" is false as strings and true as numbers; the string answer is
  // the one that quietly produces a wrong dataset.
  const out = applyFilter(ROWS, { column: "nbrvar", op: "gt", value: 2 });
  assert.deepEqual(out.map((r) => r.Croisement), ["KP.3.1.1", "MC.1.2"]);
});

test("filter handles blanks explicitly rather than treating them as a value", () => {
  const rows: Row[] = [{ a: "" }, { a: null }, { a: "x" }];
  assert.equal(applyFilter(rows, { column: "a", op: "not_null" }).length, 1);
  assert.equal(applyFilter(rows, { column: "a", op: "is_null" }).length, 2);
});

test("filter keeps every row when no column is chosen instead of dropping all", () => {
  assert.equal(applyFilter(ROWS, { op: "eq", value: "x" }).length, ROWS.length);
});

test("select keeps, drops and renames", () => {
  const out = applySelect(ROWS, {
    keep: ["Date", "Croisement", "nbrvar"],
    rename: { Croisement: "lineage" },
  });
  assert.deepEqual(Object.keys(out[0]!), ["Date", "lineage", "nbrvar"]);
  assert.equal(out[0]!.lineage, "KP.3.1.1");
});

test("derive concat builds the composite key an ontology output needs", () => {
  const out = applyDerive(ROWS, {
    as: "key",
    op: "concat",
    columns: ["Date", "Croisement"],
    separator: "|",
  });
  assert.equal(out[0]!.key, "2024-12-29|KP.3.1.1");
  // Distinct per row — the property that stops 294 rows collapsing to 6.
  assert.equal(new Set(out.map((r) => r.key)).size, ROWS.length);
});

test("derive date_part and arithmetic", () => {
  const parts = applyDerive(ROWS, { as: "yr", op: "date_part", columns: ["Date"], part: "year" });
  assert.equal(parts[0]!.yr, 2024);
  const doubled = applyDerive(ROWS, {
    as: "twice",
    op: "arithmetic",
    columns: ["nbrvar"],
    arith: "multiply",
    value: 2,
  });
  assert.equal(doubled[0]!.twice, 24);
});

test("derive divide by zero yields null rather than Infinity", () => {
  const out = applyDerive([{ a: 5 }], {
    as: "r",
    op: "arithmetic",
    columns: ["a"],
    arith: "divide",
    value: 0,
  });
  assert.equal(out[0]!.r, null);
});

test("derive conditional flags the aggregate bucket that is not a real lineage", () => {
  const out = applyDerive(ROWS, {
    as: "isAggregate",
    op: "conditional",
    columns: ["Croisement"],
    compareOp: "eq",
    compareTo: "Autres",
    thenValue: true,
    elseValue: false,
  });
  assert.deepEqual(out.map((r) => r.isAggregate), [false, true, false, false]);
});

test("cast converts types and handles the comma decimal in the source data", () => {
  const { rows, dropped } = applyCast(ROWS, {
    casts: [
      { column: "nbrvar", to: "number" },
      { column: "proportion", to: "number" },
      { column: "Date", to: "date" },
    ],
  });
  assert.equal(dropped, 0);
  assert.equal(rows[0]!.nbrvar, 12);
  assert.equal(rows[1]!.proportion, 1.6, "1,6 is 1.6, not a failed cast");
});

test("cast nulls a bad value by default and counts the row when told to drop", () => {
  const bad: Row[] = [{ n: "12" }, { n: "not a number" }];
  const nulled = applyCast(bad, { casts: [{ column: "n", to: "number" }] });
  assert.equal(nulled.rows.length, 2);
  assert.equal(nulled.rows[1]!.n, null);

  const dropped = applyCast(bad, {
    casts: [{ column: "n", to: "number" }],
    onError: "drop_row",
  });
  assert.equal(dropped.rows.length, 1);
  assert.equal(dropped.dropped, 1, "a dropped row is counted so the canvas can show it");
});

test("cast trims and fills before casting", () => {
  const { rows } = applyCast([{ a: "  7  ", b: "" }], {
    trim: ["a"],
    fillNulls: { b: "unknown" },
    casts: [{ column: "a", to: "number" }],
  });
  assert.equal(rows[0]!.a, 7);
  assert.equal(rows[0]!.b, "unknown");
});

test("join renames colliding columns instead of overwriting them", () => {
  const left: Row[] = [{ id: "1", name: "ward A", beds: 20 }];
  const right: Row[] = [{ id: "1", name: "Jewish General", region: "MTL" }];
  const out = applyJoin(left, right, { leftKey: "id", rightKey: "id" });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.name, "ward A", "the left value survives");
  assert.equal(out[0]!.name_right, "Jewish General", "and the right one is still reachable");
  assert.equal(out[0]!.region, "MTL");
});

test("join inner drops unmatched, left keeps them", () => {
  const left: Row[] = [{ id: "1" }, { id: "2" }];
  const right: Row[] = [{ id: "1", extra: "x" }];
  assert.equal(applyJoin(left, right, { leftKey: "id", rightKey: "id" }).length, 1);
  const outer = applyJoin(left, right, { leftKey: "id", rightKey: "id", kind: "left" });
  assert.equal(outer.length, 2);
  assert.equal(outer[1]!.extra, undefined);
});

test("join fans out on a one-to-many match", () => {
  const left: Row[] = [{ id: "1" }];
  const right: Row[] = [{ id: "1", n: 1 }, { id: "1", n: 2 }];
  const out = applyJoin(left, right, { leftKey: "id", rightKey: "id", rightPrefix: "r_" });
  assert.equal(out.length, 2, "row count growing after a join is expected, not a bug");
  assert.deepEqual(out.map((r) => r.r_n), [1, 2]);
});
