import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { refusesPartialReplace } from "./connectivity.js";

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
