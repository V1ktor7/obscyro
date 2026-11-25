// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/auth";

import type { ActionType, ActionTypeList, AnalystToolLine, TwinOffer } from "../analyst-api";

const api = vi.hoisted(() => ({
  fetchActionTypes: vi.fn(),
  fetchAnalystTools: vi.fn(),
  createActionType: vi.fn(),
  saveActionType: vi.fn(),
  removeActionType: vi.fn(),
  switchAnalystTool: vi.fn(),
}));
vi.mock("../analyst-api", async (orig) => ({ ...(await orig<typeof import("../analyst-api")>()), ...api }));

import { ActionTypesPage } from "./ActionTypes";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

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
  modes: { lit: [{ mode: "standard", leadDays: 14 }, { mode: "rush", leadDays: 3 }] },
};

const common = { description: "", leadDays: null, approver: "", active: true, builtIn: true, declared: false, missing: null };
const BUILT_IN: ActionType[] = [
  { ...common, key: "capacity", name: "Add or close capacity", effect: "capacity", bounds: { activity: null, minUnits: null, maxUnits: null, sites: null, mode: null } },
  { ...common, key: "measure", name: "Apply a measure", effect: "measure", bounds: { layers: null, maxDays: null, catchments: null } },
  { ...common, key: "transfer", name: "Transfer waiting patients", effect: "transfer", bounds: { maxPerDay: null, from: null, to: null } },
  { ...common, key: "response", name: "Follow a recorded response", effect: "response", bounds: { responses: null } },
];
const OVERFLOW: ActionType = {
  ...common,
  key: "open-overflow-beds",
  name: "Open overflow beds",
  description: "Beds opened in the old wing.",
  effect: "capacity",
  bounds: { activity: "lit", minUnits: 10, maxUnits: 60, sites: ["site:lake"], mode: null },
  leadDays: 2,
  approver: "Director of nursing",
  builtIn: false,
  declared: true,
};
const line = { group: "The twin", does: "reads" as const, origin: "code" as const, inputs: [] };
const TOOLS: AnalystToolLine[] = [
  { ...line, name: "describe_twin", reads: "An overview of the twin.", where: ["ask", "options"], switchable: true, why: null, on: true },
  { ...line, name: "calculate", reads: "A calculation.", where: ["ask", "options"], switchable: false, why: "A figure the analyst derives has to be computed by a tool.", on: true },
  { ...line, name: "web_search", reads: "A search of the web.", where: ["events", "investigate"], switchable: true, why: null, on: true },
];

const list = (types: ActionType[] = BUILT_IN, over: Partial<ActionTypeList> = {}): ActionTypeList => ({ types, offer: OFFER, offerProblem: null, ...over });
async function page(l: ActionTypeList = list(), tools: AnalystToolLine[] = TOOLS) {
  api.fetchActionTypes.mockResolvedValue(l);
  api.fetchAnalystTools.mockResolvedValue({ tools });
  render(<ActionTypesPage env="mtl" />);
  await screen.findByText("What the analyst may propose");
}
const card = (name: string) => screen.getByRole("listitem", { name });

beforeEach(() => {
  api.saveActionType.mockResolvedValue({});
  api.createActionType.mockResolvedValue({});
  api.removeActionType.mockResolvedValue(undefined);
  api.switchAnalystTool.mockResolvedValue({});
});

