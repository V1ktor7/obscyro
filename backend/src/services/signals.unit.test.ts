import assert from "node:assert/strict";
import { test } from "node:test";

import type { DbClient } from "../lib/db.js";
import {
  closeClearedSignals,
  countOpenByType,
  countOpenSignals,
  countSignals,
  createWorkflow,
  dismissSignal,
  domainCounters,
  listSignals,
  moveSignal,
  SIGNAL_LIST_LIMIT,
} from "./signals.js";

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

// --- the board's list ----------------------------------------------------------

/** A db that keeps every query whole, with its parameters. */
function recordingDb(results: unknown[][]): DbClient & { sent: { sql: string; params: unknown[] }[] } {
  const sent: { sql: string; params: unknown[] }[] = [];
  let i = 0;
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      sent.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
      const rows = results[i++] ?? [];
      return { rows, rowCount: rows.length };
    },
  } as unknown as DbClient;
  return Object.assign(db, { sent }) as DbClient & { sent: { sql: string; params: unknown[] }[] };
}

const OLD_SIGNAL = { ...OPEN_SIGNAL[0]!, id: "sig-old", title: "Urgence au-dessus du seuil depuis des semaines" };

test("the list stops at the most recent signals, open ones only", async () => {
  const db = recordingDb([OPEN_SIGNAL]);
  const listed = await listSignals(db, "p1", { scenarioId: null });
  assert.deepEqual(listed.map((s) => s.id), ["sig-1"]);
  assert.equal(db.sent.length, 1, "nothing else is read when no link names a signal");
  assert.match(db.sent[0]!.sql, /WHERE project_id = \$1 AND scenario_id IS NULL AND closed_at IS NULL ORDER BY detected_at DESC LIMIT 500$/);
  assert.equal(SIGNAL_LIST_LIMIT, 500);
});

test("a signal a link names is listed even when it is older than the list goes", async () => {
  // An emergency room over its threshold for weeks: the alert is still open and
  // links to a signal thousands of signals old.
  const db = recordingDb([OPEN_SIGNAL, [OLD_SIGNAL]]);
  const listed = await listSignals(db, "p1", { scenarioId: null, also: "sig-old" });
  assert.deepEqual(listed.map((s) => s.id), ["sig-old", "sig-1"], "it comes first: it is what the person came for");
  const second = db.sent[1]!;
  assert.match(second.sql, /WHERE project_id = \$1 AND scenario_id IS NULL AND id = \$2$/);
  assert.deepEqual(second.params, ["p1", "sig-old"], "looked up in this project, never across projects");
  assert.doesNotMatch(second.sql, /closed_at IS NULL/, "a closed signal is still shown to whoever follows its link");
});

test("a signal the list already holds is not read twice", async () => {
  const db = recordingDb([OPEN_SIGNAL]);
  const listed = await listSignals(db, "p1", { scenarioId: null, also: "sig-1" });
  assert.equal(listed.length, 1);
  assert.equal(db.sent.length, 1);
});

test("a link to a signal of another project adds nothing", async () => {
  const db = recordingDb([OPEN_SIGNAL, []]);
  const listed = await listSignals(db, "p1", { scenarioId: null, also: "sig-elsewhere" });
  assert.deepEqual(listed.map((s) => s.id), ["sig-1"]);
});

test("a linked signal stays inside the scenario the list is about", async () => {
  const db = recordingDb([[], []]);
  await listSignals(db, "p1", { scenarioId: "sc-1", also: "sig-old" });
  assert.match(db.sent[1]!.sql, /WHERE project_id = \$1 AND scenario_id = \$2 AND id = \$3$/);
  assert.deepEqual(db.sent[1]!.params, ["p1", "sc-1", "sig-old"]);
});

test("the count is what the list chooses from, before its limit", async () => {
  const db = recordingDb([[{ n: 2752 }]]);
  assert.equal(await countSignals(db, "p1", { scenarioId: null }), 2752);
  assert.match(db.sent[0]!.sql, /^SELECT count\(\*\)::int AS n FROM app\.signal WHERE project_id = \$1 AND scenario_id IS NULL AND closed_at IS NULL$/);
  // With closed signals asked for, they are counted too: the count and the list agree.
  const all = recordingDb([[{ n: 3000 }]]);
  assert.equal(await countSignals(all, "p1", { scenarioId: null, includeClosed: true }), 3000);
  assert.doesNotMatch(all.sent[0]!.sql, /closed_at/);
});

// --- what became of the alert ---------------------------------------------------

