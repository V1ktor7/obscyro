"use client";

/**
 * Where it breaks: the sites where somebody waits, in each of the two runs.
 *
 * The island figure above this says how full the network gets; this says which
 * door has a queue behind it, from which day, and what the planner's choices
 * did about it. A row is a button: it puts that site's own curve on the
 * timeline.
 */

import { cn } from "@/lib/cn";

import { people, type BreakRow, type SiteBreak, type Summary } from "./results";

const LABEL = "text-[10px] font-semibold uppercase tracking-wide text-ink-faint";

function when(b: SiteBreak): string {
  return b.firstDay === null ? "no queue" : `from day ${b.firstDay}`;
}

export default function BreakList({
  activity,
  rows,
  events,
  full,
  hasChoices,
  focus,
  onFocus,
}: {
  activity: string;
  rows: BreakRow[];
  events: Summary;
  full: Summary;
  hasChoices: boolean;
  focus: number | null;
  onFocus: (index: number | null) => void;
}) {
  const saved = events.waitingDays - full.waitingDays;
  return (
    <div className="flex flex-col gap-2">
      <span className={LABEL}>Where it breaks · people waiting for {activity}</span>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col">
          <span className="text-[11.5px] text-ink-muted">Events only</span>
          <span className="text-[15px] font-bold tabular-nums text-ink-muted">
            {events.sites} of {events.of} sites
          </span>
          <span className="text-[11.5px] tabular-nums text-ink-muted">
            {events.sites ? `${people(events.waitingDays)} patient-days waiting` : "nobody waits"}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[11.5px] font-semibold text-brand-deep">With your choices</span>
          <span className="text-[15px] font-bold tabular-nums text-brand-deep">
            {full.sites} of {full.of} sites
          </span>
          <span className="text-[11.5px] tabular-nums text-ink-muted">
            {full.sites ? `${people(full.waitingDays)} patient-days waiting` : "nobody waits"}
          </span>
        </div>
      </div>
      {events.sites === 0 && full.sites === 0 ? (
        <p className="text-[12.5px] text-ink-body">No site runs out of {activity} in either run: nobody waits.</p>
      ) : (
        <>
          {hasChoices ? (
            <p className="text-[12.5px] text-ink-body">
              {saved > 0.5
                ? `Your choices spare ${people(saved)} patient-days of waiting${
                    events.waitingDays > 0 ? ` (${Math.round((saved / events.waitingDays) * 100)} %)` : ""
                  }.`
                : saved < -0.5
                  ? `Your choices add ${people(-saved)} patient-days of waiting.`
                  : "Your choices do not change how long people wait."}
            </p>
          ) : null}
          <ul className="flex max-h-[260px] flex-col gap-1 overflow-y-auto">
            {rows.map((r) => {
              const on = focus === r.index;
              const relieved = r.events.firstDay !== null && r.full.firstDay === null;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => onFocus(on ? null : r.index)}
                    className={cn(
                      "grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-2 rounded-md border px-2 py-1.5 text-left",
                      on ? "border-brand bg-brand-soft" : "border-line-soft bg-canvas-raised hover:border-line",
                    )}
                  >
                    <span className="truncate text-[12px] font-semibold text-ink" title={r.name}>{r.name}</span>
                    <span className={cn("text-[11.5px] font-semibold tabular-nums", relieved ? "text-ok-ink" : "text-danger-ink")}>
                      {relieved ? "relieved" : when(r.full)}
                    </span>
                    <span className="col-span-2 text-[11px] tabular-nums text-ink-muted">
                      {r.capacity.toLocaleString("en-CA")} {activity} · events only: {when(r.events)}
                      {r.events.firstDay !== null ? `, up to ${people(r.events.peakWaiting)} waiting` : ""}
                      {r.full.firstDay !== null ? ` · yours: up to ${people(r.full.peakWaiting)} waiting (day ${r.full.peakDay})` : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-ink-faint">
            A site breaks when somebody is still waiting for {activity} at the end of a day. Patients go to the sites of
            their own catchment and nobody is transferred, so one site can queue while another has room. Tap a site to see
            its own curve.
          </p>
        </>
      )}
    </div>
  );
}
