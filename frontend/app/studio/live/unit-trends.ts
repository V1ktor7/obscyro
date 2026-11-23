import type {
  TwinDailyMean,
  TwinMeasureChange,
  TwinMetric,
  TwinMetricUnit,
  TwinUnitMetrics,
  TwinUnitTrends,
  TwinValueAge,
} from "@/lib/platform-api";

import { formatHours, formatMetricValue, formatReadingAge } from "../twin-ui";

// ---------------------------------------------------------------------------
// What a sheet says beside a value: how far it moved since the reading before,
// what it has been on average, why it is not there, and where it comes from.
//
// No screen here, and no arithmetic on readings: the change and the mean are
// counted by the server, on readings it kept. This only puts them in words, so
// the unit page and the map's inspector say the same thing in the same way.
//
// A change is never coloured. Twelve more people waiting is worse and twelve
// more stretchers is better: the sign means "more", and nothing else.
// ---------------------------------------------------------------------------

/** A change in words, and the reading it is counted from. */
export interface ChangeView {
  /** "▲ 6", "▼ 3 pts", "no change", "first reading kept", "no value before". */
  text: string;
  /** The hour of the reading compared with ("16:45", "21 Nov 23:45"); null when there is none. */
  since: string | null;
  /** The whole sentence, for a title or a screen reader. */
  says: string;
}

/** A delta the way its measure is written: people, points, hours and minutes. */
export function formatDelta(delta: number, unit: TwinMetricUnit | undefined): string {
  const size = Math.abs(delta);
  if (unit === "hours") return formatHours(size);
  if (unit === "percent") return `${Math.round(size)} pts`;
  if (unit === "ratio") return size.toFixed(2);
  if (unit === "count") return String(Math.round(size));
  return size.toFixed(1);
}

/** A delta too small to show at the precision its measure is written with. */
function roundsToNothing(delta: number, unit: TwinMetricUnit | undefined): boolean {
  if (unit === "hours") return Math.round(Math.abs(delta) * 60) === 0;
  if (unit === "percent" || unit === "count") return Math.round(Math.abs(delta)) === 0;
  if (unit === "ratio") return Math.abs(delta) < 0.005;
  return Math.abs(delta) < 0.05;
}

/**
 * An instant on the clock of its source, short: the hour alone when it is the
 * same day as now, the day and the hour otherwise.
 */
export function clockLabel(iso: string, nowIso: string, zone?: string | null): string {
  const at = new Date(iso);
  const part = (d: Date, opts: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat("en-GB", { timeZone: zone || undefined, ...opts }).format(d);
    } catch {
      return new Intl.DateTimeFormat("en-GB", opts).format(d);
    }
  };
  const day = (d: Date) => part(d, { day: "numeric", month: "short", year: "numeric" });
  const hour = part(at, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return day(at) === day(new Date(nowIso)) ? hour : `${part(at, { day: "numeric", month: "short" })} ${hour}`;
}

/**
 * The change of one measure, in words. Null when the server sent nothing for
 * it: the history was not read, or the measure has no value now.
 */
export function changeView(
  change: TwinMeasureChange | undefined | null,
  unit: TwinMetricUnit | undefined,
  nowIso: string,
  age?: TwinValueAge | null,
): ChangeView | null {
  if (!change) return null;
  if (!change.previous) {
    return { text: "first reading kept", since: null, says: "No earlier reading of this value was kept: nothing to compare it with." };
  }
  const since = clockLabel(change.previous.at, nowIso, age?.zone);
  const of = change.previous.atIs === "observed" ? `the reading of ${since}` : `the reading noted at ${since}`;
  if (change.previous.value === null || change.delta === null) {
    return { text: "no value before", since, says: `It had no value at ${of}: no change is counted against an absence.` };
  }
  if (roundsToNothing(change.delta, unit)) return { text: "no change", since, says: `No change since ${of}.` };
  const up = change.delta > 0;
  const size = formatDelta(change.delta, unit);
  return { text: `${up ? "▲" : "▼"} ${size}`, since, says: `${up ? "Up" : "Down"} ${size} since ${of}.` };
}

/** A mean over the days kept, and how many days that is. */
export interface MeanView {
  text: string;
  /** "30-day average", or "average over 12 days kept" while the history is younger than the window. */
  label: string;
}

