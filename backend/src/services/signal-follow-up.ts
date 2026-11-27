import type { DbClient } from "../lib/db.js";
import { whole, wholePct } from "./analyst-tools.js";
import type { Decision } from "./decisions.js";
import { duration, shown, type LiveMeasure } from "./live-reading.js";
import type { MetricUnit } from "./twin-metrics.js";
import type { KeptReading, ReadingsBetween } from "./twin-history.js";

/**
 * A signal, followed: what was decided on it, and what was measured after.
 *
 * A decision taken on an alert has to be readable later with what happened
 * next, in the same place: on the signal. Three things are set together here,
 * and kept apart:
 *
 *   measured   the measure that raised the signal, at its unit, as the twin
 *              wrote it down (`twin-history.ts`): when the signal was raised,
 *              when the decision was taken, and since;
 *   recorded   when the decision was taken, and how long after the signal;
 *   expected   what the run that tested the response gave, in the engine's
 *              own terms.
 *
 * No gap is computed between what the run expected and what the twin
 * measured. The run counts people waiting and an occupancy that stops at
 * 100 % of capacity; the twin measures what its organisation defined, which
 * can read 143 %. Subtracting one from the other would give a number that
 * means nothing. Each side gives its own change, and the screen says they are
 * not the same quantity.
 *
 * It reports and stops. Whether the decision held is not something two series
 * can say, and it is not the tool's to say.
 *
 * Nothing here is about a person: a unit, a measure, an aggregate value.
 */

/** What the signal itself and its alert say, read in one row. */
export interface SignalFacts {
  /** The measure the alert was raised on; null for a signal no alert raised. */
  metric: string | null;
  /** The value the alert had when it became a signal. */
  raisedValue: number | null;
  closedReason: string | null;
  /** The alert the signal came from; null when there is none, or it is no longer on file. */
  alert: { status: "open" | "ack" | "resolved"; resolvedAt: string | null } | null;
}

export async function signalFacts(db: DbClient, projectId: string, signalId: string): Promise<SignalFacts | null> {
  const { rows } = await db.query<{
    metric: string | null;
    value: string | null;
    closed_reason: string | null;
    alert_status: "open" | "ack" | "resolved" | null;
    resolved_at: Date | null;
  }>(
    `SELECT s.properties ->> 'metric' AS metric, s.properties ->> 'value' AS value, s.closed_reason,
            a.status AS alert_status, a.resolved_at
       FROM app.signal s
       LEFT JOIN app.twin_alert a ON s.origin_kind = 'twin_alert' AND a.id = s.origin_id
      WHERE s.id = $1 AND s.project_id = $2`,
    [signalId, projectId],
  );
  const r = rows[0];
  if (!r) return null;
  const value = r.value === null ? Number.NaN : Number(r.value);
  return {
    metric: r.metric && r.metric.trim() ? r.metric : null,
    raisedValue: Number.isFinite(value) ? value : null,
    closedReason: r.closed_reason,
    alert: r.alert_status ? { status: r.alert_status, resolvedAt: r.resolved_at ? r.resolved_at.toISOString() : null } : null,
  };
}

export interface FollowUpExpected {
  /** Which run this is: the test the response was kept from, or the one made again when the signal opened. */
  run: "kept_test" | "retest";
  /** When that run was made; null for a kept test whose date the decision does not carry. */
  testedAt: string | null;
  horizon: number;
  activity: string;
  /** Patient-days waiting over the whole network and the whole run, without the response and with it. */
  waiting: { without: number; with: number; change: number };
  /**
   * The signal's own unit in that run, when it is one of its sites. From the
   * kept test only: a retest keeps the network's figures, not each site's.
   */
  site: { name: string; peakOccupancyPct: { without: number; with: number }; waiting: { without: number; with: number } } | null;
  says: string[];
}

export type SignalFollowUp =
  | { followed: false; why: string }
  | {
      followed: true;
      measure: { key: string; label: string; countedIn: MetricUnit };
      /** The signal: when it was raised, and the value its alert had then. */
      raised: { at: string; value: number | null };
      /** The first decision taken on this signal; null when none was. */
      decision: { id: string; label: string; by: string | null; at: string; delaySeconds: number; delay: string; others: number } | null;
      measured: {
        /** What the figures below are counted from: the decision when there is one, else the signal. */
        from: "decision" | "raised";
        fromAt: string;
        /** Until the signal closed, or until now. */
        untilAt: string;
        closed: boolean;
        /** Readings written down over that stretch. */
        readings: number;
        /** The value in force when the stretch began; null when none had been written down by then. */
        atStart: number | null;
        latest: number | null;
        lowest: number | null;
        highest: number | null;
        /** Latest minus the value at the start, in the measure's own unit; null when either is missing. */
        change: number | null;
        says: string[];
      };
      alert: { state: "holds" | "acknowledged" | "cleared" | "unknown"; clearedAt: string | null; says: string };
      expected: FollowUpExpected | null;
      /** Why no figure sets the run against the twin. Null when there is no decision, so nothing expected. */
      gap: string | null;
      closedAs: string | null;
      limits: string[];
    };

