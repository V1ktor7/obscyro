/**
 * Replay the analyst's reference questions against a running API, with the real model.
 *
 *   OBSCYRO_API_KEY=obs_live_... npx tsx scripts/analyst-eval.ts
 *
 * Run by hand, never by the test suite: it calls the Claude API through the
 * Obscyro API and costs what a dozen questions cost. It needs the analyst to be
 * switched on (ANTHROPIC_API_KEY on the API service).
 *
 * Options (environment or flags):
 *   OBSCYRO_API_URL     where the API is. Default: production.
 *   OBSCYRO_API_KEY     an Obscyro API key for a user who can read the environment. Required.
 *   OBSCYRO_ENV         the environment. Default: montreal-covid-19.
 *   OBSCYRO_SCENARIO    part of the scenario's name. Default: "calibrated on INSPQ".
 *   --run <file.json>   the run on screen, as the Scenarios page summarises it
 *                       (the `run` field of what it sends to /analyst/ask).
 *                       Without it the questions about a run are skipped.
 *   --only <id,id>      only these questions.
 *   --times <n>         replay each question n times. Default 2: a set that
 *                       passes once has not shown it passes.
 *   --show              print each answer, to be read by a person.
 *
 * Exits 1 when anything fails, so it can gate a change to the analyst's
 * instructions or to a tool's description.
 */

import { readFile } from "node:fs/promises";

import { QUESTIONS, judge, report, type AnswerLike, type Outcome } from "../src/services/analyst-eval.js";

const flag = (name: string): string | null => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? "") : null;
};
const has = (name: string) => process.argv.includes(`--${name}`);

const API = (process.env.OBSCYRO_API_URL ?? "https://obscyro-production.up.railway.app").replace(/\/$/, "");
const KEY = process.env.OBSCYRO_API_KEY ?? "";
const ENV = process.env.OBSCYRO_ENV ?? "montreal-covid-19";
const SCENARIO = process.env.OBSCYRO_SCENARIO ?? "calibrated on INSPQ";
const TIMES = Math.max(1, Number(flag("times") ?? 2) || 2);
const ONLY = flag("only")?.split(",").filter(Boolean) ?? null;

interface Done extends AnswerLike {
  usage?: { inputTokens: number; outputTokens: number };
}

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${KEY}` } });
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return (await res.json()) as T;
}

/** Ask one question and wait for the last line of the stream. */
async function ask(body: object): Promise<{ done: Done | null; failed: string | null }> {
  const res = await fetch(`${API}/v1/ontology/${encodeURIComponent(ENV)}/analyst/ask`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { done: null, failed: err?.error?.message ?? `the API answered ${res.status}` };
  }
  let done: Done | null = null;
  let failed: string | null = null;
  for (const line of (await res.text()).split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as { type: string; result?: Done; message?: string };
      if (e.type === "done" && e.result) done = e.result;
      if (e.type === "failed") failed = e.message ?? "the analyst failed";
    } catch {
      // Not one of ours.
    }
  }
  return { done, failed: done ? null : (failed ?? "the stream ended without an answer") };
}

async function main(): Promise<number> {
  if (!KEY) {
    console.error("OBSCYRO_API_KEY is not set. Use a key for a user who can read the environment.");
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
  const runFile = flag("run");
  const run = runFile ? (JSON.parse(await readFile(runFile, "utf8")) as object) : null;

  console.log(`${API} · ${ENV} · "${scenario.name}" · ${status.model} · each question ${TIMES} time${TIMES === 1 ? "" : "s"}${run ? "" : " · no run supplied"}\n`);
  const outcomes: Outcome[] = [];
  for (const q of QUESTIONS) {
    if (ONLY && !ONLY.includes(q.id)) continue;
    for (let attempt = 1; attempt <= TIMES; attempt++) {
      if (q.needsRun && !run) {
        outcomes.push({ id: q.id, attempt, skipped: "about a run, and no --run file was given", failures: [], seconds: null, tokens: null, steps: null });
        break;
      }
      const started = Date.now();
      const { done, failed } = await ask({
        question: q.question,
        scenarioId: scenario.id,
        looking: q.looking,
        // The "no run" question is asked with none, whatever was supplied.
        run: q.needsRun ? run : null,
      });
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
