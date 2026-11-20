import assert from "node:assert/strict";
import { test } from "node:test";

import { QUESTIONS, judge, lastLine, report, runHeadline, type AnswerLike, type Expectation } from "./analyst-eval.js";
import { numbersIn } from "./analyst-verify.js";

const answer = (over: Partial<AnswerLike> = {}, text = "Lakeshore has 234 beds for about 225,700 residents."): AnswerLike => ({
  status: "answered",
  verified: true,
  struck: [],
  steps: [{ tool: "get_site", ok: true }],
  answer: { paragraphs: [{ text, sources: ["s1"] }], assumptions: [], limits: [] },
  ...over,
});

const lakeshore: Expectation = {
  id: "lakeshore",
  question: "How many beds?",
  looking: "reality",
  tools: ["get_site|find_sites"],
  figures: ["234", "225,710"],
  says: ["lakeshore"],
};

test("an answer with the tools, the figures and the words passes", () => {
  assert.deepEqual(judge(lakeshore, answer()), []);
});

test("a figure may be rounded the way the verifier allows, and not otherwise", () => {
  assert.deepEqual(judge(lakeshore, answer({}, "Lakeshore: 234 beds, 225,710 residents.")), []);
  assert.deepEqual(judge(lakeshore, answer({}, "Lakeshore has 243 beds for 225,710 residents.")), ["does not give 234"]);
});

test("either of two tools will do, but one of them has to have returned something", () => {
  assert.deepEqual(judge(lakeshore, answer({ steps: [{ tool: "find_sites", ok: true }] })), []);
  assert.deepEqual(judge(lakeshore, answer({ steps: [{ tool: "get_site", ok: false }] })), ["did not read with get_site or find_sites"]);
});

test("a figure struck from the answer fails it, and is named", () => {
  const r = answer({ verified: false, struck: [{ figures: ["412"] }] });
  assert.deepEqual(judge(lakeshore, r), ["1 figure(s) had to be removed: 412"]);
});

test("an exchange that ends the wrong way is judged on that alone", () => {
  const r = answer({ status: "incomplete", answer: null, message: "Stopped." });
  assert.deepEqual(judge(lakeshore, r), ['ended "incomplete" instead of "answered" (Stopped.)']);
  // And one that is supposed to end without an answer passes when it does.
  assert.deepEqual(judge({ ...lakeshore, status: "incomplete", tools: [], figures: [] }, r), []);
});

test("words are matched without case or accents, and either of two will do", () => {
  const e: Expectation = { id: "x", question: "?", looking: "reality", says: ["forecast|prévision", "montreal"] };
  assert.deepEqual(judge(e, answer({}, "Ce n'est pas une Prevision pour Montréal.")), []);
  assert.deepEqual(judge(e, answer({}, "It is a run.")), ['does not mention "forecast" or "prévision"', 'does not mention "montreal"']);
});

test("an answer that read something has to cite it somewhere", () => {
  const r = answer({ answer: { paragraphs: [{ text: "Lakeshore has 234 beds, 225,710 residents.", sources: [] }], assumptions: [], limits: [] } });
  assert.deepEqual(judge(lakeshore, r), ["no paragraph cites a step"]);
});

test("a name and its figure have to be in the same statement", () => {
  const e: Expectation = { id: "order", question: "?", looking: "scenario", pairs: [["LaSalle", "18"], ["Lachine", "19"]] };
  assert.deepEqual(judge(e, answer({}, "LaSalle queues from day 18, Lachine from day 19.")), []);
  // Both figures are there, each beside the other name: the swap the first real answer made.
  assert.deepEqual(judge(e, answer({}, "Lachine queues from day 18, LaSalle from day 19.")), [
    "does not give 18 for LaSalle",
    "does not give 19 for Lachine",
  ]);
});

test("the reference set is well formed", () => {
  const ids = QUESTIONS.map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length, "two questions share an id");
  assert.ok(QUESTIONS.length >= 12);
  assert.ok(QUESTIONS.some((q) => q.needsRun) && QUESTIONS.some((q) => !q.needsRun));
  for (const q of QUESTIONS) {
    assert.ok(q.question.length >= 3, q.id);
    // An expected figure that is not a figure would fail every answer.
    for (const f of q.figures ?? []) assert.equal(numbersIn(f).length, 1, `${q.id}: "${f}"`);
  }
});

