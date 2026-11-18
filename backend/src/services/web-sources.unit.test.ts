import assert from "node:assert/strict";
import { test } from "node:test";

import { AppError } from "../lib/errors.js";
import { DEFAULT_WEB_SOURCES, MAX_WEB_SOURCES, normalizeSource, normalizeSources, sourceAllows } from "./web-sources.js";

const refused = (code: string) => (err: unknown) => err instanceof AppError && err.code === code;

test("the starting list is official health and government sources", () => {
  assert.deepEqual(DEFAULT_WEB_SOURCES, ["inspq.qc.ca", "quebec.ca", "msss.gouv.qc.ca", "donneesquebec.ca", "canada.ca", "who.int"]);
  // Every entry of the starting list is one the API accepts as written.
  assert.deepEqual(normalizeSources(DEFAULT_WEB_SOURCES), DEFAULT_WEB_SOURCES);
});

test("an entry is tidied to a bare domain, with its path if it has one", () => {
  assert.equal(normalizeSource("  https://www.Quebec.ca/  "), "www.quebec.ca");
  assert.equal(normalizeSource("quebec.ca/sante"), "quebec.ca/sante");
  assert.equal(normalizeSource("http://inspq.qc.ca/covid-19/donnees/"), "inspq.qc.ca/covid-19/donnees");
});

test("what is not a domain is refused, with the reason", () => {
  assert.throws(() => normalizeSource("*.quebec.ca"), refused("WEB_SOURCE_INVALID"));
  assert.throws(() => normalizeSource("quebec"), refused("WEB_SOURCE_INVALID"));
  assert.throws(() => normalizeSource("quebec.ca/a page"), refused("WEB_SOURCE_INVALID"));
  // A Cyrillic "а" makes another domain that reads the same.
  assert.throws(() => normalizeSource("cаnada.ca"), refused("WEB_SOURCE_INVALID"));
});

test("a list loses its blanks and its repeats, and has a ceiling", () => {
  assert.deepEqual(normalizeSources(["quebec.ca", "", " quebec.ca ", "who.int"]), ["quebec.ca", "who.int"]);
  assert.deepEqual(normalizeSources([]), []);
  const many = Array.from({ length: MAX_WEB_SOURCES + 1 }, (_, i) => `site${i}.example.org`);
  assert.throws(() => normalizeSources(many), refused("WEB_SOURCES_TOO_MANY"));
});

test("a page is allowed when it is on a listed domain, one of its subdomains, or under a listed path", () => {
  const list = ["quebec.ca", "inspq.qc.ca/covid-19"];
  assert.equal(sourceAllows(list, "https://quebec.ca/nouvelles"), true);
  assert.equal(sourceAllows(list, "https://www.quebec.ca/nouvelles/actualites/detail/x"), true);
  assert.equal(sourceAllows(list, "https://www.inspq.qc.ca/covid-19/donnees"), true);
  assert.equal(sourceAllows(list, "https://www.inspq.qc.ca/covid-19"), true);
  // Under another path, on a look-alike domain, or not a web page at all.
  assert.equal(sourceAllows(list, "https://www.inspq.qc.ca/publications/123"), false);
  assert.equal(sourceAllows(list, "https://www.inspq.qc.ca/covid-1900"), false);
  assert.equal(sourceAllows(list, "https://notquebec.ca/nouvelles"), false);
  assert.equal(sourceAllows(list, "https://quebec.ca.example.org/"), false);
  assert.equal(sourceAllows(list, "javascript:alert(1)"), false);
  assert.equal(sourceAllows(list, "not a url"), false);
  assert.equal(sourceAllows([], "https://quebec.ca/"), false);
});
