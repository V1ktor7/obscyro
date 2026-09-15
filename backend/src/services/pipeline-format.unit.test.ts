import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyDerive, renderTemplate, templateParts, validate } from "./pipeline.js";

// ---------------------------------------------------------------------------
// What this buys: a reading whose age is knowable.
//
// The RSQA publishes the date in one column and the hour in another — "2026-09-14"
// and 9. Nothing in the ontology can carry that as an observation stamp, because
// the parser wants two digits and no node could turn 9 into "09". So eight air
// quality stations reported "Reading age: unknown", and a reading taken nine
// hours ago was painted exactly like one taken ten minutes ago.
//
// The strictness below is the point. A template composes ONE value out of parts,
// and a part that is missing does not make a shorter value — it makes no value.
// Padding an absent hour would write "00" and publish a midnight reading that
// nobody took.
// ---------------------------------------------------------------------------

describe("reading a template", () => {
  const ok = (t: string) => {
    const r = templateParts(t);
    assert.ok(r.ok, `expected "${t}" to parse: ${r.ok ? "" : r.message}`);
    return r.parts;
  };

  it("reads a column into its place", () => {
    assert.equal(renderTemplate(ok("{a}"), { a: "x" }), "x");
  });

  it("keeps the text around the columns", () => {
    assert.equal(renderTemplate(ok("{date}T{heure}:00"), { date: "2026-09-14", heure: 9 }), "2026-09-14T9:00");
  });

  it("pads to a width, which is the whole reason this exists", () => {
    assert.equal(
      renderTemplate(ok("{date}T{heure:02}:00"), { date: "2026-09-14", heure: 9 }),
      "2026-09-14T09:00",
    );
  });

  it("leaves a value already wide enough alone", () => {
    assert.equal(renderTemplate(ok("{heure:02}"), { heure: 14 }), "14");
    assert.equal(renderTemplate(ok("{heure:02}"), { heure: 123 }), "123");
  });

  it("pads a real zero, because midnight is an hour", () => {
    assert.equal(renderTemplate(ok("{heure:02}"), { heure: 0 }), "00");
  });

  it("writes nothing at all when a part is missing", () => {
    // The trap: padding "" to width 2 gives "00" and invents a midnight
    // reading. A composed value with a hole in it is not a shorter value.
    assert.equal(renderTemplate(ok("{date}T{heure:02}:00"), { date: "2026-09-14", heure: null }), null);
    assert.equal(renderTemplate(ok("{date}T{heure:02}:00"), { date: "2026-09-14" }), null);
    assert.equal(renderTemplate(ok("{date}T{heure:02}:00"), { date: "", heure: 9 }), null);
    assert.equal(renderTemplate(ok("{date}T{heure:02}:00"), { date: "  ", heure: 9 }), null);
  });

  it("writes a literal brace for a doubled one", () => {
    assert.equal(renderTemplate(ok("{{{a}}}"), { a: "x" }), "{x}");
    assert.equal(renderTemplate(ok("{{}}"), {}), "{}");
  });

  it("refuses a brace that closes nothing", () => {
    assert.equal(templateParts("a } b").ok, false);
  });

  it("refuses a brace that is never closed", () => {
    assert.equal(templateParts("{date").ok, false);
  });

  it("refuses an empty placeholder", () => {
    assert.equal(templateParts("{}").ok, false);
  });

  it("refuses a width spec it does not understand", () => {
    // Silently ignoring it would produce "2026-09-14T9:00", which the stamp
    // parser rejects — and the failure would surface as "reading age unknown"
    // with nothing pointing back here.
    assert.equal(templateParts("{heure:2}").ok, false);
    assert.equal(templateParts("{heure:x}").ok, false);
    assert.equal(templateParts("{heure:0}").ok, false);
  });
});

describe("the format derivation", () => {
  it("writes the composed column onto every row", () => {
    const rows = applyDerive(
      [
        { date: "2026-09-14", heure: 9 },
        { date: "2026-09-14", heure: 23 },
      ],
      { as: "releve_a", op: "format", template: "{date}T{heure:02}:00" },
    );
    assert.deepEqual(rows.map((r) => r.releve_a), ["2026-09-14T09:00", "2026-09-14T23:00"]);
  });

  it("leaves the column null on a row that cannot fill it", () => {
    const rows = applyDerive(
      [{ date: "2026-09-14", heure: 9 }, { date: "2026-09-14", heure: null }],
      { as: "releve_a", op: "format", template: "{date}T{heure:02}:00" },
    );
    assert.deepEqual(rows.map((r) => r.releve_a), ["2026-09-14T09:00", null]);
  });

  it("writes null rather than a wrong string when the template is broken", () => {
    const rows = applyDerive([{ a: 1 }], { as: "x", op: "format", template: "{a" });
    assert.equal(rows[0].x, null);
  });
});

describe("a broken template is refused before it runs", () => {
  const wire = (config: Record<string, unknown>) => ({
    nodes: [
      { id: "in", kind: "dataset_input" as const, name: "in", x: 0, y: 0, config: { datasetId: "d" } },
      { id: "f", kind: "derive" as const, name: "format", x: 1, y: 0, config },
    ],
    edges: [{ from: "in", to: "f" }],
  });

  it("flags a format with no template", () => {
    const issues = validate(wire({ as: "x", op: "format" }));
    assert.ok(issues.some((i) => i.nodeId === "f" && /template/i.test(i.message)));
  });

  it("flags a template that names no column", () => {
    // That is a constant written the long way, and it would quietly fill a
    // column with the same string on every row.
    const issues = validate(wire({ as: "x", op: "format", template: "hello" }));
    assert.ok(issues.some((i) => i.nodeId === "f"));
  });

  it("flags a malformed placeholder, naming what is wrong", () => {
    const issues = validate(wire({ as: "x", op: "format", template: "{date}T{heure:2}:00" }));
    assert.ok(
      issues.some((i) => i.nodeId === "f" && /heure:2/.test(i.message)),
      "the message quotes the spec it could not read",
    );
  });

  it("accepts the template this was written for", () => {
    assert.deepEqual(
      validate(wire({ as: "releve_a", op: "format", template: "{date}T{heure:02}:00" })).filter(
        (i) => i.nodeId === "f",
      ),
      [],
    );
  });

  it("still wants an output column", () => {
    const issues = validate(wire({ op: "format", template: "{a}" }));
    assert.ok(issues.some((i) => i.nodeId === "f" && /name/i.test(i.message)));
  });
});
