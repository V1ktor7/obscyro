import { describe, expect, it } from "vitest";

import {
  formatReadingAge,
  formatTwinMetric,
  kindIconName,
  severityDotClass,
  twinMetricNumber,
} from "./twin-ui";

describe("twin-ui", () => {
  const metrics = {
    unitId: "u1",
    instanceCountByType: { Patient: 3, Bed: 10 },
    values: { occupancy: 75.5, staff_available: 4, wait_minutes: 12.34 },
    occupancyPct: 75.5,
    numericMeans: { spo2: 94.2 },
    freshnessSeconds: 125,
    freshnessBasis: "observed" as const,
    fetchedAgeSeconds: null,
    linkedInstanceCount: 13,
  };

  it("formatTwinMetric formats occupancy", () => {
    expect(formatTwinMetric(metrics, "occupancyPct")).toBe("76%");
  });

  it("formatTwinMetric formats count prefix", () => {
    expect(formatTwinMetric(metrics, "count:Patient")).toBe("3");
  });

  it("formatTwinMetric formats freshness", () => {
    expect(formatTwinMetric(metrics, "freshnessSeconds")).toBe("2m");
  });

  it("formatTwinMetric renders a user-defined metric with its declared unit", () => {
    // The engine no longer knows what a metric means, so the unit decides the
    // rendering: the same 12.34 is "12" as a count and "12.3" as a number.
    expect(formatTwinMetric(metrics, "occupancy", "percent")).toBe("76%");
    expect(formatTwinMetric(metrics, "staff_available", "count")).toBe("4");
    expect(formatTwinMetric(metrics, "wait_minutes", "number")).toBe("12.3");
    expect(formatTwinMetric(metrics, "wait_minutes", "count")).toBe("12");
  });

  it("severityDotClass maps severities to palette tokens", () => {
    // Tailwind's rose/amber/emerald were replaced by the Studio's severity
    // tokens; the dots have to keep meaning the same thing.
    expect(severityDotClass("critical")).toBe("bg-danger");
    expect(severityDotClass("warn")).toBe("bg-warn");
    expect(severityDotClass(null)).toBe("bg-ok");
  });

  it("kindIconName maps kinds", () => {
    expect(kindIconName("ward")).toBe("BedDouble");
    expect(kindIconName("lab")).toBe("FlaskConical");
  });

  it("twinMetricNumber reads the number an alert rule would threshold", () => {
    // A measure the organisation defined wins over a built-in of the same name.
    expect(twinMetricNumber(metrics, "occupancy")).toBe(75.5);
    expect(twinMetricNumber(metrics, "occupancyPct")).toBe(75.5);
    expect(twinMetricNumber(metrics, "linkedInstanceCount")).toBe(13);
    expect(twinMetricNumber(metrics, "freshnessSeconds")).toBe(125);
    expect(twinMetricNumber(metrics, "count:Patient")).toBe(3);
    expect(twinMetricNumber(metrics, "mean:spo2")).toBe(94.2);
    expect(twinMetricNumber(metrics, "spo2")).toBe(94.2);
  });

  it("twinMetricNumber keeps a missing value missing", () => {
    // Not a zero: a unit that reports nothing for a measure is not at 0.
    expect(twinMetricNumber(metrics, "wastewater")).toBeNull();
    expect(twinMetricNumber({ ...metrics, values: { occupancy: null } }, "occupancy")).toBeNull();
    expect(twinMetricNumber(undefined, "occupancy")).toBeNull();
    // A count of a type nothing is linked to is a true zero.
    expect(twinMetricNumber(metrics, "count:Ventilator")).toBe(0);
  });
});

describe("formatReadingAge", () => {
  it("reads as an age when one source answered", () => {
    expect(formatReadingAge(3600, "observed")).toBe("1h ago");
  });

  it("marks a floor as a floor, in the text and not only in a tooltip", () => {
    // A reader repeats the number, not the tooltip. "2h ago" under a unit
    // whose other feed went quiet is a claim nobody can stand behind.
    expect(formatReadingAge(7200, "partial")).toBe("≥ 2h ago");
  });

  it("says unknown rather than showing a dash", () => {
    expect(formatReadingAge(null, "undeclared")).toBe("unknown");
    expect(formatReadingAge(null, "partial")).toBe("unknown");
  });
});
