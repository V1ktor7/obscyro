"use client";

import { Badge } from "@/components/ui/Badge";
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
      <p className="text-[11px] text-gray-400">
        No alert rules would fire during this simulation run.
      </p>
    );
  }

  const grouped = groupAlertsByDay(events);

  return (
    <div className="space-y-3">
      {Array.from(grouped.entries()).map(([day, dayEvents]) => (
        <div key={day}>
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wide text-gray-400">
            Day {day}
          </p>
          <div className="space-y-2 border-l-2 border-indigo-100 pl-3">
            {dayEvents.map((e, i) => (
              <div
                key={`${day}-${i}-${e.unitInstanceId}-${e.metric}`}
                className="rounded border border-gray-100 bg-gray-50/50 px-2.5 py-2"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={severityBadgeTone(e.severity)}>{e.severity}</Badge>
                  <span className="font-mono text-[10px] text-gray-500">
                    {unitNames?.get(e.unitInstanceId) ??
                      `unit ${truncateId(e.unitInstanceId)}`}
                  </span>
                  <span className="font-mono text-[10px] text-gray-400">
                    {e.metric}={Math.round(e.value * 10) / 10}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-gray-700">{e.message}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
