import { describe, expect, it } from "vitest";

import { parseLines, stepLabel } from "./analyst-api";

describe("the analyst's stream", () => {
  it("yields whole lines and keeps the unfinished one for later", () => {
    const first = parseLines('{"type":"status","message":"Reading"}\n{"type":"pi');
    expect(first.events).toEqual([{ type: "status", message: "Reading" }]);
    expect(first.remainder).toBe('{"type":"pi');
    const second = parseLines(`${first.remainder}ng"}\n\n`);
    expect(second.events).toEqual([{ type: "ping" }]);
    expect(second.remainder).toBe("");
  });

  it("drops a line that is not JSON rather than stopping", () => {
    expect(parseLines('oops\n{"type":"ping"}\n').events).toEqual([{ type: "ping" }]);
  });
});

describe("a step in a planner's words", () => {
  const label = (tool: string, input: Record<string, unknown>, output: unknown = {}, ok = true) => stepLabel({ tool, input, output, ok });

  it("names what was read and in which world", () => {
    expect(label("describe_twin", { world: "reality" })).toBe("Overview of the twin, as it stands");
    expect(label("find_sites", { world: "scenario", activity: "lit", catchment: "West" })).toBe("Sites providing lit, serving West, with the scenario");
    expect(label("find_sites", { world: "reality" })).toBe("Sites of the network, as it stands");
    expect(label("get_site", { world: "reality", site: "Lakeshore" })).toBe("One site: Lakeshore, as it stands");
    expect(label("read_run", { part: "site", site: "Lakeshore" })).toBe("The run, day by day at Lakeshore");
    expect(label("read_run", { part: "summary" })).toBe("The run: summary of both runs");
    expect(label("read_series", { dataset: "INSPQ", value_column: "admissions" })).toBe("Series admissions of INSPQ");
  });

  it("shows a calculation with its result, and without one when it was refused", () => {
    const input = { label: "Share spared", expression: "round((7316 - 267) / 7316 * 100, 1)" };
    expect(label("calculate", input, { result: 96.4 })).toBe("Share spared: round((7316 - 267) / 7316 * 100, 1) = 96.4");
    expect(label("calculate", input, { error: "no" }, false)).toBe("Share spared: round((7316 - 267) / 7316 * 100, 1)");
  });

  it("falls back to the tool's name for one it does not know", () => {
    expect(label("something_new", {})).toBe("something_new");
  });
});
