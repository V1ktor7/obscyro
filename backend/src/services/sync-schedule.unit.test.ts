import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * How often a pull sync is allowed to call the outside world.
 *
 * Both halves of this were broken at once and neither said anything. The
 * statement that stamps `last_run_at` could not type its own parameter, so it
 * failed and was swallowed; the column stayed null through four successful
 * runs; and the scheduler reads a null as "never ran". An hourly sync called
 * the ministry's server every thirty seconds, and every run reported success.
 *
 * The SQL is read from the source rather than executed, because what went wrong
 * lives in the text of two statements and neither needs a database to inspect.
 */
const SRC = readFileSync(
  fileURLToPath(new URL("./connectivity.ts", import.meta.url)),
  "utf8",
);

describe("stamping a sync run", () => {
  it("casts the parameter it also tests for null", () => {
    // "$2 IS NULL" inside a CASE constrains nothing, so Postgres answers
    // "could not determine data type of parameter $2" and the whole update
    // fails. The cast is the difference between recording a run and not.
    assert.match(SRC, /last_error = \$2::text/);
    assert.match(SRC, /CASE WHEN \$2::text IS NULL/);
  });

  it("still records the run and its error", () => {
    assert.match(SRC, /INSERT INTO app\.sync_run/);
    assert.match(SRC, /SET last_run_at = now\(\)/);
  });
});

describe("deciding a sync is due", () => {
  it("respects the configured interval", () => {
    assert.match(SRC, /make_interval\(secs => s\.interval_seconds\)/);
  });

  it("checks the run log too, not only the column", () => {
    // The column is a denormalised convenience, and one swallowed error left
    // it null through four runs. A row lands in the log before the column is
    // touched, so this test holds even when the other is stale.
    assert.match(SRC, /NOT EXISTS \(/);
    assert.match(SRC, /FROM app\.sync_run r/);
    assert.match(SRC, /r\.started_at > now\(\) - make_interval/);
  });

  it("never picks up a paused sync", () => {
    assert.match(SRC, /s\.status = 'active'/);
  });

  it("leaves streaming syncs alone — they land rows as they arrive", () => {
    assert.match(SRC, /s\.mode <> 'stream'/);
  });

  it("takes a bounded batch, oldest first", () => {
    assert.match(SRC, /ORDER BY s\.last_run_at ASC NULLS FIRST/);
    assert.match(SRC, /LIMIT 5/);
  });
});
