"use client";

/**
 * The timeline under the network map.
 *
 * Two lanes it always had: when alerts opened, and when feeds delivered. A
 * third appears when a site that counts one unit is selected: the series of
 * the measure the map paints, over the same window, as the twin kept it.
 *
 * When an investigation of that unit is on screen, the lane also carries what
 * it found: the episodes it counted, as bands under the series, and the events,
 * as marks at the day a source dates them. A dashed mark is a candidate, a
 * solid one is already in the calendar. That an event stands before an episode
 * is all the drawing says: the two are close in time.
 *
 * Folded to its counts on arrival, like every panel on the map.
 */

import { ChevronDown } from "lucide-react";
import { useMemo } from "react";

import { cn } from "@/lib/cn";
import type { TwinAlert, TwinUnitHistory } from "@/lib/platform-api";

import type { Investigated } from "../analyst-api";
import { OVERLAY_BAR } from "../map-overlay";
import { formatMetricValue } from "../twin-ui";
import { SPANS, spanLabel, type Pairing } from "./investigation";
import { seriesLane } from "./series-lane";

type Unit = "percent" | "ratio" | "count" | "number" | "hours";

/** The series of the selected unit, as far as the page has read it. */
export interface TimelineSeries {
  unitName: string;
  label: string;
  unit: Unit;
  /** The alert threshold on this measure, when a rule sets one. */
  threshold: number | null;
  state: "reading" | "read" | "failed";
  history: TwinUnitHistory | null;
}

const W = 900;
const LEFT = 70;
const RIGHT = W - 10;
const BOX = { x0: LEFT, x1: RIGHT, y0: 66, y1: 116 };
const EVENTS_Y = 132;
const MARK: Record<Pairing, string> = { before: "stroke-brand fill-brand", inside: "stroke-warn fill-warn", none: "stroke-ink-ghost fill-ink-ghost", unplaced: "stroke-ink-ghost fill-ink-ghost" };

