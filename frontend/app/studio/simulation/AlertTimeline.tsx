import type { AlertTimelineEvent } from "@/lib/platform-api";

export function groupAlertsByDay(
  events: AlertTimelineEvent[],
): Map<number, AlertTimelineEvent[]> {
  const byDay = new Map<number, AlertTimelineEvent[]>();
  for (const e of events) {
    const list = byDay.get(e.day) ?? [];
    list.push(e);
    byDay.set(e.day, list);
  }
  return new Map(
    Array.from(byDay.entries()).sort(([a], [b]) => a - b),
  );
}
