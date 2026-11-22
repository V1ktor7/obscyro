/**
 * How a comparison of responses was ranked, in words.
 *
 * The engine ranks on counts in order — deaths, then care not delivered, then
 * cost — and says which count put the first response first. This turns that
 * into what the results card shows, so first place reads as a reason and not
 * as a verdict.
 *
 * It replaced a single weighted score of deaths and dollars. On a twin whose
 * care model declares no deaths, every response tied on deaths and the order
 * was the order of their cost: doing nothing, which costs nothing, was marked
 * "best" every time, whatever it left undelivered.
 */

export interface Ranking {
  /** The counts, in priority order. */
  by: string[];
  /** Two responses closer than this on a count are level on it. */
  tie_below: number;
  /** The count that put the first row ahead of the second; null when level. */
  decided_by: string | null;
}

type Row = Record<string, string | number>;

export const COUNT_LABEL: Record<string, string> = {
  excess_deaths: "deaths",
  unmet_care: "care not delivered",
  response_cost: "cost",
};

const name = (key: string): string => COUNT_LABEL[key] ?? key.replace(/_/g, " ");

/** Whether the first row earned its place, rather than merely being listed first. */
export function hasWinner(ranking: Ranking | undefined, rows: Row[]): boolean {
  if (rows.length < 2) return false;
  // An engine that does not say how it ranked is the older one: its first row
  // is whatever its score put first.
  return ranking ? ranking.decided_by !== null : true;
}

/** The sentence under the table. */
export function rankingSentence(ranking: Ranking | undefined, weights: Record<string, number>): string {
  if (!ranking || ranking.by.length === 0) {
    const dollars = Math.round(1 / (weights.response_cost || 1)).toLocaleString("en-CA");
    return `Ranked by a score that weighs one death against ${dollars} dollars of spending. That is a judgement, not a fact — change it and the ranking can change with it.`;
  }
  const order = ranking.by.map(name);
  const listed = order.length > 1 ? `${order.slice(0, -1).join(", then ")}, then ${order[order.length - 1]}` : order[0]!;
  const first =
    ranking.decided_by === null
      ? "Nothing separates the first two, so no response is marked best."
      : `First place was decided on ${name(ranking.decided_by)}.`;
  return `Ranked on ${listed}: a later count only decides between responses level on the ones before it, and a gap under ${ranking.tie_below} counts as level. ${first} The order of those counts is a judgement, not a fact.`;
}

/**
 * What the cost column is made of, said under any table that shows one.
 *
 * A response is counted at the amount each of its rules declares. Those
 * amounts are written in the engine's built-in responses, or typed with a
 * response somebody wrote; none comes from the twin's price list, and none has
 * a source. So they are demo prices, and the screen says so wherever one is
 * shown. Empty when no response on screen counts any cost.
 */
export const DEMO_COSTS =
  "Costs are demo prices: a response is counted at the amount each of its rules declares, each time it fires, and none of these amounts has a source.";

export function costSentence(costs: readonly unknown[]): string {
  return costs.some((c) => Number(c ?? 0) > 0) ? DEMO_COSTS : "";
}

/**
 * What "vs doing nothing" compares.
 *
 * Deaths when doing nothing costs any; otherwise the care it leaves
 * undelivered. A column of dashes — which is what comparing on deaths gave a
 * twin that declares none — says nothing about whether acting helped.
 */
export function comparedOn(baseline: Row | undefined, ranking: Ranking | undefined): string | null {
  if (!baseline) return null;
  const tie = ranking?.tie_below ?? 0;
  for (const key of ["excess_deaths", "unmet_care"]) {
    if (Number(baseline[key] ?? 0) > tie) return key;
  }
  return null;
}

/** The change against the baseline on one count, as a share; null when there is nothing to compare. */
export function changeAgainst(row: Row, baseline: Row | undefined, key: string | null): number | null {
  if (!baseline || key === null || row.policy === baseline.policy) return null;
  const base = Number(baseline[key] ?? 0);
  if (!(base > 0)) return null;
  return (Number(row[key] ?? 0) - base) / base;
}
