import assert from "node:assert/strict";
import { test } from "node:test";

import type { DbClient } from "../lib/db.js";
import {
  applyTextField,
  applyValidate,
  validate,
  type Pipeline,
  type PipelineNode,
  type Row,
} from "./pipeline.js";

function node(id: string, kind: PipelineNode["kind"], config: Record<string, unknown> = {}): PipelineNode {
  return { id, kind, name: id, x: 0, y: 0, config };
}

const PIPE: Pipeline = {
  id: "00000000-0000-0000-0000-000000000001",
  projectId: "00000000-0000-0000-0000-000000000002",
  name: "clinical",
  slug: "clinical",
  description: null,
  nodes: [],
  edges: [],
  status: "draft",
  lastRunAt: null,
  lastStatus: null,
  lastError: null,
};

/** Records inserts so the review path can be asserted without a database. */
function fakeDb(): DbClient & { inserts: unknown[][] } {
  const inserts: unknown[][] = [];
  return {
    inserts,
    query: async (_sql: string, params?: unknown[]) => {
      inserts.push(params ?? []);
      return { rows: [], rowCount: 0 };
    },
  } as unknown as DbClient & { inserts: unknown[][] };
}

// --- text field -------------------------------------------------------------

test("text_field takes a plain column through unchanged", () => {
  const rows: Row[] = [{ id: 1, note: "pt c/o chest pain" }];
  const { rows: out, dropped } = applyTextField(rows, { column: "note" });
  assert.equal(dropped, 0);
  assert.equal(out[0]!.text, "pt c/o chest pain");
  assert.equal(out[0]!.id, 1, "the rest of the row is carried through");
});

test("text_field digs a path out of a JSON column", () => {
  const rows: Row[] = [{ payload: JSON.stringify({ note: { body: "denies fever" } }) }];
  const { rows: out } = applyTextField(rows, {
    column: "payload",
    fieldPath: "note.body",
    as: "clinicalText",
  });
  assert.equal(out[0]!.clinicalText, "denies fever");
});

test("text_field drops and counts rows with no usable text", () => {
  const rows: Row[] = [{ note: "real text" }, { note: "" }, { note: null }, { other: "x" }];
  const { rows: out, dropped } = applyTextField(rows, { column: "note" });
  assert.equal(out.length, 1);
  assert.equal(dropped, 3, "an empty note is reported, not sent to the model as an empty string");
});

test("text_field leaves rows alone when no column is configured", () => {
  const rows: Row[] = [{ a: 1 }];
  assert.deepEqual(applyTextField(rows, {}).rows, rows);
});

// --- validate ---------------------------------------------------------------

test("validate keeps rows at or above the confidence floor", async () => {
  const rows: Row[] = [
    { span: "chest pain", contextConfidence: 0.91 },
    { span: "fever", contextConfidence: 0.42 },
  ];
  const r = await applyValidate(fakeDb(), PIPE, node("v", "validate_confidence", {
    minConfidence: 0.6,
    onLow: "flag",
  }), rows, true);
  assert.equal(r.rows.length, 2, "flag keeps the row");
  assert.equal(r.rows[1]!.decision, "flag");
  assert.equal(r.dropped, 0);
});

test("validate drops low-confidence rows when told to, and counts them", async () => {
  const rows: Row[] = [
    { span: "a", contextConfidence: 0.91 },
    { span: "b", contextConfidence: 0.2 },
  ];
  const r = await applyValidate(fakeDb(), PIPE, node("v", "validate_confidence", {
    minConfidence: 0.6,
    onLow: "drop",
  }), rows, true);
  assert.equal(r.rows.length, 1);
  assert.equal(r.dropped, 1);
});

test("validate queues low-confidence findings for review rather than discarding", async () => {
  const db = fakeDb();
  const rows: Row[] = [
    { span: "chest pain", code: "29857009", display: "Chest pain", contextConfidence: 0.3, decision: "flag" },
  ];
  const r = await applyValidate(db, PIPE, node("v", "validate_confidence", {
    minConfidence: 0.6,
    onLow: "review",
  }), rows, false);
  assert.equal(r.rows.length, 0, "it leaves the main flow");
  assert.equal(r.queued, 1, "but it does not disappear");
  assert.equal(db.inserts.length, 1);
  assert.equal(db.inserts[0]![0], PIPE.id, "the review item records which pipeline produced it");
  assert.equal(db.inserts[0]![3], "chest pain");
});