export default function NetworkTimeline({
  alerts,
  feedEvents,
  windowHours,
  onWindow,
  open,
  onOpen,
  series,
  investigation,
  className,
}: {
  alerts: TwinAlert[];
  feedEvents: { id: string; receivedAt: string }[];
  windowHours: number;
  onWindow: (h: number) => void;
  open: boolean;
  onOpen: (open: boolean) => void;
  /** Null when no site is selected, the site counts several units, or the measure is not kept over time. */
  series: TimelineSeries | null;
  /** The investigation on screen, when it is of the unit and the measure drawn. */
  investigation: Investigated | null;
  className?: string;
}) {
  const now = Date.now();
  const start = now - windowHours * 3_600_000;
  const x = (iso: string) => {
    const t = new Date(iso).getTime();
    return LEFT + (RIGHT - LEFT) * Math.max(0, Math.min(1, (t - start) / (now - start)));
  };

  const alertEvents = alerts.filter((a) => a.createdAt && new Date(a.createdAt).getTime() >= start).slice(0, 60);
  const feeds = feedEvents.filter((e) => new Date(e.receivedAt).getTime() >= start);

  const readings = series?.history?.readings;
  const lane = useMemo(
    () =>
      readings
        ? seriesLane({
            readings,
            start,
            end: now,
            box: BOX,
            threshold: series?.threshold ?? null,
            episodes: investigation?.episodes ?? [],
            events: investigation?.compared ?? [],
          })
        : null,
    // The window moves with the clock; redrawn when what is drawn changes, not every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [readings, windowHours, series?.threshold, investigation],
  );
  const format = (v: number) => formatMetricValue(v, series?.unit ?? "number");
  const height = series ? 150 : 64;

  return (
    <div className={cn(OVERLAY_BAR, "px-3 py-1.5", className)}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => onOpen(!open)}
          className="flex items-center gap-1 text-[11px] font-semibold text-ink hover:text-brand"
        >
          Event timeline
          <ChevronDown className={cn("h-3.5 w-3.5 text-ink-faint transition-transform", open && "rotate-180")} aria-hidden="true" />
        </button>
        {SPANS.map(({ hours: h, label }) => (
          <button
            key={h}
            type="button"
            aria-pressed={windowHours === h}
            onClick={() => onWindow(h)}
            className={cn("rounded px-2 py-0.5 text-[10.5px]", windowHours === h ? "bg-brand-soft font-medium text-brand-deep" : "border border-line text-ink-faint")}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto truncate text-[10.5px] text-ink-faint">
          {series ? `${series.unitName} · ${series.label} · ` : ""}
          {alertEvents.length} alerts · {feeds.length} feed events in window
          {investigation ? ` · ${investigation.compared.length} event${investigation.compared.length === 1 ? "" : "s"} of the investigation` : ""}
        </span>
      </div>
      {open ? (
        <>
          <svg
            viewBox={`0 0 ${W} ${height}`}
            className="mt-1 w-full"
            role="img"
            aria-label={
              series
                ? `Timeline: alerts, feed events, and ${series.label} at ${series.unitName} over the last ${spanLabel(windowHours)}`
                : "Timeline lanes for alerts and feed events"
            }
          >
            <line x1={LEFT} y1={18} x2={RIGHT} y2={18} stroke="#333333" strokeWidth="1" />
            <line x1={LEFT} y1={46} x2={RIGHT} y2={46} stroke="#333333" strokeWidth="1" />
            <text x={4} y={21} fontSize="9" fill="#a8a8a8">
              ALERTS
            </text>
            <text x={4} y={49} fontSize="9" fill="#a8a8a8">
              FEEDS
            </text>
            {alertEvents.map((a) => (
              <circle
                key={a.id}
                cx={x(a.createdAt!)}
                cy={18}
                r={a.severity === "critical" ? 5 : 4}
                fill={a.severity === "critical" ? "#fa4d56" : a.severity === "warn" ? "#f1c21b" : "#4589ff"}
                opacity="0.85"
              >
                <title>{a.message}</title>
              </circle>
            ))}
            {feeds.map((e) => (
              <rect key={e.id} x={x(e.receivedAt) - 1} y={41} width={2} height={10} fill="#4589ff" opacity="0.6">
                <title>ingest event · {new Date(e.receivedAt).toLocaleString()}</title>
              </rect>
            ))}

            {series ? (
              <>
                <text x={4} y={(BOX.y0 + BOX.y1) / 2 + 3} fontSize="9" className="fill-ink-faint">
                  SERIES
                </text>
                <text x={4} y={EVENTS_Y + 3} fontSize="9" className="fill-ink-faint">
                  EVENTS
                </text>
                <rect x={BOX.x0} y={BOX.y0 - 4} width={BOX.x1 - BOX.x0} height={BOX.y1 - BOX.y0 + 8} className="fill-canvas" opacity="0.5" />
                <line x1={LEFT} y1={EVENTS_Y} x2={RIGHT} y2={EVENTS_Y} className="stroke-line-soft" strokeWidth="1" />
                {lane?.bands.map((b) => (
                  <rect key={b.id} x={b.x} y={BOX.y0 - 4} width={b.width} height={BOX.y1 - BOX.y0 + 8} className="fill-danger" opacity="0.14">
                    <title>Episode {b.id.replace(/^e/, "")}: the measure beyond its alert threshold</title>
                  </rect>
                ))}
                {lane?.thresholdY != null ? (
                  <line x1={LEFT} y1={lane.thresholdY} x2={RIGHT} y2={lane.thresholdY} className="stroke-danger" strokeWidth="1" strokeDasharray="3 3" opacity="0.7">
                    <title>Alert threshold: {format(series.threshold!)}</title>
                  </line>
                ) : null}
                {lane?.segments.map((points, i) => (
                  <polyline key={i} points={points} fill="none" className="stroke-ink-body" strokeWidth="1.4" strokeLinejoin="round" />
                ))}
                {lane?.marks.map((m) => (
                  <g key={m.ref} className={MARK[m.pairing]}>
                    <line x1={m.x} y1={BOX.y0 - 4} x2={m.x} y2={EVENTS_Y} strokeWidth="1" strokeDasharray={m.from === "candidate" ? "2 3" : undefined} fill="none" />
                    {m.from === "candidate" ? (
                      <rect x={m.x - 3.5} y={EVENTS_Y - 3.5} width={7} height={7} transform={`rotate(45 ${m.x} ${EVENTS_Y})`} strokeWidth="0" />
                    ) : (
                      <circle cx={m.x} cy={EVENTS_Y} r={4} strokeWidth="0" />
                    )}
                    <title>
                      {m.title} · {m.day} · {m.from === "candidate" ? "candidate" : "in the calendar"}
                    </title>
                  </g>
                ))}
              </>
            ) : null}

            <text x={LEFT} y={height - 2} fontSize="8.5" fill="#a8a8a8">
              −{spanLabel(windowHours)}
            </text>
            <text x={RIGHT} y={height - 2} textAnchor="end" fontSize="8.5" fill="#a8a8a8">
              now
            </text>
          </svg>

          {series ? (
            <p className="mt-0.5 text-[10.5px] leading-snug text-ink-faint">
              {series.state === "reading"
                ? "Reading the series the twin kept…"
                : series.state === "failed"
                  ? "The series could not be read."
                  : lane && lane.low !== null && lane.high !== null
                    ? `${series.label} at ${series.unitName}: lowest ${format(lane.low)}, highest ${format(lane.high)} over the last ${spanLabel(windowHours)}. Each value holds until the next reading.`
                    : series.history?.since
                      ? `No reading of ${series.label} was kept at ${series.unitName} over the last ${spanLabel(windowHours)}.`
                      : `No reading of ${series.label} has been kept at ${series.unitName} yet.`}
              {series.state === "read" && lane && series.threshold !== null && lane.thresholdY === null && lane.low !== null
                ? ` The alert threshold (${format(series.threshold)}) is far from what was read, and is not drawn.`
                : ""}
              {investigation
                ? ` Bands are the episodes the investigation counted. A dashed mark is a candidate, a solid one is in the calendar, each at the day its source dates it: close in time, and nothing more.${
                    lane && lane.marksOutside > 0 ? ` ${lane.marksOutside} dated event${lane.marksOutside === 1 ? " falls" : "s fall"} outside this window.` : ""
                  }`
                : ""}
            </p>
          ) : (
            <p className="mt-0.5 text-[10.5px] text-ink-faint">Select a site that counts one unit to see its series here.</p>
          )}
        </>
      ) : null}
    </div>
  );
}
