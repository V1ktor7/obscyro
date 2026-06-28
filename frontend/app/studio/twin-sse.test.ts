import { describe, expect, it } from "vitest";

import { parseSseJsonEvents, type TwinTreeSnapshot } from "@/lib/platform-api";

describe("parseSseJsonEvents (twin)", () => {
  it("parses twin tree snapshots", () => {
    const buffer =
      'data: {"computedAt":"2026-01-01T00:00:00Z","nodes":[],"edges":[],"roots":[]}\n\n';
    const { events, remainder } = parseSseJsonEvents<TwinTreeSnapshot>(buffer);
    expect(events).toHaveLength(1);
    expect(events[0]?.computedAt).toBe("2026-01-01T00:00:00Z");
    expect(remainder).toBe("");
  });

  it("ignores ping comments", () => {
    const { events } = parseSseJsonEvents<TwinTreeSnapshot>(": ping\n\n");
    expect(events).toHaveLength(0);
  });

  it("retains partial chunks", () => {
    const buffer = 'data: {"computedAt":"x","nodes":[]';
    const { events, remainder } = parseSseJsonEvents<TwinTreeSnapshot>(buffer);
    expect(events).toHaveLength(0);
    expect(remainder).toContain("data:");
  });
});
