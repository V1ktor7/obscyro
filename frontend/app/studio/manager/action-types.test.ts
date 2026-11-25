import { describe, expect, it } from "vitest";

import type { ActionType, TwinOffer } from "../analyst-api";
import { blankForm, boundsLines, draftOf, effectLabel, formOf, modesFor, standingOf, unitsText } from "./action-types";

const OFFER: TwinOffer = {
  activities: ["civiere", "lit"],
  layers: ["ecole", "menage"],
  sites: [
    { id: "site:lake", name: "Lakeshore", activities: ["lit"] },
    { id: "site:north", name: "Nord", activities: ["lit"] },
    { id: "site:clinic", name: "Clinique Pointe", activities: ["civiere"] },
  ],
  catchments: [{ id: "pop:west", name: "Ouest-de-l'Île" }],
  routes: [{ source: "site:lake", target: "site:north" }],
  responses: [{ id: "load-balance", name: "Transfer when full" }],
  modes: { lit: [{ mode: "standard", leadDays: 14 }, { mode: "rush", leadDays: 3 }], civiere: [{ mode: "rush", leadDays: 1 }] },
};

const base = { description: "", leadDays: null, approver: "", active: true, builtIn: false, declared: true, missing: null };
const overflow: ActionType = {
  ...base,
  key: "overflow-beds",
  name: "Open overflow beds",
  effect: "capacity",
  bounds: { activity: "lit", minUnits: 10, maxUnits: 60, sites: ["site:lake", "site:north"], mode: "rush" },
  leadDays: 2,
  approver: "Director of nursing",
};
const builtIn: ActionType = { ...base, key: "capacity", name: "Add or close capacity", effect: "capacity", bounds: { activity: null, minUnits: null, maxUnits: null, sites: null, mode: null }, builtIn: true, declared: false };

describe("an action type, in sentences", () => {
  it("says a range of units the way a person would", () => {
    expect(unitsText(null, null)).toBe("any number of units");
    expect(unitsText(10, 60)).toBe("10 to 60 units");
    expect(unitsText(20, 20)).toBe("20 units");
    expect(unitsText(10, null)).toBe("10 units or more");
    expect(unitsText(null, 40)).toBe("40 units or fewer");
    expect(unitsText(-20, -1)).toBe("-20 to -1 units");
  });

  it("gives the bounds of a capacity type with the names the twin gives its sites", () => {
    expect(boundsLines(overflow, OFFER)).toEqual(["On lit", "10 to 60 units", "At Lakeshore, Nord", "Opened in mode “rush” of the price list", "Takes 2 days before it can apply"]);
    // Without the twin, a site is its id rather than nothing.
    expect(boundsLines(overflow, null)[2]).toBe("At site:lake, site:north");
  });

  it("says an unbounded type in as few lines, with no number nobody declared", () => {
    expect(boundsLines(builtIn, OFFER)).toEqual(["On any activity a site provides", "At any site that provides it"]);
  });

  it("gives the bounds of a measure, a transfer and a response", () => {
    const measure: ActionType = { ...base, key: "m", name: "Close schools", effect: "measure", bounds: { layers: [{ layer: "ecole", minFactor: 0, maxFactor: 0.5 }], maxDays: 14, catchments: ["pop:west"] } };
    expect(boundsLines(measure, OFFER)).toEqual(["ecole, factor 0 to 0.5", "14 days at most", "In Ouest-de-l'Île"]);
    const transfer: ActionType = { ...base, key: "t", name: "Divert", effect: "transfer", bounds: { maxPerDay: 1, from: ["site:lake"], to: null }, leadDays: 0 };
    expect(boundsLines(transfer, OFFER)).toEqual(["1 patient a day at most", "From Lakeshore", "To any site a route reaches", "Can apply from the day of the decision"]);
    const response: ActionType = { ...base, key: "r", name: "Approved plans", effect: "response", bounds: { responses: ["load-balance"] } };
    expect(boundsLines(response, OFFER)).toEqual(["Only Transfer when full"]);
    expect(boundsLines({ ...response, bounds: { responses: null } }, OFFER)).toEqual(["Any recorded response"]);
  });

  it("shortens a long list of sites, and says how many it left out", () => {
    const many: ActionType = { ...overflow, bounds: { ...overflow.bounds, sites: ["a", "b", "c", "d", "e", "f"] } } as ActionType;
    expect(boundsLines(many, null)[2]).toBe("At a, b, c, d and 2 more");
  });

  it("says where a type comes from", () => {
    expect(standingOf(builtIn)).toBe("built-in");
    expect(standingOf({ ...builtIn, declared: true })).toBe("built-in, changed here");
    expect(standingOf(overflow)).toBe("this project's");
    expect(effectLabel("response")).toBe("Recorded response");
  });
});

