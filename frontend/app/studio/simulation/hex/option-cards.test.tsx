// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Basis, OptionFigures } from "../../analyst-api";

import { MISSING_VALUE_COST, NORMAL_COST, RUSH_COST, UNPRICED_COST } from "./__fixtures__/priced-costs";
import { CostLine, DelayLine, EvidenceMeter, Figures, Fold, Outcome, SiteStrip, evidenceCounts, hasPriceList, money, placesResponse, waitingGap, waitingScale, weighOptions } from "./option-cards";

afterEach(cleanup);

const figures = (over: Partial<OptionFigures> = {}): OptionFigures => ({
  peakOccupancy: 0.941,
  peakDay: 24,
  sitesWithQueue: 8,
  sitesWithActivity: 34,
  firstQueueDay: 12,
  waitingDays: 7316.4,
  peakWaiting: 410,
  peakWaitingDay: 27,
  strandedWaitingDays: null,
  ...over,
});

const basis = (...levels: Basis["evidence"][]): Basis[] => levels.map((evidence, i) => ({ element: `thing ${i}`, evidence, from: "twin" }));

describe("the gap between two runs", () => {
  it("is the subtraction of the two figures as they are shown", () => {
    // 7,316.4 is shown as 7,316 and 266.6 as 267: the gap is 7,049, what a reader finds by hand.
    expect(waitingGap(figures({ sitesWithQueue: 3, waitingDays: 266.6 }), figures())).toBe(-7049);
    expect(waitingGap(figures({ waitingDays: 9718.2 }), figures())).toBe(2402);
    expect(waitingGap(figures(), figures())).toBe(0);
  });

  it("counts no waiting for a run where no site has a queue, as the Result panel does", () => {
    expect(waitingGap(figures({ sitesWithQueue: 0, waitingDays: 0.4 }), figures())).toBe(-7316);
  });

  it("draws every bar against the longest wait among the runs shown together", () => {
    expect(waitingScale([figures(), figures({ waitingDays: 359 }), figures({ waitingDays: 9718 })])).toBe(9718);
    // Nobody waits anywhere: the scale is not zero, so no bar divides by it.
    expect(waitingScale([figures({ sitesWithQueue: 0, waitingDays: 0 })])).toBe(1);
  });
});

describe("the figures of a run, drawn", () => {
  it("says the gap in the direction it goes, and names what it is read beside", () => {
    const { rerender } = render(<Figures figures={figures({ sitesWithQueue: 3, waitingDays: 267 })} against={figures()} scale={7316.4} />);
    expect(screen.getByText("−7,049 vs as it is")).toBeTruthy();
    rerender(<Figures figures={figures({ waitingDays: 9718 })} against={figures()} scale={9718} beside="without it" />);
    expect(screen.getByText("+2,402 vs without it")).toBeTruthy();
    rerender(<Figures figures={figures()} against={figures()} scale={7316.4} />);
    expect(screen.getByText("±0 vs as it is")).toBeTruthy();
  });

  it("gives no gap to the run everything else is read beside", () => {
    render(<Figures figures={figures()} scale={7316.4} />);
    expect(screen.queryByText(/vs as it is/)).toBeNull();
  });

  it("shows the waiting where no site serves only when asked, and a dash when the run reports none", () => {
    const { rerender } = render(<Figures figures={figures()} scale={7316.4} />);
    expect(screen.queryByText("Patient-days waiting where no site serves")).toBeNull();
    rerender(<Figures figures={figures({ strandedWaitingDays: 41.6 })} scale={7316.4} stranded />);
    expect(screen.getByText("Patient-days waiting where no site serves").nextElementSibling?.textContent).toBe("42");
    rerender(<Figures figures={figures()} scale={7316.4} stranded />);
    expect(screen.getByText("Patient-days waiting where no site serves").nextElementSibling?.textContent).toBe("—");
  });

  it("says what the run comes to in words", () => {
    const { rerender } = render(<Outcome figures={figures()} />);
    expect(screen.getByText("8 sites with a queue")).toBeTruthy();
    rerender(<Outcome figures={figures({ sitesWithQueue: 1 })} />);
    expect(screen.getByText("1 site with a queue")).toBeTruthy();
    rerender(<Outcome figures={figures({ sitesWithQueue: 0 })} />);
    expect(screen.getByText("Nobody waits")).toBeTruthy();
  });

  it("draws one square per site, and a share of a bar when the sites are too many for squares", () => {
    const few = render(<SiteStrip on={3} of={34} />);
    expect(few.container.querySelectorAll(".bg-danger")).toHaveLength(3);
    expect(few.container.querySelectorAll(".bg-line-strong")).toHaveLength(31);
    few.unmount();
    const many = render(<SiteStrip on={19} of={190} />);
    const part = many.container.querySelector(".bg-danger") as HTMLElement;
    expect(part.style.width).toBe("10%");
  });
});

