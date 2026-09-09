import assert from "node:assert/strict";
import { test } from "node:test";

import { describeIdentityViolation, identityKeyOf, identityReadiness } from "./identity.js";

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

// ---------------------------------------------------------------------------
// An identity made of two properties.
//
// `identityReadiness` builds its SQL by joining one fragment per property. The
// sample-value fragment was `properties ->> $2 || ' · ' || properties ->> $3`,
// and in Postgres `||` shares precedence with `->>` and binds left to right —
// so that reads `((properties ->> $2) || ' · ' || properties) ->> $3`, which is
// `text ->> text`. No such operator: 42883, every time, for every type whose
// identity needed more than one column. A wastewater reading is identified by
// its site *and* its target; neither alone says what was measured.
// ---------------------------------------------------------------------------

test("a two-part identity produces SQL Postgres can parse", async () => {
  const seen: string[] = [];
  const db = {
    query: async (sql: string) => {
      seen.push(sql);
      if (sql.includes("property_schema")) {
        return { rows: [{ property_schema: [{ key: "site" }, { key: "mesure" }] }], rowCount: 1 };
      }
      if (sql.includes("count(*)::text AS total")) {
        return { rows: [{ total: "0", missing: "0" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Parameters<typeof identityReadiness>[0];

  await identityReadiness(db, "type-1", ["site", "mesure"]);

  const dupes = seen.find((s) => s.includes("AS vals"));
  assert.ok(dupes, "the duplicate scan ran");
  // Each extraction stands alone, so `||` can only ever join two texts.
  assert.match(dupes!, /\(properties ->> \$2\) \|\| ' · ' \|\| \(properties ->> \$3\)/);
  assert.ok(
    !/properties ->> \$\d+ \|\|/.test(dupes!),
    "an unparenthesised extraction beside a concatenation is the 42883 bug",
  );
});

test("a one-part identity is unchanged by the fix", () => {
  assert.equal(identityKeyOf({ code: "A" }, ["code"]), '["a"]');
});
