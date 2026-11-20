import assert from "node:assert/strict";
import { test } from "node:test";

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { ANALYST_MODEL, ask, echo, type AnalystEvent, type AnalystModel } from "./analyst.js";
import { READ_TOOLS, ToolError, type AnalystContext, type AnalystTool } from "./analyst-tools.js";
import { Ledger, STRUCK } from "./analyst-verify.js";

type Message = Anthropic.Beta.BetaMessage;
type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;
type Block = Anthropic.Beta.BetaContentBlock;

// --- a model that says what the test tells it to ---------------------------

let ids = 0;
const use = (name: string, input: unknown): Block => ({ type: "tool_use", id: `tu_${++ids}`, name, input }) as Block;
const say = (text: string): Block => ({ type: "text", text, citations: null }) as Block;
const reply = (content: Block[], stop: Message["stop_reason"] = "tool_use", model = ANALYST_MODEL): Message =>
  ({
    id: "msg",
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 },
  }) as unknown as Message;

function scripted(turns: Message[]): AnalystModel & { seen: Params[] } {
  const seen: Params[] = [];
  return {
    seen,
    async create(params) {
      // The loop appends to one array; keep what was sent at the time.
      seen.push(JSON.parse(JSON.stringify(params)) as Params);
      const next = turns.shift();
      if (!next) throw new Error("The script ran out: the loop asked for a turn the test did not expect.");
      return next;
    },
  };
}

/** The tool results the model was sent on its nth request, as text. */
function resultsOf(m: { seen: Params[] }, request: number): { text: string; error: boolean }[] {
  const last = m.seen[request]!.messages.at(-1)!;
  assert.equal(last.role, "user");
  return (last.content as Anthropic.Beta.BetaToolResultBlockParam[]).map((b) => ({ text: String(b.content), error: b.is_error === true }));
}

// --- a twin of one site ----------------------------------------------------

const lookup: AnalystTool = {
  name: "lookup",
  description: "Read the one site.",
  input_schema: { type: "object", properties: { what: { type: "string" } }, required: ["what"], additionalProperties: false },
  parse: z.object({ what: z.string() }),
  async run(_ctx, input: { what: string }) {
    if (input.what === "nothing") throw new ToolError("Nothing by that name.");
    if (input.what === "broken") throw new Error("database is down");
    return { site: "Lakeshore", units: 234, residents: 225710, waiting_before: 7316, waiting_after: 267 };
  },
};
const TOOLS = [lookup, READ_TOOLS.find((t) => t.name === "calculate")!];

const ctx = (): AnalystContext => ({
  environment: "ile",
  scenario: null,
  run: null,
  known: new Ledger(),
  world: async () => {
    throw new ToolError("not used");
  },
  datasets: async () => [],
  rows: async () => [],
  events: async () => [],
  live: async () => {
    throw new ToolError("not used");
  },
});

const answer = (paragraphs: { text: string; sources: string[] }[], extra: Record<string, unknown> = {}) =>
  use("give_answer", { paragraphs, assumptions: [], limits: [], follow_ups: [], focus_sites: [], ...extra });

const Q = { question: "How many beds does Lakeshore have?", looking: "reality" as const };