test("the report counts what ran, and names what is wrong", () => {
  const out = report([
    { id: "a", attempt: 1, skipped: null, failures: [], seconds: 12.34, tokens: 9000, steps: 3 },
    { id: "a", attempt: 2, skipped: null, failures: ["does not give 234"], seconds: 20, tokens: 9500, steps: 4 },
    { id: "b", attempt: 1, skipped: "no run supplied", failures: [], seconds: null, tokens: null, steps: null },
  ]);
  assert.match(out, /PASS {2}a +12\.3 s +9,000 +3/);
  assert.match(out, /FAIL {2}a #2 +20\.0 s +9,500 +4 +does not give 234/);
  assert.match(out, /SKIP {2}b .*no run supplied/);
  assert.match(out, /1 of 2 passed, 1 skipped\. Median time 12\.3 s\./);
});

// --- the questions added after the first real replay --------------------------

const question = (id: string): Expectation => {
  const q = QUESTIONS.find((x) => x.id === id);
  assert.ok(q, `no question "${id}"`);
  return q;
};
const read = (tool: string, text: string) => answer({ steps: [{ tool, ok: true }] }, text);

test("three sites each keep their own figure, and a swap between two of them fails", () => {
  const q = question("three-sites");
  assert.deepEqual(judge(q, read("find_sites", "Hôpital général du Lakeshore has 234 acute beds. Hôpital de LaSalle has 110. Hôpital de Lachine has 56.")), []);
  // Every figure is there; two are beside the wrong hospital.
  assert.deepEqual(judge(q, read("find_sites", "Hôpital général du Lakeshore has 234 acute beds. Hôpital de LaSalle has 56. Hôpital de Lachine has 110.")), [
    "does not give 110 for LaSalle",
    "does not give 56 for Lachine",
  ]);
  assert.deepEqual(judge(q, read("describe_twin", "Lakeshore has 234 beds. LaSalle has 110. Lachine has 56.")), ["did not read with get_site or find_sites"]);
});

test("two catchments compared each keep their own rate", () => {
  const q = question("two-catchments");
  const good = "Dorval - Lachine - Lasalle has 1.15 acute beds per 1,000 residents. Pierrefonds - Lac Saint-Louis has 1.04, the lower of the two.";
  assert.deepEqual(judge(q, read("compare_catchments", good)), []);
  const swapped = "Dorval - Lachine - Lasalle has 1.04 acute beds per 1,000 residents. Pierrefonds - Lac Saint-Louis has 1.15.";
  assert.deepEqual(judge(q, read("compare_catchments", swapped)), ["does not give 1.04 for Pierrefonds", "does not give 1.15 for Dorval"]);
});

test("a question asked in French is answered in French, with figures written the French way", () => {
  const q = question("in-french");
  // A no-break space in the thousands, as French writes them.
  const fr = "L'Hôpital général du Lakeshore a 234 lits de soins aigus. Il dessert le RLS de Pierrefonds - Lac Saint-Louis, soit 225\u00a0710 résidents.";
  assert.deepEqual(judge(q, read("get_site", fr)), []);
  // The right facts in the wrong language.
  assert.deepEqual(judge(q, read("get_site", "Lakeshore has 234 acute beds and serves 225,710 residents.")), ['does not mention "lits"']);
});

test("the set now has the questions the first real replay showed were missing", () => {
  for (const id of ["three-sites", "two-catchments", "in-french"]) assert.ok(QUESTIONS.some((q) => q.id === id), id);
  // None of them needs a run: they are asked whether or not one was made.
  assert.equal(QUESTIONS.filter((q) => ["three-sites", "two-catchments", "in-french"].includes(q.id)).some((q) => q.needsRun), false);
});

// --- what the script reads from the API -----------------------------------------

test("a stream's last word is its done line, whatever came before", () => {
  const text = ['{"type":"status","message":"Reading the twin"}', '{"type":"ping"}', "", '{"type":"done","run":{"horizon":60}}', ""].join("\n");
  assert.deepEqual(lastLine<{ run: { horizon: number } }>(text), { done: { type: "done", run: { horizon: 60 } } as never, failed: null });
});

test("a stream that failed, or stopped short, says so instead of handing back nothing", () => {
  assert.deepEqual(lastLine('{"type":"status","message":"Reading the twin"}\n{"type":"failed","message":"The simulation service could not be reached."}\n'), {
    done: null,
    failed: "The simulation service could not be reached.",
  });
  assert.deepEqual(lastLine('{"type":"status","message":"Reading the twin"}\n{"type":"pi'), { done: null, failed: "the stream ended without an answer" });
  assert.deepEqual(lastLine(""), { done: null, failed: "the stream ended without an answer" });
});

test("a run is named in the Result panel's own figures, so a person can tell which run was asked about", () => {
  const side = (island: (number | null)[], sitesWithQueue: number, waitingDays: number) => ({ island, sitesWithQueue, sitesWithActivity: 34, waitingDays });
  assert.equal(
    runHeadline({ horizon: 60, activity: "litsantephysique", events: side([0.8, 0.941, null], 8, 7316.4), full: side([0.8, 0.93, 0.9], 3, 267.2) }),
    "60 days, litsantephysique. Events only: peak 94 %, 8 of 34 sites with a queue, 7,316 patient-days waiting. With the choices: peak 93 %, 3 of 34 sites with a queue, 267 patient-days waiting.",
  );
  assert.match(runHeadline({ horizon: 30, activity: "lit", events: side([null], 0, 0), full: side([], 0, 0) }), /Events only: no occupancy reported, 0 of 34/);
});
