import { describe, expect, it } from "vitest";

import { changeAgainst, comparedOn, costSentence, hasWinner, rankingSentence, type Ranking } from "./ranking";

const BY = ["excess_deaths", "unmet_care", "response_cost"];
const ranking = (decided_by: string | null): Ranking => ({ by: BY, tie_below: 0.5, decided_by });

const nothing = { policy: "null", excess_deaths: 0, unmet_care: 25561, response_cost: 0 };
const transfers = { policy: "load-balance", excess_deaths: 0, unmet_care: 14186, response_cost: 56000 };

describe("how a comparison was ranked", () => {
  it("names the counts in order and the one that decided first place", () => {
    const s = rankingSentence(ranking("unmet_care"), {});
    expect(s).toContain("Ranked on deaths, then care not delivered, then cost");
    expect(s).toContain("a gap under 0.5 counts as level");
    expect(s).toContain("First place was decided on care not delivered.");
    expect(s).toContain("a judgement, not a fact");
  });

  it("says so when nothing separates the first two, and marks nobody best", () => {
    expect(rankingSentence(ranking(null), {})).toContain("no response is marked best");
    expect(hasWinner(ranking(null), [nothing, transfers])).toBe(false);
    expect(hasWinner(ranking("unmet_care"), [transfers, nothing])).toBe(true);
    expect(hasWinner(ranking("unmet_care"), [transfers])).toBe(false);
  });

  it("still reads a result from an engine that does not say how it ranked", () => {
    expect(rankingSentence(undefined, { response_cost: 0.000002 })).toContain("one death against 500,000 dollars");
    expect(hasWinner(undefined, [nothing, transfers])).toBe(true);
  });
});

describe("what acting is compared with", () => {
  it("compares on deaths when doing nothing costs any", () => {
    const base = { ...nothing, excess_deaths: 40 };
    expect(comparedOn(base, ranking("excess_deaths"))).toBe("excess_deaths");
    expect(changeAgainst({ ...transfers, excess_deaths: 30 }, base, "excess_deaths")).toBeCloseTo(-0.25);
  });

  it("compares on care not delivered when nobody dies, instead of showing dashes", () => {
    expect(comparedOn(nothing, ranking("unmet_care"))).toBe("unmet_care");
    expect(changeAgainst(transfers, nothing, "unmet_care")).toBeCloseTo(-0.445, 3);
  });

  it("has nothing to compare when doing nothing leaves nothing undone", () => {
    const quiet = { policy: "null", excess_deaths: 0, unmet_care: 0.2, response_cost: 0 };
    expect(comparedOn(quiet, ranking(null))).toBeNull();
    expect(comparedOn(undefined, ranking(null))).toBeNull();
    expect(changeAgainst(transfers, quiet, null)).toBeNull();
  });

  it("never compares the baseline with itself", () => {
    expect(changeAgainst(nothing, nothing, "unmet_care")).toBeNull();
  });
});

describe("what the cost column is made of", () => {
  it("says the costs of responses are demo prices, wherever one is counted", () => {
    expect(costSentence([nothing.response_cost, transfers.response_cost])).toBe(
      "Costs are demo prices: a response is counted at the amount each of its rules declares, each time it fires, and none of these amounts has a source.",
    );
  });

  it("says nothing when no response counts a cost", () => {
    expect(costSentence([0, undefined, "0"])).toBe("");
    expect(costSentence([])).toBe("");
  });
});
