import { describe, expect, it } from "vitest";

import { LAYER_META } from "./quality-api";

describe("LAYER_META", () => {
  it("defines six quality layers", () => {
    expect(LAYER_META).toHaveLength(6);
  });

  it("marks layer 6 ML anomaly as disabled", () => {
    const ml = LAYER_META.find((l) => l.layer === 6);
    expect(ml?.label).toContain("ML");
    expect(ml?.disabled).toBe(true);
  });

  it("has active layers 1 through 5 without disabled flag", () => {
    for (const layer of LAYER_META.filter((l) => l.layer <= 5)) {
      expect(layer.disabled).toBeFalsy();
      expect(layer.label.length).toBeGreaterThan(0);
    }
  });
});
