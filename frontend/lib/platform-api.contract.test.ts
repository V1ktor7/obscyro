import { describe, expect, it } from "vitest";

import { runReportProblem, type SimComparison } from "./platform-api";

/**
 * The seam between this app and the engine, pinned.
 *
 * Twice in one session a field was renamed on one side and dropped in silence
 * on the other. The first time a composed event arrived carrying no effects and
 * every response scored the same; the second, `result.scenario.name` threw on a
 * field the engine has never sent and the page went blank. Neither failure said
 * anything about a field name.
 */

const REAL: SimComparison = {
  // Exactly the top-level keys `CompareResponse` declares in the engine.
  event: { id: "e", name: "Vague Omicron", description: "", effects: [] },
  rows: [{ policy: "null", name: "No response", unmet_care: 37424 }],
  facilities: 241,
  horizon: 91,
  activities: ["litsantephysique"],
  weights: { excess_deaths: 1 },
  datasets: [],
};

describe("a run report", () => {
  it("accepts what the engine actually sends", () => {
    expect(runReportProblem(REAL)).toBeNull();
  });

  it("names the mismatch instead of letting a render throw", () => {
    // The shape the app used to declare: `scenario`, which is not on the wire.
    const stale = { ...REAL, event: undefined } as unknown as SimComparison;
    expect(runReportProblem(stale)).toMatch(/disagree about the shape/);
  });

  it("catches a ranking that is not a list", () => {
    expect(runReportProblem({ ...REAL, rows: undefined } as unknown as SimComparison)).toMatch(
      /no ranking/,
    );
  });

  it("catches a missing horizon, which the player divides by", () => {
    expect(
      runReportProblem({ ...REAL, horizon: undefined } as unknown as SimComparison),
    ).toMatch(/horizon/);
  });

  it("says so when there is nothing at all", () => {
    expect(runReportProblem(null)).toMatch(/returned nothing/);
  });
});