test("a signal says what became of the alert that raised it", async () => {
  const row = (id: string, alert_status: string | null | undefined) => ({ ...OPEN_SIGNAL[0]!, id, origin_kind: "twin_alert", alert_status });
  const db = recordingDb([[row("a", "open"), row("b", "ack"), row("c", "resolved"), row("d", null), row("e", undefined)]]);
  const listed = await listSignals(db, "p1", { scenarioId: null });
  assert.deepEqual(
    listed.map((s) => [s.id, s.alert]),
    [
      ["a", "holds"],
      ["b", "acknowledged"],
      ["c", "cleared"],
      // No alert raised it, or its alert is no longer on file: nothing is claimed.
      ["d", null],
      ["e", null],
    ],
  );
  // Read with the signal, from the alert its origin names.
  assert.match(db.sent[0]!.sql, /\(SELECT a\.status FROM app\.twin_alert a WHERE signal\.origin_kind = 'twin_alert' AND a\.id = signal\.origin_id\) AS alert_status/);
});

// --- the two piles ----------------------------------------------------------------

/** What the board sets apart: an alert raised it, the alert cleared, and nobody acted on it. */
const SET_APART =
  /\(signal\.origin_kind = 'twin_alert' AND EXISTS \(SELECT 1 FROM app\.twin_alert a WHERE a\.id = signal\.origin_id AND a\.status = 'resolved'\) AND NOT EXISTS \(SELECT 1 FROM app\.signal_event e WHERE e\.signal_id = signal\.id AND \(e\.actor_user_id IS NOT NULL OR e\.kind NOT IN \('detected', 'noted'\)\)\)\)/;