const valued = (rs: readonly KeptReading[]) => rs.filter((r): r is KeptReading & { value: number } => r.value !== null);

function print(value: number | null, unit: MetricUnit): string {
  const v = shown(value, unit);
  if (v === null) return "no value";
  if (unit === "percent") return `${v}%`;
  if (unit === "ratio") return v.toFixed(2);
  if (unit === "count") return String(v);
  return v.toFixed(1);
}

/** A difference in the measure's own unit, with its sign: "−22 points", "+3", "no change". */
function printChange(change: number, unit: MetricUnit): string {
  const v = shown(Math.abs(change), unit) ?? 0;
  if (v === 0) return "no change";
  const sign = change < 0 ? "−" : "+";
  if (unit === "percent") return `${sign}${v} point${v === 1 ? "" : "s"}`;
  if (unit === "ratio") return `${sign}${v.toFixed(2)}`;
  if (unit === "count") return `${sign}${v}`;
  return `${sign}${v.toFixed(1)}`;
}

function expectedOf(d: Decision, unitId: string | null): FollowUpExpected {
  const e = d.expected;
  const retest = e.retested ?? null;
  const without = whole((retest ?? e).asItIs.waitingDays);
  const withIt = whole((retest ?? e).withOption.waitingDays);
  const s = unitId ? (e.sites.find((x) => x.id === unitId) ?? null) : null;
  const site = s
    ? {
        name: s.name,
        peakOccupancyPct: { without: wholePct(s.asItIs.peakOccupancy), with: wholePct(s.withOption.peakOccupancy) },
        waiting: { without: whole(s.asItIs.waitingDays), with: whole(s.withOption.waitingDays) },
      }
    : null;
  const says = [
    retest
      ? `What is given is the run made again on the network as it was when the signal opened, on ${retest.testedAt.slice(0, 10)}${retest.current ? "" : "; the card no longer called it a test of the current state when the response was engaged"}.`
      : "What is given is the test the response was kept from, made in calm time: no test on the network as it was when the signal opened had given figures.",
    `Over ${e.horizon} days, for ${e.activity}, across the whole network: ${without.toLocaleString("en-US")} patient-days waiting without the response, ${withIt.toLocaleString("en-US")} with it.`,
  ];
  if (site) {
    says.push(
      `At ${site.name}, in the test the response was kept from: occupancy peaks at ${site.peakOccupancyPct.without}% without it and ${site.peakOccupancyPct.with}% with it, ` +
        `and ${site.waiting.without.toLocaleString("en-US")} patient-days are spent waiting without it, ${site.waiting.with.toLocaleString("en-US")} with it. The engine's occupancy stops at 100%: what exceeds capacity is counted as waiting.`,
    );
  } else if (unitId) {
    says.push("This unit is not one of the sites that run reports on, so the run gives no figure for it.");
  }
  return {
    run: retest ? "retest" : "kept_test",
    testedAt: retest?.testedAt ?? null,
    horizon: e.horizon,
    activity: e.activity,
    waiting: { without, with: withIt, change: withIt - without },
    site,
    says,
  };
}

/**
 * The follow-up of a signal, from what was read.
 *
 * `decisions` are the ones taken on this signal, oldest first. `kept` is what
 * the twin wrote down for the signal's measure at its unit from the moment the
 * signal was raised; null when there is nothing to read it for.
 */
