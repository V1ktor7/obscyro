// @vitest-environment jsdom

/**
 * The player exists so a reader can watch the network fill up and stop at the
 * day it broke. Both of those are behaviour.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { SimComparison, SimExport } from "@/lib/platform-api";

import ReplayPlayer from "./ReplayPlayer";

afterEach(cleanup);

const SNAPSHOT = {
  facilities: [
    {
      id: "h",
      name: "HÔPITAL NOTRE-DAME",
      location: [45.52, -73.56],
      resources: {
        a: { id: "a", category: "space", quantity: 0, capacity: 300, enables: ["litsantephysique"] },
      },
      census: {},
    },
    {
      id: "c",
      name: "CHSLD ANGUS",
      location: [45.56, -73.58],
      resources: {
        b: { id: "b", category: "space", quantity: 40, capacity: 40, enables: ["lithebergement"] },
      },
      census: {},
    },
    { id: "nowhere", name: "SANS ADRESSE", location: null, resources: {}, census: {} },
  ],
  populations: [],
  object_types: [],
  objects: [],
} as unknown as SimExport;

function comparison(withTable = true): SimComparison {
  return {
    rows: [
      { policy: "null", name: "Ne rien faire" },
      { policy: "load-balance", name: "Transférer" },
    ],
    horizon: 3,
    facilities: 2,
    activities: [],
    weights: {},
    scenario: { id: "e", name: "Vague", description: "", perturbations: [] },
    datasets: withTable
      ? [
          {
            name: "facilities",
            label: "",
            description: "",
            columns: [
              "policy", "step", "facility_id", "facility", "activity", "occupancy", "waiting",
            ],
            rows: [
              ["null", 0, "h", "HÔPITAL NOTRE-DAME", "litsantephysique", 0.2, 0],
              ["null", 0, "c", "CHSLD ANGUS", "lithebergement", 1, 0],
              ["null", 1, "h", "HÔPITAL NOTRE-DAME", "litsantephysique", 1, 42],
              ["null", 1, "c", "CHSLD ANGUS", "lithebergement", 1, 0],
              ["load-balance", 0, "h", "HÔPITAL NOTRE-DAME", "litsantephysique", 0.1, 0],
            ],
          },
        ]
      : [],
  } as unknown as SimComparison;
}

describe("what the player says at a step", () => {
  it("starts at the first step and counts what is full", () => {
    render(<ReplayPlayer result={comparison()} snapshot={SNAPSHOT} />);
    expect(screen.getByText("step 0 of 2")).toBeTruthy();
    // Angus is at capacity, Notre-Dame is at a fifth.
    expect(screen.getByLabelText("The network at step 0")).toBeTruthy();
  });

  it("moves when the slider moves", () => {
    render(<ReplayPlayer result={comparison()} snapshot={SNAPSHOT} />);
    fireEvent.change(screen.getByLabelText("Time step"), { target: { value: "1" } });
    expect(screen.getByText("step 1 of 2")).toBeTruthy();
    // 42 people waiting at Notre-Dame on step 1.
    expect(screen.getByText("42")).toBeTruthy();
  });

  it("draws a dot per placed facility and leaves out the unplaced one", () => {
    // A site with no coordinates piled at the origin is a red dot in the
    // Atlantic that somebody will ask about.
    const { container } = render(<ReplayPlayer result={comparison()} snapshot={SNAPSHOT} />);
    const map = container.querySelector('[aria-label="The network at step 0"]')!;
    expect(map.querySelectorAll("circle")).toHaveLength(2);
  });

  it("names the facility and what is full on it", () => {
    const { container } = render(<ReplayPlayer result={comparison()} snapshot={SNAPSHOT} />);
    const titles = Array.from(container.querySelectorAll("title")).map((t) => t.textContent);
    expect(titles.some((t) => t?.includes("CHSLD ANGUS") && t.includes("100%"))).toBe(true);
  });
});

describe("switching response", () => {
  it("replays the other one without leaking the first", () => {
    // Two responses share the table. Reading rows that belong to the other is
    // how a player shows a crisis that this policy prevented.
    const { container } = render(<ReplayPlayer result={comparison()} snapshot={SNAPSHOT} />);
    const map = () => container.querySelector("svg[aria-label^='The network']")!;
    expect(map().querySelectorAll("circle")).toHaveLength(2);

    fireEvent.change(screen.getByLabelText("Response to replay"), {
      target: { value: "load-balance" },
    });
    // `load-balance` only ever reported Notre-Dame.
    expect(map().querySelectorAll("circle")).toHaveLength(1);
  });

  it("stays on the same step, because that is the comparison", () => {
    // Switching response at day 45 asks "what did this one look like on the
    // same day". Jumping back to zero would answer a different question and
    // lose the reader's place.
    render(<ReplayPlayer result={comparison()} snapshot={SNAPSHOT} />);
    fireEvent.change(screen.getByLabelText("Time step"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Response to replay"), {
      target: { value: "load-balance" },
    });
    expect(screen.getByText("step 2 of 2")).toBeTruthy();
  });
});

describe("when the trajectory was not collected", () => {
  it("says which box to tick rather than showing an empty map", () => {
    render(<ReplayPlayer result={comparison(false)} snapshot={SNAPSHOT} />);
    expect(screen.getByText(/one row per step and facility/)).toBeTruthy();
  });
});
