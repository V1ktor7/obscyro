import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { alertStateOfPlace, type TwinAlertSeverity } from "./twin.js";

/**
 * What a building on the map says about the wards inside it.
 *
 * The map picks its sites one way or the other: instances of a type the
 * institution called physical, or — only when nothing is tagged — the twin
 * tree's roots. Tagging buildings physical therefore replaces units with
 * buildings on the map in a single step, and everything a unit carried has to
 * be carried across explicitly or it disappears without a word.
 */

const node = (worstAlertSeverity: TwinAlertSeverity | null, openAlertCount: number) => ({
  worstAlertSeverity,
  openAlertCount,
});

describe("a building shows the alerts of what stands in it", () => {
  it("carries a ward's alert up to the building", () => {
    // The regression this exists to prevent: promote a registry of addresses
    // to map sites and every ring goes out at once, while the alerts stay
    // open in the database and listed in the panel beside the map.
    const units = new Map([["u1", node("critical", 1)]]);
    assert.deepEqual(alertStateOfPlace([{ id: "u1" }], units), {
      worstAlertSeverity: "critical",
      openAlertCount: 1,
    });
  });

  it("shows the worst of several wards, not the commonest", () => {
    // A building holding four calm clinics and one overflowing emergency ward
    // is not, on average, fine.
    const units = new Map([
      ["u1", node("info", 1)],
      ["u2", node("info", 1)],
      ["u3", node("critical", 1)],
      ["u4", node("warn", 1)],
    ]);
    const out = alertStateOfPlace(
      [{ id: "u1" }, { id: "u2" }, { id: "u3" }, { id: "u4" }],
      units,
    );
    assert.equal(out.worstAlertSeverity, "critical");
    assert.equal(out.openAlertCount, 4, "the count is every open alert in the building");
  });

  it("orders warn above info", () => {
    const units = new Map([
      ["u1", node("info", 2)],
      ["u2", node("warn", 1)],
    ]);
    assert.equal(alertStateOfPlace([{ id: "u1" }, { id: "u2" }], units).worstAlertSeverity, "warn");
  });

  it("stays quiet when nothing inside is alerting", () => {
    const units = new Map([
      ["u1", node(null, 0)],
      ["u2", node(null, 0)],
    ]);
    assert.deepEqual(alertStateOfPlace([{ id: "u1" }, { id: "u2" }], units), {
      worstAlertSeverity: null,
      openAlertCount: 0,
    });
  });

  it("is quiet — not alarmed — for a building with nothing placed in it", () => {
    // Most of a provincial installation registry is group homes and clinics
    // with no org unit attached. An empty building is not an emergency.
    assert.deepEqual(alertStateOfPlace([], new Map()), {
      worstAlertSeverity: null,
      openAlertCount: 0,
    });
  });

  it("ignores a placed unit the tree does not know", () => {
    const units = new Map([["u1", node("critical", 1)]]);
    const out = alertStateOfPlace([{ id: "u1" }, { id: "ghost" }], units);
    assert.equal(out.openAlertCount, 1, "a unit outside the tree contributes nothing");
  });

  it("counts a ward once even when it is placed twice", () => {
    // Two `situe_dans` links onto one building would otherwise double every
    // number the badge shows.
    const units = new Map([["u1", node("warn", 3)]]);
    assert.equal(alertStateOfPlace([{ id: "u1" }, { id: "u1" }], units).openAlertCount, 3);
  });
});
