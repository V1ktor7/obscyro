import { describe, expect, it } from "vitest";

import { runBlockedBecause, unsizedPopulations, type GateInput } from "./run-gate";

const MONTREAL: GateInput = {
  event: "event:abc",
  hasCapacity: true,
  populations: Array.from({ length: 12 }, (_, i) => ({ id: `pop:${i}`, size: 150_000 })),
  typedSizes: {},
  edgeCount: 0,
  routeCapacity: "0",
};

describe("what stops a run", () => {
  it("lets a twin run on the sizes it declared itself", () => {
    // The defect: the gate counted only sizes typed into the form, so a twin
    // carrying all twelve of its RLS populations was still told to enter one by
    // hand and the button never lit.
    expect(runBlockedBecause(MONTREAL)).toBeNull();
  });

  it("asks for a size when nothing anywhere has one", () => {
    const bare = { ...MONTREAL, populations: [{ id: "pop:1", size: 0 }] };
    expect(runBlockedBecause(bare)).toMatch(/how many people/);
  });

  it("accepts a size typed in when the ontology holds none", () => {
    const typed = {
      ...MONTREAL,
      populations: [{ id: "pop:1", size: 0 }],
      typedSizes: { "pop:1": "40000" },
    };
    expect(runBlockedBecause(typed)).toBeNull();
  });

  it("runs when only some catchments are sized", () => {
    // One territory without a head count is a gap to report, not a reason to
    // refuse the whole run.
    const partial = {
      ...MONTREAL,
      populations: [{ id: "a", size: 200_000 }, { id: "b", size: 0 }],
    };
    expect(runBlockedBecause(partial)).toBeNull();
  });

  it("names the event first, because that is the one you notice missing", () => {
    expect(runBlockedBecause({ ...MONTREAL, event: "" })).toMatch(/Pick one of your events/);
  });

  it("does not demand a route capacity from a twin with no routes", () => {
    // Montréal has zero edges. Asking how many patients a route carries is a
    // dead end: there is no route to size.
    expect(runBlockedBecause({ ...MONTREAL, edgeCount: 0, routeCapacity: "" })).toBeNull();
  });

  it("demands one as soon as a route exists", () => {
    expect(
      runBlockedBecause({ ...MONTREAL, edgeCount: 3, routeCapacity: "0" }),
    ).toMatch(/route can carry/);
  });

  it("says so when nothing is capacity", () => {
    expect(runBlockedBecause({ ...MONTREAL, hasCapacity: false })).toMatch(/carries capacity/);
  });
});

describe("unsizedPopulations", () => {
  it("returns only the ones still missing a head count", () => {
    const pops = [{ id: "a", size: 200_000 }, { id: "b", size: 0 }, { id: "c" }];
    expect(unsizedPopulations(pops, { c: "500" }).map((p) => p.id)).toEqual(["b"]);
  });
});
