/**
 * Where a bar sits, and what a drag means.
 *
 * Split out from the component because this is the part that can be wrong
 * silently. A bar drawn two pixels off is a cosmetic complaint; a drag that
 * writes step 7 when the pointer was over step 8 corrupts the event and shows
 * nothing — the composer's sentence would faithfully describe the wrong number.
 */

import type { ProfileShape, TemporalProfile } from "@/lib/platform-api";

export interface Track {
  /** 0..1 of the track width. */
  left: number;
  width: number;
}

/**
 * An open-ended effect runs to the horizon and is drawn as such.
 *
 * Returning the horizon rather than the last step is deliberate: an effect that
 * starts at 58 of 60 must still be a visible sliver, and clamping it to a
 * zero-width bar would hide the thing most likely to be a mistake.
 */
export function effectiveEnd(profile: TemporalProfile, horizon: number): number {
  return profile.end === null ? horizon : profile.end;
}

export function trackOf(profile: TemporalProfile, horizon: number): Track {
  const span = Math.max(1, horizon);
  const start = clampStep(profile.start, horizon);
  const end = clampStep(effectiveEnd(profile, horizon), horizon);
  const left = start / span;
  // A pulse has no duration but must remain grabbable, so it is drawn one step
  // wide. Anything narrower cannot be hit with a pointer.
  const width = Math.max(1 / span, (Math.max(end, start) - start) / span);
  return { left, width: Math.min(width, 1 - left) };
}

export function clampStep(step: number, horizon: number): number {
  if (!Number.isFinite(step)) return 0;
  return Math.max(0, Math.min(Math.round(step), horizon));
}

/** The step under a pointer, given its offset within the track. */
export function stepAt(offsetX: number, trackWidth: number, horizon: number): number {
  if (trackWidth <= 0) return 0;
  return clampStep((offsetX / trackWidth) * horizon, horizon);
}

export type DragEdge = "start" | "end" | "body";

/**
 * The profile a drag produces. Pure, so the rule is testable without a DOM.
 *
 * `body` moves both bounds and preserves duration; the edges move one bound
 * each. An edge dragged past its opposite is clamped rather than swapped:
 * swapping would silently turn "shorten this" into "invert this", and the user
 * would have to notice a reversed window to catch it.
 */
export function applyDrag(
  profile: TemporalProfile,
  edge: DragEdge,
  step: number,
  horizon: number,
): TemporalProfile {
  const target = clampStep(step, horizon);
  const end = effectiveEnd(profile, horizon);

  if (edge === "start") {
    return { ...profile, start: Math.min(target, end) };
  }
  if (edge === "end") {
    const next = Math.max(target, profile.start);
    // An open-ended effect stays open-ended until its end is dragged inside
    // the horizon; dragging it to the far edge should not silently pin it.
    if (profile.end === null && next >= horizon) return profile;
    return { ...profile, end: next };
  }

  const duration = end - profile.start;
  const start = clampStep(Math.min(target, horizon - duration), horizon);
  return {
    ...profile,
    start,
    end: profile.end === null ? null : start + duration,
  };
}

/**
 * The intensity curve across the bar, as points in 0..1 space.
 *
 * Drawn inside the bar so a ramp is distinguishable from a step at a glance —
 * two events with identical windows and different shapes are otherwise
 * identical rectangles, and the shape is half of what an effect does.
 */
export function shapePoints(
  shape: ProfileShape,
  peak: number,
  samples = 24,
): Array<{ x: number; y: number }> {
  const height = Math.max(0, Math.min(1, peak));
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= samples; i += 1) {
    const x = i / samples;
    let y: number;
    if (shape === "step") y = height;
    else if (shape === "ramp") y = height * x;
    else if (shape === "pulse") y = i === 0 ? height : 0;
    else {
      // Matches the engine: a gaussian centred in the window, width = span/6.
      const width = 1 / 6;
      y = height * Math.exp(-((x - 0.5) ** 2) / (2 * width ** 2));
    }
    out.push({ x, y });
  }
  return out;
}

/** Steps where two effects on the same target are both active. */
export function overlapWindow(
  a: TemporalProfile,
  b: TemporalProfile,
  horizon: number,
): { from: number; to: number } | null {
  const from = Math.max(a.start, b.start);
  const to = Math.min(effectiveEnd(a, horizon), effectiveEnd(b, horizon));
  return to >= from ? { from, to } : null;
}
