// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/auth";

import type { FunctionOffer, FunctionType, FunctionTypeList } from "../analyst-api";

const api = vi.hoisted(() => ({
  fetchFunctionTypes: vi.fn(),
  createFunctionType: vi.fn(),
  saveFunctionType: vi.fn(),
  removeFunctionType: vi.fn(),
  tryFunctionType: vi.fn(),
}));
vi.mock("../analyst-api", async (orig) => ({ ...(await orig<typeof import("../analyst-api")>()), ...api }));

import { FunctionTypesPage } from "./FunctionTypes";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const OFFER: FunctionOffer = {
  objectTypes: [
    { name: "Ventilator", properties: ["site", "status", "Flow"] },
    { name: "Bed", properties: ["state", "staffed"] },
  ],
  metrics: [{ key: "occupancy", label: "Occupancy" }],
  datasets: [{ id: "d1", name: "Surgeries by period", slug: "surgeries", columns: ["period", "waiting", "region"] }],
};

const BY_SITE: FunctionType = {
  key: "ventilators_available_by_site",
  label: "Ventilators available by site",
  description: "The ventilators that are free, at each site.",
  inputs: [{ name: "site", kind: "text", required: false, says: "The site's name.", min: null, max: null, choices: [] }],
  active: true,
  missing: null,
  block: "aggregate",
  config: { type: "Ventilator", where: [{ property: "status", equals: { value: "available" } }], agg: "count", property: null, groupBy: { value: "site" }, as: "ventilators_available" },
};
const KEPT: FunctionType = {
  key: "occupancy_kept",
  label: "Occupancy kept at a unit",
  description: "What the twin kept of the occupancy of a unit.",
  inputs: [
    { name: "unit", kind: "text", required: true, says: "The unit's name.", min: null, max: null, choices: [] },
    { name: "hours", kind: "number", required: true, says: "The window.", min: 1, max: 72, choices: [] },
  ],
  active: false,
  missing: "The twin keeps no measure named “occupancy” over time.",
  block: "history",
  config: { metric: "occupancy", unit: { input: "unit" }, hours: { input: "hours" } },
};

const list = (types: FunctionType[] = [], over: Partial<FunctionTypeList> = {}): FunctionTypeList => ({ types, unreadable: [], offer: OFFER, ...over });
async function page(l: FunctionTypeList = list(), onChanged?: () => void) {
  api.fetchFunctionTypes.mockResolvedValue(l);
  render(<FunctionTypesPage env="mtl" onChanged={onChanged} />);
  await screen.findByRole("button", { name: "Declare a tool" });
}
const card = (name: string) => screen.getByRole("listitem", { name });
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

beforeEach(() => {
  api.saveFunctionType.mockResolvedValue({});
  api.createFunctionType.mockResolvedValue({});
  api.removeFunctionType.mockResolvedValue(undefined);
});

