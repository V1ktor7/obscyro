"use client";

/**
 * Options: say what should change, and see what the engine gives for up to
 * three ways of changing it.
 *
 * The analyst proposes; the engine tests; a person decides. So three things
 * here are not the model's:
 *
 * - the table. Every figure in it is the engine's own count from a test, read
 *   from the test's record, beside the same scenario run as it stands;
 * - the level of evidence beside each thing a run rests on — measured,
 *   published or assumption — which the server assigns from where that thing
 *   comes from;
 * - the two buttons. "Add to scenario" writes the option's stamps, and "Record
 *   decision" keeps the choice with the figures expected of it. Nothing happens
 *   to the scenario until one of them is pressed.
 *
 * Options are shown in the order they were tested. Nothing ranks them.
 */

import { AlertTriangle, Check, Loader2, MapPin, Plus, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ApiError } from "@/lib/auth";
import { cn } from "@/lib/cn";

import {
  proposeOptions,
  recordDecision,
  stepLabel,
  type AnalystStep,
  type Basis,
  type OptionFigures,
  type OptionsEvent,
  type OptionsResult,
  type ProposedOption,
  type RunDigest,
} from "../../analyst-api";
import { EvidenceBadge, LABEL, Text, Trace } from "./analyst-parts";
import { people } from "./results";

const LETTERS = ["A", "B", "C"];

function suggestions(run: RunDigest | null): string[] {
  const worst = run
    ? [...run.sites].filter((s) => s.full.firstDay !== null).sort((a, b) => b.full.waitingDays - a.full.waitingDays)[0]
    : undefined;
  return [
    worst ? `Nobody should wait at ${worst.name}.` : "Nobody should wait at any site.",
    "The fewest patient-days waiting, with at most 100 beds added.",
    "Push back the first day somebody waits.",
  ];
}

const pct = (share: number | null) => (share === null ? "—" : `${Math.round(share * 100)} %`);

/** The rows of the comparison: one figure of a run, written the way the Result panel writes it. */
const ROWS: { label: string; of: (f: OptionFigures) => string; note?: (f: OptionFigures) => string | null }[] = [
  { label: "Peak occupancy", of: (f) => pct(f.peakOccupancy), note: (f) => (f.peakDay === null ? null : `day ${f.peakDay}`) },
  { label: "Sites with a queue", of: (f) => `${f.sitesWithQueue} of ${f.sitesWithActivity}` },
  { label: "Patient-days waiting", of: (f) => (f.sitesWithQueue ? people(f.waitingDays) : "0") },
  { label: "First day somebody waits", of: (f) => (f.firstQueueDay === null ? "nobody waits" : `day ${f.firstQueueDay}`) },
];

function BasisList({ items }: { items: Basis[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((b, i) => (
        <li key={i} className="flex items-start gap-1.5 text-[11.5px] text-ink-body">
          <EvidenceBadge evidence={b.evidence} />
          <span className="min-w-0">{b.element}</span>
        </li>
      ))}
    </ul>
  );
}

