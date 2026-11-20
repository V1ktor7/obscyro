"use client";

/**
 * The "Context" lane of the timeline: what was happening around the network
 * on the days the scenario runs over.
 *
 * It shows the events a person validated from official sources, placed by
 * their dates from the calendar date of day 0. They are drawn as outlines, not
 * as the filled blocks of the other lanes, because they are not stamps: the
 * engine never receives them and they change no result. They are there to be
 * read beside the curve.
 *
 * Rendered as two cells of the timeline's grid (label, lane), then a third
 * row for the event that is open.
 */

import { X } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/cn";

import { DOOR_LABEL, isWebLink, type HealthEvent } from "../../analyst-api";
import { EvidenceBadge, WebChip } from "./analyst-parts";
import { placeEvents } from "./context-lane";

const LINE = 24;

export default function ContextLane({
  events,
  origin,
  horizon,
  day,
  onRemove,
}: {
  /** Every validated event of the project. */
  events: HealthEvent[];
  /** The calendar date of day 0, when the scenario sets one. */
  origin: string | null;
  horizon: number;
  /** The day the timeline is on. */
  day: number;
  /** Takes an event out of the calendar, on a person's click. */
  onRemove: (id: string) => Promise<void>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const { placed, rows, outside } = origin ? placeEvents(events, origin, horizon) : { placed: [], rows: 0, outside: 0 };
  const open = placed.find((p) => p.event.id === openId)?.event ?? null;

  function show(id: string | null) {
    setOpenId(id);
    setConfirming(false);
    setProblem(null);
  }

  async function remove(id: string) {
    setRemoving(true);
    setProblem(null);
    try {
      await onRemove(id);
      show(null);
    } catch {
      setProblem("The event could not be removed. Check the connection and try again.");
    } finally {
      setRemoving(false);
    }
  }

  const empty = !origin
    ? events.length
      ? `Day 0 has no calendar date, so the ${events.length} validated event${events.length === 1 ? "" : "s"} cannot be placed. Set one under Result, Reality check.`
      : "No validated event yet. Find some under Analyst, Event finder."
    : placed.length === 0
      ? events.length
        ? `None of the ${events.length} validated event${events.length === 1 ? "" : "s"} falls on these days.`
        : "No validated event yet. Find some under Analyst, Event finder."
      : null;

  return (
    <>
      <span
        title="Events a person validated from official sources. Context only: they are not part of the run and change no result."
        className="text-[10.5px] font-bold uppercase tracking-wide text-brand-deep"
      >
        Context
      </span>
      <div className="relative rounded bg-canvas" style={{ height: Math.max(1, rows) * LINE + 4 }}>
        {empty ? <span className="absolute inset-0 flex items-center truncate px-2 text-[11px] text-ink-muted">{empty}</span> : null}
        {placed.map((p) => (
          <button
            key={p.event.id}
            type="button"
            aria-pressed={p.event.id === openId}
            onClick={() => show(p.event.id === openId ? null : p.event.id)}
            title={`${p.event.title} · ${p.event.startsOn}${p.event.endsOn ? ` to ${p.event.endsOn}` : ""} · published, not part of the run`}
            className={cn(
              "absolute min-w-[10px] overflow-hidden text-ellipsis whitespace-nowrap border border-brand-deep bg-surface px-1.5 text-left text-[11px] font-semibold text-brand-deep hover:bg-brand-soft",
              p.startsBefore ? "rounded-r border-l-0" : p.endsAfter ? "rounded-l border-r-0" : "rounded",
              p.event.id === openId && "bg-brand-soft ring-2 ring-ink",
            )}
            style={{
              left: `${(p.start / horizon) * 100}%`,
              width: `${Math.max((p.days / horizon) * 100, 1.5)}%`,
              top: 2 + p.row * LINE,
              height: LINE - 4,
            }}
          >
            {p.event.title}
          </button>
        ))}
        <div className="pointer-events-none absolute -bottom-1 -top-1 w-0.5 bg-ink" style={{ left: `${((day + 0.5) / horizon) * 100}%` }} />
      </div>

      {outside > 0 && origin ? (
        <>
          <span />
          <span className="text-[10.5px] text-ink-faint">
            {outside} more validated event{outside === 1 ? "" : "s"} outside these days.
          </span>
        </>
      ) : null}

      {open ? (
        <>
          <span />
          <div aria-label={`Event: ${open.title}`} className="flex flex-col gap-1 rounded border border-line-soft bg-surface p-2 text-[11.5px] text-ink-body">
            <div className="flex flex-wrap items-center gap-1.5">
              <span title={DOOR_LABEL[open.door].title} className="rounded bg-canvas px-1 py-px text-[9.5px] font-bold uppercase tracking-wide">
                {DOOR_LABEL[open.door].label}
              </span>
              <EvidenceBadge evidence="published" />
              <WebChip url={open.sourceUrl} title={open.sourceTitle ?? undefined} />
              <button type="button" onClick={() => show(null)} aria-label="Close" className="ml-auto rounded p-0.5 text-ink-muted hover:bg-surface-hover">
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
            <p className="text-[12.5px] font-semibold text-ink">{open.title}</p>
            <p>
              {open.startsOn}
              {open.endsOn && open.endsOn !== open.startsOn ? ` to ${open.endsOn}` : ""} · {open.place}
            </p>
            <p className="italic">
              “{open.passage}”
              <span className="not-italic text-ink-muted">
                {" — "}
                {isWebLink(open.sourceUrl) ? (
                  <a href={open.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-ink-body">
                    {open.sourceTitle || open.sourceUrl}
                  </a>
                ) : (
                  open.sourceTitle || open.sourceUrl
                )}
              </span>
            </p>
            <p className="text-[11px] text-ink-muted">
              Accepted by {open.validatedBy ?? "an account since removed"} on {open.validatedAt.slice(0, 10)}
              {open.proposedByAnalyst ? ", from a candidate the analyst proposed" : ""}. Published by its source; not measured by the twin, and not
              part of the run.
            </p>
            {problem ? <p role="alert" className="text-danger-ink">{problem}</p> : null}
            <div className="flex flex-wrap items-center gap-1.5">
              {confirming ? (
                <>
                  <span className="text-ink-muted">Remove it from the calendar? The analyst will no longer see it.</span>
                  <button type="button" disabled={removing} onClick={() => void remove(open.id)} className="rounded border border-danger-ink bg-surface px-2 py-0.5 text-[11px] font-semibold text-danger-ink hover:bg-danger-soft disabled:opacity-60">
                    Yes, remove
                  </button>
                  <button type="button" disabled={removing} onClick={() => setConfirming(false)} className="rounded border border-line bg-surface px-2 py-0.5 text-[11px] hover:bg-surface-hover disabled:opacity-60">
                    Keep
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirming(true)} className="rounded border border-line bg-surface px-2 py-0.5 text-[11px] hover:bg-surface-hover">
                  Remove from the calendar
                </button>
              )}
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
