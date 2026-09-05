/**
 * The arithmetic behind a hand-drawn chart.
 *
 * There is no charting library in this project, so the scales are written here
 * — and a scale is where a chart lies without ever failing. Three of these
 * decisions are the difference between a figure somebody can act on and one
 * that quietly misleads:
 *
 * 1. A bar's baseline is always zero. Bar length is read as a ratio: 40 next to
 *    20 must look twice as long. Cropping the axis to make small differences
 *    visible is the oldest misleading chart there is, and a ministry reading
 *    this would be right to stop trusting the rest of the screen.
 * 2. A line may start above zero, because a curve is read by its shape and
 *    forcing zero flattens a real movement into a straight line. But the axis
 *    then has to say so, which is why `zeroBased` is returned rather than
 *    assumed.
 * 3. A flat series has no range. Dividing by it yields NaN, and NaN in path
 *    data makes an SVG element vanish with no error anywhere — a blank card
 *    that reads as "no data" when the truth is "every value is 227".
 */

export interface Point {
  label: string;
  value: number;
}

export interface Scale {
  min: number;
  max: number;
  /** Where a value sits, 0 at the bottom of the plot and 1 at the top. */
  norm: (v: number) => number;
  zeroBased: boolean;
}

/**
 * The vertical scale for a set of values.
 *
 * `zeroBased` forces the floor to zero — always for bars, never silently for
 * lines.
 */
export function scaleFor(values: readonly number[], zeroBased: boolean): Scale {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) {
    return { min: 0, max: 1, norm: () => 0, zeroBased };
  }

  let lo = Math.min(...finite);
  let hi = Math.max(...finite);

  if (zeroBased) {
    // Negative values still need to be visible, so the floor is the lower of
    // zero and the smallest value rather than zero flat.
    lo = Math.min(0, lo);
    hi = Math.max(0, hi);
  }

  if (lo === hi) {
    // A flat series. Without this the range is zero and every normalised value
    // is NaN, which removes the path from the document without an error.
    if (lo === 0) {
      hi = 1;
    } else {
      const pad = Math.abs(lo) * 0.1;
      lo -= pad;
      hi += pad;
    }
  }

  const range = hi - lo;
  return {
    min: lo,
    max: hi,
    norm: (v) => (Number.isFinite(v) ? (v - lo) / range : 0),
    zeroBased,
  };
}

/**
 * Axis labels at round numbers.
 *
 * Ticks at 0, 4713.4, 9426.8 are arithmetically correct and unreadable. This
 * steps up through 1, 2, 5, 10, 20, 50 … so a reader gets 0, 5000, 10000.
 */
export function niceTicks(scale: Scale, count = 4): number[] {
  const range = scale.max - scale.min;
  if (!Number.isFinite(range) || range <= 0) return [scale.min];

  const rough = range / Math.max(1, count);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalized = rough / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;

  const out: number[] = [];
  const first = Math.ceil(scale.min / step) * step;
  for (let t = first; t <= scale.max + step * 1e-9; t += step) {
    // Floating point leaves 0.30000000000000004 on the axis otherwise.
    out.push(Number(t.toPrecision(12)));
  }
  return out.length ? out : [scale.min];
}

export interface PlotBox {
  width: number;
  height: number;
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
}

/** Screen coordinates for a series, left to right in the order given. */
export function linePoints(
  points: readonly Point[],
  scale: Scale,
  box: PlotBox,
): { x: number; y: number; point: Point }[] {
  const w = box.width - box.padLeft - box.padRight;
  const h = box.height - box.padTop - box.padBottom;
  const n = points.length;
  return points.map((p, i) => ({
    // A single point sits in the middle rather than dividing by zero and
    // landing at NaN, which would delete it from the document.
    x: box.padLeft + (n === 1 ? w / 2 : (i / (n - 1)) * w),
    y: box.padTop + h - scale.norm(p.value) * h,
    point: p,
  }));
}

