import { describe, expect, it } from "vitest";

import { csvFilename, escapeField, toCsv, type Dataset } from "./csv";

function dataset(over: Partial<Dataset> = {}): Dataset {
  return {
    name: "steps",
    label: "One row per step",
    description: "",
    columns: ["policy", "step", "deaths"],
    rows: [
      ["null", 0, 1.5],
      ["load-balance", 1, 0],
    ],
    ...over,
  };
}

describe("escapeField", () => {
  it("quotes a field containing a comma", () => {
    expect(escapeField("Urgence, aile est")).toBe('"Urgence, aile est"');
  });

  it("doubles quotes inside a quoted field", () => {
    expect(escapeField('the ward called "north"')).toBe('"the ward called ""north"""');
  });

  it("quotes a field containing a newline", () => {
    // `because` strings are assembled from user-named facilities and can carry
    // anything a person typed into the ontology.
    expect(escapeField("line one\nline two")).toBe('"line one\nline two"');
  });

  it("neutralises a value a spreadsheet would execute", () => {
    // Not a CSV concern at all: Excel and Sheets run a cell beginning `=`, `+`,
    // `-` or `@` as a formula on open. A unit named `=cmd` is a spreadsheet
    // running something on a colleague's machine.
    expect(escapeField("=1+1")).toBe("'=1+1");
    expect(escapeField("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(escapeField("+33 1 40 00")).toBe("'+33 1 40 00");
  });

  it("leaves a negative number readable while still guarding it", () => {
    // A guarded negative is a small annoyance; an unguarded one is the same
    // formula hole. The guard wins, and the value is still legible.
    expect(escapeField(-5)).toBe("'-5");
  });

  it("writes an empty cell for a missing value", () => {
    expect(escapeField(null)).toBe("");
  });

  it("leaves ordinary values untouched", () => {
    expect(escapeField("load-balance")).toBe("load-balance");
    expect(escapeField(0)).toBe("0");
  });
});

describe("toCsv", () => {
  it("puts the header first and one line per row", () => {
    expect(toCsv(dataset()).split("\r\n")).toEqual([
      "policy,step,deaths",
      "null,0,1.5",
      "load-balance,1,0",
    ]);
  });

  it("uses CRLF, which is what the format says and what Excel expects", () => {
    expect(toCsv(dataset())).toContain("\r\n");
  });

  it("still emits the header when there are no rows", () => {
    // An empty file reads as a failed export; a header alone reads as "the run
    // produced none of this", which is the truth when no rule ever fired.
    expect(toCsv(dataset({ rows: [] }))).toBe("policy,step,deaths");
  });
});

describe("csvFilename", () => {
  const at = new Date("2026-08-17T12:00:00Z");

  it("carries the event and the table, not just a number", () => {
    expect(csvFilename("Contamination d'une aile", "steps", at)).toBe(
      "contamination-d-une-aile-steps-2026-08-17.csv",
    );
  });

  it("dates in ISO order so a folder sorts chronologically", () => {
    expect(csvFilename("x", "steps", at).endsWith("2026-08-17.csv")).toBe(true);
  });

  it("survives a name with nothing usable in it", () => {
    expect(csvFilename("!!!", "decisions", at)).toBe("event-decisions-2026-08-17.csv");
  });
});
