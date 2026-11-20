import assert from "node:assert/strict";
import { test } from "node:test";

import type Anthropic from "@anthropic-ai/sdk";

import { ANALYST_MODEL, converse, type AnalystModel, type LoopEvent } from "./analyst.js";
import { MAX_SEARCHES, eventSearch, eventsClosing, type EventsFinding, type EventsProposal } from "./analyst-events.js";
import { ToolError, type AnalystContext } from "./analyst-tools.js";
import { Ledger, STRUCK } from "./analyst-verify.js";

type Message = Anthropic.Beta.BetaMessage;
type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;
type Block = Anthropic.Beta.BetaContentBlock;

// --- a model that says what the test tells it to ---------------------------

let ids = 0;
const use = (name: string, input: unknown): Block => ({ type: "tool_use", id: `tu_${++ids}`, name, input }) as Block;
const search = (id: string, query: string): Block => ({ type: "server_tool_use", id, name: "web_search", input: { query } }) as Block;
const results = (id: string, pages: { url: string; title: string }[]): Block =>
  ({
    type: "web_search_tool_result",
    tool_use_id: id,
    content: pages.map((p) => ({ type: "web_search_result", url: p.url, title: p.title, page_age: null, encrypted_content: "enc" })),
  }) as Block;
const cited = (text: string, p: { url: string; title: string; text: string }): Block =>
  ({ type: "text", text, citations: [{ type: "web_search_result_location", url: p.url, title: p.title, cited_text: p.text, encrypted_index: "idx" }] }) as Block;
const reply = (content: Block[], stop: Message["stop_reason"], searches = 0): Message =>
  ({
    id: "msg",
    type: "message",
    role: "assistant",
    model: ANALYST_MODEL,
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20, server_tool_use: { web_search_requests: searches } },
  }) as unknown as Message;

function scripted(turns: Message[]): AnalystModel & { seen: Params[] } {
  const seen: Params[] = [];
  return {
    seen,
    async create(params) {
      seen.push(JSON.parse(JSON.stringify(params)) as Params);
      const next = turns.shift();
      if (!next) throw new Error("The script ran out: the loop asked for a turn the test did not expect.");
      return next;
    },
  };
}

/** What the loop sent last on its nth request, as text. */
function lastSent(m: { seen: Params[] }, request: number): string {
  const last = m.seen[request]!.messages.at(-1)!;
  if (typeof last.content === "string") return last.content;
  return (last.content as { content?: unknown }[]).map((b) => String(b.content ?? "")).join("\n");
}

// A context that can read nothing: every reader throws, so a test fails loudly
// if the search were ever handed the twin.
const sealed = (): AnalystContext => {
  const never = async (): Promise<never> => {
    throw new ToolError("The event finder must not read the twin.");
  };
  return { environment: "ile", scenario: null, run: null, known: new Ledger(), world: never, datasets: never, rows: never, events: never, live: never };
};

const DOMAINS = ["quebec.ca", "inspq.qc.ca"];
const REQUEST = "What measures were in force in Montréal between 2021-12-01 and 2022-02-28?";

const CURFEW = {
  url: "https://www.quebec.ca/nouvelles/couvre-feu",
  title: "Nouvelles mesures pour freiner la transmission",
  text: "Un couvre-feu sera en vigueur à compter du 31 décembre 2021, de 22 h à 5 h, partout au Québec.",
};
const SCHOOLS = {
  url: "https://www.quebec.ca/education/retour-en-classe",
  title: "Retour en classe",
  text: "Les élèves du primaire et du secondaire retourneront en classe le 17 janvier.",
};

const researched = (...passages: (typeof CURFEW)[]): Message =>
  reply(
    [
      search("srv_1", "mesures sanitaires Québec décembre 2021"),
      results("srv_1", passages.map((p) => ({ url: p.url, title: p.title }))),
      ...passages.map((p) => cited("According to the page, this happened.", p)),
    ],
    "end_turn",
    1,
  );