describe("the levels of evidence of a run", () => {
  it("counts the three apart and never adds them", () => {
    expect(evidenceCounts(basis("measured", "assumption", "measured", "published"))).toEqual({ measured: 2, published: 1, assumption: 1 });
    render(<EvidenceMeter items={basis("measured", "assumption", "measured", "published")} />);
    expect(screen.getByText("2 measured · 1 published · 1 assumption")).toBeTruthy();
  });

  it("leaves out a level the run does not rest on, and says nothing for a run that rests on nothing listed", () => {
    const { container, rerender } = render(<EvidenceMeter items={basis("assumption", "assumption")} />);
    expect(screen.getByText("2 assumption")).toBeTruthy();
    rerender(<EvidenceMeter items={[]} />);
    expect(container.textContent).toBe("");
  });
});

describe("a fold", () => {
  it("keeps its explanation out of the page until it is opened, and says whether it is", () => {
    render(
      <Fold title="What it rests on" meta={<span>2 measured</span>}>
        <p>The twin holds 234 beds.</p>
      </Fold>,
    );
    const button = screen.getByRole("button", { name: /What it rests on/ });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.textContent).toMatch(/2 measured/);
    expect(screen.queryByText("The twin holds 234 beds.")).toBeNull();
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("The twin holds 234 beds.")).toBeTruthy();
  });

  it("can start open, for what must not wait for a click", () => {
    render(
      <Fold title="Why this option" defaultOpen>
        <p>A figure was removed here.</p>
      </Fold>,
    );
    expect(screen.getByText("A figure was removed here.")).toBeTruthy();
  });
});

describe("what a run cost, and which options can be weighed", () => {
  const whole = (counted: number) => ({ counted, complete: true, says: `The engine counted ${counted} $.` });
  const asItIs = figures({ sitesWithQueue: 1, waitingDays: 76 });
  const opt = (step: string, waitingDays: number, cost?: { counted: number | null; complete: boolean; says: string }) => ({
    step,
    label: `Option ${step}`,
    figures: figures({ sitesWithQueue: waitingDays > 0 ? 1 : 0, waitingDays }),
    cost,
  });

  it("marks an option dominated only against another whose whole cost the engine counted", () => {
    const out = weighOptions(asItIs, [
      opt("s1", 11, whole(7500)),
      // Costs more, leaves more waiting: dominated by s1.
      opt("s2", 40, whole(9000)),
      // Beds: no price, so it is neither weighed nor allowed to dominate, though it leaves nobody waiting.
      opt("s3", 0, { counted: null, complete: false, says: "No cost is counted." }),
      // A priced response with beds beside it: the count is not the option's whole cost.
      opt("s4", 60, { counted: 100, complete: false, says: "Not the whole cost." }),
      // Journalled before costs existed.
      opt("s5", 70),
    ]);
    expect(Array.from(out.dominated)).toEqual([["s2", "Option s1"]]);
    expect(out.weighed).toBe(2);
  });

  it("counts the waiting of catchments no site serves: a queue moved out of sight is not avoided", () => {
    const moved = { ...opt("s2", 5, whole(100)), figures: figures({ sitesWithQueue: 1, waitingDays: 5, strandedWaitingDays: 300 }) };
    const out = weighOptions({ ...asItIs, strandedWaitingDays: 0 }, [opt("s1", 20, whole(100)), moved]);
    expect(Array.from(out.dominated)).toEqual([["s2", "Option s1"]]);
  });

  it("writes the count when there is one, and says when it is not the whole cost", () => {
    const { rerender, container } = render(<CostLine cost={whole(7500)} />);
    // What the engine counts is the amount a rule declares, and no rule amount has a source: a demo price, and it shows.
    expect(container.textContent).toBe("Cost counted: 7,500 $. demo price The engine counted 7500 $.");
    rerender(<CostLine cost={{ counted: 100, complete: false, says: "The beds carry no price.", demo: true }} />);
    expect(container.textContent).toBe("Cost counted: 100 $ (not the whole cost). demo price The beds carry no price.");
    // Nothing counted: no figure, no badge, only why.
    rerender(<CostLine cost={{ counted: null, complete: false, says: "No cost is counted for this run." }} />);
    expect(container.textContent).toBe("No cost is counted for this run.");
  });

  it("knows an option that places a recorded response", () => {
    expect(placesResponse({ stamps: [{ body: { kind: "response" }, start: 12, days: 18 }] })).toBe(true);
    expect(placesResponse({ stamps: [{ body: { kind: "capacity" }, start: 5, days: 25 }] })).toBe(false);
  });
});

