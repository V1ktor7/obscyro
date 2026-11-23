import { describe, expect, it } from "vitest";

import type { TwinUnitMetrics, TwinUnitTrends } from "@/lib/platform-api";

import { agePhrase, changeView, clockLabel, commonSince, formatDelta, meanView, reportLines, sourceNotes, withheldPhrase } from "./unit-trends";

// 18:00 in Montréal on 22 November.
const NOW = "2026-11-22T23:00:00.000Z";
const MTL = "America/Toronto";
const T1645 = "2026-11-22T21:45:00.000Z";

describe("the change since the reading before", () => {
  it("is written in the measure's own unit, with the hour it is counted from", () => {
    const up = changeView({ previous: { value: 130, at: T1645, atIs: "observed" }, delta: 6 }, "count", NOW, { seconds: 900, basis: "observed", zone: MTL });
    expect(up).toEqual({ text: "▲ 6", since: "16:45", says: "Up 6 since the reading of 16:45." });
    // A percentage moves by points, not by percent.
    expect(changeView({ previous: { value: 203, at: T1645, atIs: "observed" }, delta: -6.4 }, "percent", NOW, { seconds: 900, basis: "observed", zone: MTL })?.text).toBe("▼ 6 pts");
    // A duration moves by hours and minutes.
    expect(formatDelta(-0.41, "hours")).toBe("0 h 25");
  });

  it("says no change when the value is the same at the next hour", () => {
    const same = changeView({ previous: { value: 53, at: T1645, atIs: "observed" }, delta: 0 }, "count", NOW, { seconds: 900, basis: "observed", zone: MTL });
    expect(same?.text).toBe("no change");
    expect(same?.says).toBe("No change since the reading of 16:45.");
    // A move too small to print is not an arrow beside "0".
    expect(changeView({ previous: { value: 209.2, at: T1645, atIs: "observed" }, delta: 0.3 }, "percent", NOW)?.text).toBe("no change");
  });

  it("writes that nothing was kept before, instead of a change", () => {
    const first = changeView({ previous: null, delta: null }, "count", NOW);
    expect(first?.text).toBe("first reading kept");
    expect(first?.since).toBeNull();
  });

  it("counts no change against an hour that had no value", () => {
    const gap = changeView({ previous: { value: null, at: T1645, atIs: "observed" }, delta: null }, "count", NOW, { seconds: 900, basis: "observed", zone: MTL });
    expect(gap?.text).toBe("no value before");
    expect(gap?.says).toContain("no change is counted against an absence");
  });

  it("says nothing when the server sent nothing", () => {
    expect(changeView(undefined, "count", NOW)).toBeNull();
    expect(changeView(null, "count", NOW)).toBeNull();
  });

  it("names a reading the source did not date by when it was noted", () => {
    const c = changeView({ previous: { value: 1.1, at: "2026-11-15T12:00:00.000Z", atIs: "recorded" }, delta: 0.3 }, "number", NOW, { seconds: null, basis: "undeclared", zone: "UTC" });
    expect(c?.says).toBe("Up 0.3 since the reading noted at 15 Nov 12:00.");
  });
});

describe("an hour on the clock of its source", () => {
  it("gives the hour alone the same day, and the day with it otherwise", () => {
    expect(clockLabel(T1645, NOW, MTL)).toBe("16:45");
    // 23:45 the evening before in Montréal, already the 22nd in UTC.
    expect(clockLabel("2026-11-22T04:45:00.000Z", NOW, MTL)).toBe("21 Nov 23:45");
  });

  it("reads a stamp kept a fraction of a second early as the minute it is", () => {
    // What the twin kept for a reading stamped 17:45: "now minus its age in whole seconds".
    expect(clockLabel("2026-11-22T22:44:59.872Z", NOW, MTL)).toBe("17:45");
    expect(clockLabel("2026-11-22T22:45:01.100Z", NOW, MTL)).toBe("17:45");
  });
});

describe("the mean over the days kept", () => {
  it("says how many days it rests on until the window is full", () => {
    expect(meanView({ mean: 6.2, days: 12, from: "2026-11-11", to: "2026-11-22", window: 30 }, "hours")).toEqual({ text: "6 h 12", label: "average over 12 days kept" });
    expect(meanView({ mean: 6.2, days: 1, from: "2026-11-22", to: "2026-11-22", window: 30 }, "hours")?.label).toBe("average over 1 day kept");
    expect(meanView({ mean: 6.2, days: 30, from: "2026-10-24", to: "2026-11-22", window: 30 }, "hours")?.label).toBe("30-day average");
    expect(meanView(undefined, "hours")).toBeNull();
  });
});

