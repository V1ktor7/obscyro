/**
 * The options available from here, ranked.
 *
 * Maven's shape: the machine generates the candidates, runs them, and hands the
 * commander an ordered list; the commander decides. What the machine must not
 * do is decide *for* them, and that is the whole difficulty in ranking these —
 * one option avoids more waiting and costs four million, another avoids less
 * and costs seventy thousand, and putting them in one order needs an exchange
 * rate between a dollar and a patient-day that belongs to the institution and
 * not to this file.
 *
 * So nothing here collapses the two into a score. Options are ordered by what
 * they achieve, what each costs sits beside it, and the one objective statement
 * that needs no exchange rate is made explicitly: an option that costs more and
 * achieves less than another is **dominated**, and there is no preference under
 * which it wins. Marking those is ranking without inventing a trade-off.
 */

import type { RuleLike } from "./branch";
import { rulesFromStep, withDemandFactor, demandFactorOf } from "./branch";

export interface StoredResponse {
  id: string;
  name: string;
  rules: RuleLike[];
}

export interface Candidate {
  /** The id the engine will report this row under. */
  id: string;
  label: string;
  responseId: string;
  fromStep: number;
  strength: number | null;
  rules: RuleLike[];
}

/**
 * A fitted strength, at half and at twice the effect it was fitted at.
 *
 * The alternative was a fixed spread — plus or minus two points, say — and that
 * is a number this file would have invented and then ranked as though somebody
 * had measured it. What is defensible is arithmetic on the number the author
 * *did* declare: a factor of 0.96 is a four-point reduction, so half of it is
 * 0.98 and twice is 0.92. The reader asked "what if compliance were only half
 * what we assumed", and that question has an answer that needs no new constant.
 *
 * Floored at zero: a lever cannot remove more demand than there is.
 */
export function halfAndDouble(stored: number): number[] {
  const effect = stored - 1;
  return [1 + effect / 2, Math.max(0, 1 + effect * 2)];
}

/**
 * Every response, made to start where the reader is, plus the range on any
 * whose strength is a guess.
 *
 * The question a commander asks is "given where I am, what can I do" — so the
 * step is fixed and the options vary. Whether acting sooner would have helped
 * is a different question, and it already has an answer: branch at a different
 * step.
 *
 * A response whose strength was fitted rather than measured is generated at the
 * ends of its range as well as its middle. Ranking a number that cannot be
 * pinned down as though it could is how a list of options becomes a list of
 * false precision.
 */
export function candidatesFrom(
  responses: readonly StoredResponse[],
  fromStep: number,
  spread?: (stored: number) => readonly number[],
): Candidate[] {
  const out: Candidate[] = [];
  for (const r of responses) {
    const stored = demandFactorOf(r.rules);
    // Per response and not once for the batch: two responses fitted at
    // different strengths do not share a range, and running one of them at the
    // other's numbers would rank a lever nobody proposed.
    const around = stored !== null && spread ? spread(stored) : [];
    const strengths: Array<number | null> =
      stored !== null && around.length ? [stored, ...around.filter((s) => s !== stored)] : [null];
    for (const s of strengths) {
      const rules = rulesFromStep(s === null ? r.rules : withDemandFactor(r.rules, s), fromStep);
      out.push({
        id: `opt${out.length}`,
        label: r.name + (s !== null && s !== stored ? ` at ×${round4(s)}` : ""),
        responseId: r.id,
        fromStep,
        strength: s,
        rules,
      });
    }
  }
  return out;
}

/** Enough digits to tell two options apart, few enough to read. */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export interface ResultRow {
  policy: string;
  name?: string;
  unmet_care?: number;
  excess_deaths?: number;
  response_cost?: number;
  [k: string]: unknown;
}

export interface RankedOption {
  id: string;
  label: string;
  /** Patient-days of waiting this avoided, against doing nothing. */
  avoidedWaiting: number;
  /** Lives it avoided losing. Zero everywhere until a mortality is declared. */
  avoidedDeaths: number;
  cost: number;
  /** Dollars per patient-day avoided, or null when it avoided nothing. */
  costPerDay: number | null;
  /**
   * Another option achieves at least as much for no more money.
   *
   * The one comparison that needs no exchange rate: whatever a reader thinks a
   * patient-day is worth, this option is not the answer.
   */
  dominated: boolean;
  /** The option that dominates it, for saying so on screen. */
  dominatedBy: string | null;
}

const BASELINE = "null";

/**
 * Options against doing nothing, best first, with the dominated ones marked.
 *
 * Sorted on what they achieve and never on cost, because sorting on a blend of
 * the two is the exchange rate again, wearing a sort key. Ties are broken by
 * cost ascending, which is the only ordering nobody has to agree to a price
 * for.
 */
export function rankOptions(rows: readonly ResultRow[]): RankedOption[] {
  const base = rows.find((r) => r.policy === BASELINE);
  if (!base) return [];
  const baseWait = Number(base.unmet_care ?? 0);
  const baseDeaths = Number(base.excess_deaths ?? 0);

  const options: RankedOption[] = rows
    .filter((r) => r.policy !== BASELINE)
    .map((r) => {
      const cost = Number(r.response_cost ?? 0);
      const avoidedWaiting = baseWait - Number(r.unmet_care ?? 0);
      return {
        id: r.policy,
        label: String(r.name ?? r.policy),
        avoidedWaiting,
        avoidedDeaths: baseDeaths - Number(r.excess_deaths ?? 0),
        cost,
        costPerDay: avoidedWaiting > 0 ? cost / avoidedWaiting : null,
        dominated: false,
        dominatedBy: null,
      };
    });

  for (const a of options) {
    for (const b of options) {
      if (a === b) continue;
      // Strictly better on one axis and no worse on the other. Equal on both is
      // not domination: two identical options are a duplicate, not a loser.
      const better =
        (b.avoidedWaiting > a.avoidedWaiting && b.cost <= a.cost) ||
        (b.avoidedWaiting >= a.avoidedWaiting && b.cost < a.cost);
      if (better) {
        a.dominated = true;
        a.dominatedBy = b.label;
        break;
      }
    }
  }

  return options.sort(
    (x, y) =>
      y.avoidedDeaths - x.avoidedDeaths ||
      y.avoidedWaiting - x.avoidedWaiting ||
      x.cost - y.cost ||
      x.label.localeCompare(y.label),
  );
}

/**
 * The options nobody can argue against on preferences alone.
 *
 * Everything not dominated. Reading it is the real output of this screen: these
 * are the choices, and picking among them is a judgement about what a
 * patient-day is worth — which is the decision the reader is there to make.
 */
export function frontier(options: readonly RankedOption[]): RankedOption[] {
  return options.filter((o) => !o.dominated);
}
