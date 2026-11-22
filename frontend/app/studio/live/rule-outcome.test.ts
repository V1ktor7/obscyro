import { describe, expect, it } from "vitest";

import { ruleOutcomeLines, sharePct } from "./rule-outcome";

describe("what became of the signals a rule raised", () => {
  it("gives the share of false positives among the signals that were closed", () => {
    expect(ruleOutcomeLines({ raised: 2878, open: 46, closed: 2832, falsePositives: 3, clearedOnOwn: 2810 })).toEqual([
      "2,878 signals raised: 46 open, 2,832 closed.",
      "3 of the 2,832 closed were dismissed as a false positive: 0.1%.",
      "2,810 were closed after the alert cleared on its own, with nobody having had to act.",
    ]);
  });

  it("gives no share while no signal is closed: an open signal has not been judged", () => {
    expect(ruleOutcomeLines({ raised: 12, open: 12, closed: 0, falsePositives: 0, clearedOnOwn: 0 })).toEqual([
      "12 signals raised: 12 open, 0 closed.",
      "None is closed yet, so there is no share of false positives to give.",
    ]);
  });

  it("says when a rule has raised nothing, and why that can be", () => {
    expect(ruleOutcomeLines({ raised: 0, open: 0, closed: 0, falsePositives: 0, clearedOnOwn: 0 })).toEqual([
      "This rule has raised no signal yet. An alert only becomes a signal when a signal type claims its measure.",
    ]);
  });

  it("writes one signal as one signal", () => {
    expect(ruleOutcomeLines({ raised: 1, open: 0, closed: 1, falsePositives: 1, clearedOnOwn: 0 })).toEqual([
      "1 signal raised: 0 open, 1 closed.",
      "1 of the 1 closed was dismissed as a false positive: 100%.",
    ]);
  });

  it("claims nothing when the API said nothing of the rule's signals", () => {
    expect(ruleOutcomeLines(undefined)).toEqual([]);
    expect(ruleOutcomeLines(null)).toEqual([]);
  });
});

describe("a share a person can read", () => {
  it("is never rounded to zero when it is not zero", () => {
    expect(sharePct(0, 2832)).toBe("0%");
    expect(sharePct(1, 2832)).toBe("less than 0.1%");
    expect(sharePct(3, 2832)).toBe("0.1%");
    expect(sharePct(12, 300)).toBe("4%");
    expect(sharePct(45, 300)).toBe("15%");
    expect(sharePct(7, 7)).toBe("100%");
  });

  it("gives no share of nothing", () => {
    expect(sharePct(0, 0)).toBe("0%");
  });
});
