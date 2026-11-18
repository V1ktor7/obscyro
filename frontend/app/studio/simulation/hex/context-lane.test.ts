import { describe, expect, it } from "vitest";

import type { HealthEvent } from "../../analyst-api";
import { dayOf, placeEvents } from "./context-lane";

const event = (id: string, startsOn: string, endsOn: string | null = null): HealthEvent => ({
  id,
  title: id,
  place: "Québec",
  door: "access",
  startsOn,
  endsOn,
  proposedStartsOn: startsOn,
  proposedEndsOn: endsOn,
  sourceUrl: "https://www.quebec.ca/x",
  sourceTitle: null,
  passage: "…",
  sources: [],
  proposedByAnalyst: true,
  exchangeId: null,
  candidate: null,
  validatedBy: null,
  validatedAt: "2026-11-17T15:00:00.000Z",
});

const ORIGIN = "2021-12-13";

describe("placing validated events on a scenario's days", () => {
  it("counts days from the calendar date of day 0", () => {
    expect(dayOf(ORIGIN, "2021-12-13")).toBe(0);
    expect(dayOf(ORIGIN, "2021-12-31")).toBe(18);
    expect(dayOf(ORIGIN, "2022-01-17")).toBe(35);
    expect(dayOf(ORIGIN, "2021-12-01")).toBe(-12);
  });

  it("puts an event on its days, and an event with no stated end on one day", () => {
    const { placed, rows, outside } = placeEvents([event("curfew", "2021-12-31", "2022-01-17"), event("closure", "2021-12-21")], ORIGIN, 60);
    expect(placed.map((p) => [p.event.id, p.start, p.days, p.row])).toEqual([
      ["closure", 8, 1, 0],
      ["curfew", 18, 18, 0],
    ]);
    expect(rows).toBe(1);
    expect(outside).toBe(0);
  });

  it("cuts an event that starts before day 0 or runs past the last day, and says it did", () => {
    const { placed } = placeEvents([event("before", "2021-12-01", "2021-12-15"), event("after", "2022-02-01", "2022-03-15")], ORIGIN, 60);
    expect(placed.map((p) => [p.event.id, p.start, p.days, p.startsBefore, p.endsAfter])).toEqual([
      ["before", 0, 3, true, false],
      // Day 50 to day 59, the last of sixty.
      ["after", 50, 10, false, true],
    ]);
  });

  it("leaves out what falls wholly outside the days, and counts it", () => {
    const { placed, outside } = placeEvents([event("long ago", "2020-03-13", "2020-05-01"), event("later", "2022-06-01"), event("in", "2022-01-01")], ORIGIN, 60);
    expect(placed.map((p) => p.event.id)).toEqual(["in"]);
    expect(outside).toBe(2);
  });

  it("gives two events over the same days a line each, and reuses a line once it is free", () => {
    const { placed, rows } = placeEvents(
      [event("curfew", "2021-12-31", "2022-01-17"), event("schools", "2021-12-21", "2022-01-16"), event("masks", "2022-01-20", "2022-02-01")],
      ORIGIN,
      60,
    );
    expect(placed.map((p) => [p.event.id, p.row])).toEqual([
      ["schools", 0],
      ["curfew", 1],
      ["masks", 0],
    ]);
    expect(rows).toBe(2);
  });
});
