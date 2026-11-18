import assert from "node:assert/strict";
import { test } from "node:test";

import type Anthropic from "@anthropic-ai/sdk";

import { Ledger, numbersIn } from "./analyst-verify.js";
import { WebReader, bareQuote, dateStated, excerpt, passageLedger, quotedFrom, statedDates, webSearchTool, wordsIn, type WebPassage } from "./analyst-web.js";

type Block = Anthropic.Beta.BetaContentBlock;

const search = (id: string, query: string): Block => ({ type: "server_tool_use", id, name: "web_search", input: { query } }) as Block;
const results = (id: string, pages: { url: string; title: string }[]): Block =>
  ({
    type: "web_search_tool_result",
    tool_use_id: id,
    content: pages.map((p) => ({ type: "web_search_result", url: p.url, title: p.title, page_age: null, encrypted_content: "enc" })),
  }) as Block;
const failed = (id: string, code: string): Block =>
  ({ type: "web_search_tool_result", tool_use_id: id, content: { type: "web_search_tool_result_error", error_code: code } }) as Block;
const cited = (text: string, url: string, title: string, citedText: string): Block =>
  ({ type: "text", text, citations: [{ type: "web_search_result_location", url, title, cited_text: citedText, encrypted_index: "idx" }] }) as Block;

const CURFEW: WebPassage = {
  url: "https://www.quebec.ca/nouvelles/couvre-feu",
  title: "Nouvelles mesures pour freiner la transmission",
  cited_text: "Un couvre-feu sera en vigueur à compter du 31 décembre 2021, de 22 h à 5 h, partout au Québec.",
};

test("the search is restricted to the project's sources, capped, and called directly", () => {
  assert.deepEqual(webSearchTool({ domains: ["quebec.ca", "inspq.qc.ca"], maxUses: 8 }), {
    type: "web_search_20260318",
    name: "web_search",
    // Not from the API's code sandbox: every query is then a step, and the cap holds for the whole exchange.
    allowed_callers: ["direct"],
    allowed_domains: ["quebec.ca", "inspq.qc.ca"],
    max_uses: 8,
  });
});

test("a search, the pages it returned and the passage a sentence was cited to become steps", () => {
  const reader = new WebReader();
  const steps = reader.read([
    search("srv_1", "couvre-feu Québec décembre 2021"),
    results("srv_1", [{ url: CURFEW.url, title: CURFEW.title }]),
    cited("A curfew began on 31 December 2021.", CURFEW.url, CURFEW.title, CURFEW.cited_text),
  ]);
  assert.deepEqual(steps, [
    {
      tool: "web_search",
      input: { query: "couvre-feu Québec décembre 2021" },
      ok: true,
      // The page's content stays encrypted: only its address and its title are ours to keep.
      output: { results: [{ url: CURFEW.url, title: CURFEW.title, page_age: null }] },
    },
    { tool: "web_passage", input: { url: CURFEW.url }, ok: true, output: CURFEW },
  ]);
  assert.equal(reader.waiting, 0);
});

test("a search deferred behind one of our own calls is paired with its results on the next response", () => {
  const reader = new WebReader();
  assert.deepEqual(reader.read([search("srv_1", "écoles Québec janvier 2022")]), []);
  assert.equal(reader.waiting, 1);
  const later = reader.read([results("srv_1", [])]);
  // A search that matched nothing is an empty list, not a failure.
  assert.deepEqual(later, [{ tool: "web_search", input: { query: "écoles Québec janvier 2022" }, ok: true, output: { results: [] } }]);
  assert.equal(reader.waiting, 0);
});

test("a search the service refused is a refused step that says why", () => {
  const [step] = new WebReader().read([search("srv_1", "x"), failed("srv_1", "max_uses_exceeded")]);
  assert.equal(step!.ok, false);
  assert.match((step!.output as { error: string }).error, /used up\. \(max_uses_exceeded\)/);
});

test("the same passage cited twice is recorded once", () => {
  const reader = new WebReader();
  const first = reader.read([cited("One.", CURFEW.url, CURFEW.title, CURFEW.cited_text)]);
  const again = reader.read([cited("Two.", CURFEW.url, CURFEW.title, CURFEW.cited_text), { type: "text", text: "No citation.", citations: null } as Block]);
  assert.equal(first.length, 1);
  assert.deepEqual(again, []);
});

