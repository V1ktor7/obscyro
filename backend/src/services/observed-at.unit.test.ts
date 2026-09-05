import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { freshnessOf, readStamp } from "./observed-at.js";

/**
 * The difference between when a number was true and when we wrote it down.
 *
 * Measured wrong, freshness is worse than absent: a re-download of an unchanged
 * file resets it, and an eighty-minute-old occupancy figure reads as four
 * minutes old on the screen somebody is deciding from. Every case here is one
 * way that lie gets told.
 */

const MTL = "America/Toronto";

describe("reading a published timestamp", () => {
  it("takes a stamp that carries its own zone at its word", () => {
    const { at, basis } = readStamp("2026-09-05T22:45:00Z");
    assert.equal(basis, "observed");
    assert.equal(at!.toISOString(), "2026-09-05T22:45:00.000Z");
  });

  it("reads an offset as an offset", () => {
    assert.equal(
      readStamp("2026-09-05T18:45:00-04:00").at!.toISOString(),
      "2026-09-05T22:45:00.000Z",
    );
  });

  it("places a naive stamp on the clock it was declared for", () => {
    // This is the MSSS shape exactly: 2026-09-05T18:45, no zone, Montréal time.
    // `new Date()` on the server reads it as UTC, and the server is UTC on
    // Railway — which would put a 6:45pm Montréal reading four hours in the
    // future and give freshness a negative number.
    const { at, basis } = readStamp("2026-09-05T18:45", MTL);
    assert.equal(basis, "observed");
    assert.equal(at!.toISOString(), "2026-09-05T22:45:00.000Z");
  });

  it("follows daylight saving rather than a fixed offset", () => {
    // Same wall clock, January: Montréal is on standard time, five hours back.
    assert.equal(readStamp("2026-01-05T18:45", MTL).at!.toISOString(), "2026-01-05T23:45:00.000Z");
    assert.equal(readStamp("2026-07-05T18:45", MTL).at!.toISOString(), "2026-07-05T22:45:00.000Z");
  });

  it("refuses a naive stamp when no zone was declared", () => {
    // Guessing UTC here is the whole bug. Saying so is the fix.
    const { at, basis } = readStamp("2026-09-05T18:45");
    assert.equal(at, null);
    assert.equal(basis, "zone-unknown");
  });

  it("refuses a zone nobody has heard of rather than falling back to the server", () => {
    assert.equal(readStamp("2026-09-05T18:45", "Mars/Olympus").basis, "zone-unknown");
  });

  it("accepts a space where the T should be, which is how CSV writes it", () => {
    assert.equal(readStamp("2026-09-05 18:45", MTL).at!.toISOString(), "2026-09-05T22:45:00.000Z");
  });

  it("says nothing for a value that is not a timestamp at all", () => {
    for (const v of ["", "   ", null, undefined, "hier", "18:45", 42]) {
      assert.equal(readStamp(v, MTL).at, null, `read ${String(v)}`);
    }
  });
});

describe("how old the reading under a unit is", () => {
  const now = Date.parse("2026-09-05T23:24:00Z");
  const prop = { key: "Mise_a_jour", zone: MTL };

  it("measures from the source's stamp, not from the write", () => {
    // 18:45 Montréal is 22:45 UTC; at 23:24 UTC that is 39 minutes.
    const out = freshnessOf({
      property: prop,
      instances: [{ properties: { Mise_a_jour: "2026-09-05T18:45" } }],
      now,
    });
    assert.equal(out.basis, "observed");
    assert.equal(out.seconds, 39 * 60);
  });

  it("takes the newest reading under the unit", () => {
    const out = freshnessOf({
      property: prop,
      instances: [
        { properties: { Mise_a_jour: "2026-09-05T12:00" } },
        { properties: { Mise_a_jour: "2026-09-05T18:45" } },
      ],
      now,
    });
    assert.equal(out.seconds, 39 * 60);
  });

  it("says unknown when no property is declared, rather than timing the download", () => {
    const out = freshnessOf({
      property: null,
      instances: [{ properties: { Mise_a_jour: "2026-09-05T18:45" } }],
      now,
    });
    assert.equal(out.seconds, null);
    assert.equal(out.basis, "undeclared");
  });

  it("says unknown when the declared property holds nothing readable", () => {
    const out = freshnessOf({
      property: prop,
      instances: [{ properties: { Mise_a_jour: "" } }, { properties: {} }],
      now,
    });
    assert.equal(out.seconds, null);
    assert.equal(out.basis, "unreadable");
  });

  it("distinguishes a missing zone from a missing value", () => {
    // Both come out as "unknown" on screen, but only one is fixed by declaring
    // a zone, and the sentence has to send the reader to the right place.
    const out = freshnessOf({
      property: { key: "Mise_a_jour", zone: null },
      instances: [{ properties: { Mise_a_jour: "2026-09-05T18:45" } }],
      now,
    });
    assert.equal(out.basis, "zone-unknown");
  });

  it("says nothing about a unit with nothing under it", () => {
    assert.deepEqual(freshnessOf({ property: prop, instances: [], now }), {
      seconds: null,
      basis: "empty",
    });
  });

  it("reports a stamp from the future as negative rather than flooring it", () => {
    // A source stamping ahead of us is a clock fault somewhere, and a zero
    // would present it as perfectly fresh.
    const out = freshnessOf({
      property: prop,
      instances: [{ properties: { Mise_a_jour: "2026-09-06T18:45" } }],
      now,
    });
    assert.ok(out.seconds !== null && out.seconds < 0);
  });
});