test("the cleared view is the signals whose alert cleared and that nobody acted on", async () => {
  const db = recordingDb([[]]);
  await listSignals(db, "p1", { scenarioId: null, view: "cleared" });
  const sql = db.sent[0]!.sql;
  assert.match(sql, SET_APART);
  assert.match(sql, /closed_at IS NULL AND \(signal\.origin_kind/);
  // Only a resolved alert has cleared: an acknowledged one still fires.
  assert.doesNotMatch(sql, /status <> 'open'/);
  assert.match(sql, /ORDER BY detected_at DESC LIMIT 500$/);
});

test("the active view is everything else: nothing is in both piles, nothing in neither", async () => {
  const db = recordingDb([[]]);
  await listSignals(db, "p1", { scenarioId: null, view: "active" });
  assert.match(db.sent[0]!.sql, SET_APART);
  assert.match(db.sent[0]!.sql, /closed_at IS NULL AND NOT \(signal\.origin_kind/);
});

test("a signal a link names is found whatever pile it is in", async () => {
  const db = recordingDb([OPEN_SIGNAL, [OLD_SIGNAL]]);
  const listed = await listSignals(db, "p1", { scenarioId: null, view: "active", also: "sig-old" });
  assert.deepEqual(listed.map((s) => s.id), ["sig-old", "sig-1"]);
  // The second read is the project and the scenario only: no view.
  assert.match(db.sent[1]!.sql, /WHERE project_id = \$1 AND scenario_id IS NULL AND id = \$2$/);
});

test("the count follows the view the list is about", async () => {
  const db = recordingDb([[{ n: 2810 }]]);
  assert.equal(await countSignals(db, "p1", { scenarioId: null, view: "cleared" }), 2810);
  assert.match(db.sent[0]!.sql, /closed_at IS NULL AND \(signal\.origin_kind/);
});

test("what is set apart is counted, with what is shown and the whole", async () => {
  const db = recordingDb([[{ open: 2852, cleared: 2810 }]]);
  assert.deepEqual(await countOpenSignals(db, "p1", { scenarioId: null }), { open: 2852, active: 42, cleared: 2810 });
  const sql = db.sent[0]!.sql;
  assert.match(sql, /^SELECT count\(\*\)::int AS open, \(count\(\*\) FILTER \(WHERE \(signal\.origin_kind/);
  assert.match(sql, /FROM app\.signal WHERE project_id = \$1 AND scenario_id IS NULL AND closed_at IS NULL$/);
  // An empty project counts zeros, not nothing.
  assert.deepEqual(await countOpenSignals(recordingDb([[]]), "p1"), { open: 0, active: 0, cleared: 0 });
});

// --- counters by domain -------------------------------------------------------------

test("open signals are counted by type in the database, over all of them", async () => {
  const db = recordingDb([[{ signal_type_id: "t1", open: 2800, critical: 2790 }]]);
  const counted = await countOpenByType(db, "p1", { scenarioId: null, view: "cleared" });
  assert.deepEqual(counted, [{ signalTypeId: "t1", open: 2800, critical: 2790 }]);
  const sql = db.sent[0]!.sql;
  assert.match(sql, /count\(\*\)::int AS open, \(count\(\*\) FILTER \(WHERE severity = 'critical'\)\)::int AS critical/);
  assert.match(sql, /GROUP BY signal_type_id$/);
  // No limit: the counters are not counted on the 500 the list holds.
  assert.doesNotMatch(sql, /LIMIT/);
});

test("the counters by domain are right past the 500 signals the list holds", () => {
  const types = [
    { id: "t1", domain: "Patient flow" },
    { id: "t2", domain: "Patient flow" },
    { id: "t3", domain: "Data & systems" },
    { id: "t4", domain: "Supply" },
  ];
  const counters = domainCounters(types, [
    { signalTypeId: "t1", open: 2800, critical: 2790 },
    { signalTypeId: "t2", open: 40, critical: 0 },
    { signalTypeId: "t3", open: 12, critical: 12 },
    // A type of another organisation's configuration is not placed in any domain.
    { signalTypeId: "t-gone", open: 9, critical: 9 },
  ]);
  assert.deepEqual(counters, [
    // A domain sums its types, and the worst comes first.
    { domain: "Patient flow", open: 2840, critical: 2790 },
    { domain: "Data & systems", open: 12, critical: 12 },
    // A domain with nothing open is still listed: a signal can be raised in it.
    { domain: "Supply", open: 0, critical: 0 },
  ]);
});

// --- the batch close ------------------------------------------------------------------

test("closing in a batch needs a reason and a person, and asks the database nothing without them", async () => {
  const db = recordingDb([]);
  await assert.rejects(() => closeClearedSignals(db, "p1", { actorUserId: "u", reason: "   " }), /needs a reason/);
  await assert.rejects(() => closeClearedSignals(db, "p1", { actorUserId: "", reason: "retombées seules" }), /closed by a person/);
  // A domain with no signal type has nothing to close.
  assert.equal(await closeClearedSignals(db, "p1", { actorUserId: "u", reason: "x", signalTypeIds: [] }), 0);
  assert.equal(db.sent.length, 0);
});

test("the batch closes what is set apart, in one statement, with a line on each signal's trail", async () => {
  const db = recordingDb([[{ n: 2810 }]]);
  const closed = await closeClearedSignals(db, "p1", {
    actorUserId: "user-1",
    reason: "  Cleared on their own over the weekend ",
    scenarioId: null,
    signalTypeIds: ["t1", "t2"],
  });
  assert.equal(closed, 2810);
  assert.equal(db.sent.length, 1, "one statement: all of them close, or none does");

  const { sql, params } = db.sent[0]!;
  // What it closes is exactly what the cleared view shows, in this project, among these types.
  assert.match(sql, SET_APART);
  assert.match(sql, /WHERE project_id = \$1 AND scenario_id IS NULL AND closed_at IS NULL AND \(signal\.origin_kind/);
  assert.match(sql, /AND signal_type_id = ANY\(\$2::uuid\[\]\) FOR UPDATE/);
  // Each signal gets its own line, numbered after the last one on its trail.
  assert.match(sql, /INSERT INTO app\.signal_event \(signal_id, seq, kind, from_stage_id, actor_user_id, note, payload\) SELECT shut\.id, COALESCE\(\(SELECT MAX\(e\.seq\) FROM app\.signal_event e WHERE e\.signal_id = shut\.id\), 0\) \+ 1, 'closed', shut\.stage_id, \$4, \$5, \$6::jsonb FROM shut/);
  // The count returned is the count of lines written: no signal is closed without one.
  assert.match(sql, /SELECT count\(\*\)::int AS n FROM trail$/);
  // It does not pretend they reached the last stage.
  assert.doesNotMatch(sql, /stage_id =/);

  assert.deepEqual(params, [
    "p1",
    ["t1", "t2"],
    // Neither "resolved" nor "false positive: …": a third way to close, told apart.
    "alert cleared: Cleared on their own over the weekend",
    "user-1",
    "Cleared on their own over the weekend",
    JSON.stringify({ reason: "alert_cleared", batch: true }),
  ]);
});

test("without a domain the batch is the whole project, and it stays inside one scenario", async () => {
  const db = recordingDb([[{ n: 3 }]]);
  await closeClearedSignals(db, "p1", { actorUserId: "user-1", reason: "x", scenarioId: "sc-1" });
  const { sql, params } = db.sent[0]!;
  assert.match(sql, /WHERE project_id = \$1 AND scenario_id = \$2 AND closed_at IS NULL/);
  assert.doesNotMatch(sql, /signal_type_id = ANY/);
  assert.deepEqual(params.slice(0, 3), ["p1", "sc-1", "alert cleared: x"]);
});

test("a trail written at the same instant closes nothing, and says to try again", async () => {
  const db = {
    query: async () => {
      throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
    },
  } as unknown as DbClient;
  await assert.rejects(
    () => closeClearedSignals(db, "p1", { actorUserId: "user-1", reason: "x" }),
    /Nothing was closed: try again/,
  );
  // Any other failure is not dressed up as that one.
  const broken = { query: async () => { throw new Error("connection lost"); } } as unknown as DbClient;
  await assert.rejects(() => closeClearedSignals(broken, "p1", { actorUserId: "user-1", reason: "x" }), /connection lost/);
});
