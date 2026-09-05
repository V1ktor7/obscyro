import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  crossReference,
  dayToDate,
  placeSites,
  seriesFromTrajectories,
  siteValueFromUnits,
  stepsIn,
  valuesAtStep,
} from "./dashboard-twin.js";
import { readContext } from "./dashboards.js";
import type { AlertTimelineEvent, DailyTrajectory } from "./simulation.js";

/**
 * The joins and the silences.
 *
 * Every function here sits between a source that knows some of the network and
 * a card that draws all of it. The failure they guard against is the same one
 * each time: filling a gap with a number instead of leaving it empty. A site
 * the run never mentioned drawn at zero reads as a calm hospital; a mean
 * computed over an empty overlap reads as perfect agreement.
 */

const alert = (over: Partial<AlertTimelineEvent>): AlertTimelineEvent => ({
  day: 0,
  unitInstanceId: "u1",
  ruleId: null,
  metric: "occupancy",
  value: 1,
  severity: "warn",
  message: "",
  ...over,
});

const site = (over: Partial<Parameters<typeof siteValueFromUnits>[0]> = {}) => ({
  id: "s1",
  name: "CHUM",
  latitude: 45.5,
  longitude: -73.5,
  contributingUnits: [] as { id: string; name: string }[],
  metrics: { values: {} as Record<string, number | null> },
  ...over,
});

describe("reading one step of a run", () => {
  it("keeps the worst reading a unit had that day", () => {
    // A unit whose twenty acute beds are full and whose clinic is empty is not
    // half full; it is turning people away.
    const at = valuesAtStep(
      [
        alert({ day: 3, unitInstanceId: "u1", value: 0.4 }),
        alert({ day: 3, unitInstanceId: "u1", value: 1.2 }),
      ],
      3,
    );
    assert.equal(at.get("u1")!.value, 1.2);
  });

  it("says nothing about a day the run said nothing about", () => {
    const at = valuesAtStep([alert({ day: 3 })], 4);
    assert.equal(at.size, 0);
  });

  it("offers only the days the run actually recorded", () => {
    // A step picker running 0..horizon would offer days with nothing in them,
    // and each one would draw an empty map that reads as a quiet network.
    assert.deepEqual(stepsIn([alert({ day: 5 }), alert({ day: 2 }), alert({ day: 5 })]), [2, 5]);
  });
});

describe("putting sites on the map", () => {
  it("counts the ones it cannot place instead of dropping them", () => {
    // "22 sites, 3 without coordinates" is a fixable statement. A map quietly
    // showing 19 is not.
    const out = placeSites(
      [site({ id: "a" }), site({ id: "b", latitude: null }), site({ id: "c", longitude: null })],
      () => ({ value: 1, from: null }),
    );
    assert.equal(out.sites.length, 1);
    assert.equal(out.unplaced, 2);
  });

  it("counts a placed site with no reading as unread, and keeps it on the map", () => {
    // Dropping it would shrink the network; drawing it at zero would invent a
    // hospital with nobody in it.
    const out = placeSites([site({ id: "a" }), site({ id: "b" })], (s) =>
      s.id === "a" ? { value: 0.9, from: null } : { value: null, from: null },
    );
    assert.equal(out.sites.length, 2);
    assert.equal(out.unread, 1);
    assert.equal(out.sites.find((s) => s.id === "b")!.value, null);
  });
});

describe("joining a run back to a site", () => {
  it("reads through the units placed in the site", () => {
    // A run models org units; a map draws buildings. Without the placement the
    // building has no number of its own.
    const values = new Map([["unit-9", { value: 0.87, message: "" }]]);
    const out = siteValueFromUnits(
      site({ contributingUnits: [{ id: "unit-9", name: "Urgence" }] }),
      values,
    );
    assert.equal(out.value, 0.87);
    assert.equal(out.from, "Urgence", "the card can say which unit the number came from");
  });

  it("accepts a site that is its own unit", () => {
    // A twin whose installations carry their own coordinates has no placement
    // link to follow, and returning nothing there left every site grey.
    const out = siteValueFromUnits(site({ id: "s1" }), new Map([["s1", { value: 2, message: "" }]]));
    assert.equal(out.value, 2);
  });

  it("keeps the worst of several units in one building", () => {
    const out = siteValueFromUnits(
      site({
        contributingUnits: [
          { id: "a", name: "Longue duree" },
          { id: "b", name: "Urgence" },
        ],
      }),
      new Map([
        ["a", { value: 0.1, message: "" }],
        ["b", { value: 1.4, message: "" }],
      ]),
    );
    assert.equal(out.from, "Urgence");
  });

  it("returns nothing rather than zero when no unit was mentioned", () => {
    const out = siteValueFromUnits(site({ contributingUnits: [{ id: "a", name: "x" }] }), new Map());
    assert.equal(out.value, null);
  });
});