const curfew = (over: Record<string, unknown> = {}) => ({
  title: "Curfew across Québec",
  start_date: "2021-12-31",
  end_date: "",
  place: "Québec",
  door: "access",
  passages: ["s2"],
  quote: "Un couvre-feu sera en vigueur à compter du 31 décembre 2021",
  ...over,
});
const deliver = (candidates: unknown[], extra: Record<string, unknown> = {}): Block =>
  use("give_events", { candidates, not_found: [], limits: [], ...extra });

const run = (model: AnalystModel, events: LoopEvent<EventsProposal, EventsFinding>[] = []) =>
  converse(
    model,
    sealed(),
    eventsClosing({ request: REQUEST, domains: DOMAINS, today: "2026-11-17" }),
    (e) => events.push(e),
    [],
    undefined,
    eventSearch(DOMAINS),
  );

test("a search becomes candidates whose link, passage and dates come from what the search returned", async () => {
  const model = scripted([researched(CURFEW), reply([deliver([curfew()])], "tool_use")]);
  const events: LoopEvent<EventsProposal, EventsFinding>[] = [];
  const out = await run(model, events);

  assert.equal(out.status, "answered");
  assert.equal(out.verified, true);
  assert.deepEqual(out.answer, {
    request: REQUEST,
    sources: DOMAINS,
    searches: 1,
    candidates: [
      {
        id: "c1",
        title: "Curfew across Québec",
        startDate: "2021-12-31",
        endDate: null,
        datesRemoved: [],
        place: "Québec",
        door: "access",
        url: CURFEW.url,
        sourceTitle: CURFEW.title,
        quote: "Un couvre-feu sera en vigueur à compter du 31 décembre 2021",
        quoteReplaced: false,
        passages: [{ step: "s2", ...CURFEW }],
        evidence: "published",
      },
    ],
    notFound: [],
    limits: [],
  });
  // The search and the passage are steps, shown and journalled like any reading.
  assert.deepEqual(out.steps.map((s) => [s.id, s.tool, s.ok]), [
    ["s1", "web_search", true],
    ["s2", "web_passage", true],
  ]);
  assert.deepEqual(out.usage, {
    requests: 2,
    inputTokens: 200,
    outputTokens: 40,
    webSearches: 1,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    // The search ran inside the first request; the second only delivered.
    byRequest: [
      { input: 100, cacheWrite: 0, cacheRead: 0, output: 20, webSearches: 1 },
      { input: 100, cacheWrite: 0, cacheRead: 0, output: 20, webSearches: 0 },
    ],
  });
  assert.deepEqual(events.map((e) => e.type), ["status", "step", "step", "status", "status", "done"]);
  assert.equal((events[0] as { message: string }).message, "Searching the allowed sources");
});

test("the model is handed the search, the delivery and nothing that reads the organisation's data", async () => {
  const model = scripted([researched(CURFEW), reply([deliver([curfew()])], "tool_use")]);
  await run(model);
  const first = model.seen[0]!;
  assert.deepEqual(first.tools, [
    { type: "web_search_20260318", name: "web_search", allowed_callers: ["direct"], allowed_domains: DOMAINS, max_uses: MAX_SEARCHES },
    first.tools!.at(-1),
  ]);
  assert.equal((first.tools!.at(-1) as { name: string }).name, "give_events");
  // The opening names the sources and the request: no environment, no scenario, no figure of the twin.
  assert.equal(
    first.messages[0]!.content,
    `<context>\nToday is 2026-11-17.\nSources you may search: quebec.ca, inspq.qc.ca.\nSearches allowed: ${MAX_SEARCHES}.\n</context>\n\n<request>\n${REQUEST}\n</request>`,
  );
  assert.doesNotMatch(String(first.system), /describe_twin|find_sites|read_run/);
});

