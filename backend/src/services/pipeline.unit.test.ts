import assert from "node:assert/strict";
import { test } from "node:test";

import { topoSort, validate, type PipelineEdge, type PipelineNode } from "./pipeline.js";

function node(id: string, kind: PipelineNode["kind"], config: Record<string, unknown> = {}): PipelineNode {
  return { id, kind, name: id, x: 0, y: 0, config };
}

test("topoSort orders nodes by dependency, not by declaration", () => {
  const nodes = [
    node("out", "dataset_output", { datasetId: "d2" }),
    node("filter", "filter"),
    node("in", "dataset_input", { datasetId: "d1" }),
  ];
  const edges: PipelineEdge[] = [
    { from: "in", to: "filter" },
    { from: "filter", to: "out" },
  ];
  assert.deepEqual(
    topoSort(nodes, edges).map((n) => n.id),
    ["in", "filter", "out"],
  );
});

test("topoSort refuses a cycle instead of looping forever", () => {
  const nodes = [node("a", "filter"), node("b", "filter")];
  const edges: PipelineEdge[] = [
    { from: "a", to: "b" },
    { from: "b", to: "a" },
  ];
  assert.throws(() => topoSort(nodes, edges), /cycle/i);
});

test("topoSort handles a fan-out — the thing a linear step list cannot express", () => {
  const nodes = [
    node("in", "dataset_input", { datasetId: "d1" }),
    node("adults", "filter"),
    node("kids", "filter"),
    node("o1", "dataset_output", { datasetId: "d2" }),
    node("o2", "dataset_output", { datasetId: "d3" }),
  ];
  const edges: PipelineEdge[] = [
    { from: "in", to: "adults" },
    { from: "in", to: "kids" },
    { from: "adults", to: "o1" },
    { from: "kids", to: "o2" },
  ];
  const order = topoSort(nodes, edges).map((n) => n.id);
  assert.equal(order[0], "in");
  assert.ok(order.indexOf("adults") < order.indexOf("o1"));
  assert.ok(order.indexOf("kids") < order.indexOf("o2"));
});

test("validate reports every problem at once, not one per run", () => {
  const issues = validate({ nodes: [node("f", "filter")], edges: [] });
  const text = issues.map((i) => i.message).join(" ");
  assert.match(text, /needs somewhere to read from/);
  assert.match(text, /Add an output/);
  assert.match(text, /Nothing feeds this node/);
});

test("validate insists on an identity key for an ontology output", () => {
  const nodes = [
    node("in", "dataset_input", { datasetId: "d1" }),
    node("out", "object_output", { objectTypeName: "Patient", identityProperties: [] }),
  ];
  const issues = validate({ nodes, edges: [{ from: "in", to: "out" }] });
  assert.ok(
    issues.some((i) => i.nodeId === "out" && /every run duplicates/.test(i.message)),
    "an empty key silently collapses rows on re-run, so it has to block",
  );
});

test("validate accepts a key and stops complaining", () => {
  const nodes = [
    node("in", "dataset_input", { datasetId: "d1" }),
    node("out", "object_output", { objectTypeName: "Patient", identityProperties: ["mrn"] }),
  ];
  const issues = validate({ nodes, edges: [{ from: "in", to: "out" }] });
  assert.deepEqual(issues, []);
});

test("validate requires a join to have exactly one left and one right input", () => {
  const nodes = [
    node("a", "dataset_input", { datasetId: "d1" }),
    node("b", "dataset_input", { datasetId: "d2" }),
    node("j", "join", { leftKey: "id", rightKey: "id" }),
    node("out", "dataset_output", { datasetId: "d3" }),
  ];
  const bothLeft: PipelineEdge[] = [
    { from: "a", to: "j", toPort: "left" },
    { from: "b", to: "j", toPort: "left" },
    { from: "j", to: "out" },
  ];
  assert.ok(validate({ nodes, edges: bothLeft }).some((i) => /left and one right/.test(i.message)));

  const correct: PipelineEdge[] = [
    { from: "a", to: "j", toPort: "left" },
    { from: "b", to: "j", toPort: "right" },
    { from: "j", to: "out" },
  ];
  assert.deepEqual(validate({ nodes, edges: correct }), []);
});

test("validate rejects a second input on a single-input node", () => {
  const nodes = [
    node("a", "dataset_input", { datasetId: "d1" }),
    node("b", "dataset_input", { datasetId: "d2" }),
    node("f", "filter"),
    node("out", "dataset_output", { datasetId: "d3" }),
  ];
  const issues = validate({
    nodes,
    edges: [
      { from: "a", to: "f" },
      { from: "b", to: "f" },
      { from: "f", to: "out" },
    ],
  });
  assert.ok(issues.some((i) => i.nodeId === "f" && /single input/.test(i.message)));
});

test("validate rejects an input node that is fed by something", () => {
  const nodes = [
    node("a", "dataset_input", { datasetId: "d1" }),
    node("b", "dataset_input", { datasetId: "d2" }),
    node("out", "dataset_output", { datasetId: "d3" }),
  ];
  const issues = validate({
    nodes,
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "out" },
    ],
  });
  assert.ok(issues.some((i) => i.nodeId === "b" && /cannot have an input/.test(i.message)));
});
