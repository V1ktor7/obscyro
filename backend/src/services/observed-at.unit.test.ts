import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { freshnessAcross, freshnessOf, readStamp } from "./observed-at.js";

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

// ---------------------------------------------------------------------------
// An hour written with one digit.
//
// The MSSS emergency file writes `2026-11-19T9:45` from midnight to ten in the
// morning, and `2026-11-19T10:45` after. Refused, the first shape left every
// emergency reading without an age for ten hours a day: at 9:37 one morning no
// open alert had an exact age, and two hours later all of them did, with no
// change of code in between.
// ---------------------------------------------------------------------------

describe("an hour written with one digit", () => {
  it("is the hour it says", () => {
    // 9:45 in Montréal in November is 14:45 UTC.
    const { at, basis } = readStamp("2026-11-19T9:45", MTL);
    assert.equal(basis, "observed");
    assert.equal(at!.toISOString(), "2026-11-19T14:45:00.000Z");
    // The same instant as the two-digit spelling, to the millisecond.
    assert.equal(at!.getTime(), readStamp("2026-11-19T09:45", MTL).at!.getTime());
  });

  it("is read at midnight too, and with a space or seconds", () => {
    assert.equal(readStamp("2026-11-19T0:45", MTL).at!.toISOString(), "2026-11-19T05:45:00.000Z");
    assert.equal(readStamp("2026-11-19 9:45", MTL).at!.toISOString(), "2026-11-19T14:45:00.000Z");
    assert.equal(readStamp("2026-11-19T9:45:30", MTL).at!.toISOString(), "2026-11-19T14:45:30.000Z");
  });

  it("is read when the stamp carries its own zone", () => {
    assert.equal(readStamp("2026-11-19T9:45-05:00").at!.toISOString(), "2026-11-19T14:45:00.000Z");
    assert.equal(readStamp("2026-11-19T9:45:00Z").at!.toISOString(), "2026-11-19T09:45:00.000Z");
  });

  it("still needs a declared zone when it carries none", () => {
    assert.deepEqual(readStamp("2026-11-19T9:45"), { at: null, basis: "zone-unknown" });
  });

  it("gives an emergency reading an age before ten in the morning", () => {
    // 9:37 in Montréal: the newest census was published at 8:45.
    const out = freshnessOf({
      property: { key: "mise_a_jour", zone: MTL },
      instances: [{ properties: { mise_a_jour: "2026-11-19T8:45" } }],
      now: Date.parse("2026-11-19T14:37:00Z"),
    });
    assert.deepEqual(out, { seconds: 52 * 60, basis: "observed" });
  });

  it("does not complete a stamp that was cut short", () => {
    // Seen once in the file: the minutes never arrived. What is missing is not
    // filled in, and the hour of our download never stands in for it.
    for (const v of ["2026-11-19T9:", "2026-11-19T9", "2026-11-19T", "2026-11-19T9:4"]) {
      assert.deepEqual(readStamp(v, MTL), { at: null, basis: "unreadable" }, `read ${v}`);
    }
  });

  it("does not turn an hour that does not exist into one that does", () => {
    assert.equal(readStamp("2026-11-19T25:45", MTL).at, null);
    assert.equal(readStamp("2026-11-19T9:75", MTL).at, null);
  });
});

// ---------------------------------------------------------------------------
// A date with no hour.
//
// What a registry or a weekly sample publishes: `2026-07-02`. It names a day,
// on the clock the institution declared. It is read as the start of that day,
// the oldest the reading can be, so the age can overstate by up to a day and
// can never understate.
// ---------------------------------------------------------------------------

