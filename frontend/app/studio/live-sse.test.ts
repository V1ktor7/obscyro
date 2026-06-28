import { describe, expect, it } from "vitest";

import { parseSseEvents } from "./live-api";

describe("parseSseEvents", () => {
  it("parses data lines into metrics snapshots", () => {
    const buffer =
      'data: {"computedAt":"2026-01-01T00:00:00Z","totalInstances":3,"byType":[],"occupancy":[]}\n\n';
    const { events, remainder } = parseSseEvents(buffer);
    expect(events).toHaveLength(1);
    expect(events[0]?.totalInstances).toBe(3);
    expect(remainder).toBe("");
  });

  it("ignores ping comments", () => {
    const buffer = ": ping\n\n";
    const { events } = parseSseEvents(buffer);
    expect(events).toHaveLength(0);
  });

  it("retains partial chunks in remainder", () => {
    const buffer = 'data: {"computedAt":"2026-01-01T00:00:00Z","totalInstances":1,"byType":[],"occupancy":[]}';
    const { events, remainder } = parseSseEvents(buffer);
    expect(events).toHaveLength(0);
    expect(remainder).toContain("data:");
  });

  it("handles multiple events in one buffer", () => {
    const buffer =
      'data: {"computedAt":"a","totalInstances":1,"byType":[],"occupancy":[]}\n\n' +
      'data: {"computedAt":"b","totalInstances":2,"byType":[],"occupancy":[]}\n\n';
    const { events } = parseSseEvents(buffer);
    expect(events).toHaveLength(2);
    expect(events[1]?.totalInstances).toBe(2);
  });
});
