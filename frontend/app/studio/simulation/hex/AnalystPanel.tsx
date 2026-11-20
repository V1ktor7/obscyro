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
 *
 * Four tabs, one panel. "Ask" answers a question. "Event finder" searches
 * official web sources for what was happening around the network and proposes
 * candidate events (`EventFinderTab.tsx`). "Options" takes an objective and
 * has the engine test up to three ways of meeting it (`OptionsTab.tsx`).
 * "Decisions" lists what was retained, with what was expected of it
 * (`DecisionsTab.tsx`). In all four the analyst writes nothing: an event
 * enters the calendar, an option enters a scenario, and a decision exists, on
 * a person's click.
 */

import { AlertTriangle, Loader2, MapPin, Send, ShieldCheck } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { ApiError } from "@/lib/auth";
import { cn } from "@/lib/cn";

import {
  askAnalyst,
  fetchAnalyst,
  listedEvents,
  stepLabel,
  type AnalystEvent,
  type AnalystResult,
  type AnalystStep,
  type AskFocus,
  type HealthEvent,
  type ProposedOption,
  type RunDigest,
} from "../../analyst-api";
import { EvidenceBadge, LABEL, Text, Trace, WebChip } from "./analyst-parts";
import DecisionsTab from "./DecisionsTab";
import EventFinderTab from "./EventFinderTab";
import OptionsTab from "./OptionsTab";

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

type Tab = "ask" | "events" | "options" | "decisions";
// In the order of the decision loop: the situation, what was happening around
// it, the options, what was retained.
const TABS: { key: Tab; label: string }[] = [
  { key: "ask", label: "Ask" },
  { key: "events", label: "Event finder" },
  { key: "options", label: "Options" },
  { key: "decisions", label: "Decisions" },
];

/** How many published events a paragraph shows a link for before it says how many more its steps hold. */
const WEB_CHIPS = 6;

