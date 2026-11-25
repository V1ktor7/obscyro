import assert from "node:assert/strict";
import { test } from "node:test";

import type { DbClient } from "../lib/db.js";
import { toolCatalogue } from "./analyst-settings.js";
import { READ_TOOLS } from "./analyst-tools.js";
import { declaredTools, standingFrom } from "./function-reads.js";

/**
 * Where an object stands, for a declared tool that counts by unit or by site.
 *
 * The twin here: the CHUM contains an emergency department and an intensive
 * care unit; Notre-Dame is a hospital of its own with its emergency department.
 * The CHUM is housed in one building, Notre-Dame in another. Beds are attached
 * to the departments. What is under test is that a count by unit or by site
 * follows the same links the unit pages and the map follow, whichever way the
 * institution drew its arrows.
 */
const unit = (id: string, name: string, parentId: string | null = null) => ({ id, name, parentId });
const UNITS = [unit("chum", "CHUM"), unit("ed", "Emergency", "chum"), unit("icu", "Intensive care", "chum"), unit("nd", "Notre-Dame"), unit("ed-nd", "Emergency", "nd")];

/** A link that attaches without chaining, toward its target: "bed located_in ward". */
const attach = (fromInstanceId: string, toInstanceId: string) => ({ aggregates: "metrics" as const, aggregateToward: "target" as const, transitive: false, fromInstanceId, toInstanceId });
const PLACES = [
  { id: "p-sanguinet", name: "1051 Sanguinet" },
  { id: "p-sherbrooke", name: "1560 Sherbrooke" },
];
const LINKS = [
  attach("bed-1", "ed"),
  attach("bed-2", "icu"),
  attach("bed-3", "ed-nd"),
  // The hospitals are placed; their departments are not.
  attach("chum", "p-sanguinet"),
  attach("nd", "p-sherbrooke"),
];

test("an object stands at the unit it is attached to, named with the unit above", () => {
  const s = standingFrom(UNITS, LINKS, PLACES);
  assert.deepEqual(s.unitOf("bed-1"), { id: "ed", name: "Emergency", under: "CHUM" });
  assert.deepEqual(s.unitOf("bed-3"), { id: "ed-nd", name: "Emergency", under: "Notre-Dame" });
  // A unit stands at itself, and the top of a tree has nothing above it.
  assert.deepEqual(s.unitOf("chum"), { id: "chum", name: "CHUM", under: null });
  assert.equal(s.unitOf("bed-nowhere"), null);
  assert.equal(s.partial, false);
});

test("an object stands at the site of its unit, or of the nearest unit above that is placed", () => {
  const s = standingFrom(UNITS, LINKS, PLACES);
  assert.deepEqual(s.siteOf("bed-1"), { id: "p-sanguinet", name: "1051 Sanguinet" });
  assert.deepEqual(s.siteOf("bed-2"), { id: "p-sanguinet", name: "1051 Sanguinet" });
  assert.deepEqual(s.siteOf("bed-3"), { id: "p-sherbrooke", name: "1560 Sherbrooke" });
  assert.deepEqual(s.siteOf("icu"), { id: "p-sanguinet", name: "1051 Sanguinet" });
  // A department placed on its own stands there, not where its hospital is.
  const moved = standingFrom(UNITS, [...LINKS, attach("icu", "p-sherbrooke")], PLACES);
  assert.deepEqual(moved.siteOf("bed-2"), { id: "p-sherbrooke", name: "1560 Sherbrooke" });
  assert.deepEqual(moved.siteOf("bed-1"), { id: "p-sanguinet", name: "1051 Sanguinet" });
});

test("a site is its own site, and an object attached to nothing stands nowhere", () => {
  const s = standingFrom(UNITS, LINKS, PLACES);
  assert.deepEqual(s.siteOf("p-sanguinet"), { id: "p-sanguinet", name: "1051 Sanguinet" });
  assert.equal(s.siteOf("bed-nowhere"), null);
  // A unit no placement reaches is at no site: nothing is guessed from its name.
  const unplaced = standingFrom(UNITS, LINKS.filter((l) => l.fromInstanceId !== "nd"), PLACES);
  assert.equal(unplaced.siteOf("bed-3"), null);
});

test("the first attachment wins, in the order the links were read", () => {
  const s = standingFrom(UNITS, [attach("bed-1", "icu"), ...LINKS], PLACES);
  assert.equal(s.unitOf("bed-1")!.id, "icu");
});

test("the arrow can be drawn either way: what counts is which end receives", () => {
  // "ward holds bed", aggregating toward its source.
  const holds = (fromInstanceId: string, toInstanceId: string) => ({ aggregates: "metrics" as const, aggregateToward: "source" as const, transitive: false, fromInstanceId, toInstanceId });
  const s = standingFrom(UNITS, [holds("ed", "bed-1"), holds("p-sanguinet", "chum")], PLACES);
  assert.equal(s.unitOf("bed-1")!.id, "ed");
  assert.equal(s.siteOf("bed-1")!.id, "p-sanguinet");
});

test("a link that chains or carries nothing attaches nothing", () => {
  const s = standingFrom(
    UNITS,
    [
      { ...attach("bed-1", "ed"), transitive: true },
      { ...attach("bed-2", "icu"), aggregates: null },
    ],
    PLACES,
  );
  assert.equal(s.unitOf("bed-1"), null);
  assert.equal(s.unitOf("bed-2"), null);
});

test("when the ontology calls nothing physical, a site is the top of the unit's tree, as on the map", () => {
  const s = standingFrom(UNITS, LINKS, []);
  assert.deepEqual(s.siteOf("bed-1"), { id: "chum", name: "CHUM" });
  assert.deepEqual(s.siteOf("bed-3"), { id: "nd", name: "Notre-Dame" });
  assert.deepEqual(s.siteOf("chum"), { id: "chum", name: "CHUM" });
});

test("a cycle of units does not spin, and a ceiling reached is carried", () => {
  const looped = [unit("a", "A", "b"), unit("b", "B", "a")];
  const s = standingFrom(looped, [attach("bed-1", "a")], PLACES, true);
  assert.equal(s.siteOf("bed-1"), null);
  assert.equal(s.partial, true);
});

// --- what a project offers the analyst ------------------------------------------------

const PROJECT = { id: "p-1", organizationId: "o-1" };
const stored = (key: string, active: boolean) => ({
  key,
  label: key,
  description: "The ventilators that are free, at each site.",
  inputs: [],
  block: "aggregate",
  config: { type: "Ventilator", where: [], agg: "count", property: null, groupBy: { of: "site" }, as: "ventilators" },
  active,
});
const dbWith = (rows: unknown[]) => ({ query: async () => ({ rows, rowCount: rows.length }) }) as unknown as DbClient;

test("a project that declared no function type offers the analyst exactly the tools of the code", async () => {
  const { tools, types } = await declaredTools(dbWith([]), PROJECT);
  assert.deepEqual(tools, []);
  assert.deepEqual(types, []);
  // What Ask is handed, and what the list of tools shows, are what they were before function types existed.
  assert.deepEqual([...READ_TOOLS, ...tools], READ_TOOLS);
  assert.deepEqual(toolCatalogue(new Set(), types), toolCatalogue());
});

test("only the function types that are on are offered, and never under a name the code has taken", async () => {
  const { tools, types } = await declaredTools(dbWith([stored("ventilators_by_site", true), stored("beds_closed", false), stored("describe_twin", true)]), PROJECT);
  assert.deepEqual(tools.map((t) => t.name), ["ventilators_by_site"]);
  // The list keeps all three: the screen shows one that is off as off.
  assert.equal(types.length, 3);
});