test("dates are read as a page writes them, in French and in English", () => {
  assert.deepEqual(statedDates("à compter du 31 décembre 2021, de 22 h à 5 h"), [{ day: 31, month: 12, year: 2021 }]);
  assert.deepEqual(statedDates("Les écoles rouvriront le 17 janvier."), [{ day: 17, month: 1, year: null }]);
  assert.deepEqual(statedDates("le 1er février 2022"), [{ day: 1, month: 2, year: 2022 }]);
  assert.deepEqual(statedDates("On December 31, 2021, a curfew"), [{ day: 31, month: 12, year: 2021 }]);
  assert.deepEqual(statedDates("from 17 January 2022"), [{ day: 17, month: 1, year: 2022 }]);
  assert.deepEqual(statedDates("du 20 au 31 décembre 2021"), [
    { day: 20, month: 12, year: 2021 },
    { day: 31, month: 12, year: 2021 },
  ]);
  assert.deepEqual(statedDates("effective 2021-12-31"), [{ day: 31, month: 12, year: 2021 }]);
});

test("a month without a day states no day", () => {
  assert.deepEqual(statedDates("Les écoles ont rouvert en janvier 2022."), []);
  assert.deepEqual(statedDates("En mars 2022, les mesures ont été levées."), []);
  // "mardi" is not March, "maintenant" is not May.
  assert.deepEqual(statedDates("mardi 4 personnes, maintenant 12"), []);
});

test("a date counts only when a passage states its day and month, and its year is stated or asked about", () => {
  const asked = new Ledger();
  assert.equal(dateStated("2021-12-31", [CURFEW], asked), true);
  assert.equal(dateStated("2021-12-30", [CURFEW], asked), false);
  // The passage says 2021 beside that day: it does not support another year.
  assert.equal(dateStated("2022-12-31", [CURFEW], asked), false);

  const schools: WebPassage = { url: "https://www.quebec.ca/x", title: "", cited_text: "Les écoles rouvriront le 17 janvier." };
  assert.equal(dateStated("2022-01-17", [schools], asked), false);
  asked.addText("What measures were in force between 2021-12-01 and 2022-02-28?");
  assert.equal(dateStated("2022-01-17", [schools], asked), true);
  assert.equal(dateStated("2023-01-17", [schools], asked), false);
  assert.equal(dateStated("not a date", [schools], asked), false);
});

test("a passage's ledger holds its figures and its dates, not its address", () => {
  const ledger = passageLedger({ ...CURFEW, url: "https://www.quebec.ca/2019/07/14/page" });
  const has = (text: string) => numbersIn(text).every((t) => ledger.has(t));
  assert.equal(has("from 22 to 5"), true);
  assert.equal(has("2021-12-31"), true);
  assert.equal(has("2019"), false);
  assert.equal(has("14"), false);
});

test("a quotation is in a passage word for word, whatever the typography", () => {
  assert.equal(quotedFrom("Un couvre-feu sera en vigueur à compter du 31 décembre 2021", [CURFEW]), CURFEW);
  assert.equal(quotedFrom("« couvre-feu sera en vigueur à compter du 31 décembre 2021 »", [CURFEW]), CURFEW);
  assert.equal(quotedFrom("…partout au Québec.", [CURFEW]), CURFEW);
  // Close is not copied.
  assert.equal(quotedFrom("Un couvre-feu est en vigueur depuis le 31 décembre 2021", [CURFEW]), null);
  assert.equal(quotedFrom("", [CURFEW]), null);
  assert.equal(bareQuote(' "l’école" '), "l'école");
  assert.equal(wordsIn("de 22 h à 5 h"), 6);
});

test("a passage's opening words stand in for a quotation, cut short of fifteen words", () => {
  assert.equal(excerpt("Un couvre-feu partout."), "Un couvre-feu partout.");
  const long = excerpt(CURFEW.cited_text);
  assert.equal(long, "Un couvre-feu sera en vigueur à compter du 31 décembre 2021, de 22 h…");
  assert.equal(wordsIn(long), 14);
});
