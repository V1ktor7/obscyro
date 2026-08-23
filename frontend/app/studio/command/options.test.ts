import { describe, expect, it } from "vitest";

import { candidatesFrom, frontier, halfAndDouble, rankOptions, type ResultRow } from "./options";

const RESPONSES = [
  {
    id: "p1",
    name: "Transfer when full",
    rules: [{ id: "t", trigger: { when: "every_tick", start: 0 }, action: { kind: "transfer" } }],
  },
  {
    id: "p2",
    name: "December package",
    rules: [
      {
        id: "d",
        trigger: { when: "every_tick", start: 0 },
        action: { kind: "modify_demand", population: "pop:a", factor: 0.96 },
      },
    ],
  },
];

describe("generating the options", () => {
  it("offers every response, made to start where the reader is", () => {
    // "Given where I am, what can I do." Whether acting sooner would have helped
    // is a different question, and branching at another step already answers it.
    const c = candidatesFrom(RESPONSES, 42);
    expect(c).toHaveLength(2);
    expect(c[0]!.rules[0]!.trigger).toEqual({ when: "from_tick", start: 42, end: null });
  });

  it("spreads a strength that was fitted rather than measured", () => {
    // Ranking a number that cannot be pinned down as though it could is how a
    // list of options becomes a list of false precision.
    const c = candidatesFrom(RESPONSES, 10, () => [0.95, 0.97]);
    const demand = c.filter((x) => x.responseId === "p2");
    expect(demand.map((x) => x.strength)).toEqual([0.96, 0.95, 0.97]);
    expect(demand[1]!.label).toContain("×0.95");
  });

  it("leaves a response with no strength alone", () => {
    // A transfer moves the number of patients it says it moves. Generating
    // three of it would be three identical runs and three minutes.
    const c = candidatesFrom(RESPONSES, 10, () => [0.9, 0.8]);
    expect(c.filter((x) => x.responseId === "p1")).toHaveLength(1);
  });

  it("does not repeat the stored strength when it is already in the spread", () => {
    const c = candidatesFrom(RESPONSES, 10, () => [0.96, 0.9]);
    expect(c.filter((x) => x.responseId === "p2").map((x) => x.strength)).toEqual([0.96, 0.9]);
  });

  it("ranges a fitted strength over its own effect, not a made-up interval", () => {
    // A fixed plus-or-minus would be a constant this module invented and then
    // ranked as though it had been measured. Half and twice the declared effect
    // is arithmetic on the author's own number.
    expect(halfAndDouble(0.96)).toEqual([0.98, 0.9199999999999999]);
    expect(halfAndDouble(1.2)[1]).toBeCloseTo(1.4, 6);
  });

  it("never proposes removing more demand than exists", () => {
    expect(halfAndDouble(0.3)[1]).toBe(0);
  });

  it("ranges each response around its own strength", () => {
    // Two levers fitted at different strengths do not share an interval, and
    // running one at the other's numbers ranks a lever nobody proposed.
    const two = [
      RESPONSES[1]!,
      { id: "p3", name: "Curfew", rules: [{ id: "c", action: { kind: "modify_demand", population: "pop:a", factor: 0.8 } }] },
    ];
    const c = candidatesFrom(two, 0, halfAndDouble);
    expect(c.filter((x) => x.responseId === "p2").map((x) => x.strength)).toEqual([0.96, 0.98, 0.9199999999999999]);
    expect(c.filter((x) => x.responseId === "p3").map((x) => x.strength)).toEqual([0.8, 0.9, 0.6000000000000001]);
  });

  it("gives every candidate an id the engine can report it under", () => {
    const ids = candidatesFrom(RESPONSES, 10, () => [0.95]).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

function row(policy: string, name: string, unmet: number, cost: number, deaths = 0): ResultRow {
  return { policy, name, unmet_care: unmet, response_cost: cost, excess_deaths: deaths };
}

describe("ranking them", () => {
  const ROWS = [
    row("null", "Do nothing", 37424, 0),
    row("opt0", "Transfer", 17130, 75000),
    row("opt1", "Surge then transfer", 14347, 2684000),
    row("opt2", "Expensive and worse", 20000, 3000000),
  ];

  it("measures each option against doing nothing", () => {
    const [best] = rankOptions(ROWS);
    expect(best!.label).toBe("Surge then transfer");
    expect(best!.avoidedWaiting).toBe(37424 - 14347);
  });

  it("puts what it costs beside what it achieves rather than blending them", () => {
    // One option avoids more and costs four million, another avoids less for
    // seventy thousand. Ordering those needs an exchange rate between a dollar
    // and a patient-day, and that belongs to the institution.
    const transfer = rankOptions(ROWS).find((o) => o.label === "Transfer")!;
    expect(transfer.cost).toBe(75000);
    expect(transfer.costPerDay).toBeCloseTo(75000 / (37424 - 17130), 4);
  });

  it("marks an option nothing could justify", () => {
    // Costs more and achieves less than another. Whatever a reader thinks a
    // patient-day is worth, this is not the answer — the one comparison that
    // needs no price.
    const bad = rankOptions(ROWS).find((o) => o.label === "Expensive and worse")!;
    expect(bad.dominated).toBe(true);
    expect(bad.dominatedBy).toBeTruthy();
  });

  it("leaves a genuine trade-off standing", () => {
    // Cheap-and-less against dear-and-more is a decision, not a mistake.
    const names = frontier(rankOptions(ROWS)).map((o) => o.label);
    expect(names).toContain("Transfer");
    expect(names).toContain("Surge then transfer");
    expect(names).not.toContain("Expensive and worse");
  });

  it("ranks by lives first when any are at stake", () => {
    // Until a mortality is declared these are all zero and the order falls
    // through to waiting — which is honest, and not the same as saying lives
    // do not matter.
    const withDeaths = [
      row("null", "Do nothing", 37424, 0, 490),
      row("opt0", "Cheap, saves fewer", 17130, 75000, 243),
      row("opt1", "Dear, saves more", 20000, 900000, 203),
    ];
    expect(rankOptions(withDeaths)[0]!.label).toBe("Dear, saves more");
  });

  it("says nothing about an option that avoided nothing", () => {
    // Dividing by zero would print an infinite price per patient-day, which
    // reads as the most expensive option rather than as one that did nothing.
    const flat = [row("null", "Do nothing", 100, 0), row("opt0", "No effect", 100, 5000)];
    expect(rankOptions(flat)[0]!.costPerDay).toBeNull();
  });

  it("returns nothing rather than guessing when there is no baseline", () => {
    // Every figure here is a difference against doing nothing. Without it there
    // is no ranking to make, only numbers to misread.
    expect(rankOptions([row("opt0", "Alone", 100, 0)])).toEqual([]);
  });

  it("does not call two identical options losers", () => {
    const twins = [
      row("null", "Do nothing", 100, 0),
      row("opt0", "A", 50, 1000),
      row("opt1", "B", 50, 1000),
    ];
    expect(rankOptions(twins).every((o) => !o.dominated)).toBe(true);
  });
});
