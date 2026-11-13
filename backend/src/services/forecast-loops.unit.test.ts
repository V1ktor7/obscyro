import assert from "node:assert/strict";
import { test } from "node:test";

import { BLOCK_DAYS, addDays, mergeSeries, nextBlock, numberOf } from "./forecast-loops.js";

test("a published dot is a missing value, not a zero", () => {
  assert.equal(numberOf("."), null);
  assert.equal(numberOf(""), null);
  assert.equal(numberOf("12,5"), 12.5);
  assert.equal(numberOf("0"), 0);
});

test("the driver joins the target by date, and the series ends at its last value", () => {
  const target = [
    { date: "2022-01-02", n: "5" },
    { date: "2022-01-01", n: "3" },
    { date: "2022-01-03", n: "." },
  ];
  const driver = { rows: [{ jour: "2022-01-01", p: "0.2" }, { jour: "2022-01-02", p: "." }], timeColumn: "jour", column: "p" };
  const m = mergeSeries(target, "date", "n", driver);
  assert.deepEqual(m.rows.map((r) => r.date), ["2022-01-01", "2022-01-02", "2022-01-03"]);
  assert.deepEqual(m.rows.map((r) => r.x), [0.2, null, null]);
  assert.equal(m.lastDay, "2022-01-02");
  assert.deepEqual(m.actual, { "2022-01-01": 3, "2022-01-02": 5 });
});

test("two rows on one day are refused rather than read as consecutive days", () => {
  assert.throws(
    () => mergeSeries([{ d: "2022-01-01", n: 1 }, { d: "2022-01-01", n: 2 }], "d", "n"),
    /one value a day/,
  );
});

test("blocks walk from the first morning to the morning after the data, then stop", () => {
  const first = nextBlock("2021-09-06", null, "2021-12-31");
  assert.deepEqual(first, { first: "2021-09-06", last: addDays("2021-09-06", BLOCK_DAYS - 1) });
  const later = nextBlock("2021-09-06", "2021-12-20", "2021-12-31");
  assert.deepEqual(later, { first: "2021-12-21", last: "2022-01-01" });
  assert.equal(nextBlock("2021-09-06", "2022-01-01", "2021-12-31"), null);
  assert.equal(nextBlock("2021-09-06", null, null), null);
});
