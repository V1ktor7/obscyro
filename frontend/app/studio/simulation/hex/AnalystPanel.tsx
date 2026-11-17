"use client";

/**
 * The analyst: ask a question about what is on the map, read the answer, and
 * see exactly what was read to write it.
 *
 * Three things are always on screen with an answer, because an answer without
 * them is a claim: the steps it took (each tool call, with what it returned),
 * which of those steps each paragraph rests on, and whether every figure was
 * found in them. A figure that was not found is not shown; the place it stood
 * is, so nobody reads a sentence that quietly lost its number.
 *
 * The analyst only reads. Nothing here changes the twin or the scenario.
 */

import { AlertTriangle, Check, ChevronRight, Loader2, MapPin, Send, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ApiError } from "@/lib/auth";
import { cn } from "@/lib/cn";

import {
  askAnalyst,
  fetchAnalyst,
  stepLabel,
  type AnalystEvent,
  type AnalystResult,
  type AnalystStep,
  type RunDigest,
} from "../../analyst-api";

const LABEL = "text-[10px] font-semibold uppercase tracking-wide text-ink-faint";

/** What replaces a figure the server could not trace. Must match the server's. */
const STRUCK = "[unverified]";

type Looking = "reality" | "scenario";

function suggestions(hasScenario: boolean, hasRun: boolean, looking: Looking): string[] {
  if (hasRun && looking === "scenario") {
    return ["Where does it break first, and why there?", "What did my choices change?", "Which catchment is least provided for?"];
  }
  if (hasScenario && looking === "scenario") {
    return ["What does this scenario assume?", "Which catchment is least provided for?", "What is the twin missing for a run?"];
  }
  return ["Which catchment is least provided for?", "Which sites hold the most capacity?", "What is the twin missing for a run?"];
}

/** A paragraph, with the places a figure was taken out made visible. */
function Text({ text }: { text: string }) {
  const parts = text.split(STRUCK);
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 ? (
            <span
              title="A figure stood here that was not in any step this paragraph cites. It was removed."
              className="mx-0.5 rounded bg-warn-soft px-1 text-[11px] font-semibold text-warn-ink"
            >
              figure removed
            </span>
          ) : null}
        </span>
      ))}
    </>
  );
}

function StepRow({ step, open, onToggle }: { step: AnalystStep; open: boolean; onToggle: () => void }) {
  return (
    <li className={cn("rounded-md border", open ? "border-brand bg-white" : "border-line-soft bg-canvas-raised")}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 px-2 py-1.5 text-left"
      >
        <span className={cn("mt-px rounded px-1 font-mono text-[10.5px] font-bold", step.ok ? "bg-brand-soft text-brand-deep" : "bg-warn-soft text-warn-ink")}>
          {step.id}
        </span>
        <span className="min-w-0 break-words text-[11.5px] text-ink-body">
          {stepLabel(step)}
          {step.ok ? null : <span className="text-warn-ink"> · refused</span>}
        </span>
        <ChevronRight className={cn("mt-0.5 h-3 w-3 shrink-0 text-ink-muted transition-transform", open && "rotate-90")} aria-hidden="true" />
      </button>
      {open ? (
        <div className="flex flex-col gap-1.5 border-t border-line-soft px-2 py-2">
          <span className={LABEL}>Asked · {step.tool}</span>
          <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded bg-canvas p-1.5 font-mono text-[10.5px] text-ink">
            {JSON.stringify(step.input, null, 2)}
          </pre>
          <span className={LABEL}>{step.ok ? "Returned" : "Refused, because"}</span>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-canvas p-1.5 font-mono text-[10.5px] text-ink">
            {JSON.stringify(step.output, null, 2)}
          </pre>
        </div>
      ) : null}
    </li>
  );
}