describe("how a value is dated", () => {
  it("never gives a figure of the day before the age of the last hour", () => {
    expect(agePhrase({ seconds: 900, basis: "observed", period: "previous_day", zone: MTL }, "hours")).toBe("Yesterday's average, published 15m ago");
    expect(agePhrase({ seconds: 900, basis: "observed", period: "previous_day" }, "count")).toBe("Yesterday's figure, published 15m ago");
    expect(agePhrase({ seconds: 900, basis: "observed" }, "count")).toBe("This value was read 15m ago");
    expect(agePhrase({ seconds: null, basis: "unreadable" }, "count")).toBe("The age of this value is unknown");
  });

  it("says why a value is not shown", () => {
    expect(withheldPhrase({ reason: "several", count: 3 })).toContain("3 units under this one each publish their own average");
    expect(withheldPhrase({ reason: "blank", count: 1 })).toBe("Its source published no figure in the latest reading.");
  });
});

const DEFS = [
  { key: "occupancy", label: "Occupation des civières", unit: "percent" as const, numerator: { ofType: "ReleveUrgence", agg: "sum" as const }, denominator: { ofType: "ReleveUrgence", agg: "sum" as const } },
  { key: "patients_presents", label: "People in the emergency room", unit: "count" as const, numerator: { ofType: "ReleveUrgence", agg: "sum" as const } },
  { key: "dms_ambulatoire", label: "Average stay, walk-in patients", unit: "hours" as const, numerator: { ofType: "ReleveUrgence", agg: "only" as const } },
  { key: "iqa", label: "Indice de la qualité de l'air", unit: "number" as const, numerator: { ofType: "StationAirQualite", agg: "max" as const } },
];

const metrics = (over: Partial<TwinUnitMetrics> = {}): TwinUnitMetrics => ({
  unitId: "u1",
  instanceCountByType: { ReleveUrgence: 1 },
  values: { occupancy: 209.4, patients_presents: 136, dms_ambulatoire: 5.99, iqa: null },
  occupancyPct: 209.4,
  numericMeans: {},
  freshnessSeconds: 900,
  freshnessBasis: "observed",
  valueAges: {
    occupancy: { seconds: 900, basis: "observed" },
    patients_presents: { seconds: 900, basis: "observed" },
    dms_ambulatoire: { seconds: 900, basis: "observed", period: "previous_day", zone: MTL },
  },
  fetchedAgeSeconds: 2,
  linkedInstanceCount: 1,
  ...over,
});

const TRENDS: TwinUnitTrends = {
  at: NOW,
  changes: {
    occupancy: { previous: { value: 203, at: T1645, atIs: "observed" }, delta: 6.4 },
    patients_presents: { previous: { value: 130, at: T1645, atIs: "observed" }, delta: 6 },
    dms_ambulatoire: { previous: { value: 6.4, at: "2026-11-22T04:45:00.000Z", atIs: "observed" }, delta: -0.41 },
  },
  means: { dms_ambulatoire: { mean: 6.2, days: 12, from: "2026-11-11", to: "2026-11-22", window: 30 } },
};

describe("what a unit reports", () => {
  it("lists each measure with its change, and a daily figure with its mean", () => {
    const lines = reportLines(DEFS, metrics(), TRENDS, NOW);
    // The air index has no value and no reason to give: nothing it reads is here.
    expect(lines.map((l) => l.key)).toEqual(["occupancy", "patients_presents", "dms_ambulatoire"]);
    expect(lines[1]).toMatchObject({ text: "136", daily: false, change: { text: "▲ 6", since: "16:45" }, mean: null, withheld: null });
    expect(lines[2]).toMatchObject({ text: "5 h 59", daily: true, change: { text: "▼ 0 h 25", since: "21 Nov 23:45" }, mean: { text: "6 h 12", label: "average over 12 days kept" } });
    // Said once for the list: the hour most changes are counted from.
    expect(commonSince(lines)).toBe("16:45");
  });

  it("keeps a withheld measure in the list, with its reason and no figure", () => {
    const lines = reportLines(DEFS, metrics({ values: { occupancy: 150, patients_presents: 226, dms_ambulatoire: null, iqa: null }, withheld: { dms_ambulatoire: { reason: "several", count: 2 } } }), TRENDS, NOW);
    const stay = lines.find((l) => l.key === "dms_ambulatoire")!;
    expect(stay.text).toBeNull();
    expect(stay.withheld).toContain("2 units under this one");
    expect(stay.change).toBeNull();
  });

  it("still lists the values when the history could not be read", () => {
    const lines = reportLines(DEFS, metrics(), null, NOW);
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => l.change === null && l.mean === null)).toBe(true);
    expect(commonSince(lines)).toBeNull();
    expect(reportLines(DEFS, undefined, TRENDS, NOW)).toEqual([]);
  });
});

describe("where the figures come from", () => {
  it("prints what the organisation wrote on the types the reported measures read", () => {
    const notes = { ReleveUrgence: "Source : MSSS, Console provinciale des urgences, CC-BY 4.0.", StationAirQualite: "RSQA." };
    const reported = new Set(["occupancy", "patients_presents"]);
    // One note for the census, said once though two measures read it; none for a station nothing here reports.
    expect(sourceNotes(DEFS, reported, notes)).toEqual([{ type: "ReleveUrgence", text: notes.ReleveUrgence }]);
    expect(sourceNotes(DEFS, reported, undefined)).toEqual([]);
    expect(sourceNotes(DEFS, reported, {})).toEqual([]);
  });
});