describe("the action types of a project", () => {
  it("shows the four built-in types of a project that declared nothing, and says the analyst works as before", async () => {
    await page();
    expect(screen.getByText(/This project declared none: the four built-in types stand, and the analyst works as it always did\./)).toBeTruthy();
    expect(screen.getAllByRole("listitem").filter((li) => within(li).queryByText("built-in")).length).toBe(4);
    const capacity = card("Add or close capacity");
    expect(within(capacity).getByText("Capacity")).toBeTruthy();
    expect(within(capacity).getByText("On any activity a site provides")).toBeTruthy();
    expect(within(capacity).getByText("No approver declared.")).toBeTruthy();
    // Nothing to reset on a built-in type nobody changed.
    expect(within(capacity).queryByRole("button", { name: /Reset|Remove/ })).toBeNull();
    expect(screen.getByText("4 on")).toBeTruthy();
  });

  it("shows a type the project declared with its bounds, its delay and who can approve it", async () => {
    await page(list([...BUILT_IN, OVERFLOW]));
    expect(screen.getByText(/This project declared its own: the analyst is told to keep to them\./)).toBeTruthy();
    const c = card("Open overflow beds");
    expect(within(c).getByText("this project's")).toBeTruthy();
    expect(within(c).getByText("open-overflow-beds")).toBeTruthy();
    for (const line of ["On lit", "10 to 60 units", "At Lakeshore", "Takes 2 days before it can apply"]) expect(within(c).getByText(line)).toBeTruthy();
    expect(within(c).getByText("Can be approved by Director of nursing.")).toBeTruthy();
    expect(within(c).getByRole("button", { name: /Remove/ })).toBeTruthy();
  });

  it("says when a type cannot be tested on this twin, with what is missing", async () => {
    await page(list([...BUILT_IN, { ...OVERFLOW, missing: 'No site provides "soins_intensifs". The activities of the twin are: civiere, lit.' }]));
    expect(within(card("Open overflow beds")).getByRole("alert").textContent).toBe('Cannot be tested on this twin. No site provides "soins_intensifs". The activities of the twin are: civiere, lit.');
  });

  it("says so when the twin could not be read, and still lists the types", async () => {
    await page(list(BUILT_IN, { offer: null, offerProblem: "The twin could not be read, so what an action type can point at is not listed and no type is checked against it." }));
    expect(screen.getByText(/The twin could not be read/)).toBeTruthy();
    expect(card("Add or close capacity")).toBeTruthy();
  });

  it("switches a type off with what it already holds, and reads the list again", async () => {
    await page(list([...BUILT_IN, OVERFLOW]));
    fireEvent.click(screen.getByRole("switch", { name: "Open overflow beds: on" }));
    await waitFor(() => expect(api.saveActionType).toHaveBeenCalled());
    expect(api.saveActionType).toHaveBeenCalledWith("mtl", "open-overflow-beds", {
      name: "Open overflow beds",
      description: "Beds opened in the old wing.",
      effect: "capacity",
      bounds: { activity: "lit", minUnits: 10, maxUnits: 60, sites: ["site:lake"], mode: null },
      leadDays: 2,
      approver: "Director of nursing",
      active: false,
    });
    await waitFor(() => expect(api.fetchActionTypes).toHaveBeenCalledTimes(2));
  });

  it("switching a built-in type off is how a kind of change stops being proposed", async () => {
    await page();
    fireEvent.click(screen.getByRole("switch", { name: "Apply a measure: on" }));
    await waitFor(() => expect(api.saveActionType).toHaveBeenCalled());
    const [, key, draft] = api.saveActionType.mock.calls[0]!;
    expect([key, draft.effect, draft.active]).toEqual(["measure", "measure", false]);
  });

  it("says that a type switched off is not proposed", async () => {
    await page(list([...BUILT_IN.slice(0, 3), { ...BUILT_IN[3]!, active: false, declared: true }]));
    const c = card("Follow a recorded response");
    expect(within(c).getByText(/Switched off: the analyst does not propose this kind of change under this type\./)).toBeTruthy();
    expect(within(c).getByText("built-in, changed here")).toBeTruthy();
    expect(within(c).getByRole("button", { name: /Reset/ })).toBeTruthy();
    expect(screen.getByText("3 on")).toBeTruthy();
  });

  it("removes a type of the project, or resets a built-in one, only after a yes", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await page(list([...BUILT_IN, OVERFLOW]));
    fireEvent.click(within(card("Open overflow beds")).getByRole("button", { name: /Remove/ }));
    expect(confirm.mock.calls[0]![0]).toMatch(/Remove the action type “Open overflow beds”\?.*Nothing already tested or decided changes\./);
    expect(api.removeActionType).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(within(card("Open overflow beds")).getByRole("button", { name: /Remove/ }));
    await waitFor(() => expect(api.removeActionType).toHaveBeenCalledWith("mtl", "open-overflow-beds"));
  });

  it("shows what the server refused, in its words", async () => {
    api.saveActionType.mockRejectedValue(new ApiError(400, "ACTION_TYPE_INVALID", "The bounds cannot be read: sites: Expected array."));
    await page(list([...BUILT_IN, OVERFLOW]));
    fireEvent.click(screen.getByRole("switch", { name: "Open overflow beds: on" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The bounds cannot be read: sites: Expected array.");
  });
});

describe("declaring an action type", () => {
  async function open() {
    await page();
    fireEvent.click(screen.getByRole("button", { name: /Add an action type/ }));
    return screen.getByRole("form", { name: "New action type" });
  }

  it("offers what the twin declares, never a box to type a name of the twin in", async () => {
    const form = await open();
    const activity = within(form).getByLabelText("Activity") as HTMLSelectElement;
    expect(Array.from(activity.options).map((o) => o.textContent)).toEqual(["Any activity a site provides", "civiere", "lit"]);
    // Sites are those that provide the activity picked.
    fireEvent.change(activity, { target: { value: "lit" } });
    fireEvent.click(within(form).getByLabelText("Any site that provides the activity"));
    expect(within(form).getByLabelText("Lakeshore")).toBeTruthy();
    expect(within(form).getByLabelText("Nord")).toBeTruthy();
    expect(within(form).queryByLabelText("Clinique Pointe")).toBeNull();
    // The modes are the price list's, with the days each takes.
    const mode = within(form).getByLabelText("Mode of the price list") as HTMLSelectElement;
    expect(Array.from(mode.options).map((o) => o.textContent)).toEqual(["Any mode the price list holds", "standard · 14 days", "rush · 3 days"]);
  });

  it("writes the type as it was filled in, and reads the list again", async () => {
    const form = await open();
    fireEvent.change(within(form).getByLabelText("Name, in your own words"), { target: { value: "Open overflow beds" } });
    fireEvent.change(within(form).getByLabelText("Who can approve it"), { target: { value: "Director of nursing" } });
    fireEvent.change(within(form).getByLabelText("Activity"), { target: { value: "lit" } });
    fireEvent.change(within(form).getByLabelText("Fewest units"), { target: { value: "10" } });
    fireEvent.change(within(form).getByLabelText("Most units"), { target: { value: "60" } });
    fireEvent.click(within(form).getByLabelText("Any site that provides the activity"));
    fireEvent.click(within(form).getByLabelText("Lakeshore"));
    fireEvent.change(within(form).getByLabelText("Days before it can apply"), { target: { value: "2" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.createActionType).toHaveBeenCalled());
    expect(api.createActionType).toHaveBeenCalledWith("mtl", {
      name: "Open overflow beds",
      description: "",
      effect: "capacity",
      bounds: { activity: "lit", minUnits: 10, maxUnits: 60, sites: ["site:lake"], mode: null },
      leadDays: 2,
      approver: "Director of nursing",
      active: true,
    });
    await waitFor(() => expect(screen.queryByRole("form", { name: "New action type" })).toBeNull());
    expect(api.fetchActionTypes).toHaveBeenCalledTimes(2);
  });

  it("says what to correct, and sends nothing until it is", async () => {
    const form = await open();
    fireEvent.change(within(form).getByLabelText("Fewest units"), { target: { value: "60" } });
    fireEvent.change(within(form).getByLabelText("Most units"), { target: { value: "10" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    const said = within(form).getByRole("alert").textContent ?? "";
    expect(said).toMatch(/Give the action type a name, in your own words\./);
    expect(said).toMatch(/The fewest units \(60\) is above the most \(10\)\./);
    expect(api.createActionType).not.toHaveBeenCalled();
  });

  it("changes what it asks for with what the type changes", async () => {
    const form = await open();
    fireEvent.change(within(form).getByLabelText("What it changes"), { target: { value: "measure" } });
    fireEvent.click(within(form).getByLabelText("Any contact layer the twin declares, any factor"));
    fireEvent.click(within(form).getByLabelText("ecole"));
    fireEvent.change(within(form).getByLabelText("Highest factor on ecole"), { target: { value: "0.5" } });
    fireEvent.change(within(form).getByLabelText("Name, in your own words"), { target: { value: "Close schools" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.createActionType).toHaveBeenCalled());
    expect(api.createActionType.mock.calls[0]![1].bounds).toEqual({ layers: [{ layer: "ecole", minFactor: 0, maxFactor: 0.5 }], maxDays: null, catchments: null });

    fireEvent.click(screen.getByRole("button", { name: /Add an action type/ }));
    const again = screen.getByRole("form", { name: "New action type" });
    fireEvent.change(within(again).getByLabelText("What it changes"), { target: { value: "transfer" } });
    expect(within(again).getByText(/a run lets each carry 20 patients a day, and that is an assumption\. 1 route in the twin\./)).toBeTruthy();
    fireEvent.click(within(again).getByLabelText("Any site a route leaves"));
    // Only a site a route leaves can send patients.
    expect(within(again).getByLabelText("Lakeshore")).toBeTruthy();
    expect(within(again).queryByLabelText("Clinique Pointe")).toBeNull();
  });

  it("edits a type in place, and keeps what it changes", async () => {
    await page(list([...BUILT_IN, OVERFLOW]));
    fireEvent.click(within(card("Open overflow beds")).getByRole("button", { name: /Edit/ }));
    const form = screen.getByRole("form", { name: "Open overflow beds" });
    expect((within(form).getByLabelText("What it changes") as HTMLSelectElement).disabled).toBe(true);
    expect((within(form).getByLabelText("Fewest units") as HTMLInputElement).value).toBe("10");
    fireEvent.change(within(form).getByLabelText("Most units"), { target: { value: "40" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.saveActionType).toHaveBeenCalled());
    const [, key, draft] = api.saveActionType.mock.calls[0]!;
    expect(key).toBe("open-overflow-beds");
    expect(draft.bounds.maxUnits).toBe(40);
    expect(draft.bounds.sites).toEqual(["site:lake"]);
  });

  it("shows the server's refusal in the form, and keeps what was typed", async () => {
    api.createActionType.mockRejectedValue(new ApiError(400, "ACTION_TYPE_INVALID", "The bounds cannot be read: maxPerDay: too big."));
    const form = await open();
    fireEvent.change(within(form).getByLabelText("Name, in your own words"), { target: { value: "Beds" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("The bounds cannot be read: maxPerDay: too big.");
    expect((within(form).getByLabelText("Name, in your own words") as HTMLInputElement).value).toBe("Beds");
  });
});

describe("the analyst's tools", () => {
  it("lists each tool with what it reads and where it is offered", async () => {
    await page();
    expect(screen.getByText("3 of 3 on")).toBeTruthy();
    const search = screen.getByRole("listitem", { name: "web_search" });
    expect(within(search).getByText("A search of the web.")).toBeTruthy();
    expect(within(search).getByText("Event finder")).toBeTruthy();
    expect(within(search).getByText("Investigate")).toBeTruthy();
    expect(screen.getByText(/A project can switch one off, and the\s+analyst is then not offered it\. A reading tool of the project.s own is declared under Functions, and switched there\./)).toBeTruthy();
  });

  it("switches a tool off for the project, and reads again", async () => {
    await page();
    fireEvent.click(screen.getByRole("switch", { name: "web_search: on" }));
    await waitFor(() => expect(api.switchAnalystTool).toHaveBeenCalledWith("mtl", "web_search", false));
    await waitFor(() => expect(api.fetchAnalystTools).toHaveBeenCalledTimes(2));
  });

  it("keeps on the tools an exchange cannot do without, and says why", async () => {
    await page();
    const calc = screen.getByRole("listitem", { name: "calculate" });
    expect((within(calc).getByRole("switch") as HTMLButtonElement).disabled).toBe(true);
    expect(within(calc).getByText(/Always on\. A figure the analyst derives has to be computed by a tool\./)).toBeTruthy();
  });

  it("shows a tool the project declared with where its switch is, not as always on", async () => {
    const own: AnalystToolLine = { ...line, origin: "project", group: "Declared in this project", name: "ventilators_by_site", reads: "Ventilators by site.", where: ["ask", "options"], switchable: false, why: "It is switched on or off where it is declared, under Ontology, Functions.", on: true };
    await page(list(), [TOOLS[0]!, own]);
    const item = screen.getByRole("listitem", { name: "ventilators_by_site" });
    expect(within(item).getByText("It is switched on or off where it is declared, under Ontology, Functions.")).toBeTruthy();
    expect((within(item).getByRole("switch") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a tool that is off as off", async () => {
    await page(list(), [{ ...TOOLS[2]!, on: false }, TOOLS[0]!]);
    expect(screen.getByRole("switch", { name: "web_search: off" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("1 of 2 on")).toBeTruthy();
  });
});

describe("reading the page", () => {
  it("asks for an environment, and says when the list cannot be read", async () => {
    render(<ActionTypesPage env={null} />);
    expect(screen.getByText("Open an environment to read its action types.")).toBeTruthy();
    cleanup();
    api.fetchActionTypes.mockRejectedValue(new ApiError(404, "ENV_NOT_FOUND", "That environment was not found."));
    api.fetchAnalystTools.mockResolvedValue({ tools: [] });
    render(<ActionTypesPage env="mtl" />);
    expect((await screen.findByRole("alert")).textContent).toBe("The action types could not be read: That environment was not found.");
  });
});
