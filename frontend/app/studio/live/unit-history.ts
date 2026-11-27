import type { TwinUnitHistory } from "@/lib/platform-api";

// ---------------------------------------------------------------------------
// The history of one value, as the unit's sheet draws it. No screen here.
//
// The twin writes down a measure when its value changes or is read at a new
// time, and checks every few minutes. So between two readings kept, the twin
// showed the first one: the line is a staircase, each value holding until the
// next reading, and nothing is drawn between two readings that was not read.
//
// A reading with no value breaks the line. A gap is not a zero.
//
// A reading can also have been caught up afterwards, from a copy of the source
// that was kept before the twin started writing this measure down. It is drawn
// like the others, and said apart: the twin did not show it at the time.
// ---------------------------------------------------------------------------

/** What the sheet knows of a value's history. */
export type HistoryState =
  /** The measure is one of the counts every twin has: computed on the spot, not kept. */
  | { state: "not_kept" }
  | { state: "reading" }
  | { state: "failed" }
  | { state: "read"; history: TwinUnitHistory };

/** The drawing box, in the units of the SVG's viewBox. */
export const BOX = { width: 280, height: 56, pad: 3 };

export interface HistoryView {
  /** The staircase, in pieces: one polyline per stretch where the measure had a value. */
  segments: string[];
  /** Lowest and highest value over the window; null when it holds none. */
  low: number | null;
  high: number | null;
  /** Readings with a value in the list. */
  count: number;
  /** What is said under the drawing, in order. */
  lines: string[];
}

const seconds = (fromIso: string, toIso: string): number => Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 1000));

/** How long ago, the way the alert banner says a duration: "40 s", "12 min", "3 h", "17 d". */
function agoLabel(s: number): string {
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** "48 h", "7 d": the window, as its title says it. */
export function windowLabel(hours: number): string {
  return hours % 24 === 0 && hours > 48 ? `${hours / 24} d` : `${hours} h`;
}

/** "5 min", "90 s": how often the twin is read. */
function everyLabel(s: number): string {
  return s % 60 === 0 ? `${s / 60} min` : `${s} s`;
}

/**
 * The drawing and the sentences for one history.
 *
 * `format` writes a value the way the sheet writes the value above the drawing,
 * so the lowest and the highest read like it.
 */
export function historyView(h: TwinUnitHistory, format: (value: number) => string): HistoryView {
  const end = Date.parse(h.at);
  const start = end - h.hours * 3_600_000;
  const valued = h.readings.filter((r): r is typeof r & { value: number } => r.value !== null);
  const low = valued.length ? Math.min(...valued.map((r) => r.value)) : null;
  const high = valued.length ? Math.max(...valued.map((r) => r.value)) : null;

  const lines: string[] = [];
  if (h.readings.length === 0) {
    lines.push(
      h.since === null
        ? `No reading of this value has been kept yet. The twin writes its measures down every ${everyLabel(h.everySeconds)}: the history starts with the first one.`
        : `No reading of this value was kept in the last ${windowLabel(h.hours)}.`,
    );
  } else if (valued.length === 0) {
    lines.push(`This measure had no value here over the last ${windowLabel(h.hours)}.`);
  } else if (valued.length === 1) {
    lines.push(`One reading so far: ${format(valued[0]!.value)}.`);
  } else {
    lines.push(`${valued.length} readings · lowest ${format(low!)} · highest ${format(high!)}`);
  }
  if (h.cut) lines.push("The window holds more readings than are drawn: the oldest are left out.");
  const caughtUp = h.readings.filter((r) => r.replayed).length;
  if (caughtUp > 0) {
    lines.push(
      caughtUp === h.readings.length
        ? "These readings were caught up afterwards from kept copies of the source: the twin did not show them at the time."
        : `${caughtUp} of these ${h.readings.length} readings ${caughtUp === 1 ? "was" : "were"} caught up afterwards from kept copies of the source: the twin did not show ${caughtUp === 1 ? "it" : "them"} at the time.`,
    );
  }
  if (h.since !== null) {
    lines.push(
      h.sinceCaughtUp
        ? `The oldest reading comes from a copy of the source kept ${agoLabel(seconds(h.since, h.at))}, caught up afterwards. Nothing earlier is known.`
        : `The first reading of this value was kept ${agoLabel(seconds(h.since, h.at))}. Nothing earlier is known.`,
    );
  }
  if (valued.length > 1) {
    lines.push(`Each value holds until the next reading. The twin is read every ${everyLabel(h.everySeconds)}.`);
  }

  // The staircase. A single value is a flat line, not a point: it holds until now.
  const span = high !== null && low !== null && high > low ? high - low : 1;
  const x = (ms: number) => BOX.pad + ((Math.min(end, Math.max(start, ms)) - start) / (end - start)) * (BOX.width - 2 * BOX.pad);
  const y = (v: number) => (high === low ? BOX.height / 2 : BOX.pad + (1 - (v - low!) / span) * (BOX.height - 2 * BOX.pad));
  const at = (r: { observedAt: string | null; recordedAt: string }) => Date.parse(r.observedAt ?? r.recordedAt);
  const p = (px: number, py: number) => `${px.toFixed(1)},${py.toFixed(1)}`;

  const segments: string[] = [];
  let points: string[] = [];
  let lastX = BOX.pad;
  let lastY: number | null = null;
  const close = (untilX: number) => {
    if (lastY !== null) points.push(p(untilX, lastY));
    if (points.length > 1) segments.push(points.join(" "));
    points = [];
    lastY = null;
  };
  for (const r of h.readings) {
    // A source can date a reading before the one kept just before it: the line never goes back.
    const here = Math.max(lastX, x(at(r)));
    if (r.value === null) {
      close(here);
    } else {
      const level = y(r.value);
      if (lastY !== null) points.push(p(here, lastY));
      points.push(p(here, level));
      lastY = level;
    }
    lastX = here;
  }
  close(BOX.width - BOX.pad);

  return { segments, low, high, count: valued.length, lines };
}