export default function AnalystPanel({
  env,
  scenario,
  run,
  siteName,
  onFocusSite,
  horizon = 60,
  activity = "",
  scenarioKey = "",
  onAddOption,
  period = null,
  onEventAccepted,
}: {
  env: string;
  scenario: { id: string; name: string } | null;
  /** The run on screen, or null when nothing was run. */
  run: RunDigest | null;
  /** A site's name by id, or null when the map does not show it. */
  siteName: (id: string) => string | null;
  onFocusSite: (id: string) => void;
  /** The days the page runs over and the activity it reads: what an option is tested on. */
  horizon?: number;
  activity?: string;
  /** Changes whenever the scenario's stamps do. */
  scenarioKey?: string;
  /** Writes a tested option's stamps into the scenario, on a person's click. */
  onAddOption?: (option: ProposedOption) => Promise<void>;
  /** The calendar dates the scenario runs over, when its day 0 has one. */
  period?: { origin: string; horizon: number } | null;
  /** A person accepted an event into the calendar. */
  onEventAccepted?: (event: HealthEvent) => void;
}) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("ask");
  // A tab is built the first time it is opened and kept after, so what was
  // asked or tested in it is still there on the way back.
  const [opened, setOpened] = useState<Tab[]>(["ask"]);
  const [decisionsVersion, setDecisionsVersion] = useState(0);

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

  function show(next: Tab) {
    setTab(next);
    setOpened((o) => (o.includes(next) ? o : [...o, next]));
  }

  const off = (
    <div className="flex flex-col gap-2 p-3">
      <p className="text-[12.5px] font-semibold text-ink">The analyst is not switched on for this server.</p>
      <p className="text-[12px] text-ink-body">
        It answers questions about the twin by reading it through the Claude API, and the API service has no key for
        it yet. An administrator has to set <code className="rounded bg-canvas px-1 font-mono text-[11px]">ANTHROPIC_API_KEY</code>{" "}
        on the API service, then reload this page.
      </p>
    </div>
  );

  return (
    <div className="flex flex-col">
      <div role="tablist" aria-label="Analyst" className="flex border-b border-line-soft px-2 pt-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`analyst-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`analyst-panel-${t.key}`}
            onClick={() => show(t.key)}
            className={cn(
              "-mb-px border-b-2 px-2.5 py-1 text-[12px]",
              tab === t.key ? "border-brand font-semibold text-brand-deep" : "border-transparent text-ink-muted hover:text-ink-body",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="analyst-panel-ask" aria-labelledby="analyst-tab-ask" hidden={tab !== "ask"}>
        {configured === false ? (
          off
        ) : (
          <AskTab env={env} scenario={scenario} run={run} siteName={siteName} onFocusSite={onFocusSite} onOff={() => setConfigured(false)} />
        )}
      </div>
      {opened.includes("events") ? (
        <div role="tabpanel" id="analyst-panel-events" aria-labelledby="analyst-tab-events" hidden={tab !== "events"}>
          {configured === false ? (
            off
          ) : (
            <EventFinderTab env={env} scenario={scenario} period={period} onAccepted={(e) => onEventAccepted?.(e)} onOff={() => setConfigured(false)} />
          )}
        </div>
      ) : null}
      {opened.includes("options") ? (
        <div role="tabpanel" id="analyst-panel-options" aria-labelledby="analyst-tab-options" hidden={tab !== "options"}>
          {configured === false ? (
            off
          ) : (
            <OptionsTab
              env={env}
              scenario={scenario}
              run={run}
              horizon={horizon}
              activity={activity}
              scenarioKey={scenarioKey}
              siteName={siteName}
              onFocusSite={onFocusSite}
              onAdd={onAddOption ?? (() => Promise.reject(new Error("This page cannot add an option to a scenario.")))}
              onRecorded={() => setDecisionsVersion((v) => v + 1)}
              onOff={() => setConfigured(false)}
            />
          )}
        </div>
      ) : null}
      {opened.includes("decisions") ? (
        // Readable without the model: a decision is a record, not an answer.
        <div role="tabpanel" id="analyst-panel-decisions" aria-labelledby="analyst-tab-decisions" hidden={tab !== "decisions"}>
          <DecisionsTab env={env} scenario={scenario} refresh={decisionsVersion} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Ask a question, read the answer and what it rests on.
 *
 * On the scenario map it is the first tab of the Analyst panel. It is also the
 * whole of the analyst everywhere else in the Studio (`AnalystDock`, the
 * situation card): there `live` is set, no scenario or run is on screen, and
 * `focus` says what the person has in front of them.
 */
export function AskTab({
  env,
  scenario,
  run,
  siteName,
  onFocusSite,
  onOff,
  live = false,
  focus = null,
  prepared = "",
  hints,
}: {
  env: string;
  scenario: { id: string; name: string } | null;
  run: RunDigest | null;
  siteName: (id: string) => string | null;
  onFocusSite: (id: string) => void;
  /** The server said the analyst is switched off. */
  onOff: () => void;
  /** Asked from a live page: about the network now, not about a scenario or a run. */
  live?: boolean;
  /** What the person has in front of them, by id. */
  focus?: AskFocus | null;
  /** A question already written, put in the box for the person to send or change. */
  prepared?: string;
  /** Questions offered before the first one is asked, in place of the scenario map's. */
  hints?: string[];
}) {
  const fieldId = useId();
  const [looking, setLooking] = useState<Looking>(scenario ? "scenario" : "reality");
  const [draft, setDraft] = useState(prepared);
  const [asked, setAsked] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [steps, setSteps] = useState<AnalystStep[]>([]);
  const [result, setResult] = useState<AnalystResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [traceOpen, setTraceOpen] = useState(false);
  const abort = useRef<AbortController | null>(null);

  // Without a scenario there is one world; with one, start on what is open.
  useEffect(() => {
    setLooking(scenario ? "scenario" : "reality");
  }, [scenario?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => abort.current?.abort(), []);

  // A prepared question follows what it was written about, until the person has asked or typed their own.
  const lastPrepared = useRef(prepared);
  useEffect(() => {
    setDraft((d) => (d === lastPrepared.current ? prepared : d));
    lastPrepared.current = prepared;
  }, [prepared]);

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
      await askAnalyst(
        env,
        { question: q, scenarioId: scenario?.id ?? null, looking: scenario ? looking : "reality", run, ...(focus ? { focus } : {}) },
        onEvent,
        controller.signal,
      );
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      if (err instanceof ApiError && err.code === "ANALYST_NOT_CONFIGURED") onOff();
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
  const onMap = (answer?.focusSites ?? []).map((id) => ({ id, name: siteName(id) })).filter((s): s is { id: string; name: string } => s.name !== null);

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
                  className={cn("px-2 py-1", looking === key ? "bg-brand-soft font-semibold text-brand-deep" : "bg-surface text-ink-body hover:bg-surface-hover")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <p className="text-[11.5px] text-ink-muted">
          {live ? (
            "The network as it stands now: what is open, and a unit's live figures, each with its age."
          ) : (
            <>
              {scenario && looking === "scenario" ? `The twin with “${scenario.name}” applied` : "The twin as it stands today"}
              {run
                ? ` · the run on screen (${run.horizon} days, ${run.activity}${run.stale ? ", out of date" : ""})`
                : " · no run on screen: press Run to ask about results"}
            </>
          )}
        </p>

        <form
          className="flex items-end gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(draft);
          }}
        >
          <label htmlFor={fieldId} className="sr-only">Question for the analyst</label>
          <textarea
            id={fieldId}
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(draft);
              }
            }}
            placeholder={live ? "Ask what is open now, or about a unit's live figures…" : "Ask about the sites, the catchments, the scenario or the run…"}
            className="min-w-0 flex-1 resize-none rounded border border-line bg-surface px-2 py-1.5 text-[12.5px] text-ink focus:border-brand focus:outline-none"
          />
          {asking ? (
            <button type="button" onClick={stop} className="rounded border border-line px-2.5 py-1.5 text-[12px] text-ink-body hover:bg-surface-hover">
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
            {(hints ?? suggestions(Boolean(scenario), Boolean(run), scenario ? looking : "reality")).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void ask(s)}
                className="rounded-full border border-line bg-surface px-2.5 py-1 text-left text-[11.5px] text-ink-body hover:border-brand hover:bg-brand-soft"
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
                  {removed} figure{removed === 1 ? " was" : "s were"} removed from this answer: the steps it cites did not
                  hold {removed === 1 ? "it" : "them"}, or held {removed === 1 ? "it" : "them"} for another site. Read the
                  sentences around the gaps with care.
                </p>
              )}

              {answer.paragraphs.map((p, i) => {
                // What the paragraph took from the web: the validated events of the steps it cites.
                const published = p.sources
                  .flatMap((id) => listedEvents(stepById.get(id)))
                  .filter((e, at, all) => all.findIndex((x) => x.id === e.id) === at);
                return (
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
                  {published.length ? (
                    <div className="flex flex-wrap items-center gap-1" aria-label="Published sources this paragraph rests on">
                      <EvidenceBadge evidence="published" />
                      {published.slice(0, WEB_CHIPS).map((e) => (
                        <WebChip key={e.id} url={e.url} title={`${e.title} — “${e.passage}”`} />
                      ))}
                      {published.length > WEB_CHIPS ? (
                        <span className="text-[10.5px] text-ink-faint">and {published.length - WEB_CHIPS} more in the steps cited</span>
                      ) : null}
                      <span className="text-[10.5px] text-ink-faint">From official sources, validated by a person. Not measured by the twin.</span>
                    </div>
                  ) : null}
                </div>
                );
              })}

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

              {onMap.length ? (
                <div className="flex flex-col gap-1">
                  <span className={LABEL}>On the map</span>
                  <div className="flex flex-wrap gap-1.5">
                    {onMap.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => onFocusSite(s.id)}
                        className="flex items-center gap-1 rounded border border-line bg-surface px-2 py-1 text-[11.5px] text-ink-body hover:border-brand hover:bg-brand-soft"
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
                        className="rounded-full border border-line bg-surface px-2.5 py-1 text-left text-[11.5px] text-ink-body hover:border-brand hover:bg-brand-soft disabled:opacity-50"
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

      {asked ? (
        <Trace steps={steps} open={traceOpen} onToggle={() => setTraceOpen((o) => !o)} openStep={openStep} onOpenStep={setOpenStep} done={!asking && result !== null} />
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