/** An SVG path for a series. Empty string when there is nothing to draw. */
export function linePath(coords: readonly { x: number; y: number }[]): string {
  if (coords.length === 0) return "";
  return coords
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(2)},${c.y.toFixed(2)}`)
    .join(" ");
}

export interface Bar {
  x: number;
  y: number;
  width: number;
  height: number;
  point: Point;
}

/** Rectangles for a bar chart, always measured from the zero line. */
export function barLayout(points: readonly Point[], scale: Scale, box: PlotBox): Bar[] {
  const w = box.width - box.padLeft - box.padRight;
  const h = box.height - box.padTop - box.padBottom;
  const n = points.length;
  if (n === 0) return [];

  const slot = w / n;
  const barWidth = Math.max(1, slot * 0.7);
  const zeroY = box.padTop + h - scale.norm(0) * h;

  return points.map((p, i) => {
    const valueY = box.padTop + h - scale.norm(p.value) * h;
    return {
      x: box.padLeft + i * slot + (slot - barWidth) / 2,
      y: Math.min(zeroY, valueY),
      width: barWidth,
      // A value of exactly zero would otherwise be an invisible rectangle,
      // indistinguishable from a hospital that reported nothing at all.
      height: Math.max(1, Math.abs(zeroY - valueY)),
      point: p,
    };
  });
}

/**
 * A number as a reader wants it.
 *
 * Thin spaces as thousands separators, which is the convention in French, and
 * at most one decimal — a mean of 33.66666666666667 civières is precision the
 * source never had.
 */
export function formatValue(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const rounded = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  return rounded.toLocaleString("fr-CA", { maximumFractionDigits: 1 });
}

/**
 * An axis label short enough to sit under a bar.
 *
 * Truncation is at the end and marked, so nobody reads a cut label as the whole
 * name of a hospital.
 */
export function shortLabel(s: string, max = 14): string {
  const t = String(s ?? "").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/**
 * How many ticks a line can carry without them overlapping.
 *
 * Ninety dates on one axis is a grey smear. Every nth is kept, first and last
 * always among them, so the reader can still see the window the curve covers.
 */
export function thinLabels(count: number, room: number): number[] {
  if (count <= 0) return [];
  if (count <= room) return Array.from({ length: count }, (_, i) => i);
  const step = Math.ceil(count / room);
  const keep = new Set<number>();
  for (let i = 0; i < count; i += step) keep.add(i);
  keep.add(count - 1);
  return Array.from(keep).sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Two series on one axis

/**
 * The x-axis two partly-overlapping series share.
 *
 * A forecast and an observation are not the same length and rarely start on the
 * same day. Drawing each on its own index would put day 1 of the prediction
 * above day 1 of reality regardless of the dates, which is the one thing a
 * comparison card must not do. Labels are sorted, so dates line up as dates.
 */
export function sharedAxis(...series: readonly (readonly Point[])[]): string[] {
  const all = new Set<string>();
  for (const s of series) for (const p of s) all.add(p.label);
  return Array.from(all).sort();
}

export interface Coord {
  x: number;
  y: number;
  point: Point;
}

/**
 * A series placed on a shared axis, with a hole where it has no value.
 *
 * The holes matter: a prediction that stops on the 14th and an observation that
 * starts on the 15th must not be joined by a line implying a reading between
 * them.
 */
export function alignTo(
  labels: readonly string[],
  points: readonly Point[],
  scale: Scale,
  box: PlotBox,
): (Coord | null)[] {
  const at = new Map(points.map((p) => [p.label, p]));
  const w = box.width - box.padLeft - box.padRight;
  const h = box.height - box.padTop - box.padBottom;
  const n = labels.length;
  return labels.map((label, i) => {
    const p = at.get(label);
    if (!p) return null;
    return {
      x: box.padLeft + (n === 1 ? w / 2 : (i / (n - 1)) * w),
      y: box.padTop + h - scale.norm(p.value) * h,
      point: p,
    };
  });
}

/** An SVG path that lifts the pen over every hole rather than drawing across it. */
export function pathWithGaps(coords: readonly (Coord | null)[]): string {
  const parts: string[] = [];
  let pen = false;
  for (const c of coords) {
    if (!c) {
      pen = false;
      continue;
    }
    parts.push(`${pen ? "L" : "M"}${c.x.toFixed(2)},${c.y.toFixed(2)}`);
    pen = true;
  }
  return parts.join(" ");
}

/**
 * A closed area between two edges of the same axis.
 *
 * Used for a simulation's p5–p95 band. Both edges are required: an area drawn
 * from one edge to the axis is a filled curve, not an interval, and reads as a
 * quantity rather than as uncertainty.
 */
export function bandPath(
  low: readonly (Coord | null)[],
  high: readonly (Coord | null)[],
): string {
  const pairs: { lo: Coord; hi: Coord }[] = [];
  for (let i = 0; i < low.length; i++) {
    const lo = low[i];
    const hi = high[i];
    if (lo && hi) pairs.push({ lo, hi });
  }
  if (pairs.length < 2) return "";
  const top = pairs.map((p, i) => `${i === 0 ? "M" : "L"}${p.hi.x.toFixed(2)},${p.hi.y.toFixed(2)}`);
  const bottom = [...pairs]
    .reverse()
    .map((p) => `L${p.lo.x.toFixed(2)},${p.lo.y.toFixed(2)}`);
  return `${top.join(" ")} ${bottom.join(" ")} Z`;
}

/**
 * Where a site's value sits between the quietest and the busiest, 0 to 1.
 *
 * Returns null for a site nothing was read for, so the caller draws it as
 * unread rather than as the bottom of the scale — which is the difference
 * between "no reading" and "empty hospital".
 */
export function siteRamp(values: readonly (number | null)[]): (v: number | null) => number | null {
  const finite = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (finite.length === 0) return () => null;
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  if (lo === hi) {
    // Every site reads the same. Putting them all at the top of a colour ramp
    // would paint a uniform network as a network in crisis.
    return (v) => (v == null ? null : 0.5);
  }
  return (v) => (v == null ? null : (v - lo) / (hi - lo));
}
