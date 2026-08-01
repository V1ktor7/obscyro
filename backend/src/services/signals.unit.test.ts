import assert from "node:assert/strict";
import { test } from "node:test";

import type { DbClient } from "../lib/db.js";
import { createWorkflow, dismissSignal, moveSignal } from "./signals.js";

// ---------------------------------------------------------------------------
// The engine's guarantees, pinned without a database.
//
// What matters here is not that a signal moves — it is that it refuses to move
// in the ways that would make the trail a lie.
// ---------------------------------------------------------------------------

const ORG = "11111111-1111-1111-1111-111111111111";

/** Scriptable db: each query returns the next queued result. */
function scriptDb(results: unknown[][]): DbClient & { calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  const db = {
    query: async (sql: string) => {
      calls.push(sql.trim().split("\n")[0]!.trim());
      const rows = results[i++] ?? [];
      return { rows, rowCount: rows.length };
    },
  } as unknown as DbClient;
  return Object.assign(db, { calls }) as DbClient & { calls: string[] };
}

// --- workflow shape ----------------------------------------------------------

test("a workflow with one stage is refused", async () => {
  await assert.rejects(
    () =>
      createWorkflow(scriptDb([]), {
        organizationId: ORG,
        key: "x",
        name: "X",
        stages: [{ key: "a", name: "A", isTerminal: true }],
      }),
    /at least a first and a last stage/,
  );
});

test("a workflow with no terminal stage is refused", async () => {
  // Without one, nothing ever leaves the board and the count only grows.
  await assert.rejects(
    () =>
      createWorkflow(scriptDb([]), {
        organizationId: ORG,
        key: "x",
        name: "X",
        stages: [
          { key: "a", name: "A" },
          { key: "b", name: "B" },
        ],
      }),
    /has to close the signal/,
  );
});

test("two stages sharing a key are refused", async () => {
  await assert.rejects(
    () =>
      createWorkflow(scriptDb([]), {
        organizationId: ORG,
        key: "x",
        name: "X",
        stages: [
          { key: "a", name: "A" },
          { key: "a", name: "Encore A", isTerminal: true },
        ],
      }),
    /same key/,
  );
});

// --- moving ------------------------------------------------------------------

const OPEN_SIGNAL = [
  {
    id: "sig-1",
    project_id: "p1",
    signal_type_id: "t1",
    stage_id: "st-1",
    subject_kind: "object_instance",
    subject_id: "u1",
    title: "Occupation ≥ 95 %",
    detail: null,
    severity: "critical",
    properties: {},
    scenario_id: null,
    origin_kind: "rule",
    dedupe_key: null,
    closed_at: null,
    closed_reason: null,
    detected_at: new Date(0),
  },
];

const STAGES = [
  { id: "st-1", workflow_id: "w1", seq: 0, key: "detected", name: "Détecté", requires_approval: false, is_terminal: false },
  { id: "st-2", workflow_id: "w1", seq: 1, key: "assessed", name: "Évalué", requires_approval: false, is_terminal: false },
  { id: "st-3", workflow_id: "w1", seq: 2, key: "resolved", name: "Résolu", requires_approval: false, is_terminal: true },
];

test("a closed signal cannot be moved", async () => {
  const closed = [{ ...OPEN_SIGNAL[0]!, closed_at: new Date(), closed_reason: "résolu" }];
  await assert.rejects(
    () => moveSignal(scriptDb([closed]), "sig-1", "forward", { actorUserId: "u" }),
    /closed/,
  );
});

test("a signal at the last stage cannot advance further", async () => {
  const atEnd = [{ ...OPEN_SIGNAL[0]!, stage_id: "st-3" }];
  await assert.rejects(
    () => moveSignal(scriptDb([atEnd, STAGES]), "sig-1", "forward", { actorUserId: "u" }),
    /already at the last stage/,
  );
});

test("a signal at the first stage cannot go back", async () => {
  await assert.rejects(
    () => moveSignal(scriptDb([OPEN_SIGNAL, STAGES]), "sig-1", "back", { actorUserId: "u" }),
    /already at the first stage/,
  );
});

test("a signal whose stage is not on its workflow is a data problem, and says so", async () => {
  const orphan = [{ ...OPEN_SIGNAL[0]!, stage_id: "st-elsewhere" }];
  await assert.rejects(
    () => moveSignal(scriptDb([orphan, STAGES]), "sig-1", "forward", { actorUserId: "u" }),
    /not on its workflow/,
  );
});

test("entering an approval stage anonymously is refused", async () => {
  // The point of marking a stage as needing approval is that someone is named.
  const gated = [
    STAGES[0]!,
    { ...STAGES[1]!, requires_approval: true },
    STAGES[2]!,
  ];
  await assert.rejects(
    () => moveSignal(scriptDb([OPEN_SIGNAL, gated]), "sig-1", "forward", { actorUserId: "" }),
    /requires an approval/,
  );
});

// --- dismissal ---------------------------------------------------------------

test("dismissing without a reason is refused", async () => {
  await assert.rejects(
    () => dismissSignal(scriptDb([]), "sig-1", { actorUserId: "u", reason: "   " }),
    /needs a reason/,
  );
});

test("an already-closed signal cannot be dismissed", async () => {
  const closed = [{ ...OPEN_SIGNAL[0]!, closed_at: new Date() }];
  await assert.rejects(
    () => dismissSignal(scriptDb([closed]), "sig-1", { actorUserId: "u", reason: "bruit" }),
    /already closed/,
  );
});

test("a dismissal is recorded as a false positive, not as a resolution", async () => {
  // Alert fatigue is how decision support fails. If "resolved" and "should
  // never have fired" close the same way, the false-positive rate is unknowable.
  const db = scriptDb([OPEN_SIGNAL, [], [{ next: 1 }], [], OPEN_SIGNAL]);
  await dismissSignal(db, "sig-1", { actorUserId: "u", reason: "capteur défectueux" });
  const update = db.calls.find((c) => c.startsWith("UPDATE app.signal"));
  assert.ok(update, "the signal is closed");
  const insert = db.calls.find((c) => c.startsWith("INSERT INTO app.signal_event"));
  assert.ok(insert, "and the dismissal is on the trail");
});