export function meanView(mean: TwinDailyMean | undefined | null, unit: TwinMetricUnit | undefined): MeanView | null {
  if (!mean) return null;
  const text = formatMetricValue(mean.mean, unit ?? "number");
  if (mean.days >= mean.window) return { text, label: `${mean.window}-day average` };
  return { text, label: mean.days === 1 ? "average over 1 day kept" : `average over ${mean.days} days kept` };
}

/**
 * How a value is dated, in the sheet's words.
 *
 * A figure of the day before is never "read 14m ago": that is the age of the
 * reading that republished it. A duration is an average, and is called one.
 */
export function agePhrase(age: TwinValueAge, unit: TwinMetricUnit | undefined): string {
  if (age.period === "previous_day") {
    const what = unit === "hours" ? "Yesterday's average" : "Yesterday's figure";
    return age.seconds === null ? `${what}. When it was published is unknown.` : `${what}, published ${formatReadingAge(age.seconds, age.basis)}`;
  }
  return age.seconds === null ? "The age of this value is unknown" : `This value was read ${formatReadingAge(age.seconds, age.basis)}`;
}

/** Why a measure that has something to read here shows no value. */
export function withheldPhrase(w: { reason: "several" | "blank"; count: number }): string {
  return w.reason === "several"
    ? `Not shown here: ${w.count} units under this one each publish their own average, and averages are not averaged again.`
    : "Its source published no figure in the latest reading.";
}

/** One line of what a unit reports besides the value shown. */
export interface ReportLine {
  key: string;
  label: string;
  /** The value as written, or null when the measure is withheld. */
  text: string | null;
  about: string[];
  /** A figure of the day before. */
  daily: boolean;
  change: ChangeView | null;
  mean: MeanView | null;
  /** Why there is no value, when there is a reason to give. */
  withheld: string | null;
}

/**
 * Every measure the unit reports, with what was kept of it, in the order the
 * organisation listed them. A measure with no value and no reason to give is
 * left out: nothing it reads is here.
 */
export function reportLines(
  defs: readonly Pick<TwinMetric, "key" | "label" | "unit">[],
  metrics: TwinUnitMetrics | undefined,
  trends: TwinUnitTrends | null | undefined,
  nowIso: string,
): ReportLine[] {
  if (!metrics) return [];
  const out: ReportLine[] = [];
  for (const d of defs) {
    const raw = metrics.values[d.key];
    const value = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    const held = metrics.withheld?.[d.key] ?? null;
    if (value === null && !held) continue;
    const age = metrics.valueAges?.[d.key] ?? null;
    out.push({
      key: d.key,
      label: d.label,
      text: value === null ? null : formatMetricValue(value, d.unit),
      about: metrics.qualifiers?.[d.key] ?? [],
      daily: age?.period === "previous_day",
      change: value === null ? null : changeView(trends?.changes[d.key], d.unit, nowIso, age),
      mean: value === null ? null : meanView(trends?.means[d.key], d.unit),
      withheld: value === null && held ? withheldPhrase(held) : null,
    });
  }
  return out;
}

/**
 * The hour most changes are counted from, so a list can say it once.
 * Null when no line has one.
 */
export function commonSince(lines: readonly { change: ChangeView | null }[]): string | null {
  const count = new Map<string, number>();
  for (const l of lines) if (l.change?.since) count.set(l.change.since, (count.get(l.change.since) ?? 0) + 1);
  let best: string | null = null;
  count.forEach((n, since) => {
    if (best === null || n > count.get(best)!) best = since;
  });
  return best;
}

/**
 * What the organisation wrote about the object types these measures read: a
 * source, its licence, its limits. Nothing here names a source: the text is
 * the type's own description, written by whoever brought the data in.
 */
export function sourceNotes(
  defs: readonly Pick<TwinMetric, "key" | "numerator" | "denominator">[],
  reported: ReadonlySet<string>,
  typeNotes: Record<string, string> | undefined,
): { type: string; text: string }[] {
  if (!typeNotes) return [];
  const types = new Set<string>();
  for (const d of defs) {
    if (!reported.has(d.key)) continue;
    for (const sel of [d.numerator, d.denominator]) if (sel?.ofType) types.add(sel.ofType);
  }
  return Array.from(types)
    .filter((t) => typeNotes[t])
    .map((t) => ({ type: t, text: typeNotes[t]! }));
}