export default function AnalystPanel({
  env,
  scenario,
  run,
  siteName,
  onFocusSite,
}: {
  env: string;
  scenario: { id: string; name: string } | null;
  /** The run on screen, or null when nothing was run. */
  run: RunDigest | null;
  /** A site's name by id, or null when the map does not show it. */
  siteName: (id: string) => string | null;
  onFocusSite: (id: string) => void;
}) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [looking, setLooking] = useState<Looking>(scenario ? "scenario" : "reality");
  const [draft, setDraft] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [steps, setSteps] = useState<AnalystStep[]>([]);
  const [result, setResult] = useState<AnalystResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [traceOpen, setTraceOpen] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let live = true;
    fetchAnalyst(env)
      .then((s) => live && setConfigured(s.configured))
      // Not knowing is not the same as off: let the question be asked and the
      // server say what is wrong.
      .catch(() => live && setConfigured(true));
    return () => {
      live = false;
    };
  }, [env]);

  // Without a scenario there is one world; with one, start on what is open.
  useEffect(() => {
    setLooking(scenario ? "scenario" : "reality");
  }, [scenario?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => abort.current?.abort(), []);

  const asking = status !== null;

  async function ask(question: string) {
    const q = question.trim();
    if (q.length < 3 || asking) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setAsked(q);
    setDraft("");
    setSteps([]);
    setResult(null);
    setError(null);
    setOpenStep(null);
    setTraceOpen(true);
    setStatus("Sending the question");
    const onEvent = (e: AnalystEvent) => {
      if (e.type === "status") setStatus(e.message);
      else if (e.type === "step") setSteps((s) => [...s, e.step]);
      else if (e.type === "failed") setError(e.message);
      else if (e.type === "done") {
        setResult(e.result);
        setSteps(e.result.steps);
        setTraceOpen(e.result.status !== "answered");
      }
    };
    try {
      await askAnalyst(env, { question: q, scenarioId: scenario?.id ?? null, looking: scenario ? looking : "reality", run }, onEvent, controller.signal);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      if (err instanceof ApiError && err.code === "ANALYST_NOT_CONFIGURED") setConfigured(false);
      setError(err instanceof ApiError ? err.message : "The analyst could not be reached. Check the connection and ask again.");
    } finally {
      if (abort.current === controller) {
        abort.current = null;
        setStatus(null);
      }
    }
  }

  function stop() {
    abort.current?.abort();
    abort.current = null;
    setStatus(null);
    setError("Stopped. Nothing was answered.");
  }

  function cite(id: string) {
    setTraceOpen(true);
    setOpenStep(id);
  }

  const answer = result?.answer ?? null;
  const removed = result ? result.struck.reduce((n, f) => n + f.figures.length, 0) : 0;
  const stepById = new Map(steps.map((s) => [s.id, s]));
  const focus = (answer?.focusSites ?? []).map((id) => ({ id, name: siteName(id) })).filter((s): s is { id: string; name: string } => s.name !== null);

  if (configured === false) {
    return (
      <div className="flex flex-col gap-2 p-3">
        <p className="text-[12.5px] font-semibold text-ink">The analyst is not switched on for this server.</p>
        <p className="text-[12px] text-ink-body">
          It answers questions about the twin by reading it through the Claude API, and the API service has no key for
          it yet. An administrator has to set <code className="rounded bg-canvas px-1 font-mono text-[11px]">ANTHROPIC_API_KEY</code>{" "}
          on the API service, then reload this page.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2 p-3">
        {scenario ? (
          <div className="flex items-center gap-2">
            <span className={LABEL}>Reads</span>
            <div role="group" aria-label="What the analyst reads" className="flex overflow-hidden rounded border border-line text-[11.5px]">
              {(
                [
                  ["scenario", "This scenario"],
                  ["reality", "Reality"],
                ] as [Looking, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={looking === key}
                  onClick={() => setLooking(key)}
                  className={cn("px-2 py-1", looking === key ? "bg-brand-soft font-semibold text-brand-deep" : "bg-white text-ink-body hover:bg-canvas-raised")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <p className="text-[11.5px] text-ink-muted">
          {scenario && looking === "scenario" ? `The twin with “${scenario.name}” applied` : "The twin as it stands today"}
          {run
            ? ` · the run on screen (${run.horizon} days, ${run.activity}${run.stale ? ", out of date" : ""})`
            : " · no run on screen: press Run to ask about results"}
        </p>

        <form
          className="flex items-end gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(draft);
          }}
        >
          <label htmlFor="analyst-question" className="sr-only">Question for the analyst</label>
          <textarea
            id="analyst-question"
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(draft);
              }
            }}
            placeholder="Ask about the sites, the catchments, the scenario or the run…"
            className="min-w-0 flex-1 resize-none rounded border border-line bg-white px-2 py-1.5 text-[12.5px] text-ink focus:border-brand focus:outline-none"
          />
          {asking ? (
            <button type="button" onClick={stop} className="rounded border border-line px-2.5 py-1.5 text-[12px] text-ink-body hover:bg-canvas-raised">
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={draft.trim().length < 3}
              className="flex items-center gap-1 rounded bg-brand px-2.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" aria-hidden="true" /> Ask
            </button>
          )}
        </form>

        {!asked ? (
          <div className="flex flex-wrap gap-1.5">
            {suggestions(Boolean(scenario), Boolean(run), scenario ? looking : "reality").map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void ask(s)}
                className="rounded-full border border-line bg-white px-2.5 py-1 text-left text-[11.5px] text-ink-body hover:border-brand hover:bg-brand-soft"
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {asked ? (
        <div className="flex flex-col gap-2 border-t border-line-soft p-3">
          <p className="text-[12.5px] font-semibold text-ink">{asked}</p>

          {asking ? (
            <p role="status" className="flex items-center gap-2 text-[12px] text-ink-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> {status}…
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="rounded bg-danger-soft px-2 py-1.5 text-[12px] text-danger-ink">{error}</p>
          ) : null}

          {result && !answer ? (
            <p role="alert" className="rounded bg-warn-soft px-2 py-1.5 text-[12px] text-warn-ink">
              {result.message ?? "No answer was given."}
            </p>
          ) : null}

          {answer ? (
            <>
              {result!.verified ? (
                <p className="flex items-start gap-1.5 rounded bg-ok-soft px-2 py-1.5 text-[11.5px] text-ok-ink">
                  <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Every figure below was found in the steps its paragraph cites.
                </p>
              ) : (
                <p role="alert" className="flex items-start gap-1.5 rounded bg-warn-soft px-2 py-1.5 text-[11.5px] text-warn-ink">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {removed} figure{removed === 1 ? " was" : "s were"} removed from this answer: no step it cites held{" "}
                  {removed === 1 ? "it" : "them"}. Read the sentences around the gaps with care.
                </p>
              )}

              {answer.paragraphs.map((p, i) => (
                <div key={i} className="flex flex-col gap-1">
                  <p className="text-[12.5px] leading-relaxed text-ink">
                    <Text text={p.text} />
                  </p>
                  {p.sources.length ? (
                    <div className="flex flex-wrap gap-1">
                      {p.sources.map((id) => {
                        const s = stepById.get(id);
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => cite(id)}
                            title={s ? stepLabel(s) : id}
                            className="flex max-w-full items-center gap-1 rounded border border-line-soft bg-canvas-raised px-1.5 py-0.5 text-[10.5px] text-ink-body hover:border-brand"
                          >
                            <span className="font-mono font-bold text-brand-deep">{id}</span>
                            <span className="truncate">{s ? s.tool.replace(/_/g, " ") : ""}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <span className="text-[10.5px] text-ink-faint">Cites no step: nothing in it was read from the twin.</span>
                  )}
                </div>
              ))}

              {answer.assumptions.length ? (
                <div className="flex flex-col gap-1">
                  <span className={LABEL}>Assumed, not recorded</span>
                  <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[12px] text-ink-body">
                    {answer.assumptions.map((a, i) => (
                      <li key={i}><Text text={a} /></li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {answer.limits.length ? (
                <div className="flex flex-col gap-1">
                  <span className={LABEL}>What this cannot say</span>
                  <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[12px] text-ink-body">
                    {answer.limits.map((a, i) => (
                      <li key={i}><Text text={a} /></li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {focus.length ? (
                <div className="flex flex-col gap-1">
                  <span className={LABEL}>On the map</span>
                  <div className="flex flex-wrap gap-1.5">
                    {focus.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => onFocusSite(s.id)}
                        className="flex items-center gap-1 rounded border border-line bg-white px-2 py-1 text-[11.5px] text-ink-body hover:border-brand hover:bg-brand-soft"
                      >
                        <MapPin className="h-3 w-3 text-brand-deep" aria-hidden="true" /> {s.name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {answer.followUps.length ? (
                <div className="flex flex-col gap-1">
                  <span className={LABEL}>Ask next</span>
                  <div className="flex flex-wrap gap-1.5">
                    {answer.followUps.map((f) => (
                      <button
                        key={f}
                        type="button"
                        disabled={asking}
                        onClick={() => void ask(f)}
                        className="rounded-full border border-line bg-white px-2.5 py-1 text-left text-[11.5px] text-ink-body hover:border-brand hover:bg-brand-soft disabled:opacity-50"
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {asked && steps.length ? (
        <div className="flex flex-col gap-1.5 border-t border-line-soft p-3">
          <button
            type="button"
            aria-expanded={traceOpen}
            onClick={() => setTraceOpen((o) => !o)}
            className="flex items-center gap-1.5 text-left"
          >
            <ChevronRight className={cn("h-3 w-3 text-ink-muted transition-transform", traceOpen && "rotate-90")} aria-hidden="true" />
            <span className={LABEL}>
              What it read · {steps.length} step{steps.length === 1 ? "" : "s"}
            </span>
            {!asking && result ? <Check className="h-3 w-3 text-ok-ink" aria-hidden="true" /> : null}
          </button>
          {traceOpen ? (
            <ul className="flex flex-col gap-1">
              {steps.map((s) => (
                <StepRow key={s.id} step={s} open={openStep === s.id} onToggle={() => setOpenStep(openStep === s.id ? null : s.id)} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <p className="border-t border-line-soft px-3 py-2 text-[10.5px] text-ink-faint">
        {result
          ? `Written by ${result.model} from ${result.steps.length} step${result.steps.length === 1 ? "" : "s"} · ${(result.usage.inputTokens + result.usage.outputTokens).toLocaleString("en-CA")} tokens. `
          : ""}
        The analyst only reads: it changes nothing in the twin or the scenario, and it decides nothing. What its tools
        read is sent to the Claude API to write the answer.
      </p>
    </div>
  );
}
