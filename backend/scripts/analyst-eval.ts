/**
 * Replay the analyst's reference questions against a running API, with the real model.
 *
 *   npm run eval:analyst
 *
 * Run by hand, never by the test suite: it calls the Claude API through the
 * Obscyro API and costs what some thirty questions cost. It needs the analyst
 * to be switched on (ANTHROPIC_API_KEY on the API service).
 *
 * The key. The script acts as a person: it needs an Obscyro API key of a user
 * who can read the environment (the account's keys page, /app/keys, creates
 * one, and it can be revoked there afterwards). It is read
 * from OBSCYRO_API_KEY when that is set, and otherwise asked for at the
 * terminal, typed or pasted without being shown. It is never written to a
 * file, never printed, and never belongs in the repository or in a shell
 * history: prefer the prompt to `OBSCYRO_API_KEY=... npm run ...`.
 *
 * The run. Some questions are about "the run on screen". The script has no
 * screen, so it asks the server to run the reference scenario
 * (`POST /analyst/run`: the two passes a person's Run makes, summarised the way
 * the page summarises them) and sends that summary with those questions. It
 * takes about a minute before the first question.
 *
 * Options (environment or flags):
 *   OBSCYRO_API_URL        where the API is. Default: production.
 *   OBSCYRO_API_KEY        the key; asked for at the terminal when absent.
 *   OBSCYRO_ENV            the environment. Default: montreal-covid-19.
 *   OBSCYRO_SCENARIO       part of the scenario's name. Default: "calibrated on INSPQ".
 *   --horizon <days>       the days the run covers. Default: 60, as the page.
 *   --activity <name>      the activity the run reads. Default: litsantephysique.
 *   --run <file.json>      replay a recorded run instead of asking the server for one.
 *   --save-run <file.json> keep the run the server made, to replay it later with --run.
 *   --no-run               make no run: the questions about a run are skipped.
 *   --only <id,id>         only these questions.
 *   --times <n>            replay each question n times. Default 2: a set that
 *                          passes once has not shown it passes.
 *   --show                 print each answer, to be read by a person.
 *
 * Exits 1 when anything fails, so it can gate a change to the analyst's
 * instructions or to a tool's description.
 */

import { readFile, writeFile } from "node:fs/promises";

import { QUESTIONS, judge, lastLine, report, runHeadline, type AnswerLike, type Outcome, type RunLike } from "../src/services/analyst-eval.js";

const flag = (name: string): string | null => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? "") : null;
};
const has = (name: string) => process.argv.includes(`--${name}`);

const API = (process.env.OBSCYRO_API_URL ?? "https://obscyro-production.up.railway.app").replace(/\/$/, "");
const ENV = process.env.OBSCYRO_ENV ?? "montreal-covid-19";
const SCENARIO = process.env.OBSCYRO_SCENARIO ?? "calibrated on INSPQ";
const HORIZON = Math.max(1, Number(flag("horizon") ?? 60) || 60);
const ACTIVITY = flag("activity") || "litsantephysique";
const TIMES = Math.max(1, Number(flag("times") ?? 2) || 2);
const ONLY = flag("only")?.split(",").filter(Boolean) ?? null;

let KEY = process.env.OBSCYRO_API_KEY ?? "";

interface Done extends AnswerLike {
  usage?: { inputTokens: number; outputTokens: number };
}

/** A secret typed or pasted at the terminal, without echo. Empty when there is no terminal to ask. */
async function secret(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return "";
  process.stderr.write(prompt);
  return new Promise((resolve) => {
    let value = "";
    const stop = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stderr.write("\n");
    };
    const onData = (chunk: string) => {
      for (const c of chunk) {
        if (c === "\r" || c === "\n" || c === "\u0004") {
          stop();
          return resolve(value.trim());
        }
        if (c === "\u0003") {
          stop();
          process.exit(130);
        }
        if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
        else value += c;
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    stdin.on("data", onData);
  });
}

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${KEY}` } });
  if (res.status === 401) throw new Error("The API refused the key. Check that it is an Obscyro API key of a user who can read this environment.");
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return (await res.json()) as T;
}

/** Post, and wait for the last line of the stream that comes back. */
async function stream<T>(path: string, body: object): Promise<{ done: T | null; failed: string | null }> {
  const res = await fetch(`${API}/v1/ontology/${encodeURIComponent(ENV)}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { done: null, failed: err?.error?.message ?? `the API answered ${res.status}` };
  }
  return lastLine<T>(await res.text());
}