test("an answer whose figures are in the steps it cites is delivered as verified", async () => {
  const model = scripted([
    reply([use("lookup", { what: "site" })]),
    reply([answer([{ text: "Lakeshore has 234 beds for about 225,700 residents.", sources: ["s1"] }], { follow_ups: ["a", "b", "c", "d"], focus_sites: ["u1"] })]),
  ]);
  const events: AnalystEvent[] = [];
  const out = await ask(model, ctx(), Q, (e) => events.push(e), TOOLS);

  assert.equal(out.status, "answered");
  assert.equal(out.verified, true);
  assert.deepEqual(out.struck, []);
  assert.equal(out.answer!.paragraphs[0]!.text, "Lakeshore has 234 beds for about 225,700 residents.");
  assert.deepEqual(out.answer!.followUps, ["a", "b", "c"]);
  assert.deepEqual(out.answer!.focusSites, ["u1"]);
  assert.deepEqual(out.steps.map((s) => [s.id, s.tool, s.ok]), [["s1", "lookup", true]]);
  // Every input token is counted, and the three prices it was billed at are kept apart,
  // request by request: that is what says whether a long exchange re-read its cache.
  assert.deepEqual(out.usage, {
    requests: 2,
    inputTokens: 300,
    outputTokens: 40,
    cacheWriteTokens: 0,
    cacheReadTokens: 100,
    byRequest: [
      { input: 100, cacheWrite: 0, cacheRead: 50, output: 20 },
      { input: 100, cacheWrite: 0, cacheRead: 50, output: 20 },
    ],
  });

  // What the model was told and asked: the question and its context, tools it
  // may choose from freely, a fallback for a safeguard that misfires.
  const first = model.seen[0]!;
  assert.equal(first.model, "claude-opus-5-5");
  assert.equal(first.fallbacks, "default");
  assert.deepEqual(first.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(first.tool_choice, undefined);
  assert.equal(first.thinking, undefined);
  assert.deepEqual(first.output_config, { effort: "medium" });
  assert.deepEqual((first.tools ?? []).map((t) => (t as { name: string }).name), ["lookup", "calculate", "give_answer"]);
  assert.match(String(first.messages[0]!.content), /No scenario is open[\s\S]*No run is on screen[\s\S]*<question>\nHow many beds does Lakeshore have\?/);
  // The result goes back with the id a paragraph has to cite.
  assert.match(resultsOf(model, 1)[0]!.text, /^\{"step":"s1","result":\{"site":"Lakeshore","units":234/);

  assert.deepEqual(events.map((e) => e.type), ["status", "step", "status", "status", "done"]);
});

test("a figure that is in no cited step sends the draft back, with the figure named", async () => {
  const model = scripted([
    reply([use("lookup", { what: "site" })]),
    reply([answer([{ text: "The added beds spare 96.4 % of the waiting.", sources: ["s1"] }])]),
    reply([use("calculate", { label: "share spared", expression: "round((7316 - 267) / 7316 * 100, 1)" })]),
    reply([answer([{ text: "The added beds spare 96.4 % of the waiting.", sources: ["s1", "s2"] }])]),
  ]);
  const out = await ask(model, ctx(), Q, undefined, TOOLS);

  const sentBack = resultsOf(model, 2)[0]!;
  assert.equal(sentBack.error, true);
  assert.match(sentBack.text, /Paragraph 1: "96.4 %" is not in the results of the steps it cites \(s1\) nor in the question/);
  assert.equal(out.status, "answered");
  assert.equal(out.verified, true);
  assert.deepEqual(out.steps.map((s) => s.tool), ["lookup", "calculate"]);
  assert.equal((out.steps[1]!.output as { result: number }).result, 96.4);
});

test("a figure that still cannot be traced is taken out of the answer, and listed", async () => {
  const wrong = () => reply([answer([{ text: "Lakeshore has 234 beds and 412 staff.", sources: ["s1"] }], { limits: ["Only 3 wards are modelled."] })]);
  const model = scripted([reply([use("lookup", { what: "site" })]), wrong(), wrong(), wrong()]);
  const out = await ask(model, ctx(), Q, undefined, TOOLS);

  assert.equal(out.status, "answered");
  assert.equal(out.verified, false);
  assert.equal(out.answer!.paragraphs[0]!.text, `Lakeshore has 234 beds and ${STRUCK} staff.`);
  assert.equal(out.answer!.limits[0], `Only ${STRUCK} wards are modelled.`);
  assert.deepEqual(out.struck, [
    { where: "paragraph", index: 0, figures: ["412"] },
    { where: "limit", index: 0, figures: ["3"] },
  ]);
  assert.equal(out.usage.requests, 4);
});

test("a figure beside the wrong name is sent back with whose it is", async () => {
  const rows: AnalystTool = {
    name: "rows",
    description: "Two sites.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    parse: z.object({}),
    async run() {
      return { sites: [{ name: "Hôpital de LaSalle", from_day: 18 }, { name: "Hôpital de Lachine", from_day: 19 }] };
    },
  };
  const model = scripted([
    reply([use("rows", {})]),
    reply([answer([{ text: "Lachine queues from day 18, LaSalle from day 19.", sources: ["s1"] }])]),
    reply([answer([{ text: "LaSalle queues from day 18, Lachine from day 19.", sources: ["s1"] }])]),
  ]);
  const out = await ask(model, ctx(), Q, undefined, [rows]);
  const back = resultsOf(model, 2)[0]!;
  assert.equal(back.error, true);
  assert.match(back.text, /"18" is written about Hôpital de Lachine, but in the steps cited that figure is in the row of Hôpital de LaSalle/);
  assert.equal(out.verified, true);
  assert.equal(out.answer!.paragraphs[0]!.text, "LaSalle queues from day 18, Lachine from day 19.");
});

test("a figure from the question itself needs no step", async () => {
  const model = scripted([reply([answer([{ text: "You asked about adding 60 beds; nothing was read about that yet.", sources: [] }])])]);
  const out = await ask(model, ctx(), { question: "What if we add 60 beds?", looking: "reality" }, undefined, TOOLS);
  assert.equal(out.verified, true);
});

test("a source that names no step is dropped, so its figures are not covered by it", async () => {
  const model = scripted([
    reply([use("lookup", { what: "site" })]),
    ...[1, 2, 3].map(() => reply([answer([{ text: "Lakeshore has 234 beds.", sources: ["s9"] }])])),
  ]);
  const out = await ask(model, ctx(), Q, undefined, TOOLS);
  assert.equal(out.verified, false);
  assert.deepEqual(out.answer!.paragraphs[0], { text: `Lakeshore has ${STRUCK} beds.`, sources: [] });
});

test("a tool's refusal is a step the model can read, and carries no citable figure", async () => {
  const model = scripted([
    reply([use("lookup", { what: "nothing" }), use("nope", {}), use("lookup", { wrong: 1 })]),
    reply([answer([{ text: "The twin has nothing by that name.", sources: ["s1"] }])]),
  ]);
  const out = await ask(model, ctx(), Q, undefined, TOOLS);
  assert.deepEqual(out.steps.map((s) => s.ok), [false, false, false]);
  assert.deepEqual(out.steps[0]!.output, { error: "Nothing by that name." });
  assert.match(String((out.steps[1]!.output as { error: string }).error), /no tool called "nope"/);
  assert.match(String((out.steps[2]!.output as { error: string }).error), /Invalid input: what/);
  assert.deepEqual(resultsOf(model, 1).map((r) => r.error), [true, true, true]);
  assert.equal(out.status, "answered");
});

test("a fault of ours is not dressed up as a tool's answer", async () => {
  const model = scripted([reply([use("lookup", { what: "broken" })])]);
  await assert.rejects(ask(model, ctx(), Q, undefined, TOOLS), /database is down/);
});

test("an answer sent together with a read is refused: it cannot cite what it has not seen", async () => {
  const model = scripted([
    reply([use("lookup", { what: "site" }), answer([{ text: "Lakeshore has 234 beds.", sources: ["s1"] }])]),
    reply([answer([{ text: "Lakeshore has 234 beds.", sources: ["s1"] }])]),
  ]);
  const out = await ask(model, ctx(), Q, undefined, TOOLS);
  const back = resultsOf(model, 1);
  assert.equal(back.length, 2);
  assert.match(back[1]!.text, /must be called on its own/);
  assert.equal(out.verified, true);
});

test("an answer in prose is asked for again in its proper form, once", async () => {
  const model = scripted([
    reply([say("Lakeshore has 234 beds.")], "end_turn"),
    reply([use("lookup", { what: "site" })]),
    reply([answer([{ text: "Lakeshore has 234 beds.", sources: ["s1"] }])]),
  ]);
  const out = await ask(model, ctx(), Q, undefined, TOOLS);
  assert.match(String(model.seen[1]!.messages.at(-1)!.content), /calling give_answer/);
  assert.equal(out.status, "answered");

  const stubborn = scripted([reply([say("234.")], "end_turn"), reply([say("234, as I said.")], "end_turn")]);
  const none = await ask(stubborn, ctx(), Q, undefined, TOOLS);
  assert.equal(none.status, "incomplete");
  assert.equal(none.answer, null);
});

test("a declined question gets no answer and no invention", async () => {
  const model = scripted([reply([], "refusal")]);
  const out = await ask(model, ctx(), Q, undefined, TOOLS);
  assert.equal(out.status, "declined");
  assert.equal(out.answer, null);
  assert.match(out.message!, /declined/);
});

test("the model that answered is the one reported, after a fallback", async () => {
  const model = scripted([reply([answer([{ text: "Nothing was read.", sources: [] }])], "tool_use", "claude-opus-4-8")]);
  const out = await ask(model, ctx(), Q, undefined, TOOLS);
  assert.equal(out.model, "claude-opus-4-8");
});

test("after a fallback, what the declining model thought and called is not sent back", () => {
  const thinking = { type: "thinking", thinking: "", signature: "x" } as Block;
  const fallback = { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-4-8" } } as unknown as Block;
  const before = use("lookup", { what: "site" });
  const after = use("lookup", { what: "site" });
  assert.deepEqual(echo([thinking, say("partial"), before, fallback, thinking, after]), [say("partial"), fallback, thinking, after]);
  const plain = [thinking, after];
  assert.equal(echo(plain), plain);
});

test("nothing more is asked of the model once nobody is waiting", async () => {
  const gone = new AbortController();
  const model = scripted([reply([use("lookup", { what: "site" })])]);
  const out = await ask(
    model,
    ctx(),
    Q,
    (e) => {
      // The person leaves as the first step lands.
      if (e.type === "step") gone.abort();
    },
    TOOLS,
    gone.signal,
  );
  assert.equal(out.status, "incomplete");
  assert.equal(out.usage.requests, 1);
  assert.match(out.message!, /Stopped/);
});

test("a loop that never answers stops, and says so", async () => {
  const model = scripted(Array.from({ length: 16 }, () => reply([use("lookup", { what: "site" })])));
  const out = await ask(model, ctx(), Q, undefined, TOOLS);
  assert.equal(out.status, "incomplete");
  assert.equal(out.steps.length, 16);
  assert.match(out.message!, /narrower question/);
});
