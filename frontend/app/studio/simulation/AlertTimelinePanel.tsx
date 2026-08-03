"use client";

import { StatusChip } from "../StatusChip";
import type { AlertTimelineEvent } from "@/lib/platform-api";

import { severityBadgeTone, truncateId } from "../twin-ui";
import { groupAlertsByDay } from "./AlertTimeline";

type AlertTimelineProps = {
  events: AlertTimelineEvent[];
  unitNames?: Map<string, string>;
};

export default function AlertTimelinePanel({
  events,
  unitNames,
}: AlertTimelineProps) {
  if (!events.length) {
    return (
      <p className="text-[11px] text-ink-faint">
        No alert rules would fire during this simulation run.
      </p>
    );
  }

  const grouped = groupAlertsByDay(events);

  return (
    <div className="space-y-3">
      {Array.from(grouped.entries()).map(([day, dayEvents]) => (
        <div key={day}>
          <p className="mb-1.5 text-[10px] uppercase tracking-wide text-ink-faint">
            Day {day}
          </p>
          <div className="space-y-2 border-l-2 border-brand/30 pl-3">
            {dayEvents.map((e, i) => (
              <div
                key={`${day}-${i}-${e.unitInstanceId}-${e.metric}`}
                className="rounded border border-line-faint bg-canvas-raised/50 px-2.5 py-2"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusChip tone={severityBadgeTone(e.severity)}>{e.severity}</StatusChip>
                  <span className="text-[10px] text-ink-muted">
                    {unitNames?.get(e.unitInstanceId) ??
                      `unit ${truncateId(e.unitInstanceId)}`}
                  </span>
                  <span className="text-[10px] text-ink-faint">
                    {e.metric}={Math.round(e.value * 10) / 10}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-ink-body">{e.message}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
