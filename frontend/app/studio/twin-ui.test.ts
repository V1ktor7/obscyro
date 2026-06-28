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

  it("severityDotClass maps severities", () => {
    expect(severityDotClass("critical")).toContain("rose");
    expect(severityDotClass("warn")).toContain("amber");
    expect(severityDotClass(null)).toContain("emerald");
  });

  it("kindIconName maps kinds", () => {
    expect(kindIconName("ward")).toBe("BedDouble");
    expect(kindIconName("lab")).toBe("FlaskConical");
  });
});