export default function OptionsTab({
  env,
  scenario,
  run,
  horizon,
  activity,
  scenarioKey,
  siteName,
  onFocusSite,
  onAdd,
  onRecorded,
  onOff,
}: {
  env: string;
  scenario: { id: string; name: string } | null;
  /** The run on screen, or null when nothing was run. */
  run: RunDigest | null;
  /** The days the page runs over and the activity it reads: what an option is tested on. */
  horizon: number;
  activity: string;
  /** Changes whenever the scenario's stamps do, so a test can tell it is out of date. */
  scenarioKey: string;
  siteName: (id: string) => string | null;
  onFocusSite: (id: string) => void;
  /** Writes an option's stamps into the scenario. Rejects when it cannot. */
  onAdd: (option: ProposedOption) => Promise<void>;
  /** A decision was recorded. */
  onRecorded: () => void;
  /** The server said the analyst is switched off. */
  onOff: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [steps, setSteps] = useState<AnalystStep[]>([]);
  const [result, setResult] = useState<OptionsResult | null>(null);
  const [exchangeId, setExchangeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [traceOpen, setTraceOpen] = useState(false);
  const [basisOpen, setBasisOpen] = useState(false);
  // The scenario as it was when the options were tested.
  const [testedKey, setTestedKey] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [recorded, setRecorded] = useState<string[]>([]);
  const [acting, setActing] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  // Another scenario is another question: what was tested belongs to the one before.
  useEffect(() => {
    abort.current?.abort();
    abort.current = null;
    setAsked(null);
    setStatus(null);
    setSteps([]);
    setResult(null);
    setExchangeId(null);
    setError(null);
    setAdded([]);
    setRecorded([]);
    setActionError(null);
  }, [scenario?.id]);

  const asking = status !== null;

  async function test(objective: string) {
    const q = objective.trim();
    if (q.length < 3 || asking || !scenario) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setAsked(q);
    setDraft("");
    setSteps([]);
    setResult(null);
    setExchangeId(null);
    setError(null);
    setOpenStep(null);
    setTraceOpen(true);
    setAdded([]);
    setRecorded([]);
    setActionError(null);
    setTestedKey(scenarioKey);
    setStatus("Sending the objective");
    const onEvent = (e: OptionsEvent) => {
      if (e.type === "status") setStatus(e.message);
      else if (e.type === "step") setSteps((s) => [...s, e.step]);
      else if (e.type === "failed") setError(e.message);
      else if (e.type === "done") {
        setResult(e.result);
        setExchangeId(e.exchangeId ?? null);
        setSteps(e.result.steps);
        setTraceOpen(e.result.status !== "answered");
      }
    };
    try {
      await proposeOptions(env, { objective: q, scenarioId: scenario.id, horizon, activity, run }, onEvent, controller.signal);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      if (err instanceof ApiError && err.code === "ANALYST_NOT_CONFIGURED") onOff();
      setError(err instanceof ApiError ? err.message : "The analyst could not be reached. Check the connection and try again.");
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
    setError("Stopped. No option is shown.");
  }

  async function add(o: ProposedOption) {
    setActing(`add:${o.step}`);
    setActionError(null);
    try {
      await onAdd(o);
      setAdded((a) => [...a, o.step]);
    } catch (err) {
      setActionError(`“${o.label}” was not added: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActing(null);
    }
  }

  async function record(o: ProposedOption) {
    if (!exchangeId) return;
    setActing(`record:${o.step}`);
    setActionError(null);
    try {
      await recordDecision(env, { exchangeId, step: o.step });
      setRecorded((r) => [...r, o.step]);
      onRecorded();
    } catch (err) {
      setActionError(`The decision was not recorded: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActing(null);
    }
  }

  if (!scenario) {
    return (
      <div className="flex flex-col gap-1.5 p-3">
        <p className="text-[12.5px] font-semibold text-ink">Options are tested on a scenario.</p>
        <p className="text-[12px] text-ink-body">
          Open a scenario, or stamp something on the map to create one. An option is something added to a scenario, so
          there has to be one to add it to.
        </p>
      </div>
    );
  }

  const proposal = result?.answer ?? null;
  const removed = result ? result.struck.reduce((n, f) => n + f.figures.length, 0) : 0;
  const stepById = new Map(steps.map((s) => [s.id, s]));
  const changed = proposal !== null && testedKey !== null && testedKey !== scenarioKey;
  const focus = (proposal?.focusSites ?? []).map((id) => ({ id, name: siteName(id) })).filter((s): s is { id: string; name: string } => s.name !== null);
  const showStranded = proposal?.asItIs?.strandedWaitingDays != null;

  function cite(id: string) {
    setTraceOpen(true);
    setOpenStep(id);
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2 p-3">
        <p className="text-[11.5px] text-ink-muted">
          Tested on “{scenario.name}” over {horizon} days, reading {activity || "no activity"}. Each option is run by the
          engine before it is shown. Nothing is added to the scenario until you add it.
        </p>
        <form
          className="flex items-end gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void test(draft);
          }}
        >
          <label htmlFor="analyst-objective" className="sr-only">Objective for the options</label>
          <textarea
            id="analyst-objective"
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void test(draft);
              }
            }}
            placeholder="What should change? “Nobody waits at this site”, “the fewest patient-days waiting with at most 100 beds added”…"
            className="min-w-0 flex-1 resize-none rounded border border-line bg-white px-2 py-1.5 text-[12.5px] text-ink focus:border-brand focus:outline-none"
          />
          {asking ? (
            <button type="button" onClick={stop} className="rounded border border-line px-2.5 py-1.5 text-[12px] text-ink-body hover:bg-canvas-raised">
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={draft.trim().length < 3 || !activity}
              className="rounded bg-brand px-2.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
            >
              Test options
            </button>
          )}
        </form>
        {!asked ? (
          <div className="flex flex-wrap gap-1.5">
            {suggestions(run).map((s) => (
              <button
                key={s}
                type="button"
                disabled={!activity}
                onClick={() => void test(s)}
                className="rounded-full border border-line bg-white px-2.5 py-1 text-left text-[11.5px] text-ink-body hover:border-brand hover:bg-brand-soft disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {asked ? (
        <div className="flex flex-col gap-2.5 border-t border-line-soft p-3">
          <p className="text-[12.5px] font-semibold text-ink">{asked}</p>

          {asking ? (
            <div role="status" className="flex flex-col gap-1 text-[12px] text-ink-muted">
              <span className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> {status}…
              </span>
              {steps.filter((s) => s.tool === "test_option").map((s) => (
                <span key={s.id} className="pl-5 text-[11.5px]">
                  {s.ok ? "Tested" : "Could not test"}: {stepLabel(s).replace(/^Option tested in the engine: /, "")}
                </span>
              ))}
            </div>
          ) : null}

          {error ? <p role="alert" className="rounded bg-danger-soft px-2 py-1.5 text-[12px] text-danger-ink">{error}</p> : null}

          {result && !proposal ? (
            <p role="alert" className="rounded bg-warn-soft px-2 py-1.5 text-[12px] text-warn-ink">{result.message ?? "No option was delivered."}</p>
          ) : null}

          {proposal ? (
            <>
              {changed ? (
                <p role="alert" className="flex items-start gap-1.5 rounded bg-warn-soft px-2 py-1.5 text-[11.5px] text-warn-ink">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  The scenario was edited since these options were tested. The figures below describe it as it was; state
                  the objective again before relying on them.
                </p>
              ) : null}

              {result!.verified ? (
                <p className="flex items-start gap-1.5 rounded bg-ok-soft px-2 py-1.5 text-[11.5px] text-ok-ink">
                  <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  The table is the engine’s own counts, and every figure in the text was found in the steps it cites.
                </p>
              ) : (
                <p role="alert" className="flex items-start gap-1.5 rounded bg-warn-soft px-2 py-1.5 text-[11.5px] text-warn-ink">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {removed} figure{removed === 1 ? " was" : "s were"} removed from the text: no step it cites held{" "}
                  {removed === 1 ? "it" : "them"}. The table is the engine’s own counts and is not affected.
                </p>
              )}

              {proposal.asItIs && proposal.options.length ? (
                <div className="flex flex-col gap-1">
                  <span className={LABEL}>
                    Tested by the engine · {proposal.horizon} days · {proposal.activity} · not a forecast
                  </span>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-[11.5px] tabular-nums">
                      <caption className="sr-only">The scenario as it is beside each tested option</caption>
                      <thead>
                        <tr className="text-left text-ink-muted">
                          <th scope="col" className="py-1 pr-2 font-normal" />
                          <th scope="col" className="px-1.5 py-1 font-semibold">As it is</th>
                          {proposal.options.map((o, i) => (
                            <th key={o.step} scope="col" title={o.label} className="px-1.5 py-1 font-semibold text-brand-deep">
                              Option {LETTERS[i]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {ROWS.map((r) => (
                          <tr key={r.label} className="border-t border-line-soft align-top">
                            <th scope="row" className="py-1 pr-2 text-left font-normal text-ink-muted">{r.label}</th>
                            {[proposal.asItIs!, ...proposal.options.map((o) => o.figures)].map((f, i) => (
                              <td key={i} className={cn("px-1.5 py-1", i === 0 ? "text-ink-body" : "font-semibold text-ink")}>
                                {r.of(f)}
                                {r.note?.(f) ? <span className="block text-[10.5px] font-normal text-ink-faint">{r.note(f)}</span> : null}
                              </td>
                            ))}
                          </tr>
                        ))}
                        {showStranded ? (
                          <tr className="border-t border-line-soft align-top">
                            <th scope="row" className="py-1 pr-2 text-left font-normal text-ink-muted">Patient-days waiting where no site serves</th>
                            {[proposal.asItIs!, ...proposal.options.map((o) => o.figures)].map((f, i) => (
                              <td key={i} className={cn("px-1.5 py-1", i === 0 ? "text-ink-body" : "font-semibold text-ink")}>
                                {f.strandedWaitingDays === null ? "—" : people(f.strandedWaitingDays)}
                              </td>
                            ))}
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[10.5px] text-ink-faint">
                    “As it is” is this scenario with the choices it already holds. Each option is the same run with its
                    changes added. In the order tested; nothing here ranks them.
                  </p>
                </div>
              ) : null}

              {proposal.options.map((o, i) => {
                const isAdded = added.includes(o.step);
                const isRecorded = recorded.includes(o.step);
                return (
                  <section key={o.step} aria-label={`Option ${LETTERS[i]}: ${o.label}`} className="flex flex-col gap-1.5 rounded-md border border-line-soft bg-canvas-raised p-2">
                    <div className="flex items-start gap-1.5">
                      <span className="mt-px rounded bg-brand-soft px-1 text-[10.5px] font-bold text-brand-deep">{LETTERS[i]}</span>
                      <span className="min-w-0 text-[12.5px] font-semibold text-ink">{o.label}</span>
                      <button
                        type="button"
                        onClick={() => cite(o.step)}
                        title="Open the step that tested it"
                        className="ml-auto shrink-0 rounded border border-line-soft bg-white px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-brand-deep hover:border-brand"
                      >
                        {o.step}
                      </button>
                    </div>
                    <p className="text-[12px] leading-relaxed text-ink-body">
                      <Text text={o.mechanism} />
                    </p>
                    <span className={LABEL}>What it rests on</span>
                    <BasisList items={o.basis} />
                    {o.notTested.length || o.notes.length ? (
                      <>
                        <span className={LABEL}>What this test does not say</span>
                        <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[11.5px] text-ink-body">
                          {o.notTested.map((t, k) => (
                            <li key={k}><Text text={t} /></li>
                          ))}
                          {o.notes.map((t) => (
                            <li key={t}>{t}</li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      <button
                        type="button"
                        disabled={acting !== null || isAdded}
                        onClick={() => void add(o)}
                        className="flex items-center gap-1 rounded border border-line bg-white px-2 py-1 text-[11.5px] font-semibold text-ink hover:bg-canvas disabled:opacity-60"
                      >
                        {acting === `add:${o.step}` ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : isAdded ? <Check className="h-3 w-3 text-ok-ink" aria-hidden="true" /> : <Plus className="h-3 w-3" aria-hidden="true" />}
                        {isAdded ? "Added to the scenario" : "Add to scenario"}
                      </button>
                      <button
                        type="button"
                        disabled={acting !== null || isRecorded || !exchangeId}
                        onClick={() => void record(o)}
                        title={exchangeId ? undefined : "This test was not journalled, so there is nothing to record a decision from. Test again."}
                        className="flex items-center gap-1 rounded bg-brand px-2 py-1 text-[11.5px] font-semibold text-white disabled:opacity-60"
                      >
                        {acting === `record:${o.step}` ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : isRecorded ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
                        {isRecorded ? "Decision recorded" : "Record decision"}
                      </button>
                    </div>
                    {isAdded ? (
                      <p className="text-[11px] text-ink-muted">Its stamps are in the recipe. Press Run: the result should show the figures of this column.</p>
                    ) : null}
                    {isRecorded ? <p className="text-[11px] text-ink-muted">Kept under Decisions, with these figures as what is expected.</p> : null}
                  </section>
                );
              })}

              {actionError ? <p role="alert" className="rounded bg-danger-soft px-2 py-1.5 text-[12px] text-danger-ink">{actionError}</p> : null}

              {proposal.reading.map((p, i) => (
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

              {proposal.humanChoices.length ? (
                <div className="flex flex-col gap-1 rounded border border-scenario/30 bg-scenario-soft px-2 py-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-scenario">Yours to weigh · the tool does not settle these</span>
                  <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[12px] text-ink-body">
                    {proposal.humanChoices.map((t, i) => (
                      <li key={i}><Text text={t} /></li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {proposal.limits.length ? (
                <div className="flex flex-col gap-1">
                  <span className={LABEL}>What this cannot say</span>
                  <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[12px] text-ink-body">
                    {proposal.limits.map((t, i) => (
                      <li key={i}><Text text={t} /></li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {proposal.basis.length ? (
                <div className="flex flex-col gap-1">
                  <button type="button" aria-expanded={basisOpen} onClick={() => setBasisOpen((o) => !o)} className={cn(LABEL, "text-left hover:text-ink-body")}>
                    What every column rests on · {proposal.basis.length} {basisOpen ? "▾" : "▸"}
                  </button>
                  {basisOpen ? <BasisList items={proposal.basis} /> : null}
                </div>
              ) : null}

              {focus.length ? (
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
        The analyst writes nothing and decides nothing: an option enters the scenario, and a decision exists, on your
        click. What its tools read and what the tests return (counts and capacities, never a person) is sent to the
        Claude API to write the text.
      </p>
    </div>
  );
}
