import type { Decision } from "./decisions.js";
import { alertNow, lastChecked, unitNow, type LiveReading, type LiveSignal } from "./live-reading.js";
import type { ResponseOnCard } from "./prepared-responses.js";

/**
 * The situation card: what a person needs in front of them when an alert or a
 * signal asks for their attention.
 *
 * It opens from an alert, a signal or a unit, in one click, and it is whole
 * without the language model: the unit's live figures with their age, the
 * alert, where the signal stands in its workflow, and a question already
 * written for the analyst. What the analyst writes comes after, on the
 * person's click; if it is slow or switched off, nothing here is missing.
 *
 * Every figure on the card is one the analyst would be handed for the same
 * unit: both come from `unitNow` and `alertNow` (`live-reading.ts`), which read
 * what the unit page and the alert banner read. The card and the analyst
 * cannot give two numbers for one ward.
 *
 * Nothing is decided here and nothing is written. Aggregates only: a unit and
 * its measures, never a person.
 */

export interface SituationAsk {
  unitId: string | null;
  alertId: string | null;
  signalId: string | null;
}

/** A decision already taken on a signal of this kind: what was engaged the last times this happened. */
export interface DecisionOnCard {
  id: string;
  label: string;
  decidedBy: string | null;
  decidedAt: string;
  /** The signal it was taken on, and whether that is the one on this card. */
  signalTitle: string | null;
  onThisSignal: boolean;
  /** What was expected of it: patient-days of waiting in its test, with it and without. */
  waitingWith: number;
  waitingWithout: number;
}

export function decisionOnCard(d: Decision, signalId: string): DecisionOnCard {
  return {
    id: d.id,
    label: d.optionLabel,
    decidedBy: d.decidedBy,
    decidedAt: d.decidedAt,
    signalTitle: d.signal?.title ?? null,
    onThisSignal: d.signal?.id === signalId,
    waitingWith: d.expected.withOption.waitingDays,
    waitingWithout: d.expected.asItIs.waitingDays,
  };
}

/** What was prepared and decided for the kind of signal a card is about. Read by the route, since it is not part of the live reading. */
export interface PreparedForKind {
  responses: ResponseOnCard[];
  decisions: DecisionOnCard[];
}

/** A stage of the signal's workflow, in order. */
export interface PathStage {
  name: string;
  current: boolean;
  needsApproval: boolean;
}

export interface SituationCard {
  /** The server's clock when this was read: ages are counted from it. */
  at: string;
  /** The unit's live figures, exactly as `unit_now` gives them to the analyst. Null when the card names no unit. */
  unit: ReturnType<typeof unitNow> | null;
  /**
   * The alert the card was opened from. `open` with its reading, or `not_open`
   * when it is no longer among the open alerts: it cleared, or the link is old.
   */
  alert: { state: "open"; reading: ReturnType<typeof alertNow> } | { state: "not_open" } | null;
  signal: (LiveSignal & { path: PathStage[] }) | null;
  /**
   * The responses prepared for this kind of signal, in the order they were
   * kept, never ranked. Null when the card names no signal: a response is
   * prepared for a kind of signal, and there is none to tell the kind.
   */
  responses: ResponseOnCard[] | null;
  /** Whether a response can be engaged now, and why not when it cannot. */
  engage: { possible: boolean; why: string | null };
  /** Decisions already taken on signals of this kind, most recent first. */
  decisions: { items: DecisionOnCard[]; note: string };
  /** A question for the analyst, written by the program from what the card shows. */
  question: string;
  checked: ReturnType<typeof lastChecked>;
  alertRules: number;
  /** What this card cannot say, said on it. */
  limits: string[];
}

/** The question a person would most likely ask next, in the words of what is on the card. */
export function preparedQuestion(unitName: string | null, alertOpen: boolean): string {
  if (!unitName) return "What is open right now, and where?";
  return alertOpen
    ? `What is open at ${unitName} right now, how old are its figures, and what else is open around it?`
    : `What do the live figures of ${unitName} show right now, and how old are they?`;
}

/** Whether a prepared response can be engaged on this signal now. Said on the card, so the button never refuses in silence. */
export function engageNow(signal: LiveSignal | null): { possible: boolean; why: string | null } {
  if (!signal) return { possible: false, why: "This card names no signal: a response is engaged on a signal." };
  if (signal.closedAt) return { possible: false, why: "This signal is closed. Reopen it before engaging a response." };
  if (signal.stageNo >= signal.stages) return { possible: false, why: "This signal is already at the last stage of its workflow." };
  return { possible: true, why: null };
}

/**
 * The card, from one live reading.
 *
 * `signal` and `stages` are read by the route, because a signal a person opens
 * may be one whose alert has cleared: it is then in no feed, and still theirs
 * to look at.
 */
export function situationOf(
  live: LiveReading,
  ask: SituationAsk,
  signal: LiveSignal | null = null,
  stages: { name: string; requiresApproval: boolean }[] = [],
  prepared: PreparedForKind | null = null,
): SituationCard {
  const alertId = ask.alertId ?? signal?.alertId ?? null;
  const listed = alertId ? (live.feed.alerts.find((a) => a.id === alertId) ?? null) : null;
  const unitId = ask.unitId ?? signal?.unitId ?? listed?.unitId ?? null;
  const unit = unitId ? (live.units.find((u) => u.id === unitId) ?? null) : null;

  return {
    at: live.at,
    unit: unit ? unitNow(live, unit) : null,
    alert: alertId ? (listed ? { state: "open", reading: alertNow(listed, live) } : { state: "not_open" }) : null,
    signal: signal
      ? {
          ...signal,
          path: stages.map((s, i) => ({ name: s.name, current: i + 1 === signal.stageNo, needsApproval: s.requiresApproval })),
        }
      : null,
    responses: signal ? (prepared?.responses ?? []) : null,
    engage: engageNow(signal),
    decisions: {
      items: signal ? (prepared?.decisions ?? []) : [],
      note: !signal
        ? "This card names no signal, so there is no kind of signal to list decisions for."
        : (prepared?.decisions.length ?? 0) > 0
          ? "Taken on signals of this kind by engaging a prepared response. Each is in the Decisions tab with what was expected of it."
          : "No decision has been taken on a signal of this kind yet. One is recorded when a prepared response is engaged.",
    },
    question: preparedQuestion(unit?.name ?? null, listed !== null),
    checked: lastChecked(live),
    alertRules: live.rules,
    limits: [
      "This is the reading now. The twin keeps the readings of each measure over time, and the unit's page shows them; this card does not, so nothing here says what a figure was earlier, or what changed since this morning.",
      "An alert's age and a measure's age are the age of what that measure reads. The unit's own age is the oldest of all its sources, so it can be older than the age of one of its values.",
      "The twin holds no staff and no stocks: a figure here is capacity and what uses it, not who can open a bed.",
    ],
  };
}
