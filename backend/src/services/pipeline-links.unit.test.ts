import assert from "node:assert/strict";
import { test } from "node:test";

import { validate, type LinkRule, type PipelineNode } from "./pipeline.js";

function node(
  id: string,
  kind: PipelineNode["kind"],
  config: Record<string, unknown> = {},
): PipelineNode {
  return { id, kind, name: id, x: 0, y: 0, config };
}

const RULE: LinkRule = {
  linkType: "located_in",
  targetType: "OrgUnit",
  fromColumn: "unit",
  targetProperty: "name",
};

function chain(outputConfig: Record<string, unknown>) {
  return {
    nodes: [node("in", "dataset_input", { datasetId: "d1" }), node("out", "object_output", outputConfig)],
    edges: [{ from: "in", to: "out" }],
  };
}

test("a complete link rule passes validation", () => {
  const issues = validate(
    chain({ objectTypeName: "Patient", identityProperties: ["mrn"], linkRules: [RULE] }),
  );
  assert.deepEqual(issues, []);
});

test("an incomplete link rule is refused, naming what is missing", () => {
  // Half-filled is worse than absent: it looks configured on the canvas and
  // links nothing at run time.
  const issues = validate(
    chain({
      objectTypeName: "Patient",
      identityProperties: ["mrn"],
      linkRules: [{ linkType: "located_in", targetType: "OrgUnit" }],
    }),
  );
  assert.equal(issues.length, 1);
  assert.match(issues[0]!.message, /incomplete/);
  assert.match(issues[0]!.message, /fromColumn/);
  assert.match(issues[0]!.message, /targetProperty/);
  assert.equal(issues[0]!.nodeId, "out");
});

test("every incomplete rule is reported, not just the first", () => {
  const issues = validate(
    chain({
      objectTypeName: "Patient",
      identityProperties: ["mrn"],
      linkRules: [{ linkType: "located_in" }, { targetType: "Bed" }],
    }),
  );
  assert.equal(issues.length, 2);
});

test("an output with no link rules is still valid", () => {
  assert.deepEqual(
    validate(chain({ objectTypeName: "Patient", identityProperties: ["mrn"] })),
    [],
  );
});

test("link rules do not excuse a missing identity key", () => {
  const issues = validate(
    chain({ objectTypeName: "Patient", identityProperties: [], linkRules: [RULE] }),
  );
  assert.ok(issues.some((i) => /every run duplicates/.test(i.message)));
});
