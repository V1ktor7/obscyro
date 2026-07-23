import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildMapProperties, coerceValue } from "./channel-runner.js";
import type { PropertyDef } from "./ontology.js";

describe("coerceValue", () => {
  it("passes numbers through", () => {
    assert.deepEqual(coerceValue(3.2, "number", "value"), { value: 3.2, issue: null });
  });

  it("parses French comma decimals (locale-aware)", () => {
    assert.deepEqual(coerceValue("3,2", "number", "value"), { value: 3.2, issue: null });
    assert.deepEqual(coerceValue("1 234,5", "number", "value"), { value: 1234.5, issue: null });
  });

  it("flags a non-number instead of writing NaN", () => {
    const r = coerceValue("N/A", "number", "value");
    assert.equal(r.value, null);
    assert.ok(r.issue);
    assert.equal(r.issue?.field, "value");
  });

  it("coerces FR/EN booleans", () => {
    assert.equal(coerceValue("oui", "boolean", "x").value, true);
    assert.equal(coerceValue("non", "boolean", "x").value, false);
    assert.ok(coerceValue("maybe", "boolean", "x").issue);
  });

  it("normalizes dates to ISO and flags junk", () => {
    assert.equal(coerceValue("2026-07-22", "date", "d").value, new Date("2026-07-22").toISOString());
    assert.ok(coerceValue("not-a-date", "date", "d").issue);
  });

  it("leaves null/undefined untouched", () => {
    assert.deepEqual(coerceValue(null, "number", "x"), { value: null, issue: null });
    assert.deepEqual(coerceValue(undefined, "number", "x"), { value: undefined, issue: null });
  });
});

describe("buildMapProperties", () => {
  const schema: PropertyDef[] = [
    { key: "identifier", type: "string", required: true },
    { key: "value", type: "number", required: true },
    { key: "unit", type: "string" },
  ];

  it("maps and coerces, no issues on a clean item", () => {
    const r = buildMapProperties(
      { mrn: "12-3456", v: "3,2", u: "ng/L" },
      [
        { from: "mrn", to: "identifier" },
        { from: "v", to: "value", coerce: "number" },
        { from: "u", to: "unit" },
      ],
      schema,
    );
    assert.deepEqual(r.properties, { identifier: "12-3456", value: 3.2, unit: "ng/L" });
    assert.equal(r.issues.length, 0);
    assert.equal(r.missingRequired.length, 0);
  });

  it("reports a required property that was never mapped", () => {
    const r = buildMapProperties({ mrn: "12-3456" }, [{ from: "mrn", to: "identifier" }], schema);
    assert.deepEqual(r.missingRequired, ["value"]);
  });

  it("honors onMissing policies", () => {
    const skip = buildMapProperties({}, [{ from: "x", to: "unit", onMissing: "skip" }], schema);
    assert.equal("unit" in skip.properties, false);
    const nul = buildMapProperties({}, [{ from: "x", to: "unit", onMissing: "null" }], schema);
    assert.equal(nul.properties.unit, null);
    const flag = buildMapProperties({}, [{ from: "x", to: "unit", onMissing: "flag" }], schema);
    assert.equal(flag.issues.length, 1);
  });

  it("routes a coercion failure to issues, not the properties", () => {
    const r = buildMapProperties(
      { mrn: "12-3456", v: "N/A" },
      [
        { from: "mrn", to: "identifier" },
        { from: "v", to: "value", coerce: "number" },
      ],
      schema,
    );
    assert.equal("value" in r.properties, false);
    assert.equal(r.issues.length, 1);
    assert.deepEqual(r.missingRequired, ["value"]);
  });
});
