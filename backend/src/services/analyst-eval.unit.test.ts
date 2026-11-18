import assert from "node:assert/strict";
import { test } from "node:test";

import { QUESTIONS, judge, report, type AnswerLike, type Expectation } from "./analyst-eval.js";
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
