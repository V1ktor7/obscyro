"use client";

/**
 * Options: say what should change, and see what the engine gives for up to
 * three ways of changing it.
 *
 * The analyst proposes; the engine tests; a person decides. So three things
 * here are not the model's:
 *
 * - the figures on the cards. Each is the engine's own count from a test, read
 *   from the test's record, and drawn beside the same scenario run as it
 *   stands: a bar for the waiting, a square per site for the queues;
 * - the level of evidence beside each thing a run rests on — measured,
 *   published or assumption — which the server assigns from where that thing
 *   comes from;
 * - the two buttons. "Add to scenario" writes the option's stamps (and, for
 *   an option that replaces or removes a choice the scenario holds, takes that
 *   choice out: the button then reads "Apply to scenario"), and "Record
 *   decision" keeps the choice with the figures expected of it. Nothing happens
 *   to the scenario until one of them is pressed.
 *
 * Options are shown in the order they were tested. Nothing ranks them: no card
 * is marked as the best one. One thing is said, because it holds whatever a
 * person thinks a patient-day of waiting is worth: an option is marked as
 * dominated when another costs no more and leaves no more waiting, by their
 * own runs. That is the marking of the replay of the units page
 * (`command/options.ts`), and it is made only between options whose whole cost
 * is counted: by the engine for a recorded response, from the twin's price list
 * for the capacity an option opens. What a run cost sits on its card, with the
 * day what it opens is available; a click on a cost opens its lines.
 *
 * A card is read at a glance and explained on a click: what the option does and
 * why, what its run rests on, and what the test does not say are folded under
 * it (see `option-cards.tsx`).
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
  type OptionsEvent,
  type OptionsResult,
  type ProposedOption,
  type RunDigest,
} from "../../analyst-api";
import { ActionTypesOf, Elapsed, LABEL, OptionChanges, STRUCK, Text, Trace } from "./analyst-parts";
import KeepPrepared from "./KeepPrepared";
import { BasisList, CostLine, DelayLine, EvidenceMeter, Figures, Fold, hasPriceList, Outcome, placesResponse, waitingScale, weighOptions } from "./option-cards";
import { takesOut } from "./option-write";

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
  /** Applies an option to the scenario: its stamps written, the choices it takes out deleted. Rejects when it cannot. */
  onAdd: (option: ProposedOption) => Promise<void>;
  /** A decision was recorded. */
  onRecorded: () => void;
  /** The server said the analyst is switched off. */
  onOff: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // When the line that says what is being done last changed: a test in the
  // engine is the long wait, and the person is told how long it has been.
  const [statusAt, setStatusAt] = useState(0);
  const [steps, setSteps] = useState<AnalystStep[]>([]);
  const [result, setResult] = useState<OptionsResult | null>(null);
  const [exchangeId, setExchangeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [traceOpen, setTraceOpen] = useState(false);
  const [basisOpen, setBasisOpen] = useState(false);
  // The scenario as it was when the options were tested.
  const [testedKey, setTestedKey] = useState<string | null>(null);
  // The scenario as this tab left it after adding an option: the one change
  // since the tests that is not somebody editing the recipe elsewhere.
  const [ownKey, setOwnKey] = useState<string | null>(null);
  // The scenario as it was when this tab began writing an option into it. The
  // next scenario that differs is the one that write left. "A write is in
  // flight" would not tell: the page reads the recipe back before the write
  // settles, and React shows it only after.
  const [writingFrom, setWritingFrom] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [recorded, setRecorded] = useState<string[]>([]);
  const [acting, setActing] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  // The recipe changed after this tab wrote an option into it. Settled while
  // rendering, so the warning meant for an edit made elsewhere is never shown
  // for the tab's own write, not even for one frame.
  if (writingFrom !== null && scenarioKey !== writingFrom) {
    setOwnKey(scenarioKey);
    setWritingFrom(null);
  }

  useEffect(() => {
    // Back to the scenario that was tested: what was added has been taken out again.
    if (testedKey !== null && scenarioKey === testedKey) {
      setAdded([]);
      setOwnKey(null);
    }
  }, [scenarioKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setOwnKey(null);
    setWritingFrom(null);
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
    setOwnKey(null);
    setWritingFrom(null);
    setRecorded([]);
    setActionError(null);
    setTestedKey(scenarioKey);
    setStatus("Sending the objective");
    setStatusAt(Date.now());
    const onEvent = (e: OptionsEvent) => {
      if (e.type === "status") {
        setStatus(e.message);
        setStatusAt(Date.now());
      }
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
    setWritingFrom(scenarioKey);
    try {
      await onAdd(o);
      setAdded((a) => [...a, o.step]);
    } catch (err) {
      // Part of it may have been written: the scenario is then one no test covered.
      setWritingFrom(null);
      setOwnKey(null);
      setActionError(`“${o.label}” was not ${takesOut(o) ? "applied" : "added"}: ${err instanceof Error ? err.message : String(err)}`);
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
  const moved = proposal !== null && testedKey !== null && testedKey !== scenarioKey;
  // Three ways the scenario can differ from the one tested, and they do not
  // mean the same thing: one option added from here (Run should give its
  // column), several added together (a scenario no test covered), or an edit
  // made elsewhere (every column is out of date).
  const ownOnly = moved && ownKey === scenarioKey && added.length > 0;
  const addedOne = ownOnly && added.length === 1 ? (proposal?.options.find((o) => o.step === added[0]) ?? null) : null;
  const changed = moved && !addedOne;
  const focus = (proposal?.focusSites ?? []).map((id) => ({ id, name: siteName(id) })).filter((s): s is { id: string; name: string } => s.name !== null);
  const showStranded = proposal?.asItIs?.strandedWaitingDays != null;
  // One scale for every bar, so the cards can be compared with each other.
  const scale = proposal ? waitingScale([...(proposal.asItIs ? [proposal.asItIs] : []), ...proposal.options.map((o) => o.figures)]) : 1;
  // Dominated options, by the runs: the one comparison of cost and effect that needs no exchange rate.
  const weighing = proposal?.asItIs ? weighOptions(proposal.asItIs, proposal.options) : { dominated: new Map<string, string>(), weighed: 0, unbeaten: new Set<string>() };
  // Once any run on screen has a counted cost, every card says its own, or why it has none.
  const anyCost = Boolean(proposal && (proposal.asItIsCost?.counted != null || proposal.options.some((o) => o.cost?.counted != null)));
  // The twin declares a price list and it says something of an option on screen: a price, or why there is none.
  const anyPriceList = Boolean(proposal?.options.some((o) => hasPriceList(o.cost)));

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
            className="min-w-0 flex-1 resize-none rounded border border-line bg-surface px-2 py-1.5 text-[12.5px] text-ink focus:border-brand focus:outline-none"
          />
          {asking ? (
            <button type="button" onClick={stop} className="rounded border border-line px-2.5 py-1.5 text-[12px] text-ink-body hover:bg-surface-hover">
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
                className="rounded-full border border-line bg-surface px-2.5 py-1 text-left text-[11.5px] text-ink-body hover:border-brand hover:bg-brand-soft disabled:opacity-50"
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
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> {status}… <Elapsed since={statusAt} />
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
              {addedOne ? (
                <p role="status" className="flex items-start gap-1.5 rounded bg-brand-soft px-2 py-1.5 text-[11.5px] text-brand-deep">
                  <Check className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  “{addedOne.label}” is now in the scenario: Run should give the figures of its card. The other options
                  were tested without it, so their cards no longer describe this scenario.
                </p>
              ) : changed ? (
                <p role="alert" className="flex items-start gap-1.5 rounded bg-warn-soft px-2 py-1.5 text-[11.5px] text-warn-ink">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {ownOnly
                    ? `${added.length} options are now in the scenario together. No test covered them together: state the objective again, or run the scenario, before relying on a card.`
                    : "The scenario was edited since these options were tested. The figures below describe it as it was; state the objective again before relying on them."}
                </p>
              ) : null}

              {result!.verified ? (
                <p className="flex items-start gap-1.5 rounded bg-ok-soft px-2 py-1.5 text-[11.5px] text-ok-ink">
                  <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  The figures on the cards are the engine’s own counts, and every figure in the text was found in the steps it cites.
                </p>
              ) : (
                <p role="alert" className="flex items-start gap-1.5 rounded bg-warn-soft px-2 py-1.5 text-[11.5px] text-warn-ink">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {removed} figure{removed === 1 ? " was" : "s were"} removed from the text: the steps it cites did not hold{" "}
                  {removed === 1 ? "it" : "them"}, or held {removed === 1 ? "it" : "them"} for another site. The figures on the
                  cards are the engine’s own counts and are not affected.
                </p>
              )}

              {proposal.asItIs && proposal.options.length ? (
                <div className="flex flex-col gap-2">
                  <span className={LABEL}>
                    Tested by the engine · {proposal.horizon} days · {proposal.activity} · not a forecast
                  </span>
                  <section aria-label="The scenario as it is" className="flex flex-col gap-2.5 border border-dashed border-line-strong p-3">
                    <div className="flex items-start gap-2">
                      <span className="min-w-0 text-[12.5px] font-semibold text-ink">The scenario as it is</span>
                      <span className="ml-auto"><Outcome figures={proposal.asItIs} /></span>
                    </div>
                    <Figures figures={proposal.asItIs} scale={scale} stranded={showStranded} />
                    {proposal.asItIsCost && proposal.asItIsCost.counted !== null ? <CostLine cost={proposal.asItIsCost} /> : null}
                  </section>
                </div>
              ) : null}

              {proposal.options.map((o, i) => {
                const isAdded = added.includes(o.step);
                const isRecorded = recorded.includes(o.step);
                // "Add" would be the wrong word for an option that takes a choice out.
                const edits = takesOut(o);
                const unsaid = o.notTested.length + o.notes.length;
                const beatenBy = weighing.dominated.get(o.step);
                return (
                  <section key={o.step} aria-label={`Option ${LETTERS[i]}: ${o.label}`} className="flex flex-col border border-line bg-canvas-raised">
                    <div className="flex flex-col gap-2.5 p-3">
                      <div className="flex items-start gap-2">
                        <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center bg-brand-soft text-[11px] font-bold text-brand-deep">{LETTERS[i]}</span>
                        <span className="min-w-0 text-[12.5px] font-semibold leading-snug text-ink">{o.label}</span>
                        <span className="ml-auto"><Outcome figures={o.figures} /></span>
                      </div>
                      <Figures figures={o.figures} against={proposal.asItIs} scale={scale} stranded={showStranded} />
                      {o.cost ? <DelayLine cost={o.cost} /> : null}
                      {o.cost && (anyCost || anyPriceList || placesResponse(o)) ? <CostLine cost={o.cost} /> : null}
                      {/* Shown once the twin's price list is on screen: without one, the cards are what they were. */}
                      {anyPriceList && weighing.unbeaten.has(o.step) ? (
                        <p role="note" className="flex items-start gap-1.5 bg-ok-soft px-2 py-1.5 text-[11.5px] text-ok-ink">
                          <Check className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span>
                            <span className="font-semibold">Not beaten.</span> By these runs, no other option weighed here both costs no more and
                            leaves no more waiting. Several options can carry this mark: it is not a ranking.
                          </span>
                        </p>
                      ) : null}
                      {beatenBy !== undefined ? (
                        <p role="note" className="flex items-start gap-1.5 bg-warn-soft px-2 py-1.5 text-[11.5px] text-warn-ink">
                          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span>
                            <span className="font-semibold">Dominated.</span> By these runs, “{beatenBy}” costs no more and leaves no more waiting.
                            Whatever a patient-day of waiting is worth, this option is not the one to prefer on these two counts.
                          </span>
                        </p>
                      ) : null}
                    </div>

                    <Fold
                      title="Why this option"
                      // Where a figure was taken out of the text is shown without a click.
                      defaultOpen={o.mechanism.includes(STRUCK)}
                      meta={<span className="text-[10.5px] text-ink-faint">tested in {o.step}</span>}
                    >
                      <p className="text-[12px] leading-relaxed text-ink-body">
                        <Text text={o.mechanism} />
                      </p>
                      <OptionChanges changes={o.changes} heading="What it does to the scenario" />
                      <ActionTypesOf changes={o.changes} />
                      <button
                        type="button"
                        onClick={() => cite(o.step)}
                        title="Open the step that tested it"
                        className="self-start border border-line-soft bg-surface px-1.5 py-0.5 text-[10.5px] text-ink-body hover:border-brand"
                      >
                        Open step <span className="font-mono font-bold text-brand-deep">{o.step}</span>
                      </button>
                    </Fold>
                    <Fold title="What it rests on" below={<EvidenceMeter items={o.basis} />}>
                      <BasisList items={o.basis} />
                    </Fold>
                    {unsaid ? (
                      <Fold
                        title="What this test does not say"
                        defaultOpen={o.notTested.some((t) => t.includes(STRUCK))}
                        meta={<span className="text-[10.5px] tabular-nums text-ink-faint">{unsaid}</span>}
                      >
                        <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[11.5px] text-ink-body">
                          {o.notTested.map((t, k) => (
                            <li key={k}><Text text={t} /></li>
                          ))}
                          {o.notes.map((t) => (
                            <li key={t}>{t}</li>
                          ))}
                        </ul>
                      </Fold>
                    ) : null}

                    <div className="flex flex-col gap-1.5 border-t border-line-soft p-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          disabled={acting !== null || isAdded}
                          onClick={() => void add(o)}
                          title={edits ? "Writes its stamps into the recipe and takes out the choices it replaces or removes." : undefined}
                          className="flex h-7 items-center gap-1 border border-line-strong bg-surface px-2.5 text-[11.5px] font-semibold text-ink hover:bg-surface-hover disabled:opacity-60"
                        >
                          {acting === `add:${o.step}` ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : isAdded ? <Check className="h-3 w-3 text-ok-ink" aria-hidden="true" /> : <Plus className="h-3 w-3" aria-hidden="true" />}
                          {edits ? (isAdded ? "Applied to the scenario" : "Apply to scenario") : isAdded ? "Added to the scenario" : "Add to scenario"}
                        </button>
                        <button
                          type="button"
                          disabled={acting !== null || isRecorded || !exchangeId}
                          onClick={() => void record(o)}
                          title={exchangeId ? undefined : "This test was not journalled, so there is nothing to record a decision from. Test again."}
                          className="flex h-7 items-center gap-1 bg-brand px-2.5 text-[11.5px] font-semibold text-white hover:bg-brand-deep disabled:opacity-60"
                        >
                          {acting === `record:${o.step}` ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : isRecorded ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
                          {isRecorded ? "Decision recorded" : "Record decision"}
                        </button>
                      </div>
                      {isAdded ? (
                        <p className="text-[11px] text-ink-muted">
                          {edits
                            ? "The recipe now holds its stamps, in place of the choices it replaced or removed. Press Run: the result should show the figures of this card."
                            : "Its stamps are in the recipe. Press Run: the result should show the figures of this card."}
                        </p>
                      ) : null}
                      {isRecorded ? <p className="text-[11px] text-ink-muted">Kept under Decisions, with these figures as what is expected.</p> : null}
                      {/* The calm-time half of the live loop: this test, kept for the day a signal of some kind is raised. */}
                      <KeepPrepared env={env} exchangeId={exchangeId} step={o.step} label={o.label} current={!moved} disabled={acting !== null} />
                    </div>
                  </section>
                );
              })}

              {proposal.asItIs && proposal.options.length ? (
                <p className="text-[10.5px] text-ink-faint">
                  “As it is” is this scenario with the choices it already holds. Each option is the same run with its
                  changes applied: stamps added and, where its card says so, a choice of the scenario replaced or removed.
                  Every bar is drawn on the same scale, and the tick on it marks the scenario as it is. In the order
                  tested; nothing here ranks them.
                  {weighing.weighed > 0
                    ? ` An option is marked as dominated only when another costs no more and leaves no more waiting, which holds whatever a patient-day is worth. ${weighing.weighed} of ${proposal.options.length} option${proposal.options.length === 1 ? "" : "s"} here ${weighing.weighed === 1 ? "has" : "have"} a whole cost counted ${anyPriceList ? "(by the engine for a recorded response, from the twin’s price list for capacity) and can be weighed that way; a measure carries no price." : "by the engine and can be weighed that way; capacity and measures carry no price."}`
                    : ""}
                  {anyPriceList
                    ? " A cost from the price list is the cost of what the option opens: opening units, then keeping them open for the days of the run. It is not what the network costs to run, and nothing here turns waiting into dollars."
                    : ""}
                </p>
              ) : null}

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
                    What every option rests on · {proposal.basis.length} {basisOpen ? "▾" : "▸"}
                  </button>
                  {basisOpen ? <BasisList items={proposal.basis} /> : null}
                  {basisOpen && proposal.options.some(takesOut) ? (
                    <p className="text-[10.5px] text-ink-faint">
                      A choice an option replaces or removes is in “As it is” and not in that option’s card.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {focus.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {focus.map((s) => (
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
