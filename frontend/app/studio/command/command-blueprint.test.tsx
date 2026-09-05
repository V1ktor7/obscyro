// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { GaugeArc } from "./command-blueprint";

/**
 * A number that a ring cannot draw is still a number.
 *
 * The MSSS emergency feed reports occupancy over 100% routinely — an emergency
 * department holding 137% of its stretchers is the ordinary way a bad night
 * appears in the data, and it is the single most important thing this gauge can
 * say. The ring was clamped to one turn, which is right, and the label was
 * clamped with it, which turned a department in crisis into a full one.
 */

afterEach(cleanup);

describe("occupancy over capacity", () => {
  it("prints the real figure rather than stopping at 100", () => {
    render(<GaugeArc pct={137} />);
    expect(screen.getByText("137%")).toBeTruthy();
  });

  it("still draws the ring as one full turn, because a circle has no more", () => {
    const { container } = render(<GaugeArc pct={137} />);
    const arc = container.querySelectorAll("circle")[1]!;
    expect(Number(arc.getAttribute("stroke-dashoffset"))).toBeCloseTo(0, 6);
  });

  it("reads as critical past the threshold, not merely at the top of the ring", () => {
    const { container } = render(<GaugeArc pct={137} />);
    const arc = container.querySelectorAll("circle")[1]!;
    expect(arc.getAttribute("stroke")).toBe("#f43f5e");
  });

  it("says nothing at all when the figure is missing", () => {
    // An unreported department is not an empty one.
    render(<GaugeArc pct={null} />);
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("draws a normal figure normally", () => {
    render(<GaugeArc pct={62} />);
    expect(screen.getByText("62%")).toBeTruthy();
  });
});
