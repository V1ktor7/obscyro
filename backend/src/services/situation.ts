import { alertNow, lastChecked, unitNow, type LiveReading, type LiveSignal } from "./live-reading.js";

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
  /** Decisions recorded against this kind of signal. None can be, yet: the note says why. */
  decisions: { items: never[]; note: string };
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
    decisions: {
      items: [],
      note:
        "No decision can be listed here yet: a decision is recorded from a tested option of a scenario, and nothing attaches it to a kind of signal. " +
        "Recorded decisions are in the Scenarios page, Analyst panel, Decisions tab.",
    },
    question: preparedQuestion(unit?.name ?? null, listed !== null),
    checked: lastChecked(live),
    alertRules: live.rules,
    limits: [
      "This is the reading now. The twin keeps no history: nothing here says what a figure was earlier, or what changed since this morning.",
      "An age is the age of the unit's reading as a whole, the oldest of its sources when it has several.",
      "The twin holds no staff and no stocks: a figure here is capacity and what uses it, not who can open a bed.",
    ],
  };
}