test("after its cited sentences, the delivery is asked for with the recorded passages and not the pages again", async () => {
  const model = scripted([researched(CURFEW, SCHOOLS), reply([deliver([curfew()])], "tool_use")]);
  await run(model);
  const second = model.seen[1]!;
  // A new conversation: the request, what was searched, and the passages with the ids to cite.
  assert.equal(second.messages.length, 1);
  assert.equal(second.messages[0]!.role, "user");
  const sent = lastSent(model, 1);
  assert.ok(sent.startsWith(`<context>\nToday is 2026-11-17.`), "the request and its sources open the new conversation");
  assert.match(sent, /<request>\nWhat measures were in force in Montréal/);
  assert.match(sent, /The searches for this request have been run, 1 of the 8 allowed[\s\S]*- "mesures sanitaires Québec décembre 2021": 2 pages returned/);
  assert.match(sent, /They are the only text a candidate may rest on:\ns2 \| https:\/\/www\.quebec\.ca\/nouvelles\/couvre-feu \| Nouvelles mesures pour freiner la transmission \| "Un couvre-feu/);
  assert.match(sent, /s3 \| https:\/\/www\.quebec\.ca\/education\/retour-en-classe/);
  assert.match(sent, /No further search is possible in this exchange\. Deliver now by calling give_events/);
  // The pages the search returned are the bulk of what was read. They are not sent, and not billed, a second time.
  assert.doesNotMatch(JSON.stringify(second.messages), /encrypted_content|encrypted_index|web_search_tool_result/);
  // And the cap on searches holds for the exchange: the search is no longer offered.
  assert.deepEqual((second.tools ?? []).map((t) => (t as { name: string }).name), ["give_events"]);
  // The instructions are the same: only the conversation is new.
  assert.equal(second.system, model.seen[0]!.system);
});

test("a draft sent back after the handoff carries the passages, still without the pages", async () => {
  const model = scripted([
    researched(CURFEW),
    reply([deliver([curfew({ start_date: "2021-12-30" })])], "tool_use"),
    reply([deliver([curfew()])], "tool_use"),
  ]);
  const out = await run(model);
  assert.equal(out.status, "answered");
  const third = model.seen[2]!;
  // The new conversation, the refused draft, and why: three messages, none of them a page.
  assert.deepEqual(third.messages.map((m) => m.role), ["user", "assistant", "user"]);
  assert.match(lastSent(model, 2), /start_date: "2021-12-30" is not stated[\s\S]*The recorded passages are:\ns2 \| /);
  assert.doesNotMatch(JSON.stringify(third.messages), /encrypted_content|web_search_tool_result/);
});

test("prose without a citation records no passage, and the model is told so", async () => {
  const model = scripted([
    reply([{ type: "text", text: "There was a curfew.", citations: null } as Block], "end_turn"),
    reply([deliver([], { not_found: ["No allowed source returned a curfew."] })], "tool_use"),
  ]);
  const out = await run(model);
  assert.match(lastSent(model, 1), /No passage was recorded/);
  // Nothing to hand over yet: the conversation goes on as it is, and the search is still offered.
  assert.equal(model.seen[1]!.messages.length, 3);
  assert.equal((model.seen[1]!.tools![0] as { name: string }).name, "web_search");
  assert.equal(out.status, "answered");
  assert.deepEqual(out.answer!.candidates, []);
  assert.deepEqual(out.answer!.notFound, ["No allowed source returned a curfew."]);
});

test("a candidate that cites something other than a recorded passage is refused, without costing a draft", async () => {
  const model = scripted([
    researched(CURFEW),
    reply([deliver([curfew({ passages: ["s1"] })])], "tool_use"),
    reply([deliver([curfew()])], "tool_use"),
  ]);
  const out = await run(model);
  // s1 is the search, not a passage: a list of results is not something to rest on.
  assert.match(lastSent(model, 2), /s1 is not a recorded passage[\s\S]*s2 \| https:\/\/www\.quebec\.ca\/nouvelles\/couvre-feu/);
  assert.equal(out.status, "answered");
  assert.equal(out.verified, true);
});

test("a date no passage states sends the draft back, then is left blank for the person to enter", async () => {
  const wrong = curfew({ start_date: "2021-12-30", end_date: "2022-01-17" });
  const model = scripted([
    researched(CURFEW),
    reply([deliver([wrong])], "tool_use"),
    reply([deliver([wrong])], "tool_use"),
    reply([deliver([wrong])], "tool_use"),
  ]);
  const out = await run(model);
  assert.match(lastSent(model, 2), /Candidate 1, start_date: "2021-12-30" is not stated in the passages it cites/);
  assert.match(lastSent(model, 2), /Candidate 1, end_date: "2022-01-17" is not stated/);

  assert.equal(out.status, "answered");
  assert.equal(out.verified, false);
  const c = out.answer!.candidates[0]!;
  assert.equal(c.startDate, null);
  assert.equal(c.endDate, null);
  assert.deepEqual(c.datesRemoved, ["start", "end"]);
  assert.deepEqual(out.struck.map((f) => [f.where, f.figures]), [
    ["start_date", ["2021-12-30"]],
    ["end_date", ["2022-01-17"]],
  ]);
});

test("a day and a month in the passage, with the year the person asked about, is a stated date", async () => {
  const schools = { title: "Schools reopen", start_date: "2022-01-17", end_date: "", place: "Québec", door: "access", passages: ["s2"], quote: "retourneront en classe le 17 janvier" };
  const model = scripted([researched(SCHOOLS), reply([deliver([schools])], "tool_use")]);
  const out = await run(model);
  assert.equal(out.verified, true);
  assert.equal(out.answer!.candidates[0]!.startDate, "2022-01-17");
});

test("a quotation that is not in the passage is replaced by the passage's own opening words", async () => {
  const loose = curfew({ quote: "A curfew is in force from 31 December 2021" });
  const model = scripted([
    researched(CURFEW),
    reply([deliver([loose])], "tool_use"),
    reply([deliver([loose])], "tool_use"),
    reply([deliver([loose])], "tool_use"),
  ]);
  const out = await run(model);
  assert.match(lastSent(model, 2), /Candidate 1, quote: "A curfew is in force from 31 December 2021" is not, word for word/);
  const c = out.answer!.candidates[0]!;
  assert.equal(c.quote, "Un couvre-feu sera en vigueur à compter du 31 décembre 2021, de 22 h…");
  assert.equal(c.quoteReplaced, true);
  assert.equal(out.verified, false);
});

test("a quotation of fifteen words or more is not a quotation", async () => {
  const long = curfew({ quote: CURFEW.text });
  const model = scripted([researched(CURFEW), reply([deliver([long])], "tool_use"), reply([deliver([curfew()])], "tool_use")]);
  const out = await run(model);
  assert.match(lastSent(model, 2), /in fewer than fifteen words/);
  assert.equal(out.verified, true);
});

test("a figure in a title that the passages do not hold is struck", async () => {
  const titled = curfew({ title: "Curfew from 10 p.m. for 3 weeks" });
  const model = scripted([
    researched(CURFEW),
    reply([deliver([titled])], "tool_use"),
    reply([deliver([titled])], "tool_use"),
    reply([deliver([titled])], "tool_use"),
  ]);
  const out = await run(model);
  assert.match(lastSent(model, 2), /Candidate 1, title: "10", "3" are not in the passages it cites/);
  assert.equal(out.answer!.candidates[0]!.title, `Curfew from ${STRUCK} p.m. for ${STRUCK} weeks`);
});

test("a candidate resting on a page outside the allowed sources is dropped", async () => {
  const outside = { url: "https://example.org/blog/curfew", title: "A blog", text: "A curfew began on December 31, 2021 across Québec." };
  const blog = { title: "Curfew", start_date: "2021-12-31", end_date: "", place: "Québec", door: "access", passages: ["s3"], quote: "A curfew began on December 31, 2021" };
  const delivery = () => reply([deliver([blog, curfew()])], "tool_use");
  const model = scripted([researched(CURFEW, outside), delivery(), delivery(), delivery()]);
  const out = await run(model);
  assert.match(lastSent(model, 2), /Candidate 1: its passage is from "https:\/\/example\.org\/blog\/curfew", which is outside the sources this project allows/);
  // Dropped, and the one that stands is numbered as the person sees it.
  assert.deepEqual(out.answer!.candidates.map((c) => [c.id, c.url]), [["c1", CURFEW.url]]);
  assert.deepEqual(out.struck.map((f) => f.where), ["source"]);
});

test("an end before its start is taken out", async () => {
  const both = { ...CURFEW, text: "Le couvre-feu, en vigueur depuis le 31 décembre 2021, sera levé le 17 janvier 2022." };
  const backwards = curfew({ start_date: "2022-01-17", end_date: "2021-12-31", quote: "sera levé le 17 janvier 2022" });
  const delivery = () => reply([deliver([backwards])], "tool_use");
  const model = scripted([researched(both), delivery(), delivery(), delivery()]);
  const out = await run(model);
  const c = out.answer!.candidates[0]!;
  assert.equal(c.startDate, "2022-01-17");
  assert.equal(c.endDate, null);
  assert.deepEqual(c.datesRemoved, ["end"]);
});

test("a search turn the API paused goes back as it is, with no word of ours added", async () => {
  const model = scripted([
    reply([search("srv_1", "couvre-feu Québec")], "pause_turn"),
    reply([results("srv_1", [{ url: CURFEW.url, title: CURFEW.title }]), cited("A curfew began.", CURFEW)], "end_turn", 1),
    reply([deliver([curfew()])], "tool_use"),
  ]);
  const out = await run(model);
  // The second request ends on the paused assistant turn: a user message there would end the turn.
  assert.equal(model.seen[1]!.messages.length, 2);
  assert.equal(model.seen[1]!.messages.at(-1)!.role, "assistant");
  assert.equal(out.status, "answered");
  // The search asked for in one response and answered in the next is one step.
  assert.deepEqual(out.steps.map((s) => [s.id, s.tool, (s.input as { query?: string }).query ?? null]), [
    ["s1", "web_search", "couvre-feu Québec"],
    ["s2", "web_passage", null],
  ]);
});

test("a delivery made in the same breath as a search waits for the search", async () => {
  const early = curfew({ passages: ["s2"] });
  const model = scripted([
    // The API hands back our call first and has not run the search yet.
    reply([search("srv_1", "couvre-feu Québec décembre 2021"), deliver([early])], "tool_use"),
    // The search runs on the next request; the model then writes what it found.
    reply([results("srv_1", [{ url: CURFEW.url, title: CURFEW.title }]), cited("A curfew began on 31 December 2021.", CURFEW)], "end_turn", 1),
    reply([deliver([curfew()])], "tool_use"),
  ]);
  const out = await run(model);
  assert.match(lastSent(model, 1), /give_events must be called on its own/);
  assert.equal(out.status, "answered");
  assert.equal(out.answer!.searches, 1);
  assert.equal(out.usage.webSearches, 1);
  // The delivery itself came after the handoff, in a conversation without the pages.
  assert.equal(model.seen[2]!.messages.length, 1);
});

test("a model that keeps writing prose delivers nothing, and nothing is made up", async () => {
  const model = scripted([researched(CURFEW), researched(SCHOOLS), reply([{ type: "text", text: "As I said.", citations: null } as Block], "end_turn")]);
  const out = await run(model);
  assert.equal(out.status, "incomplete");
  assert.equal(out.answer, null);
  assert.match(out.message!, /did not deliver its candidates/);
});
