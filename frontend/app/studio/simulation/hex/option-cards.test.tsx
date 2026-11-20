// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Basis, OptionFigures } from "../../analyst-api";

import { EvidenceMeter, Figures, Fold, Outcome, SiteStrip, evidenceCounts, waitingGap, waitingScale } from "./option-cards";

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
