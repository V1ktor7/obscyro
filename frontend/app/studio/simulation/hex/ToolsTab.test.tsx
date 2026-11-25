// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/auth";

import type { AnalystToolLine } from "../../analyst-api";

const api = vi.hoisted(() => ({ fetchAnalystTools: vi.fn() }));
vi.mock("../../analyst-api", async (orig) => ({ ...(await orig<typeof import("../../analyst-api")>()), ...api }));

import ToolsTab, { grouped } from "./ToolsTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const tool = (name: string, over: Partial<AnalystToolLine> = {}): AnalystToolLine => ({
  name,
  reads: `${name} reads something.`,
  group: "The twin",
  does: "reads",
  origin: "code",
  inputs: [],
  where: ["ask", "options"],
  switchable: true,
  why: null,
  on: true,
  ...over,
});
const TOOLS = [
  tool("describe_twin"),
  tool("get_site", { inputs: [{ name: "site", kind: "text", required: true, says: "The site's id or name." }, { name: "world", kind: "one of reality, scenario", required: false, says: "Which twin to read." }] }),
  tool("calculate", { group: "Calculation", does: "computes", switchable: false, why: "A figure the analyst derives has to be computed by a tool." }),
  tool("test_option", { group: "Options", does: "runs", where: ["options"] }),
  tool("web_search", { group: "The web", does: "searches", where: ["events", "investigate"], on: false }),
  tool("ventilators_by_site", { reads: "Ventilators available at each site.", origin: "project" }),
];

async function tab(props: Partial<Parameters<typeof ToolsTab>[0]> = {}, tools = TOOLS) {
  api.fetchAnalystTools.mockResolvedValue({ tools });
  render(<ToolsTab env="mtl" {...props} />);
  await screen.findByText("describe_twin");
}

describe("what the analyst can use", () => {
  it("groups the tools under what they read, in the order the server gives them", async () => {
    expect(grouped(TOOLS).map((g) => [g.group, g.tools.map((t) => t.name)])).toEqual([
      ["The twin", ["describe_twin", "get_site", "ventilators_by_site"]],
      ["Calculation", ["calculate"]],
      ["Options", ["test_option"]],
      ["The web", ["web_search"]],
    ]);
    await tab();
    expect(screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"))).toEqual(["The twin", "Calculation", "Options", "The web"]);
  });

  it("says how many there are, how many the project declared and how many it switched off", async () => {
    await tab();
    expect(screen.getByText(/These are its tools: 6 in all, 1 declared in this project, 1 switched off in this project\. A figure no tool returned is taken out of its answers\./)).toBeTruthy();
  });

  it("says what each tool does, and whether it is written in the code or declared here", async () => {
    await tab();
    expect(within(screen.getByRole("listitem", { name: "describe_twin" })).getByText("Reads")).toBeTruthy();
    expect(within(screen.getByRole("listitem", { name: "calculate" })).getByText("Computes")).toBeTruthy();
    expect(within(screen.getByRole("listitem", { name: "test_option" })).getByText("Runs the engine")).toBeTruthy();
    const declared = screen.getByRole("listitem", { name: "ventilators_by_site" });
    expect(within(declared).getByText("Declared here")).toBeTruthy();
    expect(within(declared).getByText("Ventilators available at each site.")).toBeTruthy();
    expect(within(screen.getByRole("listitem", { name: "describe_twin" })).queryByText("Declared here")).toBeNull();
  });

  it("shows a tool the project switched off as switched off, not as missing", async () => {
    await tab();
    expect(within(screen.getByRole("listitem", { name: "web_search" })).getByText("Switched off")).toBeTruthy();
  });

  it("opens a tool on what it is given, and where it is offered", async () => {
    await tab();
    const site = screen.getByRole("listitem", { name: "get_site" });
    fireEvent.click(within(site).getByRole("button"));
    expect(within(site).getByText(/Offered in Ask, Options\. Written in the code, and tested there\./)).toBeTruthy();
    expect(within(site).getByText("site")).toBeTruthy();
    expect(within(site).getByText(/· text · required/)).toBeTruthy();
    expect(within(site).getByText("The site's id or name.")).toBeTruthy();
    expect(within(site).getByText(/· one of reality, scenario$/)).toBeTruthy();

    const twin = screen.getByRole("listitem", { name: "describe_twin" });
    fireEvent.click(within(twin).getByRole("button"));
    expect(within(twin).getByText("It is given nothing: it reads what is open.")).toBeTruthy();
    // One at a time: opening another folds the first.
    expect(within(site).queryByText("The site's id or name.")).toBeNull();

    const calc = screen.getByRole("listitem", { name: "calculate" });
    fireEvent.click(within(calc).getByRole("button"));
    expect(within(calc).getByText(/Always on\. A figure the analyst derives has to be computed by a tool\./)).toBeTruthy();
  });

  it("says which tools are used elsewhere than in the panel it sits in", async () => {
    await tab({ offeredIn: ["ask", "investigate"] });
    expect(within(screen.getByRole("listitem", { name: "test_option" })).getByText("Not offered in this panel: it is used in Options.")).toBeTruthy();
    expect(within(screen.getByRole("listitem", { name: "web_search" })).queryByText(/Not offered in this panel/)).toBeNull();
  });

  it("says what the analyst never does, and where a tool is switched off", async () => {
    await tab();
    expect(screen.getByText(/It writes nothing: an option, an event or a decision exists when a person clicks\./)).toBeTruthy();
    expect(screen.getByText(/It reads counts and capacities, never anything about a person\./)).toBeTruthy();
    expect(screen.getByText(/A tool is switched off for this project under Ontology, Action types\./)).toBeTruthy();
  });

  it("says so when the list cannot be read", async () => {
    api.fetchAnalystTools.mockRejectedValue(new ApiError(404, "ENV_NOT_FOUND", "That environment was not found."));
    render(<ToolsTab env="mtl" />);
    expect((await screen.findByRole("alert")).textContent).toBe("That environment was not found.");
  });
});
