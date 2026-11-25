import type { AnalystStep, Comparison, Doubt, Investigated } from "../analyst-api";

// ---------------------------------------------------------------------------
// An investigation, as the network page words it. No screen here.
//
// The server sets each event beside the series and returns what it found as
// facts: an episode, a number of days, two means, the reasons to doubt. This
// file turns those facts into the sentences a person reads. It never adds a
// figure, and it never says more than the fact: an event "goes with" an
// episode, it does not cause one.
// ---------------------------------------------------------------------------

/** The spans a series can be investigated over, shared with the timeline. */
export const SPANS: { hours: number; label: string }[] = [
  { hours: 24, label: "24 h" },
  { hours: 72, label: "72 h" },
  { hours: 24 * 7, label: "7 d" },
  { hours: 24 * 30, label: "30 d" },
];

/** "30 d", "72 h": a span, as its button says it. */
export function spanLabel(hours: number): string {
  return SPANS.find((s) => s.hours === hours)?.label ?? (hours % 24 === 0 && hours > 72 ? `${hours / 24} d` : `${hours} h`);
}

/** The span that ends now. */
export function spanFrom(hours: number, now: Date): { from: string; to: string } {
  return { from: new Date(now.getTime() - hours * 3_600_000).toISOString(), to: now.toISOString() };
}

