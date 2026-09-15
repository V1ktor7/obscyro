import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { propertyDefWire } from "./ontology.js";

// ---------------------------------------------------------------------------
// The exact failure the comment above `propertyDefFields` describes, a second
// time. `required` was missing from the wire schema, so a round trip through
// the type editor silently turned a required property optional.
//
// `observedAt` and `observedAtZone` were in the same state. They are what let
// the twin say how old a reading is, and without them a stamp is reported
// unreadable rather than guessed at. Declared in the database and then saved
// once from the UI, the declaration vanished — and eight air quality stations
// would have gone back to "reading age unknown" with nothing raised.
// ---------------------------------------------------------------------------

describe("a property declaration survives the wire", () => {
  it("keeps the observation stamp and its clock", () => {
    const parsed = propertyDefWire.parse({
      key: "releve_a",
      type: "string",
      observedAt: true,
      observedAtZone: "America/Toronto",
    });
    assert.equal(parsed.observedAt, true);
    assert.equal(parsed.observedAtZone, "America/Toronto");
  });

  it("refuses a clock no platform knows", () => {
    // An unknown zone is reported as unreadable at read time, which looks
    // exactly like a source that stopped publishing. Catch it at the keystroke.
    assert.throws(() =>
      propertyDefWire.parse({
        key: "releve_a",
        type: "string",
        observedAt: true,
        observedAtZone: "America/Montreal_Quebec",
      }),
    );
  });

  it("refuses a clock declared for a property that carries no stamp", () => {
    assert.throws(() =>
      propertyDefWire.parse({ key: "x", type: "string", observedAtZone: "America/Toronto" }),
    );
  });

  it("leaves an ordinary property alone", () => {
    const parsed = propertyDefWire.parse({ key: "name", type: "string" });
    assert.equal(parsed.observedAt, undefined);
    assert.equal(parsed.observedAtZone, undefined);
  });
});