test("validate writes nothing to the review queue during a preview", async () => {
  const db = fakeDb();
  await applyValidate(db, PIPE, node("v", "validate_confidence", {
    minConfidence: 0.6,
    onLow: "review",
  }), [{ span: "x", contextConfidence: 0.1 }], true);
  assert.equal(db.inserts.length, 0, "a preview must not leave rows behind");
});

test("validate drops duplicates on the chosen key", async () => {
  const rows: Row[] = [
    { encounterId: "E1", code: "1", contextConfidence: 1 },
    { encounterId: "E1", code: "1", contextConfidence: 1 },
    { encounterId: "E1", code: "2", contextConfidence: 1 },
  ];
  const r = await applyValidate(fakeDb(), PIPE, node("v", "validate_confidence", {
    dedupeOn: ["encounterId", "code"],
  }), rows, true);
  assert.equal(r.rows.length, 2);
  assert.equal(r.dropped, 1);
});

test("validate falls back to concept confidence when there is no context score", async () => {
  const rows: Row[] = [{ span: "a", conceptConfidence: 0.2 }];
  const r = await applyValidate(fakeDb(), PIPE, node("v", "validate_confidence", {
    minConfidence: 0.6,
    onLow: "drop",
  }), rows, true);
  assert.equal(r.dropped, 1);
});

// --- graph rules ------------------------------------------------------------

test("validate() blocks an extraction whose concepts reach no output", () => {
  const nodes = [
    node("in", "dataset_input", { datasetId: "d1" }),
    node("txt", "text_field", { column: "note" }),
    node("ex", "extract_snomed"),
    node("out", "dataset_output", { datasetId: "d2" }),
  ];
  // The output is fed from the raw input, so the concepts go nowhere.
  const issues = validate({
    nodes,
    edges: [
      { from: "in", to: "txt" },
      { from: "txt", to: "ex" },
      { from: "in", to: "out" },
    ],
  });
  assert.ok(
    issues.some((i) => i.nodeId === "ex" && /computed and discarded/.test(i.message)),
    "extracting concepts and never writing them is silent waste",
  );
});

test("validate() accepts extraction that reaches an object output through other nodes", () => {
  process.env.NLP_SERVICE_URL = "http://nlp.test";
  const nodes = [
    node("in", "dataset_input", { datasetId: "d1" }),
    node("txt", "text_field", { column: "note" }),
    node("ex", "extract_snomed"),
    node("v", "validate_confidence", { minConfidence: 0.6 }),
    node("out", "object_output", { objectTypeName: "ClinicalFinding", identityProperties: ["span"] }),
  ];
  const issues = validate({
    nodes,
    edges: [
      { from: "in", to: "txt" },
      { from: "txt", to: "ex" },
      { from: "ex", to: "v" },
      { from: "v", to: "out" },
    ],
  });
  assert.deepEqual(issues, []);
  delete process.env.NLP_SERVICE_URL;
});

test("validate() says so when extraction cannot run at all", () => {
  delete process.env.NLP_SERVICE_URL;
  const nodes = [
    node("in", "dataset_input", { datasetId: "d1" }),
    node("ex", "extract_snomed"),
    node("out", "object_output", { objectTypeName: "X", identityProperties: ["span"] }),
  ];
  const issues = validate({
    nodes,
    edges: [
      { from: "in", to: "ex" },
      { from: "ex", to: "out" },
    ],
  });
  assert.ok(issues.some((i) => /NLP_SERVICE_URL/.test(i.message)));
});

test("validate() requires a text column on text_field", () => {
  const nodes = [
    node("in", "dataset_input", { datasetId: "d1" }),
    node("txt", "text_field"),
    node("out", "dataset_output", { datasetId: "d2" }),
  ];
  const issues = validate({
    nodes,
    edges: [
      { from: "in", to: "txt" },
      { from: "txt", to: "out" },
    ],
  });
  assert.ok(issues.some((i) => i.nodeId === "txt" && /column that holds the text/.test(i.message)));
});
