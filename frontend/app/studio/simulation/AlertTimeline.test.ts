import { describe, expect, it } from "vitest";

import type { AlertTimelineEvent } from "@/lib/platform-api";

import { groupAlertsByDay } from "./AlertTimeline";

describe("groupAlertsByDay", () => {
  const events: AlertTimelineEvent[] = [
    {
      day: 2,
      unitInstanceId: "u1",
      ruleId: null,
      metric: "infectedCount",
      value: 3,
      severity: "warn",
      message: "Day 2 warn",
    },
    {
      day: 1,
      unitInstanceId: "u2",
      ruleId: null,
      metric: "infectedCount",
      value: 1,
      severity: "critical",
      message: "Day 1 critical",
    },
    {
      day: 2,
      unitInstanceId: "u3",
      ruleId: null,
      metric: "isolationDemand",
      value: 2,
      severity: "info",
      message: "Day 2 info",
    },
  ];

  it("groups and sorts by day ascending", () => {
    const grouped = groupAlertsByDay(events);
    expect([...grouped.keys()]).toEqual([1, 2]);
    expect(grouped.get(1)).toHaveLength(1);
    expect(grouped.get(2)).toHaveLength(2);
  });
});
