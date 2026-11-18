import { Ledger, numbersIn } from "./analyst-verify.js";

/**
 * The analyst's reference questions, and how an answer is judged.
 *
 * The analyst is a language model, so "it worked when I tried it" is not a
 * test: the same question can be answered well on Monday and badly on Tuesday,
 * after a change to its instructions or to a tool's description. This is the
 * fixed set of questions it is held to, each with the facts a right answer has
 * to contain, so a change can be judged by replaying them rather than by eye.
 *
 * What is judged is deliberately narrow, because it has to be checkable by a
 * program: an answer was given; no figure had to be struck from it; the tools
 * the question needs were called; the figures known to be right are in it. It
 * does not judge whether the prose is good. That still takes a person, reading
 * the answers the script prints.
 *
 * The questions and their facts are about one twin (Montréal) and one scenario
 * ("Omicron · Montréal — calibrated on INSPQ"). They live in the code, next to
 * what they test, and change when the twin or the scenario does.
 *
 * Nothing here calls a model. `backend/scripts/analyst-eval.ts` does, by hand.
 */

export interface Expectation {
  id: string;
  question: string;
  /** What the person is looking at when they ask. */
  looking: "reality" | "scenario";
  /** The question is about the run on screen: skipped when no run is supplied. */
  needsRun?: boolean;
  /** How the exchange should end. "answered" unless said otherwise. */
  status?: "answered" | "incomplete" | "declined";
  /**
   * Tools that must have been called, and have returned something. `a|b` means
   * either: there is often more than one honest way to read the same fact.
   */
  tools?: string[];
  /** Figures a right answer contains, written as a person would write them. */
  figures?: string[];
  /** Words a right answer contains. Case and accents are ignored; `a|b` means either. */
  says?: string[];
}

/** As much of the analyst's result as the judging reads. */
export interface AnswerLike {
  status: string;
  verified: boolean;
  struck: { figures: string[] }[];
  steps: { tool: string; ok: boolean }[];
  answer: { paragraphs: { text: string; sources: string[] }[]; assumptions: string[]; limits: string[] } | null;
  message?: string | null;
}

const fold = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** What is wrong with an answer; empty when nothing is. */
export function judge(e: Expectation, r: AnswerLike): string[] {
  const failures: string[] = [];
  const wanted = e.status ?? "answered";
  if (r.status !== wanted) {
    failures.push(`ended "${r.status}" instead of "${wanted}"${r.message ? ` (${r.message})` : ""}`);
    // Nothing else can be read off an exchange that ended the wrong way.
    return failures;
  }

  for (const tool of e.tools ?? []) {
    const any = tool.split("|");
    if (!r.steps.some((s) => any.includes(s.tool) && s.ok)) failures.push(`did not read with ${any.join(" or ")}`);
  }
  if (wanted !== "answered" || !r.answer) return failures;

  const removed = r.struck.flatMap((s) => s.figures);
  if (!r.verified || removed.length) {
    failures.push(`${removed.length} figure(s) had to be removed: ${removed.join(", ") || "not listed"}`);
  }

  const text = [...r.answer.paragraphs.map((p) => p.text), ...r.answer.assumptions, ...r.answer.limits].join("\n");
  // The same reading of figures the verifier uses, so "about 7,300" stands for
  // 7,316 here exactly as it does there.
  const said = new Ledger();
  said.addText(text);
  for (const figure of e.figures ?? []) {
    const token = numbersIn(figure)[0];
    if (!token) {
      failures.push(`the expected figure "${figure}" is not a figure: fix the question set`);
      continue;
    }
    // Either way round: the answer may give the figure exactly, or round it
    // ("about 225,700" for 225,710), and it is the rounded one that carries
    // the tolerance.
    const wanted = new Ledger();
    wanted.addText(figure);
    if (!said.has(token) && !numbersIn(text).some((t) => wanted.has(t))) failures.push(`does not give ${figure}`);
  }
  const folded = fold(text);
  for (const words of e.says ?? []) {
    const any = words.split("|");
    if (!any.some((w) => folded.includes(fold(w)))) failures.push(`does not mention ${any.map((w) => `"${w}"`).join(" or ")}`);
  }
  // A paragraph with a figure and no source would have been struck; one with
  // neither is commentary. An answer made only of those read nothing.
  if (r.answer.paragraphs.every((p) => p.sources.length === 0) && (e.tools?.length ?? 0) > 0) {
    failures.push("no paragraph cites a step");
  }
  return failures;
}

/**
 * The reference set.
 *
 * Facts come from the Montréal twin and the calibrated Omicron scenario as they
 * stood when this was written (2026-11-17): the scenario's own recipe, and the
 * run the Result panel shows for it. A figure here that the twin no longer
 * holds is a question to fix, not an answer to blame.
 */
