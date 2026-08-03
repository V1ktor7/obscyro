import { describe, expect, it } from "vitest";

import {
  formatTwinMetric,
  kindIconName,
  severityDotClass,
} from "./twin-ui";

describe("twin-ui", () => {
  const metrics = {
    unitId: "u1",
    instanceCountByType: { Patient: 3, Bed: 10 },
    values: { occupancy: 75.5, staff_available: 4, wait_minutes: 12.34 },
    occupancyPct: 75.5,
    numericMeans: { spo2: 94.2 },
    freshnessSeconds: 125,
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
});