describe("a date with no hour", () => {
  it("is the start of that day on the declared clock", () => {
    // Midnight in Montréal is 04:00 UTC in July and 05:00 UTC in January.
    assert.deepEqual(readStamp("2026-07-02", MTL), { at: new Date("2026-07-02T04:00:00.000Z"), basis: "observed" });
    assert.equal(readStamp("2026-01-05", MTL).at!.toISOString(), "2026-01-05T05:00:00.000Z");
  });

  it("never makes a reading look fresher than it can be", () => {
    // Read at 15:00 Montréal on the day itself. The sample may have been taken
    // at 14:00 or at 00:05: the age given is the most it can be, fifteen hours.
    const out = freshnessOf({
      property: { key: "preleve_le", zone: MTL },
      instances: [{ properties: { preleve_le: "2026-11-19" } }],
      now: Date.parse("2026-11-19T20:00:00Z"),
    });
    assert.deepEqual(out, { seconds: 15 * 3600, basis: "observed" });
  });

  it("names a day on a clock, so it needs the clock declared", () => {
    assert.deepEqual(readStamp("2026-07-02"), { at: null, basis: "zone-unknown" });
  });

  it("is not read from something that only looks like a date", () => {
    for (const v of ["2026-07", "2026-7-2", "02/07/2026", "2026-13-45", "20260702"]) {
      assert.equal(readStamp(v, MTL).at, null, `read ${v}`);
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

// ---------------------------------------------------------------------------
// More than one source under one unit.
//
// Twenty-three emergency departments receive both an hourly stretcher census
// and an hourly air quality reading. Each publishes its own stamp, under its
// own property, and the rule was "the first one wins" — written when only one
// type had ever declared one. First by link insertion order, which no reader
// can see and nothing guarantees.
//
// The stalest wins instead: "Reading age" answers whether the numbers here can
// be trusted now, and two feeds make that answer no better than the older one.
// ---------------------------------------------------------------------------

const CENSUS = { key: "mise_a_jour", zone: "America/Toronto" };
const AIR = { key: "releve_a", zone: "America/Toronto" };

describe("freshness across several declared stamps", () => {
  const now = Date.parse("2026-09-15T17:00:00Z");
  const both = (census: string, air: string) => [
    { properties: { mise_a_jour: census } },
    { properties: { releve_a: air } },
  ];

  it("reports the older of the two, whichever was declared first", () => {
    // census 1 h old, air 4 h old
    const rows = both("2026-09-15T12:00", "2026-09-15T09:00");
    assert.deepEqual(freshnessAcross([CENSUS, AIR], rows, now), {
      seconds: 4 * 3600,
      basis: "observed",
    });
    assert.deepEqual(freshnessAcross([AIR, CENSUS], rows, now), {
      seconds: 4 * 3600,
      basis: "observed",
    });
  });

  it("is exactly freshnessOf when one source declares a stamp", () => {
    // Every unit in production is in this case today; it must not move.
    const rows = [{ properties: { mise_a_jour: "2026-09-15T12:00" } }];
    assert.deepEqual(
      freshnessAcross([CENSUS], rows, now),
      freshnessOf({ property: CENSUS, instances: rows, now }),
    );
  });

  it("still takes the newest row within one source", () => {
    const rows = [
      { properties: { mise_a_jour: "2026-09-15T09:00" } },
      { properties: { mise_a_jour: "2026-09-15T12:00" } },
    ];
    assert.equal(freshnessAcross([CENSUS], rows, now).seconds, 3600);
  });

  it("says so when one source publishes nothing readable", () => {
    // Reporting the other one's age alone would quietly claim the whole unit
    // is an hour old while half of it has gone silent.
    const rows = [
      { properties: { mise_a_jour: "2026-09-15T12:00" } },
      { properties: { releve_a: null } },
    ];
    const out = freshnessAcross([CENSUS, AIR], rows, now);
    assert.equal(out.basis, "partial");
    assert.equal(out.seconds, 3600);
  });

  it("keeps the reason when nothing at all is readable", () => {
    const rows = [{ properties: { mise_a_jour: "hier matin" } }];
    assert.deepEqual(freshnessAcross([CENSUS, AIR], rows, now), {
      seconds: null,
      basis: "unreadable",
    });
  });

  it("keeps zone-unknown, which is a different problem from unreadable", () => {
    const rows = [{ properties: { mise_a_jour: "2026-09-15T12:00" } }];
    assert.equal(freshnessAcross([{ key: "mise_a_jour" }], rows, now).basis, "zone-unknown");
  });

  it("is undeclared when nobody declared one", () => {
    assert.deepEqual(freshnessAcross([], [{ properties: {} }], now), {
      seconds: null,
      basis: "undeclared",
    });
  });

  it("is empty when nothing is linked, before asking about stamps", () => {
    assert.deepEqual(freshnessAcross([CENSUS], [], now), { seconds: null, basis: "empty" });
  });
});