describe("the form of an action type", () => {
  it("reads a type into the form and back into the same type", () => {
    const { draft, problems } = draftOf(formOf(overflow));
    expect(problems).toEqual([]);
    expect(draft).toEqual({
      name: "Open overflow beds",
      description: "",
      effect: "capacity",
      bounds: { activity: "lit", minUnits: 10, maxUnits: 60, sites: ["site:lake", "site:north"], mode: "rush" },
      leadDays: 2,
      approver: "Director of nursing",
      active: true,
    });
  });

  it("reads an empty box as no bound, never as a zero", () => {
    const { draft, problems } = draftOf({ ...blankForm("capacity"), name: "Beds" });
    expect(problems).toEqual([]);
    expect(draft.bounds).toEqual({ activity: null, minUnits: null, maxUnits: null, sites: null, mode: null });
    expect(draft.leadDays).toBeNull();
    // A zero typed is a zero.
    expect(draftOf({ ...blankForm("capacity"), name: "Beds", leadDays: "0" }).draft.leadDays).toBe(0);
  });

  it("says what to correct before anything is sent", () => {
    const bad = draftOf({ ...blankForm("capacity"), name: " ", minUnits: "60", maxUnits: "10", leadDays: "soon", sites: [] });
    expect(bad.problems).toEqual([
      "Give the action type a name, in your own words.",
      "The days before it can apply has to be a whole number, or left empty for no bound.",
      "The fewest units (60) is above the most (10).",
      "Pick at least one site, or allow any site.",
    ]);
    expect(draftOf({ ...blankForm("capacity"), name: "Beds", minUnits: "2.5" }).problems).toEqual(["The fewest units has to be a whole number, or left empty for no bound."]);
  });

  it("checks a measure's factors, its days and what it covers", () => {
    const form = { ...blankForm("measure"), name: "Close schools", layers: [{ layer: "ecole", minFactor: "0,8", maxFactor: "0.2" }], maxDays: "0", catchments: [] };
    expect(draftOf(form).problems).toEqual([
      "On ecole, the lowest factor (0.8) is above the highest (0.2).",
      "A measure lasts at least one day.",
      "Pick at least one catchment, or allow any catchment.",
    ]);
    const ok = draftOf({ ...blankForm("measure"), name: "Close schools", layers: [{ layer: "ecole", minFactor: "0", maxFactor: "0.5" }], maxDays: "14" });
    expect(ok.problems).toEqual([]);
    expect(ok.draft.bounds).toEqual({ layers: [{ layer: "ecole", minFactor: 0, maxFactor: 0.5 }], maxDays: 14, catchments: null });
    expect(draftOf({ ...blankForm("measure"), name: "x", layers: [] }).problems).toEqual(["Pick at least one contact layer, or allow any layer."]);
  });

  it("checks a transfer and a response", () => {
    expect(draftOf({ ...blankForm("transfer"), name: "Divert", maxPerDay: "0", from: [], to: [] }).problems).toEqual([
      "A transfer sends at least one patient a day.",
      "Pick at least one site to send from, or allow any.",
      "Pick at least one site to send to, or allow any.",
    ]);
    expect(draftOf({ ...blankForm("transfer"), name: "Divert", maxPerDay: "5", to: ["site:north"] }).draft.bounds).toEqual({ maxPerDay: 5, from: null, to: ["site:north"] });
    expect(draftOf({ ...blankForm("response"), name: "Plans", responses: [] }).problems).toEqual(["Pick at least one recorded response, or allow any."]);
    expect(draftOf({ ...blankForm("response"), name: "Plans", responses: ["load-balance"] }).draft.bounds).toEqual({ responses: ["load-balance"] });
  });

  it("offers the modes the price list holds for the activity, or for any, each once with its shortest delay", () => {
    expect(modesFor(OFFER, "lit")).toEqual([{ mode: "standard", leadDays: 14 }, { mode: "rush", leadDays: 3 }]);
    expect(modesFor(OFFER, "")).toEqual([{ mode: "standard", leadDays: 14 }, { mode: "rush", leadDays: 1 }]);
    expect(modesFor(OFFER, "soins_intensifs")).toEqual([]);
    expect(modesFor(null, "lit")).toEqual([]);
  });
});