describe("a cost from the twin's price list", () => {
  const asItIs = figures({ sitesWithQueue: 1, waitingDays: 5000 });
  const opt = (step: string, waitingDays: number, cost: typeof RUSH_COST) => ({ step, label: `Option ${step}`, figures: figures({ sitesWithQueue: 1, waitingDays }), cost });

  it("writes an amount held in cents as a person reads it", () => {
    expect(money(125050)).toBe("1,250.50 $");
    expect(money(150_000_000)).toBe("1,500,000 $");
    expect(money(0)).toBe("0 $");
  });

  it("opens the lines of a cost on a click: quantity times price, and where each price comes from", () => {
    render(<CostLine cost={RUSH_COST} />);
    const cost = screen.getByRole("button", { name: /^Cost/ });
    // The total is the server's, to the cent, and it carries the badge: one of its prices has no source.
    expect(cost.textContent).toBe("Cost2,951,140 $demo price· 2 lines");
    expect(cost.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("list", { name: "Lines of this cost" })).toBeNull();

    fireEvent.click(cost);
    expect(cost.getAttribute("aria-expanded")).toBe("true");
    const lines = screen.getByRole("list", { name: "Lines of this cost" }).querySelectorAll(":scope > li");
    expect(Array.from(lines).map((l) => l.textContent)).toEqual([
      "Openinglit at Lakeshore · day 3 · mode “rush”demo price40 units × 2,500 $ to open = 100,000 $No source in the price list. Price row: Tarif.",
      "Kept openlit at Lakeshore · days 3 to 59 · mode “rush”demo price40 units × 57 days × 1,250.50 $ a day = 2,851,140 $No source in the price list. Price row: Tarif.",
    ]);
    // The total is the sum of the lines, and it is said by kind when there are two.
    expect(screen.getByText(/^Price list total:/).textContent).toBe(
      "Price list total: 2,951,140 $ · opening 100,000 $ · kept open 2,851,140 $. The sum of the lines above, in whole cents.",
    );
    // A second click folds them away again.
    fireEvent.click(cost);
    expect(screen.queryByRole("list", { name: "Lines of this cost" })).toBeNull();
  });

  it("shows a range as its low and high ends, and no badge on a total whose prices all have a source", () => {
    render(<CostLine cost={NORMAL_COST} />);
    const cost = screen.getByRole("button", { name: /^Cost/ });
    expect(cost.textContent).toBe("Cost1,472,000 $· price list between 1,288,000 $ and 1,840,000 $· 1 line");
    expect(screen.queryByText("demo price")).toBeNull();
    fireEvent.click(cost);
    const line = screen.getByRole("list", { name: "Lines of this cost" }).querySelector("li")!;
    expect(line.textContent).toBe(
      "Kept openlit at Lakeshore · days 14 to 59 · mode “normal” · this site’s own price40 units × 46 days × 800 $ a day = 1,472,000 $ (between 1,288,000 $ and 1,840,000 $)Source: Rate card 2026 Price row: Tarif.",
    );
    expect(screen.getByText(/^Price list total:/).textContent).toBe(
      "Price list total: 1,472,000 $ (between 1,288,000 $ and 1,840,000 $). The sum of the lines above, in whole cents.",
    );
  });

  it("says what the list does not price, and never writes a zero in its place", () => {
    const { container } = render(<CostLine cost={UNPRICED_COST} />);
    const cost = screen.getByRole("button", { name: /^Cost/ });
    expect(cost.textContent).toBe("Costnot counted· no line, 1 not priced");
    expect(container.textContent).not.toMatch(/\b0 \$/);
    fireEvent.click(cost);
    expect(screen.getByText("The price list holds no price for civière at Nord.")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Lines of this cost" })).toBeNull();
    expect(screen.queryByText(/^Price list total:/)).toBeNull();
  });

  it("names the value a formula is missing", () => {
    render(<CostLine cost={MISSING_VALUE_COST} />);
    fireEvent.click(screen.getByRole("button", { name: /^Cost/ }));
    expect(screen.getByText(/gives no price: Unknown name "distance_km"\. This formula can name: places, frais_fixe, prix_par_km, units, days\./)).toBeTruthy();
  });

  it("says the day what an option opens is available, and the days its mode takes", () => {
    const { container, rerender } = render(<DelayLine cost={RUSH_COST} />);
    expect(container.textContent).toBe("DelayOpen from day 3 · lit at Lakeshore, mode “rush”: 3 days from the decision, taken on day 0 of the run.");
    rerender(<DelayLine cost={NORMAL_COST} />);
    expect(container.textContent).toBe("DelayOpen from day 14 · lit at Lakeshore, mode “normal”: 14 days from the decision, taken on day 0 of the run.");
    // A mode with no delay declared is not given one.
    const atOnce = { ...RUSH_COST, priced: { ...RUSH_COST.priced!, availability: [{ stamp: 0, site: "Lakeshore", activity: "lit", mode: "standard", leadDays: 0, fromDay: 5 }] } };
    rerender(<DelayLine cost={atOnce} />);
    expect(container.textContent).toBe("DelayOpen from day 5 · lit at Lakeshore, mode “standard”: the price list declares no delay for it.");
    // Nothing priced, nothing to say of a delay; and a cost the engine counted alone has none.
    rerender(<DelayLine cost={UNPRICED_COST} />);
    expect(container.textContent).toBe("");
    rerender(<DelayLine cost={{ counted: 7500, complete: true, says: "The engine counted 7,500 $." }} />);
    expect(container.textContent).toBe("");
  });

  it("puts the badge on a sum the engine's count is part of, even when every price row has a source", () => {
    // 1,472,000 $ from the list, every row with its source, and 12,000 $ the engine counted for a recorded response.
    render(<CostLine cost={{ ...NORMAL_COST, counted: 1_484_000, demo: true }} />);
    expect(screen.getByRole("button", { name: /^Cost/ }).textContent).toBe(
      "Cost1,484,000 $· price list between 1,288,000 $ and 1,840,000 $demo price· 1 line",
    );
  });

  it("knows a cost the price list has something to say of", () => {
    expect(hasPriceList(RUSH_COST)).toBe(true);
    expect(hasPriceList(UNPRICED_COST)).toBe(true);
    expect(hasPriceList({ counted: 7500, complete: true, says: "" })).toBe(false);
    expect(hasPriceList(undefined)).toBe(false);
  });

  it("weighs capacity the list prices, and names the options no other beats on both counts", () => {
    // Faster costs more and leaves less waiting: neither beats the other.
    const both = weighOptions(asItIs, [opt("s1", 3200, NORMAL_COST), opt("s2", 900, RUSH_COST)]);
    expect([both.weighed, Array.from(both.dominated), Array.from(both.unbeaten)]).toEqual([2, [], ["s1", "s2"]]);
    // The dearer one that also leaves more waiting is beaten, and only the other is marked.
    const beaten = weighOptions(asItIs, [opt("s1", 900, NORMAL_COST), opt("s2", 3200, RUSH_COST)]);
    expect([Array.from(beaten.dominated), Array.from(beaten.unbeaten)]).toEqual([[["s2", "Option s1"]], ["s1"]]);
    // One option alone is beaten by nothing: the mark would say nothing.
    expect(Array.from(weighOptions(asItIs, [opt("s1", 900, NORMAL_COST), opt("s3", 0, UNPRICED_COST)]).unbeaten)).toEqual([]);
  });
});
