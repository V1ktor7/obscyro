import assert from "node:assert/strict";
import { test } from "node:test";

import { assertProfileBody } from "./sim-profiles.js";

test("a profile is a series, an exposure or saved changes", () => {
  assert.doesNotThrow(() => assertProfileBody({ kind: "exposure", coef: "pm25-asthma-er", series: "20 40", usual: null }));
  assert.throws(() => assertProfileBody({ kind: "recipe" }), /series, an exposure or saved changes/);
  assert.throws(() => assertProfileBody({}), /series, an exposure or saved changes/);
});

test("a series keeps a daily rate, never negative", () => {
  assert.doesNotThrow(() => assertProfileBody({ kind: "series", curve: [0.1, 0.2, 0], sev: "hosp" }));
  assert.throws(() => assertProfileBody({ kind: "series", curve: [] }), /daily rate/);
  assert.throws(() => assertProfileBody({ kind: "series", curve: [0.1, -1] }), /daily rate/);
});

test("a profile is not a file", () => {
  const big = { kind: "series", curve: Array.from({ length: 80000 }, () => 0.123456789) };
  assert.throws(() => assertProfileBody(big), /keep it under/);
});
