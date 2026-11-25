import assert from "node:assert/strict";
import { test } from "node:test";

import { listActions } from "./analyst-actions.js";
import { OPTION_TOOLS } from "./analyst-options.js";
import { offered, toolCatalogue } from "./analyst-settings.js";
import { READ_TOOLS } from "./analyst-tools.js";

test("every tool the analyst has is on the list, each with a sentence a person can read", () => {
  const lines = toolCatalogue();
  const expected = [...new Set([...READ_TOOLS, ...OPTION_TOOLS, listActions].map((t) => t.name)), "web_search"];
  assert.deepEqual(lines.map((l) => l.name), expected);
  for (const l of lines) {
    // A tool added to the code without its sentence would show under its raw name.
    assert.notEqual(l.reads, l.name, `${l.name} has no sentence`);
    assert.match(l.reads, /\.$/);
    assert.ok(l.where.length > 0, `${l.name} is offered nowhere`);
  }
});

test("each tool says what it does, where it comes from and what it is given", () => {
  const by = Object.fromEntries(toolCatalogue().map((l) => [l.name, l]));
  assert.equal(by.describe_twin!.does, "reads");
  assert.equal(by.calculate!.does, "computes");
  assert.equal(by.test_option!.does, "runs");
  assert.equal(by.web_search!.does, "searches");
  assert.ok(toolCatalogue().every((l) => l.origin === "code"));
  // What a tool is given is read from the schema the model is shown, not written twice.
  assert.deepEqual(by.get_site!.inputs.map((i) => [i.name, i.required]), Object.keys(READ_TOOLS.find((t) => t.name === "get_site")!.input_schema.properties).map((n) => [n, READ_TOOLS.find((t) => t.name === "get_site")!.input_schema.required.includes(n)]));
  assert.ok(by.get_site!.inputs.every((i) => i.says.length > 0 && i.kind.length > 0));
  assert.deepEqual(by.web_search!.inputs.map((i) => i.name), ["query"]);
  // Every tool falls under a heading the screen knows.
  const groups = new Set(["The twin", "The scenario and its run", "The network now", "Datasets", "The calendar", "Calculation", "Options", "The web"]);
  for (const l of toolCatalogue()) assert.ok(groups.has(l.group), `${l.name} is under "${l.group}"`);
});

test("the list says where each tool is offered", () => {
  const where = Object.fromEntries(toolCatalogue().map((l) => [l.name, l.where]));
  assert.deepEqual(where.describe_twin, ["ask", "options"]);
  assert.deepEqual(where.test_option, ["options"]);
  assert.deepEqual(where.list_actions, ["options"]);
  // The search has no tool that reads the twin, and the twin's tools have no search.
  assert.deepEqual(where.web_search, ["events", "investigate"]);
});

test("a project switches a tool off, and the analyst is then not offered it", () => {
  const off = new Set(["web_search", "list_events"]);
  const lines = toolCatalogue(off);
  assert.equal(lines.find((l) => l.name === "web_search")!.on, false);
  assert.equal(lines.find((l) => l.name === "list_events")!.on, false);
  assert.equal(lines.find((l) => l.name === "describe_twin")!.on, true);
  assert.ok(!offered(READ_TOOLS, off).some((t) => t.name === "list_events"));
  assert.equal(offered(READ_TOOLS, off).length, READ_TOOLS.length - 1);
  // Nothing switched off: everything is offered, as before.
  assert.deepEqual(offered(OPTION_TOOLS, new Set()), OPTION_TOOLS);
});

test("three tools cannot be switched off, and each says why", () => {
  const kept = toolCatalogue(new Set(["calculate", "test_option", "list_actions"])).filter((l) => !l.switchable);
  assert.deepEqual(kept.map((l) => l.name), ["calculate", "test_option", "list_actions"]);
  // A row that names one of them changes nothing.
  assert.ok(kept.every((l) => l.on && l.why));
  assert.match(kept.find((l) => l.name === "test_option")!.why!, /switch its action type off/);
  assert.ok(toolCatalogue().filter((l) => l.switchable).every((l) => l.why === null));
});
