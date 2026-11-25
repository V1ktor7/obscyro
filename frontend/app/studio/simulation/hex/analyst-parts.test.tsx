// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActionTypesOf, Elapsed, elapsedText } from "./analyst-parts";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-18T12:00:00Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("how long a step has been going on", () => {
  it("is written the way a person says a duration", () => {
    expect(elapsedText(0)).toBe("0 s");
    expect(elapsedText(42)).toBe("42 s");
    expect(elapsedText(59.9)).toBe("59 s");
    expect(elapsedText(60)).toBe("1 min 00 s");
    expect(elapsedText(125)).toBe("2 min 05 s");
    expect(elapsedText(-3)).toBe("0 s");
  });

  it("stays silent at first, then counts the seconds", () => {
    const { container } = render(<Elapsed since={Date.now()} />);
    // A step that lands at once shows no counter at all.
    expect(container.textContent).toBe("");
    act(() => void vi.advanceTimersByTime(2000));
    expect(container.textContent).toBe("");
    act(() => void vi.advanceTimersByTime(3000));
    expect(container.textContent).toBe("· 5 s");
    act(() => void vi.advanceTimersByTime(60_000));
    expect(container.textContent).toBe("· 1 min 05 s");
    // Kept out of the live region around it: nobody wants a counter read aloud every second.
    expect(container.querySelector("span")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("starts again when the step changes", () => {
    const { container, rerender } = render(<Elapsed since={Date.now()} />);
    act(() => void vi.advanceTimersByTime(40_000));
    expect(container.textContent).toBe("· 40 s");
    rerender(<Elapsed since={Date.now()} />);
    expect(container.textContent).toBe("");
    act(() => void vi.advanceTimersByTime(4000));
    expect(container.textContent).toBe("· 4 s");
  });
});

describe("the action types an option falls under", () => {
  const change = (action?: { key: string; name: string; approver: string }) => ({ does: "adds" as const, now: "6 lit at Lakeshore from day 5", was: null, ...(action ? { action } : {}) });

  it("says nothing in a project that declared no action type", () => {
    expect(render(<ActionTypesOf changes={[change()]} />).container.textContent).toBe("");
    expect(render(<ActionTypesOf changes={undefined} />).container.textContent).toBe("");
  });

  it("names each action type once, with who can approve it", () => {
    const beds = { key: "overflow-beds", name: "Open overflow beds", approver: "Director of nursing" };
    const { container } = render(<ActionTypesOf changes={[change(beds), change(beds), change({ key: "divert", name: "Divert to Nord", approver: "" })]} />);
    expect(container.textContent).toBe("Action typesOpen overflow beds · can be approved by Director of nursingDivert to Nord · no approver declared");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("says who can approve, never that anybody has", () => {
    const { container } = render(<ActionTypesOf changes={[change({ key: "k", name: "Open overflow beds", approver: "Director of nursing" })]} />);
    expect(container.textContent).toMatch(/^Action typeOpen overflow beds · can be approved by/);
    expect(container.textContent).not.toMatch(/was approved|has approved|· approved by/);
  });
});
