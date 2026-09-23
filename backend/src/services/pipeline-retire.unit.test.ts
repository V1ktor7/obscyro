import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { retireDecision } from "./pipeline.js";

// ---------------------------------------------------------------------------
// An object output that is the whole current set, not an addition to it.
//
// The MSSS publishes, every hour, how many stretchers each emergency room has
// in service. The pipeline turns that count into one instance per stretcher.
// Writing only ever adds, so an emergency room that goes from 54 stretchers to
// 50 kept the last four — frozen in whatever state they were in an hour ago.
// Every hour after that, each room climbs towards the most stretchers it has
// ever had, and the simulation starts from capacity that is not there.
//
// So an output can say it is complete, and what it did not write this time goes.
// The refusals matter more than the removal. This pipeline died once already by
// writing nothing — the source renamed its columns, every row fell through a
// filter, and the run reported success. Retiring what was not written, on that
// run, would have emptied the type and reported success again.
// ---------------------------------------------------------------------------

const clean = { written: 1795, skipped: 0, unwritten: 4, truncated: false };

describe("retiring what a complete run did not write", () => {
  it("retires the stretchers that left the feed", () => {
    assert.deepEqual(retireDecision(clean), { retire: true });
  });

  it("has nothing to do when everything was rewritten", () => {
    assert.deepEqual(retireDecision({ ...clean, unwritten: 0 }), { retire: false, reason: null });
  });

  it("refuses when the run wrote nothing", () => {
    // How this pipeline died. A source that renames its columns produces an
    // empty run, and an empty run is a broken source, not an empty one.
    const d = retireDecision({ ...clean, written: 0, unwritten: 1795 });
    assert.equal(d.retire, false);
    assert.match(d.reason ?? "", /nothing/i);
  });

  it("refuses when a row could not be written", () => {
    // A row the writer could not map is not a stretcher that stopped existing.
    // Its instance would be removed for a mapping bug.
    const d = retireDecision({ ...clean, skipped: 3 });
    assert.equal(d.retire, false);
    assert.match(d.reason ?? "", /3/);
  });

  it("refuses when the run was truncated upstream", () => {
    // Rows cut at the ceiling are missing from the output, and missing from the
    // output is exactly what retirement reads as "gone".
    const d = retireDecision({ ...clean, truncated: true });
    assert.equal(d.retire, false);
    assert.match(d.reason ?? "", /truncat/i);
  });

  it("refuses to remove more than half of what exists in one run", () => {
    // A feed that changes does not lose half of itself in an hour. A truncated
    // file does, and so does one that arrived with ten rooms instead of a
    // hundred and eight: about 166 stretchers written, 1 629 left behind.
    const d = retireDecision({ ...clean, written: 166, unwritten: 1629 });
    assert.equal(d.retire, false);
    assert.match(d.reason ?? "", /1629/);
  });

  it("draws the line at more than half, not at half", () => {
    assert.equal(retireDecision({ ...clean, written: 900, unwritten: 900 }).retire, true);
    assert.equal(retireDecision({ ...clean, written: 899, unwritten: 901 }).retire, false);
  });

  it("allows a large but ordinary change", () => {
    // A night where a few rooms close stretchers is not a truncated file.
    assert.deepEqual(retireDecision({ ...clean, written: 1600, unwritten: 195 }), {
      retire: true,
    });
  });

  it("allows the first run, when nothing existed before", () => {
    assert.deepEqual(retireDecision({ ...clean, unwritten: 0 }), { retire: false, reason: null });
  });
});
