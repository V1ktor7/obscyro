import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DUE_SYNCS_SQL, refusesPartialReplace } from "./connectivity.js";

/**
 * What a pull is allowed to write when it did not read everything.
 *
 * The row cap is a loop guard for runaway pagination. It also fires on a large
 * single-request CSV, which cannot loop — and there the short read is not a
 * defence, it is a hole. What matters is what gets written afterwards.
 */

describe("a short read must not replace a complete table", () => {
  it("refuses to write a truncated snapshot", () => {
    // The federal wastewater aggregate is 61 099 rows. Read short and written
    // as a snapshot, it replaces the complete table with two thirds of it, and
    // the only trace is a sentence in the run log that nothing downstream ever
    // reads. The previous version is worth more than a fresher partial one.
    assert.equal(refusesPartialReplace("snapshot", true), true);
  });

  it("lets a complete snapshot through", () => {
    assert.equal(refusesPartialReplace("snapshot", false), false);
  });

  it("lets a truncated incremental run through", () => {
    // Incremental appends and carries a watermark, so a short read is a pause:
    // the next run continues from where this one stopped. Refusing it would
    // stall the feed instead of protecting it.
    assert.equal(refusesPartialReplace("incremental", true), false);
  });

  it("lets a stream through, which never replaces anything", () => {
    assert.equal(refusesPartialReplace("stream", true), false);
  });
});

describe("a failing sync keeps its place in the queue", () => {
  it("still selects a sync whose last run failed", () => {
    // The bug this replaces: `recordSyncRun` set status to 'error' and the
    // scheduler reads only 'active', so one transient 502 from the MSSS hourly
    // file killed the feed permanently. Nothing retried it and nothing said so.
    assert.ok(!DUE_SYNCS_SQL.includes("'error'"));
    assert.match(DUE_SYNCS_SQL, /status = 'active'/);
  });

  it("spaces the attempts by the number of consecutive failures", () => {
    assert.match(DUE_SYNCS_SQL, /POWER\(2, s\.consecutive_failures\)/);
  });

  it("caps the wait, so a long outage does not read as abandoned", () => {
    // Doubling without a ceiling turns a week of downtime into a sync that
    // retries once a fortnight.
    assert.match(DUE_SYNCS_SQL, /LEAST\(POWER\(2, s\.consecutive_failures\)::int, \d+\)/);
  });

  it("never stops selecting a sync somebody switched on", () => {
    // There is no clause anywhere that removes a sync from the queue for
    // failing. A feed switched off by an outage is a feed nobody notices.
    assert.ok(!/consecutive_failures\s*[<>]=?\s*\d+\s*(AND|\))/.test(DUE_SYNCS_SQL));
  });

  it("still refuses to run one twice inside its own interval", () => {
    assert.match(DUE_SYNCS_SQL, /NOT EXISTS/);
    assert.match(DUE_SYNCS_SQL, /app\.sync_run/);
  });
});
