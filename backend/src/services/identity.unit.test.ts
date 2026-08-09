import assert from "node:assert/strict";
import { test } from "node:test";

import { describeIdentityViolation, identityKeyOf } from "./identity.js";

// ---------------------------------------------------------------------------
// `identityKeyOf` has to agree with the SQL in migration 043 exactly. It is the
// same rule written twice — once in plpgsql for the trigger that enforces it,
// once here for the write path that looks instances up before inserting. When
// the two disagree, the application finds nothing, inserts, and is refused by
// its own constraint.
//
// So these tests are really about the seam: they pin the normalisation the
// trigger performs (`lower(btrim(v))`, values as a JSON array).
// ---------------------------------------------------------------------------

test("normalises case and surrounding space, like the trigger", () => {
  const a = identityKeyOf({ code: "HND-01" }, ["code"]);
  const b = identityKeyOf({ code: "  hnd-01 " }, ["code"]);
  assert.equal(a, b);
  assert.equal(a, '["hnd-01"]');
});

test("keeps interior space, because it distinguishes real names", () => {
  assert.notEqual(
    identityKeyOf({ name: "HND Emergency" }, ["name"]),
    identityKeyOf({ name: "HNDEmergency" }, ["name"]),
  );
});

test("a composite key is an array, not a joined string", () => {
  // The case a separator would get wrong: ("a|b", "c") and ("a", "b|c") are
  // different objects, and joining on "|" would merge them.
  assert.notEqual(
    identityKeyOf({ x: "a|b", y: "c" }, ["x", "y"]),
    identityKeyOf({ x: "a", y: "b|c" }, ["x", "y"]),
  );
});

test("order follows the declaration, so (a,b) is not (b,a)", () => {
  assert.notEqual(
    identityKeyOf({ x: "1", y: "2" }, ["x", "y"]),
    identityKeyOf({ x: "1", y: "2" }, ["y", "x"]),
  );
});

test("no key at all when an identifying property is absent or blank", () => {
  assert.equal(identityKeyOf({ code: null }, ["code"]), null);
  assert.equal(identityKeyOf({}, ["code"]), null);
  assert.equal(identityKeyOf({ code: "   " }, ["code"]), null);
  assert.equal(identityKeyOf({ code: "A", other: null }, ["code", "other"]), null);
});

test("numbers and strings that read the same identify the same thing", () => {
  // A CSV import yields "42"; a JSON feed yields 42. They are one bed.
  assert.equal(identityKeyOf({ code: 42 }, ["code"]), identityKeyOf({ code: "42" }, ["code"]));
});

test("translates the constraint violation into something actionable", () => {
  const msg = describeIdentityViolation({
    code: "23505",
    constraint: "instance_identity_pkey",
  });
  assert.match(msg ?? "", /already carries these identifying values/);
});

test("passes unrelated errors through untouched", () => {
  assert.equal(describeIdentityViolation({ code: "23505", constraint: "users_email_key" }), null);
  assert.equal(describeIdentityViolation(new Error("boom")), null);
  assert.equal(describeIdentityViolation(null), null);
});