describe("the function types of a project", () => {
  it("says a project declared none, and that the analyst keeps the tools of the code", async () => {
    await page();
    expect(screen.getByText(/This project declared none: the analyst has the tools of the code, listed above\./)).toBeTruthy();
    expect(screen.getByText(/It only\s+reads, and nothing written here is run as code\./)).toBeTruthy();
    expect(screen.queryAllByRole("listitem").length).toBe(0);
  });

  it("asks for an environment, and says when the list could not be read", async () => {
    const { unmount } = render(<FunctionTypesPage env={null} />);
    expect(screen.getByText("Open an environment to read its function types.")).toBeTruthy();
    expect(api.fetchFunctionTypes).not.toHaveBeenCalled();
    unmount();

    api.fetchFunctionTypes.mockRejectedValue(new ApiError(500, "INTERNAL", "The database did not answer."));
    render(<FunctionTypesPage env="mtl" />);
    expect((await screen.findByRole("alert")).textContent).toBe("The function types could not be read: The database did not answer.");
  });

  it("shows a declared tool: its name for the analyst, its block, what it reads and what it is given", async () => {
    await page(list([BY_SITE, KEPT], { unreadable: ["Old shape"] }));
    const own = card("Ventilators available by site");
    expect(within(own).getByText("Count or total")).toBeTruthy();
    expect(within(own).getByText("ventilators_available_by_site")).toBeTruthy();
    expect(within(own).getByText("The ventilators that are free, at each site.")).toBeTruthy();
    expect(within(own).getByText("Counts the Ventilator where status is “available”, by site.")).toBeTruthy();
    expect(within(own).getByText("Given: site (text, optional)")).toBeTruthy();
    expect(within(own).getByRole("switch").getAttribute("aria-checked")).toBe("true");

    // One that is off and cannot run says both, with what is missing.
    const kept = card("Occupancy kept at a unit");
    expect(within(kept).getByRole("switch").getAttribute("aria-checked")).toBe("false");
    expect(within(kept).getByText("Switched off: the analyst is not offered it. It can still be tried.")).toBeTruthy();
    expect(within(kept).getByRole("alert").textContent).toBe("Cannot run on this project. The twin keeps no measure named “occupancy” over time.");
    expect(within(kept).getByText("Given: unit (text) · hours (number from 1 to 72)")).toBeTruthy();

    // A stored row that can no longer be read is named, not hidden.
    expect(screen.getByText(/One stored tool can no longer be read and is not offered to the analyst:\s+Old shape\./)).toBeTruthy();
  });

  it("switches a tool off by writing it again as it was declared, then reads the list again", async () => {
    const onChanged = vi.fn();
    await page(list([BY_SITE]), onChanged);
    fireEvent.click(within(card("Ventilators available by site")).getByRole("switch"));
    await waitFor(() => expect(api.saveFunctionType).toHaveBeenCalledTimes(1));
    expect(api.saveFunctionType).toHaveBeenCalledWith("mtl", "ventilators_available_by_site", {
      label: BY_SITE.label,
      description: BY_SITE.description,
      inputs: BY_SITE.inputs,
      block: "aggregate",
      config: BY_SITE.config,
      active: false,
    });
    await waitFor(() => expect(api.fetchFunctionTypes).toHaveBeenCalledTimes(2));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("removes a tool only once a person confirmed, and says why when the server refuses", async () => {
    await page(list([BY_SITE]));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(within(card("Ventilators available by site")).getByRole("button", { name: "Remove" }));
    expect(confirm.mock.calls[0]![0]).toMatch(/Remove the tool “Ventilators available by site”\? The analyst will no longer be offered it\./);
    expect(api.removeFunctionType).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    api.removeFunctionType.mockRejectedValue(new ApiError(404, "NOT_FOUND", "That function type is not in this project."));
    fireEvent.click(within(card("Ventilators available by site")).getByRole("button", { name: "Remove" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That function type is not in this project.");
    expect(api.removeFunctionType).toHaveBeenCalledWith("mtl", "ventilators_available_by_site");
  });
});

describe("declaring a tool", () => {
  it("says what to correct, and sends nothing until it is", async () => {
    await page();
    fireEvent.click(screen.getByRole("button", { name: "Declare a tool" }));
    const form = screen.getByRole("form", { name: "New tool" });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    const problems = within(form).getByRole("alert");
    expect(within(problems).getByText("Give the tool a name, in your own words.")).toBeTruthy();
    expect(within(problems).getByText("Pick the object type it counts.")).toBeTruthy();
    expect(api.createFunctionType).not.toHaveBeenCalled();
  });

  it("builds a count by group from what the project holds, with a filter taken from an input", async () => {
    const onChanged = vi.fn();
    await page(list(), onChanged);
    fireEvent.click(screen.getByRole("button", { name: "Declare a tool" }));
    const form = screen.getByRole("form", { name: "New tool" });
    const f = within(form);

    type(f.getByPlaceholderText("Ventilators available by site"), "Ventilators available by site");
    type(f.getByPlaceholderText(/The ventilators that are free, at each site\./), "The ventilators that are free, at each site.");

    fireEvent.click(f.getByRole("button", { name: "Add an input" }));
    type(f.getByLabelText("Input 1: name"), "site");
    type(f.getByLabelText("Input 1: what it is for"), "The site's name.");
    fireEvent.click(f.getByRole("checkbox", { name: "required" }));

    // The object types are the project's own, and their properties follow the pick.
    const picker = f.getByLabelText("Object type") as HTMLSelectElement;
    expect(Array.from(picker.options).map((o) => o.textContent)).toEqual(["pick an object type…", "Ventilator", "Bed"]);
    type(picker, "Ventilator");

    fireEvent.click(f.getByRole("button", { name: "Add a filter" }));
    expect(Array.from((f.getByLabelText("Filter 1: on") as HTMLSelectElement).options).map((o) => o.textContent)).toEqual(["pick…", "site", "status", "Flow"]);
    type(f.getByLabelText("Filter 1: on"), "status");
    type(f.getByLabelText("Filter 1: value"), "available");
    fireEvent.click(f.getByRole("button", { name: "Add a filter" }));
    type(f.getByLabelText("Filter 2: on"), "site");
    type(f.getByLabelText("Filter 2: taken from"), "site");
    // A filter that takes an input has no value to write.
    expect(f.queryByLabelText("Filter 2: value")).toBeNull();

    // A count is grouped by where each object stands, or by a property of the type.
    expect(Array.from((f.getByRole("combobox", { name: "By group" }) as HTMLSelectElement).options).map((o) => o.textContent)).toEqual([
      "No group: one value",
      "by the unit each is attached to",
      "by the site each stands at",
      "by site",
      "by status",
      "by Flow",
    ]);
    type(f.getByRole("combobox", { name: "By group" }), "=site");
    type(f.getByPlaceholderText("ventilators_available"), "ventilators_available");

    fireEvent.click(f.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.createFunctionType).toHaveBeenCalledTimes(1));
    expect(api.createFunctionType).toHaveBeenCalledWith("mtl", {
      label: "Ventilators available by site",
      description: "The ventilators that are free, at each site.",
      inputs: [{ name: "site", kind: "text", required: false, says: "The site's name.", min: null, max: null, choices: [] }],
      block: "aggregate",
      config: {
        type: "Ventilator",
        where: [
          { property: "status", equals: { value: "available" } },
          { property: "site", equals: { input: "site" } },
        ],
        agg: "count",
        property: null,
        groupBy: { value: "site" },
        as: "ventilators_available",
      },
      active: true,
    });
    await waitFor(() => expect(screen.queryByRole("form", { name: "New tool" })).toBeNull());
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("keeps the form open and shows the server's sentence when it refuses", async () => {
    await page(list([BY_SITE]));
    api.saveFunctionType.mockRejectedValue(new ApiError(400, "BAD_REQUEST", "The filter on “ward” names a property the type Ventilator does not declare."));
    fireEvent.click(within(card("Ventilators available by site")).getByRole("button", { name: "Edit" }));
    const form = screen.getByRole("form", { name: "Ventilators available by site" });
    // A tool that exists keeps its block.
    expect((within(form).getByRole("combobox", { name: "Block" }) as HTMLSelectElement).disabled).toBe(true);
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("The filter on “ward” names a property the type Ventilator does not declare.");
    expect(api.saveFunctionType).toHaveBeenCalledWith("mtl", "ventilators_available_by_site", expect.objectContaining({ block: "aggregate", config: BY_SITE.config, active: true }));
    expect(screen.getByRole("form", { name: "Ventilators available by site" })).toBeTruthy();
  });

  it("offers the measures the twin keeps and the project's datasets, each for its block", async () => {
    await page();
    fireEvent.click(screen.getByRole("button", { name: "Declare a tool" }));
    const f = within(screen.getByRole("form", { name: "New tool" }));

    type(f.getByRole("combobox", { name: "Block" }), "history");
    expect(Array.from((f.getByRole("combobox", { name: "Measure" }) as HTMLSelectElement).options).map((o) => o.textContent)).toEqual(["pick a measure…", "Occupancy"]);
    expect(f.getByText(/nothing is known before the history started\./)).toBeTruthy();

    type(f.getByRole("combobox", { name: "Block" }), "dataset");
    type(f.getByRole("combobox", { name: "Dataset" }), "surgeries");
    expect(f.getByRole("checkbox", { name: "period" })).toBeTruthy();
    expect(f.getByRole("checkbox", { name: "waiting" })).toBeTruthy();

    type(f.getByRole("combobox", { name: "Block" }), "formula");
    expect(f.getByText(/A value that is missing\s+stops the formula: nothing stands in for it\./)).toBeTruthy();
  });
});

describe("trying a declared tool", () => {
  it("runs it once with what a person gives, and shows what the analyst would read", async () => {
    await page(list([KEPT]));
    api.tryFunctionType.mockResolvedValue({ ok: true, result: { unit: "CHUM", readings: 3, last: 137 }, ms: 42 });
    fireEvent.click(within(card("Occupancy kept at a unit")).getByRole("button", { name: "Try" }));
    const trial = screen.getByRole("form", { name: "Try Occupancy kept at a unit" });
    expect(within(trial).getByText("No model is called, and nothing is kept.")).toBeTruthy();
    type(within(trial).getByLabelText("unit"), "CHUM");
    type(within(trial).getByLabelText("hours"), "48");
    fireEvent.click(within(trial).getByRole("button", { name: "Run it once" }));

    await within(trial).findByText("What the analyst would read · 42 ms");
    // A number goes as a number: the tool's own bounds are the server's to hold.
    expect(api.tryFunctionType).toHaveBeenCalledWith("mtl", "occupancy_kept", { unit: "CHUM", hours: 48 });
    expect(trial.querySelector("pre")!.textContent).toBe(JSON.stringify({ unit: "CHUM", readings: 3, last: 137 }, null, 2));
  });

  it("shows a refusal in the words the analyst would be told", async () => {
    await page(list([KEPT]));
    api.tryFunctionType.mockResolvedValue({ ok: false, refused: "hours has to be at most 72.", ms: 1 });
    fireEvent.click(within(card("Occupancy kept at a unit")).getByRole("button", { name: "Try" }));
    const trial = screen.getByRole("form", { name: "Try Occupancy kept at a unit" });
    fireEvent.click(within(trial).getByRole("button", { name: "Run it once" }));
    expect((await within(trial).findByRole("status")).textContent).toBe("Refused, as the analyst would be told: hours has to be at most 72.");
    expect(api.tryFunctionType).toHaveBeenCalledWith("mtl", "occupancy_kept", {});
  });
});
