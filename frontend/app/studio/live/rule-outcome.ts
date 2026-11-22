// ---------------------------------------------------------------------------
// What became of the signals an alert rule raised, in words.
//
// Alert fatigue is how decision support fails: a rule whose signals are mostly
// dismissed teaches people to stop reading. So the share of false positives is
// read where the rule is set, next to its threshold. It is a share of the
// signals that were closed, never of all of them: an open signal has not been
// judged yet.
// ---------------------------------------------------------------------------

/** What the API counts for one rule. */
export interface RuleSignals {
  raised: number;
  open: number;
  closed: number;
  /** Closed by a person as one that should not have fired. */
  falsePositives: number;
  /** Closed in a batch after their alert cleared on its own. */
  clearedOnOwn: number;
}

const n = (x: number) => x.toLocaleString("en-US");
const plural = (x: number, one: string, many: string) => `${n(x)} ${x === 1 ? one : many}`;

/** A share as a percentage a person can read: "0%", "0.4%", "12%". Never rounded to zero when it is not zero. */
export function sharePct(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  const pct = (part / whole) * 100;
  if (pct === 0) return "0%";
  if (pct < 0.1) return "less than 0.1%";
  return pct < 10 ? `${Math.round(pct * 10) / 10}%` : `${Math.round(pct)}%`;
}

/**
 * The sentences shown under a rule. Empty when the API said nothing of its
 * signals: nothing is then claimed about them.
 */
export function ruleOutcomeLines(signals: RuleSignals | undefined | null): string[] {
  if (!signals) return [];
  if (signals.raised === 0) {
    return ["This rule has raised no signal yet. An alert only becomes a signal when a signal type claims its measure."];
  }
  const lines = [`${plural(signals.raised, "signal", "signals")} raised: ${n(signals.open)} open, ${n(signals.closed)} closed.`];
  if (signals.closed === 0) {
    lines.push("None is closed yet, so there is no share of false positives to give.");
    return lines;
  }
  lines.push(
    `${n(signals.falsePositives)} of the ${n(signals.closed)} closed ${signals.falsePositives === 1 ? "was dismissed as a false positive" : "were dismissed as false positives"}: ${sharePct(signals.falsePositives, signals.closed)}.`,
  );
  if (signals.clearedOnOwn > 0) {
    lines.push(`${n(signals.clearedOnOwn)} ${signals.clearedOnOwn === 1 ? "was" : "were"} closed after the alert cleared on its own, with nobody having had to act.`);
  }
  return lines;
}