export const QUESTIONS: Expectation[] = [
  {
    id: "twin-overview",
    question: "What does this twin contain, and what is it missing for a simulation?",
    looking: "reality",
    tools: ["describe_twin"],
    says: ["catchment"],
  },
  {
    id: "least-provided",
    question: "Which catchment has the fewest acute beds per resident?",
    looking: "scenario",
    tools: ["compare_catchments"],
    says: ["1,000|1 000|thousand"],
  },
  {
    id: "lakeshore-beds",
    question: "How many acute beds does Lakeshore have, and how many residents does it serve?",
    looking: "reality",
    tools: ["get_site|find_sites|compare_catchments"],
    figures: ["234", "225,710"],
    says: ["Lakeshore"],
  },
  {
    id: "scenario-assumptions",
    question: "What does this scenario assume before anything happens?",
    looking: "scenario",
    tools: ["scenario_recipe"],
    figures: ["85 %", "83 %", "3.6"],
  },
  {
    id: "scenario-choices",
    question: "What capacity does this scenario add, where and from which day?",
    looking: "scenario",
    tools: ["scenario_recipe"],
    figures: ["60", "30", "15", "40", "10"],
    says: ["Lakeshore", "LaSalle", "Lachine", "Verdun", "Santa Cabrini"],
  },
  {
    id: "observed-series",
    question: "What observed series is this scenario compared with, and from which date?",
    looking: "scenario",
    tools: ["scenario_recipe"],
    // Written as a date or in words: the day and the year are there either way.
    figures: ["13", "2021"],
    says: ["INSPQ"],
  },
  {
    id: "no-run",
    question: "What did my choices change in the run?",
    looking: "scenario",
    // Asked with no run on screen: the right answer is that there is none.
    tools: [],
    says: ["run"],
  },
  {
    id: "run-summary",
    question: "What did my choices change?",
    looking: "scenario",
    needsRun: true,
    tools: ["read_run"],
    figures: ["94 %", "93 %", "7,316", "267"],
  },
  {
    id: "run-where",
    question: "Where does it break first, and why there?",
    looking: "scenario",
    needsRun: true,
    tools: ["read_run"],
  },
  {
    id: "run-sites",
    question: "How many sites have a queue, with and without my choices?",
    looking: "scenario",
    needsRun: true,
    tools: ["read_run"],
    figures: ["8", "34", "3"],
  },
  {
    id: "run-share",
    question: "What share of the waiting do the added beds spare?",
    looking: "scenario",
    needsRun: true,
    tools: ["read_run", "calculate"],
    figures: ["96 %"],
  },
  {
    id: "not-a-forecast",
    question: "Will Montréal's hospitals overflow next winter?",
    looking: "scenario",
    // Not something the tools can say. A right answer says so, and invents no figure.
    tools: [],
    says: ["forecast|predict|prévision|prédire"],
  },
];

export interface Outcome {
  id: string;
  /** Which of the repeated runs this is, from one. */
  attempt: number;
  skipped: string | null;
  failures: string[];
  seconds: number | null;
  tokens: number | null;
  steps: number | null;
}

/** The outcomes as a table a person reads in a terminal. */
export function report(outcomes: Outcome[]): string {
  const rows = outcomes.map((o) => [
    o.skipped ? "SKIP" : o.failures.length ? "FAIL" : "PASS",
    `${o.id}${o.attempt > 1 ? ` #${o.attempt}` : ""}`,
    o.seconds === null ? "" : `${o.seconds.toFixed(1)} s`,
    o.tokens === null ? "" : o.tokens.toLocaleString("en-CA"),
    o.steps === null ? "" : String(o.steps),
    o.skipped ?? o.failures.join("; "),
  ]);
  const head = ["", "question", "time", "tokens", "steps", "what is wrong"];
  const width = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (r: string[]) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(width[i]!))).join("  ").trimEnd();
  const ran = outcomes.filter((o) => !o.skipped);
  const passed = ran.filter((o) => o.failures.length === 0).length;
  const times = ran.map((o) => o.seconds).filter((s): s is number => s !== null).sort((a, b) => a - b);
  const median = times.length ? times[Math.floor((times.length - 1) / 2)]! : null;
  return [
    line(head),
    ...rows.map(line),
    "",
    `${passed} of ${ran.length} passed` +
      (outcomes.length > ran.length ? `, ${outcomes.length - ran.length} skipped` : "") +
      (median === null ? "" : `. Median time ${median.toFixed(1)} s.`),
  ].join("\n");
}
