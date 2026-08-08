import assert from "node:assert/strict";
import { test } from "node:test";

import { compareVersions } from "./version-compare.js";

// ---------------------------------------------------------------------------
// The preflight check for moving Postgres images refuses a target whose
// extensions are older than the source's. That refusal is only worth anything
// if "older" is computed correctly, and the interesting case is the one a
// string compare gets backwards.
// ---------------------------------------------------------------------------

test("orders by number, not by string", () => {
  // The case that matters: "0.10.0" < "0.8.6" lexically, and a preflight check
  // that believed it would wave through a downgrade.
  assert.equal(compareVersions("0.10.0", "0.8.6") > 0, true);
  assert.equal(compareVersions("0.8.6", "0.10.0") < 0, true);
});

test("treats a missing segment as zero", () => {
  assert.equal(compareVersions("3.6", "3.6.0"), 0);
  assert.equal(compareVersions("3.6.0", "3.6"), 0);
  assert.equal(compareVersions("3.6.1", "3.6") > 0, true);
});

test("equal versions compare equal", () => {
  assert.equal(compareVersions("3.6.0", "3.6.0"), 0);
  assert.equal(compareVersions("0.8.6", "0.8.6"), 0);
});

test("ignores a non-numeric tail rather than guessing", () => {
  // PostGIS sometimes carries build detail; it must not flip the ordering.
  assert.equal(compareVersions("3.6.0", "3.6.0 r12345") <= 0, true);
  assert.equal(compareVersions("3.5.0", "3.6.0 r12345") < 0, true);
});

test("major beats minor beats patch", () => {
  assert.equal(compareVersions("4.0.0", "3.99.99") > 0, true);
  assert.equal(compareVersions("3.6.0", "3.5.99") > 0, true);
  assert.equal(compareVersions("3.6.1", "3.6.0") > 0, true);
});

test("survives the versions actually in play", () => {
  // Source is what production reports; target is what the new image ships.
  assert.equal(compareVersions("0.8.6", "0.8.6"), 0, "pgvector must not regress");
  assert.equal(compareVersions("3.6.0", "0.0.0") > 0, true);
});
