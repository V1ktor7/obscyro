import { describe, expect, it } from "vitest";

import { LAYER_META } from "./quality-api";

describe("LAYER_META", () => {
  it("defines six quality layers", () => {
    expect(LAYER_META).toHaveLength(6);
  });

  it("layer 6 ML anomaly is live", () => {
    // It shipped disabled and was turned on in 6fafc27; this assertion was
    // still checking for the flag, which is how it stayed red unnoticed.
    const ml = LAYER_META.find((l) => l.layer === 6);
    expect(ml?.label).toContain("ML");
    expect(ml?.disabled).toBeFalsy();
  });

  it("every layer is active and labelled", () => {
    for (const layer of LAYER_META) {
      expect(layer.disabled).toBeFalsy();
      expect(layer.label.length).toBeGreaterThan(0);
    }
  });
});