export function signalFollowUp(input: {
  now: Date;
  signal: { detectedAt: string; closedAt: string | null; unitId: string | null };
  facts: SignalFacts;
  measure: LiveMeasure | null;
  decisions: readonly Decision[];
  kept: ReadingsBetween | null;
}): SignalFollowUp {
  const { now, signal, facts, measure, decisions, kept } = input;
  if (!facts.metric || !signal.unitId) {
    return { followed: false, why: "This signal was not raised by an alert on a unit, so there is no measure to follow after it." };
  }
  if (!measure || !kept) {
    return {
      followed: false,
      why: `This signal was raised on “${facts.metric}”, which is not one of the measures the twin writes down over time: only the measures the organisation defined are kept.`,
    };
  }

  const unit = measure.unit;
  const first = decisions[0] ?? null;
  const fromAt = first ? first.decidedAt : signal.detectedAt;
  const untilAt = signal.closedAt ?? now.toISOString();
  const fromMs = Date.parse(fromAt);
  // What the twin showed when the stretch began: the last reading written down by then.
  const all = [...(kept.opening ? [kept.opening] : []), ...kept.readings];
  const before = all.filter((r) => Date.parse(r.recordedAt) <= fromMs);
  const atStart = before.length ? before[before.length - 1]!.value : null;
  const during = kept.readings.filter((r) => Date.parse(r.recordedAt) > fromMs);
  const values = valued(during).map((r) => r.value);
  const lastKnown = during.length ? during[during.length - 1]!.value : atStart;
  const lowest = values.length ? Math.min(...values) : null;
  const highest = values.length ? Math.max(...values) : null;
  const change = atStart !== null && lastKnown !== null && during.length > 0 ? lastKnown - atStart : null;

  const what = first ? "the decision" : "the signal was raised";
  const whenStart = first ? "when the decision was taken" : "when the signal was raised";
  const until = signal.closedAt ? "the signal closed" : "now";
  const says: string[] = [];
  says.push(
    atStart === null
      ? `No reading of ${measure.label} had been written down ${whenStart}: the twin's history of this value starts later.`
      : `${measure.label} was ${print(atStart, unit)} ${whenStart}.`,
  );
  if (during.length === 0) {
    says.push(`No new reading was written down between then and ${until}. That is not the same as no change: nothing new was read.`);
  } else {
    says.push(
      `Since then, until ${until}: ${during.length} reading${during.length === 1 ? "" : "s"}` +
        (lowest !== null && highest !== null ? `, lowest ${print(lowest, unit)}, highest ${print(highest, unit)}` : "") +
        `; the last one ${lastKnown === null ? "says the measure has no value" : `is ${print(lastKnown, unit)}`}.`,
    );
    if (change !== null) says.push(`Measured change over that stretch: ${printChange(change, unit)}.`);
  }
  if (kept.cut) says.push("More readings were written down than are counted here: the oldest of the stretch are left out.");
  // A reading caught up afterwards from a kept copy (D12) was not on anybody's screen at the time.
  const caughtUp = during.filter((r) => r.replayed).length;
  if (caughtUp > 0) {
    says.push(
      `${caughtUp} of ${during.length === 1 ? "this reading" : `these ${during.length} readings`} ${caughtUp === 1 ? "was" : "were"} caught up afterwards from kept copies of the source: the twin did not show ${caughtUp === 1 ? "it" : "them"} at the time.`,
    );
  }

  const state = facts.alert ? ({ open: "holds", ack: "acknowledged", resolved: "cleared" } as const)[facts.alert.status] : "unknown";
  const clearedAt = facts.alert?.status === "resolved" ? facts.alert.resolvedAt : null;
  const alertSays =
    state === "holds"
      ? "The alert still holds: the condition still fires."
      : state === "acknowledged"
        ? "The alert was acknowledged, and the condition still fires."
        : state === "cleared"
          ? clearedAt
            ? Date.parse(clearedAt) >= fromMs
              ? `The alert cleared ${duration(Date.parse(clearedAt) - fromMs)} after ${what}: the condition stopped firing.`
              : first
                ? "The alert had already cleared when the decision was taken."
                : "The alert has cleared: the condition stopped firing."
            : "The alert has cleared: the condition stopped firing."
          : "The alert this signal came from is no longer on file.";

  const limits: string[] = [];
  if (kept.since === null) {
    limits.push("Nothing was ever written down for this measure at this unit, so nothing measured can be set beside the decision.");
  } else if (Date.parse(kept.since) > Date.parse(signal.detectedAt)) {
    limits.push(`The twin started writing this measure down on ${kept.since.slice(0, 10)}, after this signal was raised: nothing earlier is known.`);
  }
  limits.push("A change measured after a decision is not an effect of the decision: other things changed too, and this does not tell them apart.");

  const delaySeconds = first ? Math.max(0, Math.round((Date.parse(first.decidedAt) - Date.parse(signal.detectedAt)) / 1000)) : 0;

  return {
    followed: true,
    measure: { key: measure.key, label: measure.label, countedIn: unit },
    raised: { at: signal.detectedAt, value: shown(facts.raisedValue, unit) },
    decision: first
      ? {
          id: first.id,
          label: first.optionLabel,
          by: first.decidedBy,
          at: first.decidedAt,
          delaySeconds,
          delay: duration(delaySeconds * 1000),
          others: decisions.length - 1,
        }
      : null,
    measured: {
      from: first ? "decision" : "raised",
      fromAt,
      untilAt,
      closed: signal.closedAt !== null,
      readings: during.length,
      atStart: shown(atStart, unit),
      latest: shown(lastKnown, unit),
      lowest: shown(lowest, unit),
      highest: shown(highest, unit),
      change: change === null ? null : shown(change, unit),
      says,
    },
    alert: { state, clearedAt, says: alertSays },
    expected: first ? expectedOf(first, signal.unitId) : null,
    gap: first
      ? `No figure sets one against the other. The run counts people waiting and an occupancy that stops at 100% of capacity; the twin measures ${measure.label} at this unit. They are two different quantities, shown side by side. Whether the decision held is yours to judge.`
      : null,
    closedAs: signal.closedAt ? facts.closedReason : null,
    limits,
  };
}