/** The run the questions are asked about: a recorded one, or the server's own of the scenario as it stands. */
async function theRun(scenarioId: string): Promise<RunLike | null> {
  if (has("no-run")) return null;
  const file = flag("run");
  if (file) return JSON.parse(await readFile(file, "utf8")) as RunLike;
  process.stdout.write(`Running the scenario on the server (${HORIZON} days, ${ACTIVITY}): about a minute… `);
  const started = Date.now();
  const { done, failed } = await stream<{ run: RunLike }>("/analyst/run", { scenarioId, horizon: HORIZON, activity: ACTIVITY });
  if (!done) throw new Error(`The server could not run the scenario: ${failed}`);
  console.log(`${((Date.now() - started) / 1000).toFixed(0)} s`);
  const keep = flag("save-run");
  if (keep) {
    await writeFile(keep, `${JSON.stringify(done.run)}\n`);
    console.log(`Run kept in ${keep}.`);
  }
  return done.run;
}

async function main(): Promise<number> {
  if (!KEY) KEY = await secret("Obscyro API key (not shown): ");
  if (!KEY) {
    console.error("No key. Set OBSCYRO_API_KEY, or run this in a terminal to be asked for it. Use a key of a user who can read the environment.");
    return 2;
  }
  const status = await api<{ configured: boolean; model: string }>(`/v1/ontology/${encodeURIComponent(ENV)}/analyst`);
  if (!status.configured) {
    console.error(`The analyst is switched off on ${API}: ANTHROPIC_API_KEY is not set on the API service. Nothing to replay.`);
    return 2;
  }
  const { scenarios } = await api<{ scenarios: { id: string; name: string }[] }>(`/v1/ontology/${encodeURIComponent(ENV)}/overlay-scenarios`);
  const scenario = scenarios.find((s) => s.name.toLowerCase().includes(SCENARIO.toLowerCase()));
  if (!scenario) {
    console.error(`No scenario of ${ENV} has "${SCENARIO}" in its name. Found: ${scenarios.map((s) => s.name).join("; ") || "none"}.`);
    return 2;
  }
  console.log(`${API} · ${ENV} · "${scenario.name}" · ${status.model} · each question ${TIMES} time${TIMES === 1 ? "" : "s"}`);
  const run = await theRun(scenario.id);
  // Which run the answers are about, in the Result panel's own figures: a
  // question's expected facts are those of one run, and this is how to tell
  // a wrong answer from a scenario that changed.
  console.log(run ? `The run: ${runHeadline(run)}\n` : "No run: the questions about a run are skipped.\n");

  const outcomes: Outcome[] = [];
  for (const q of QUESTIONS) {
    if (ONLY && !ONLY.includes(q.id)) continue;
    for (let attempt = 1; attempt <= TIMES; attempt++) {
      if (q.needsRun && !run) {
        outcomes.push({ id: q.id, attempt, skipped: "about a run, and none was made (--no-run)", failures: [], seconds: null, tokens: null, steps: null });
        break;
      }
      const started = Date.now();
      const { done: line, failed } = await stream<{ result?: Done }>("/analyst/ask", {
        question: q.question,
        scenarioId: scenario.id,
        looking: q.looking,
        // The "no run" question is asked with none, whatever was made.
        run: q.needsRun ? run : null,
      });
      const done = line?.result ?? null;
      const seconds = (Date.now() - started) / 1000;
      const failures = done ? judge(q, done) : [failed ?? "no answer"];
      outcomes.push({
        id: q.id,
        attempt,
        skipped: null,
        failures,
        seconds,
        tokens: done?.usage ? done.usage.inputTokens + done.usage.outputTokens : null,
        steps: done ? done.steps.length : null,
      });
      process.stdout.write(failures.length ? "x" : ".");
      if (has("show") && done?.answer) {
        console.log(`\n--- ${q.id} #${attempt}: ${q.question}`);
        for (const p of done.answer.paragraphs) console.log(`${p.text}  [${p.sources.join(", ") || "no source"}]`);
        for (const a of done.answer.assumptions) console.log(`  assumed: ${a}`);
        for (const l of done.answer.limits) console.log(`  limit: ${l}`);
      }
    }
  }
  console.log(`\n\n${report(outcomes)}`);
  return outcomes.some((o) => o.failures.length > 0) ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  },
);
