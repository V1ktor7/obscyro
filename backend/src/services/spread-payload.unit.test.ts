import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { spreadPayload } from "./spread-payload.js";

const ENGINE = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../../simulation-service/app/events/${rel}`, import.meta.url)), "utf8");

/**
 * Field names on both sides of a wire nobody validates.
 *
 * Reading the engine's source from a test is unusual, and it is the only thing
 * that catches the failure that has actually happened here: a field renamed on
 * one side, dropped in silence on the other, and a run that finishes and
 * answers a question nobody asked. Comparing the payload against a copy of the
 * names written in this file would only pin this file to itself.
 */
describe("what the API sends the spreading engine", () => {
  const payload = spreadPayload(
    { environment: "x" },
    {
      seeds: { "pop:a": { malade: 5 } },
      horizon: 91,
      changes: [{ layer: "ecole", factor: 0, fromStep: 20, toStep: 40 }],
    },
  );

  it("sends every field the engine's request declares", () => {
    const body = ENGINE("api.py").split("class SpreadRequest")[1]!.split("class ")[0]!;
    for (const field of ["system", "seeds", "horizon", "changes"]) {
      assert.ok(body.includes(`${field}:`), `SpreadRequest no longer declares ${field}`);
      assert.ok(field in payload, `payload no longer sends ${field}`);
    }
  });

  it("names a window the way the engine names it, not the way this API does", () => {
    // `fromStep` reaches a field called `from_step` as nothing at all: pydantic
    // ignores what it does not know, the window silently starts at zero, and
    // the measure appears to have been in force from the first day.
    const change = ENGINE("spread.py").split("class LayerChange")[1]!.split("@dataclass")[0]!;
    assert.ok(change.includes("from_step"), "LayerChange no longer has from_step");
    assert.ok(change.includes("to_step"), "LayerChange no longer has to_step");
    assert.deepEqual(payload.changes[0], {
      layer: "ecole",
      factor: 0,
      from_step: 20,
      to_step: 40,
    });
  });

  it("keeps a window that never closes open rather than closing it at zero", () => {
    // `to_step: null` runs to the end. Sent as 0 it would close the same tick
    // it opened, which reads on screen as a measure that did nothing.
    const [only] = spreadPayload(null, {
      seeds: {},
      horizon: 10,
      changes: [{ layer: "ecole", factor: 0.5, fromStep: 3, toStep: null }],
    }).changes;
    assert.equal(only!.to_step, null);
  });

  it("passes the seeds through untouched", () => {
    // Keyed by the export's population ids, which is what comes back in
    // `states`. One vocabulary across the round trip.
    assert.deepEqual(payload.seeds, { "pop:a": { malade: 5 } });
  });
});
