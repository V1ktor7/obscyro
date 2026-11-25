import type { Comparison, SeriesEpisode } from "../analyst-api";
import { pairingOf, type Pairing } from "./investigation";

// ---------------------------------------------------------------------------
// The series of one measure on the timeline, as geometry. No screen here.
//
// The timeline of the network page runs from a start to now. On it, the
// selected unit's series is a staircase: each value holds until the next
// reading, and a reading with no value breaks the line. When an investigation
// is on screen, its episodes are bands under the staircase and its events are
// marks on a line below, each at the day a source dates it.
//
// Nothing is drawn that was not read: an episode is one the investigation
// counted, never one guessed here from the staircase.
// ---------------------------------------------------------------------------

/** The rectangle the staircase is drawn in, in the units of the SVG's viewBox. */
export interface LaneBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface LaneMark {
  ref: string;
  title: string;
  day: string;
  x: number;
  from: "candidate" | "calendar";
  pairing: Pairing;
}

export interface SeriesLane {
  /** One polyline per stretch where the measure had a value. */
  segments: string[];
  low: number | null;
  high: number | null;
  /** Where the alert threshold crosses the box; null when there is none, or when it is far outside what was read. */
  thresholdY: number | null;
  bands: { id: string; x: number; width: number }[];
  marks: LaneMark[];
  /** Events of the investigation that fall outside the window drawn. */
  marksOutside: number;
}

/** Midnight of a day on the clock of the person looking, in milliseconds. */
const dayStart = (day: string): number => new Date(`${day}T00:00:00`).getTime();

export function seriesLane(input: {
  /** Oldest first; a reading stands where its source dates it, or where it was written down. */
  readings: readonly { observedAt: string | null; recordedAt: string; value: number | null }[];
  start: number;
  end: number;
  box: LaneBox;
  threshold: number | null;
  episodes: readonly Pick<SeriesEpisode, "id" | "startsAt" | "endsAt">[];
  events: readonly Comparison[];
}): SeriesLane {
  const { start, end, box } = input;
  const x = (ms: number) => box.x0 + ((Math.min(end, Math.max(start, ms)) - start) / Math.max(1, end - start)) * (box.x1 - box.x0);
  const valued = input.readings.flatMap((r) => (r.value === null ? [] : [r.value]));
  const low = valued.length ? Math.min(...valued) : null;
  const high = valued.length ? Math.max(...valued) : null;

  // The threshold shares the scale when it is near what was read. Far outside,
  // it would flatten the series into a line to show a level nothing reached.
  const spread = low !== null && high !== null ? Math.max(high - low, Math.abs(high) * 0.05, 1) : 1;
  const near = input.threshold !== null && low !== null && high !== null && input.threshold >= low - spread && input.threshold <= high + spread;
  const bottom = low === null ? 0 : near ? Math.min(low, input.threshold!) : low;
  const top = high === null ? 1 : near ? Math.max(high, input.threshold!) : high;
  const y = (v: number) => (top === bottom ? (box.y0 + box.y1) / 2 : box.y1 - ((v - bottom) / (top - bottom)) * (box.y1 - box.y0));
  const p = (px: number, py: number) => `${px.toFixed(1)},${py.toFixed(1)}`;

  const segments: string[] = [];
  let points: string[] = [];
  let lastY: number | null = null;
  const close = (untilX: number) => {
    if (lastY !== null) points.push(p(untilX, lastY));
    if (points.length > 1) segments.push(points.join(" "));
    points = [];
    lastY = null;
  };
  for (const r of input.readings) {
    const rx = x(Date.parse(r.observedAt ?? r.recordedAt));
    if (r.value === null) {
      close(rx);
      continue;
    }
    const ry = y(r.value);
    // The step: the value before holds up to this reading, then the line moves.
    if (lastY !== null) points.push(p(rx, lastY));
    points.push(p(rx, ry));
    lastY = ry;
  }
  // The last value holds until now.
  close(box.x1);

  const bands = input.episodes.flatMap((e) => {
    const from = Date.parse(e.startsAt);
    const to = e.endsAt ? Date.parse(e.endsAt) : end;
    if (to < start || from > end) return [];
    const bx = x(from);
    return [{ id: e.id, x: bx, width: Math.max(2, x(to) - bx) }];
  });

  let marksOutside = 0;
  const marks = input.events.flatMap((e): LaneMark[] => {
    if (!e.startsOn) return [];
    const at = dayStart(e.startsOn);
    if (Number.isNaN(at) || at < start || at > end) {
      marksOutside += 1;
      return [];
    }
    return [{ ref: e.ref, title: e.title, day: e.startsOn, x: x(at), from: e.from, pairing: pairingOf(e) }];
  });

  return { segments, low, high, thresholdY: near ? y(input.threshold!) : null, bands, marks, marksOutside };
}