describe("a trajectory and the spread it came from", () => {
  const day = (d: number, I: number): DailyTrajectory => ({
    day: d,
    S: 0,
    E: 0,
    I,
    R: 0,
    isolationDemand: 0,
  });

  it("carries the p5-p95 band beside the median", () => {
    // A median drawn alone from ten stochastic runs reads as a forecast.
    const out = seriesFromTrajectories(
      { p5: [day(0, 1), day(1, 2)], p50: [day(0, 3), day(1, 5)], p95: [day(0, 6), day(1, 9)] },
      "I",
    );
    assert.deepEqual(out.points, [
      { label: "J0", value: 3 },
      { label: "J1", value: 5 },
    ]);
    assert.deepEqual(out.band[1], { label: "J1", low: 2, high: 9 });
  });

  it("draws no band where an edge is missing rather than a flat one", () => {
    // Substituting the median for a missing edge draws a zero-width band, and
    // a zero-width band reads as certainty.
    const out = seriesFromTrajectories(
      { p5: [day(0, 1), day(1, 2)], p50: [day(0, 3), day(1, 5)], p95: [day(0, 6)] },
      "I",
    );
    assert.equal(out.points.length, 2, "both days are still drawn");
    assert.deepEqual(
      out.band.map((b) => b.label),
      ["J0"],
      "only the day with both edges gets a band",
    );
  });

  it("is empty when the run kept no median", () => {
    assert.deepEqual(seriesFromTrajectories(null, "I"), { points: [], band: [] });
  });
});

describe("lining a run up with the calendar", () => {
  it("counts days forward from when the run was made", () => {
    assert.equal(dayToDate("2026-03-01T12:00:00.000Z", 0), "2026-03-01");
    assert.equal(dayToDate("2026-03-01T12:00:00.000Z", 31), "2026-04-01");
  });

  it("falls back to the step number rather than inventing a date", () => {
    assert.equal(dayToDate("not a date", 4), "J4");
  });
});

describe("comparing a prediction with what happened", () => {
  it("measures only the days both series have", () => {
    const x = crossReference(
      [
        { label: "2026-03-01", value: 10 },
        { label: "2026-03-02", value: 20 },
        { label: "2026-03-03", value: 30 },
      ],
      [
        { label: "2026-03-02", value: 24 },
        { label: "2026-03-03", value: 28 },
      ],
    );
    assert.equal(x.overlap, 2);
    assert.equal(x.meanGap, 3);
  });

  it("names the worst day so a good average cannot bury it", () => {
    const x = crossReference(
      [
        { label: "a", value: 10 },
        { label: "b", value: 100 },
      ],
      [
        { label: "a", value: 10 },
        { label: "b", value: 20 },
      ],
    );
    assert.deepEqual(x.worstGap, { label: "b", predicted: 100, observed: 20 });
  });

  it("says nothing at all when the two never overlap", () => {
    // A mean over an empty set is 0, and 0 reads as perfect agreement — which
    // is the opposite of what an empty overlap means.
    const x = crossReference([{ label: "2026-05-01", value: 5 }], [{ label: "2026-01-01", value: 5 }]);
    assert.equal(x.overlap, 0);
    assert.equal(x.meanGap, null);
    assert.equal(x.worstGap, null);
  });
});

describe("reading a board that holds several maps", () => {
  it("rolls the network up once, not once per card", async () => {
    // The roll-up walks every instance and link in the project. Three map cards
    // on one board asked for it three times, and opening the board took three
    // times as long as it had any reason to.
    let queries = 0;
    const db = {
      query: async () => {
        queries += 1;
        return { rows: [], rowCount: 0 };
      },
    } as unknown as Parameters<typeof readContext>[0];

    const ctx = readContext(db, "p");
    const [a, b, c] = [ctx.network(), ctx.network(), ctx.network()];
    assert.equal(a, b, "the second card gets the first card's read");
    assert.equal(b, c);
    await a;
    const once = queries;

    const fresh = readContext(db, "p");
    await fresh.network();
    assert.equal(queries - once, once, "a new read does go back to the database");
  });
});