/** The date an instant falls on, on a named clock: `2026-11-22`. */
export function dayOn(iso: string, zone: string | null | undefined): string {
  try {
    // en-CA writes a date as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", { timeZone: zone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

/**
 * The sentence proposed for a span.
 *
 * It names the unit and the dates and nothing the twin measured. The person
 * reads it, changes it if they wish, and sends it: it is the only thing that
 * goes into a web search.
 */
export function proposedRequest(unitName: string, fromDay: string, toDay: string): string {
  const period = fromDay === toDay ? `on ${fromDay}` : `between ${fromDay} and ${toDay}`;
  return `What public health measures, closures, weather warnings, outbreaks or major incidents were reported in or around ${unitName} ${period}?`;
}

// --- where the work stands ----------------------------------------------------

export type StageState = "done" | "now" | "todo" | "failed";

export interface Stage {
  key: "series" | "calendar" | "neighbours" | "search" | "passages" | "compare" | "check";
  label: string;
  state: StageState;
}

const STAGES: { key: Stage["key"]; label: string; tool: string; over?: string[] }[] = [
  { key: "series", label: "Series", tool: "twin_series" },
  { key: "calendar", label: "Calendar", tool: "calendar_events" },
  { key: "neighbours", label: "Neighbours", tool: "nearest_units" },
  // A search or a passage is over when something that comes after it has been written.
  { key: "search", label: "Searches", tool: "web_search", over: ["web_passage", "events_beside_series"] },
  { key: "passages", label: "Passages", tool: "web_passage", over: ["events_beside_series"] },
  { key: "compare", label: "Beside the series", tool: "events_beside_series" },
  { key: "check", label: "Check", tool: "search_check" },
];

/**
 * The seven pieces of work of an investigation, and where it stands in them.
 *
 * Read from the steps that have arrived: nothing is animated that did not
 * happen. `ended` is true once the last line of the stream came in.
 */
export function stagesOf(steps: readonly Pick<AnalystStep, "tool" | "ok">[], ended: boolean): Stage[] {
  const has = (tool: string) => steps.some((s) => s.tool === tool);
  const failed = (tool: string) => steps.some((s) => s.tool === tool && !s.ok);
  let reachedNow = false;
  return STAGES.map((stage) => {
    if (failed(stage.tool)) return { key: stage.key, label: stage.label, state: "failed" };
    const complete = has(stage.tool) && (ended || !stage.over || stage.over.some(has));
    if (complete) return { key: stage.key, label: stage.label, state: "done" };
    if (ended || reachedNow) return { key: stage.key, label: stage.label, state: "todo" };
    reachedNow = true;
    return { key: stage.key, label: stage.label, state: "now" };
  });
}

// --- an event beside the series -------------------------------------------------

const days = (n: number): string => `${n} day${n === 1 ? "" : "s"}`;
/** "e2" is "episode 2". */
export const episodeNumber = (id: string): string => id.replace(/^e/, "");

/** How an event sits beside the series: one of four readings, so a row can be coloured by it. */
export type Pairing = "before" | "inside" | "none" | "unplaced";

export function pairingOf(c: Pick<Comparison, "episode" | "leadDays" | "doubts">): Pairing {
  if (c.doubts.some((d) => d.kind === "no_date" || d.kind === "outside_span")) return "unplaced";
  if (c.episode === null || c.leadDays === null) return "none";
  return c.leadDays >= 0 ? "before" : "inside";
}

/**
 * The one sentence under an event's title.
 *
 * "Goes with" is all it claims: the event and the episode are close in time.
 */
export function verdictOf(c: Comparison, inv: Pick<Investigated, "line" | "episodes">): string {
  if (c.doubts.some((d) => d.kind === "no_date")) return "No date: it cannot be placed on the series.";
  const outside = c.doubts.find((d): d is Extract<Doubt, { kind: "outside_span" }> => d.kind === "outside_span");
  if (outside) return outside.side === "before" ? "Starts before the span that was read." : "Starts after the span that was read.";
  if (c.episode !== null && c.leadDays !== null) {
    const n = episodeNumber(c.episode);
    if (c.leadDays > 0) return `Goes with episode ${n}: it starts ${days(c.leadDays)} before.`;
    if (c.leadDays === 0) return `Goes with episode ${n}: it starts the same day.`;
    return `Falls inside episode ${n}, which had begun ${days(-c.leadDays)} earlier.`;
  }
  if (!inv.line) return "No alert threshold on this measure, so no episode to set it beside.";
  if (inv.episodes.length === 0) return "The series has no episode over this span.";
  return "Goes with no episode.";
}

/** A reason to doubt, in a sentence. `titleOf` names another event by its reference. */
export function doubtText(d: Doubt, titleOf: (ref: string) => string): string {
  switch (d.kind) {
    case "no_date":
      return "The passage states no day. Enter the date from the source: until then it cannot be set beside the series.";
    case "outside_span":
      return d.side === "before"
        ? "It starts before the span that was read: what the series did when it began is not in it."
        : "It starts after the span that was read.";
    case "nothing_before":
      return "No reading was kept for the days before it, so no change can be measured.";
    case "nothing_after":
      return "No reading was kept for the days from its start, so no change can be measured.";
    case "starts_after":
      return `The episode had begun ${days(d.days)} before this event: the event cannot have started it.`;
    case "shared": {
      const n = d.with.length;
      return `${n} other event${n === 1 ? " goes" : "s go"} with the same episode (${d.with.map(titleOf).join("; ")}). The series cannot tell them apart.`;
    }
  }
}

/** The measured part of a comparison: the two means and what separates them. Null when the event is not placed. */
export function measuredLines(c: Pick<Comparison, "before" | "after" | "delta">, format: (value: number) => string, signed: (delta: number) => string): string[] | null {
  if (!c.before || !c.after) return null;
  const side = (label: string, a: { mean: number | null; days: number }) =>
    a.mean === null ? `${label}: no reading kept` : `${label}: ${format(a.mean)} on average, over ${days(a.days)}`;
  const lines = [side("The 3 days before", c.before), side("The 3 days from its start", c.after)];
  if (c.delta !== null) lines.push(`Change: ${signed(c.delta)}`);
  return lines;
}

/** A change, with its sign and its unit: "+8.2 points", "−3". */
export function signedChange(delta: number, unit: string): string {
  const size = Math.abs(delta);
  const text = unit === "percent" ? `${size.toFixed(1)} point${size.toFixed(1) === "1.0" ? "" : "s"}` : unit === "count" ? String(Math.round(size)) : size.toFixed(1);
  if (size < 0.05) return "none";
  return `${delta > 0 ? "+" : "−"}${text}`;
}
