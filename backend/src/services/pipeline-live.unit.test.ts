import assert from "node:assert/strict";
import { test } from "node:test";

import type { DbClient } from "../lib/db.js";
import { findDuePipelines } from "./pipeline.js";

/**
 * findDuePipelines is one SQL statement, so what is worth pinning here is the
 * statement itself: the conditions that decide whether a live pipeline ever
 * runs, and the guard that stops a half-configured node from aborting the
 * query for every other pipeline too.
 */
function captureDb(rows: { id: string }[] = []): {
  db: DbClient;
  cap: { sql: string; params: unknown[] };
} {
  const cap = { sql: "", params: [] as unknown[] };
  const db = {
    query: async (sql: string, params?: unknown[]) => {
      cap.sql = sql;
      cap.params = params ?? [];
      return { rows, rowCount: rows.length };
    },
  } as unknown as DbClient;
  return { db, cap };
}

test("findDuePipelines returns the ids the query matched", async () => {
  const { db } = captureDb([{ id: "p1" }, { id: "p2" }]);
  assert.deepEqual(await findDuePipelines(db), ["p1", "p2"]);
});

test("only live pipelines are picked up", async () => {
  const { db, cap } = captureDb();
  await findDuePipelines(db);
  assert.match(cap.sql, /p\.status = 'live'/, "a draft or paused pipeline must never auto-run");
});

test("a stream somebody pushed into still triggers a run", async () => {
  const { db, cap } = captureDb();
  await findDuePipelines(db);
  assert.match(cap.sql, /d\.kind = 'stream'/);
  assert.match(cap.sql, /n->>'kind' = 'dataset_input'/);
});

test("a table an active sync pulls into also triggers a run", async () => {
  // A REST source on a schedule writes a versioned table, never a stream. With
  // streams alone the two halves never met: the sync refreshed the dataset
  // every interval and no pipeline ever fired from it, so the ontology — and
  // the twin reading it — never moved.
  const { db, cap } = captureDb();
  await findDuePipelines(db);
  assert.match(cap.sql, /FROM app\.sync sy/);
  assert.match(cap.sql, /sy\.dataset_id = d\.id/);
  assert.match(cap.sql, /sy\.status = 'active'/);
});

test("a table only a pipeline writes does not trigger anything", async () => {
  // `dataset_output` writes tables. Widening the condition to every table
  // would let two live pipelines feed each other and re-trigger forever —
  // `d.kind = 'stream'` had been an accidental cycle guard, and the sync test
  // is what replaces it. What must never appear is a bare "any table".
  const { db, cap } = captureDb();
  await findDuePipelines(db);
  assert.doesNotMatch(
    cap.sql,
    /AND d\.kind = 'table'/,
    "an unqualified table condition would open a cycle between two live pipelines",
  );
  assert.match(cap.sql, /EXISTS \(/, "the table case must be qualified by an active sync");
});

test("a run is due only when rows arrived after the last one", async () => {
  const { db, cap } = captureDb();
  await findDuePipelines(db);
  // Without this the scheduler re-runs every tick forever, hammering the
  // ontology with upserts that change nothing.
  assert.match(cap.sql, /d\.last_written_at > p\.last_run_at/);
  assert.match(cap.sql, /p\.last_run_at IS NULL/, "a never-run pipeline is due");
});

test("the datasetId cast is guarded", async () => {
  const { db, cap } = captureDb();
  await findDuePipelines(db);
  // A node that has been dropped on the canvas but not configured holds '' or
  // a name. ::uuid on that raises, and one bad node would abort the query for
  // every pipeline in the table.
  assert.match(cap.sql, /~ '\^\[0-9a-fA-F-\]\{36\}\$'/);
});

test("the batch is bounded", async () => {
  const { db, cap } = captureDb();
  await findDuePipelines(db, 3);
  assert.match(cap.sql, /LIMIT \$1/);
  assert.deepEqual(cap.params, [3]);
});

test("the oldest run goes first so one busy pipeline cannot starve the rest", async () => {
  const { db, cap } = captureDb();
  await findDuePipelines(db);
  assert.match(cap.sql, /ORDER BY p\.last_run_at ASC NULLS FIRST/);
});
