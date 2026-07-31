import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertLensSupported,
  isLive,
  linkVisibilitySql,
  type ReadLens,
} from "./ontology-lens.js";

// ---------------------------------------------------------------------------
// The contract this phase is buying: an unimplemented lens fails at the caller.
// The alternative — accepting the option and returning live data anyway — is
// the worst available outcome, because a scenario comparison would then be
// comparing reality against itself and look like it worked.
// ---------------------------------------------------------------------------

test("no lens is live", () => {
  assert.equal(isLive(undefined), true);
  assert.equal(isLive({}), true);
  assert.doesNotThrow(() => assertLensSupported(undefined));
  assert.doesNotThrow(() => assertLensSupported({}));
});

test("asOf is refused, and says why", () => {
  assert.throws(
    () => assertLensSupported({ asOf: "2026-07-29T14:00:00Z" }),
    /not implemented yet/,
  );
});

test("scenarioId is refused", () => {
  assert.throws(
    () => assertLensSupported({ scenarioId: "00000000-0000-0000-0000-000000000001" }),
    /scenario is not implemented yet/,
  );
});

test("an offset without a scenario is a mistake, not a silent no-op", () => {
  assert.throws(() => assertLensSupported({ atOffsetHours: 216 }), /needs a scenarioId/);
});

test("a lens is accepted once its capability is declared supported", () => {
  const lens: ReadLens = { asOf: "2026-07-29T14:00:00Z" };
  assert.doesNotThrow(() => assertLensSupported(lens, ["live", "asOf"]));
  // and the scenario option is still refused independently
  assert.throws(() => assertLensSupported({ ...lens, scenarioId: "x" }, ["live", "asOf"]), /scenario/);
});

test("live visibility is open links only", () => {
  // A closed link was true once. Counting it now means a discharged patient
  // still occupies a bed.
  assert.equal(linkVisibilitySql(undefined), "li.valid_to IS NULL");
  assert.equal(linkVisibilitySql({}, "l"), "l.valid_to IS NULL");
});

test("a past instant becomes the open-interval test", () => {
  const sql = linkVisibilitySql({ asOf: "2026-07-29T14:00:00Z" });
  assert.match(sql, /valid_from <= /);
  assert.match(sql, /valid_to IS NULL OR li\.valid_to > /);
});
