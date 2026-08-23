/**
 * Asking "what if we had acted here" without pausing anything.
 *
 * The engine is deterministic and a rule that is not yet eligible does nothing,
 * so "stop at day 42, act, carry on" and "re-run from zero with a response that
 * starts at day 42" are the same trajectory. That is why there is no checkpoint
 * in the engine and no session on the server: the shared prefix is identical by
 * construction. `test_a_response_that_starts_late_leaves_the_past_untouched`
 * pins it on the engine side, and `divergenceProblem` below checks it again on
 * the data that actually came back, because an invariant nobody re-checks is a
 * belief.
 *
 * A branch stores the delta and nothing else — the step, the response, the
 * parent — the way a Foundry scenario stores only the edits. And it is frozen
 * once made: changing a branch makes a new one. Editing one in place would let
 * two lines on the same chart come from assumptions that no longer match, which
 * is the failure the comparison exists to avoid.
 */

export interface Branch {
  readonly id: string;
  readonly label: string;
  /** The step the reader was on when they asked. */
  readonly fromStep: number;
  /** A stored response, or null for "carry on doing nothing". */
  readonly policyId: string | null;
  /** The branch this one grew from, or null for the trunk. */
  readonly parentId: string | null;
}

export interface RuleLike {
  trigger?: { when?: string; start?: number; end?: number | null };
  [k: string]: unknown;
}

/**
 * The same rules, made to start where the reader is looking.
 *
 * A stored response carries its own timing, written when nobody knew which day
 * would matter. Run unchanged from a scrubbed step it would apply from its own
 * start — and the two trajectories would already differ before the point they
 * were supposed to branch at, which makes the comparison a different question
 * from the one asked.
 *
 * A rule that already starts later than the branch keeps its own start: the
 * author said "not before day 60" and the reader asking at day 42 has not
 * contradicted that.
 */
export function rulesFromStep(rules: readonly RuleLike[], fromStep: number): RuleLike[] {
  return rules.map((rule) => {
    const t = rule.trigger ?? {};
    const start = Math.max(fromStep, Number(t.start ?? 0));
    const end = t.end === null || t.end === undefined ? null : Number(t.end);
    // A window that now ends before it starts would silently never fire. Kept
    // open instead, which is the reading closest to what was written.
    const keptEnd = end !== null && end < start ? null : end;
    return {
      ...rule,
      trigger: {
        ...t,
        when: t.when === "between" && keptEnd !== null ? "between" : "from_tick",
        start,
        end: t.when === "between" && keptEnd !== null ? keptEnd : null,
      },
    };
  });
}

/**
 * The same rules at a different strength.
 *
 * Only `modify_demand` carries one, and it is the field a reader has to be able
 * to move: fitted against Montréal's own wave, the December package sits
 * somewhere between 0.95 and 0.97 a day, and lifting it three weeks later
 * produced no rebound at all. A number that cannot be pinned down is one you
 * run at several values, not one you print to four decimals.
 *
 * Everything else is left alone. A transfer rule has no strength — it moves the
 * number of patients it says it moves — and scaling it would be inventing a
 * dimension the action does not have.
 */
export function withDemandFactor(rules: readonly RuleLike[], factor: number): RuleLike[] {
  return rules.map((rule) => {
    const action = rule.action as { kind?: string } | undefined;
    if (!action || action.kind !== "modify_demand") return rule;
    return { ...rule, action: { ...action, factor } };
  });
}

/** The strength a response is stored at, or null when it carries none. */
export function demandFactorOf(rules: readonly RuleLike[]): number | null {
  for (const rule of rules) {
    const action = rule.action as { kind?: string; factor?: unknown } | undefined;
    if (action?.kind === "modify_demand" && typeof action.factor === "number") {
      return action.factor;
    }
  }
  return null;
}

export interface StepPoint {
  step: number;
  waiting: number;
  full: number;
}

/**
 * Why these two runs cannot be compared, or null when they can.
 *
 * The prefix has to match. If it does not, either the engine stopped being
 * deterministic or the branch reached backwards — and a chart drawn from two
 * runs that disagree about the past is worse than no chart, because the
 * divergence it shows is not the one the reader asked about.
 *
 * Compared on the two figures the chart is drawn from rather than on the whole
 * trajectory: those are what a reader would act on, and a difference anywhere
 * else that leaves both of them identical is not one this screen can mislead
 * anybody about.
 */
export function divergenceProblem(
  parent: readonly StepPoint[],
  branch: readonly StepPoint[],
  fromStep: number,
): string | null {
  if (parent.length === 0 || branch.length === 0) return null;
  if (parent.length !== branch.length) {
    return `The two runs are ${parent.length} and ${branch.length} steps long, so they cannot be laid over each other.`;
  }
  for (let i = 0; i < Math.min(fromStep, parent.length); i++) {
    const a = parent[i]!;
    const b = branch[i]!;
    if (Math.abs(a.waiting - b.waiting) > 1e-6 || a.full !== b.full) {
      return `The branch changed step ${i}, before the step it was taken at. The two runs no longer share a past, so the difference on screen is not the one you asked about.`;
    }
  }
  return null;
}

/** Where the two runs actually part, or null when they never do. */
export function divergesAt(
  parent: readonly StepPoint[],
  branch: readonly StepPoint[],
): number | null {
  const n = Math.min(parent.length, branch.length);
  for (let i = 0; i < n; i++) {
    const a = parent[i]!;
    const b = branch[i]!;
    if (Math.abs(a.waiting - b.waiting) > 1e-6 || a.full !== b.full) return i;
  }
  return null;
}
