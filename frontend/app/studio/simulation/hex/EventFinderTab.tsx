"use client";

/**
 * Event finder: what was happening around the network, searched in official
 * sources and proposed one candidate at a time.
 *
 * The analyst knows the twin and nothing else. Here it may search the web —
 * only the sources this project allows — for the place and the period the
 * person names. What comes back is a list of candidates, and a candidate is a
 * proposal: it enters the calendar when a person accepts it, with the dates
 * that person validated. Rejecting one calls nothing and records nothing.
 *
 * Three things on a candidate are not the model's: the link and the passage,
 * which are the search's own citations; the "Published" level; and whether a
 * date stands, which the server decides by looking for it in the passage. A
 * date it could not find is left blank, for the person to enter from the
 * source.
 *
 * Only the request goes into a search. This tab sends neither the twin, nor
 * the scenario, nor the run on screen.
 */

import { AlertTriangle, Check, Loader2, Search, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ApiError } from "@/lib/auth";
import { cn } from "@/lib/cn";

import {
  DOOR_LABEL,
  acceptEvent,
  fetchWebSources,
  findEvents,
  hostOf,
  isWebLink,
  saveWebSources,
  type AnalystStep,
  type EventCandidate,
  type EventsEvent,
  type EventsResult,
  type HealthEvent,
  type WebSources,
} from "../../analyst-api";
import { EvidenceBadge, LABEL, Text, Trace, WebChip } from "./analyst-parts";
import { dateOfDay } from "./reality";

const BLANK = /\[(place|date)\]/;

function suggestions(period: { origin: string; horizon: number } | null): string[] {
  const span = period ? `between ${period.origin} and ${dateOfDay(period.origin, period.horizon - 1)}` : "between [date] and [date]";
  return [
    `What public health measures were in force in [place] ${span}?`,
    `When did schools close and reopen in [place] ${span}?`,
    `Were there weather warnings in [place] ${span}?`,
  ];
}

const FIELD = "rounded border border-line bg-surface px-1.5 py-1 text-[11.5px] text-ink focus:border-brand focus:outline-none";

export default function EventFinderTab({
  env,
  scenario,
  period,
  onAccepted,
  onOff,
}: {
  env: string;
  scenario: { id: string; name: string } | null;
  /** The calendar dates the open scenario runs over, when its day 0 has one: only used to suggest a request. */
  period: { origin: string; horizon: number } | null;
  /** An event entered the calendar. */
  onAccepted: (event: HealthEvent) => void;
  /** The server said the analyst is switched off. */
  onOff: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [asked, setAsked] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [steps, setSteps] = useState<AnalystStep[]>([]);
  const [result, setResult] = useState<EventsResult | null>(null);
  const [exchangeId, setExchangeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [traceOpen, setTraceOpen] = useState(false);
  // What the person did with each candidate. Kept here only: a rejection is
  // never sent anywhere.
  const [dates, setDates] = useState<Record<string, { start: string; end: string }>>({});
  const [accepted, setAccepted] = useState<Record<string, { startsOn: string; endsOn: string | null }>>({});
  const [rejected, setRejected] = useState<string[]>([]);
  const [acting, setActing] = useState<string | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const abort = useRef<AbortController | null>(null);
  const box = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const searching = status !== null;

  async function search(request: string) {
    const q = request.trim();
    if (q.length < 3 || searching) return;
    if (BLANK.test(q)) {
      setHint("Replace [place] and [date] with the place and the dates you mean.");
      return;
    }
    setHint(null);
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
    setDates({});
    setAccepted({});
    setRejected([]);
    setProblems({});
    setStatus("Sending the request");
    const onEvent = (e: EventsEvent) => {
      if (e.type === "status") setStatus(e.message);
      else if (e.type === "step") setSteps((s) => [...s, e.step]);
      else if (e.type === "failed") setError(e.message);
      else if (e.type === "done") {
        setResult(e.result);
        setSteps(e.result.steps);
        setExchangeId(e.exchangeId ?? null);
        setTraceOpen(e.result.status !== "answered");
        setDates(Object.fromEntries((e.result.answer?.candidates ?? []).map((c) => [c.id, { start: c.startDate ?? "", end: c.endDate ?? "" }])));
      }
    };
    try {
      await findEvents(env, { request: q, scenarioId: scenario?.id ?? null }, onEvent, controller.signal);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      if (err instanceof ApiError && err.code === "ANALYST_NOT_CONFIGURED") onOff();
      setError(err instanceof ApiError ? err.message : "The analyst could not be reached. Check the connection and search again.");
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
    setError("Stopped. Nothing was found, and nothing was recorded.");
  }

  function suggest(text: string) {
    setDraft(text);
    setHint(BLANK.test(text) ? "Replace [place] and [date] with the place and the dates you mean, then search." : null);
    box.current?.focus();
  }

  async function accept(c: EventCandidate) {
    const d = dates[c.id] ?? { start: "", end: "" };
    const fail = (message: string) => setProblems((p) => ({ ...p, [c.id]: message }));
    if (!exchangeId) return fail("This search was not journalled, so there is nothing to accept an event from. Search again.");
    if (!d.start) return fail("Enter the start date from the source before accepting.");
    if (d.end && d.end < d.start) return fail("The event ends before it starts. Correct the dates.");
    setActing(c.id);
    setProblems((p) => {
      const next = { ...p };
      delete next[c.id];
      return next;
    });
    try {
      const event = await acceptEvent(env, { exchangeId, candidate: c.id, startsOn: d.start, endsOn: d.end || null });
      setAccepted((a) => ({ ...a, [c.id]: { startsOn: event.startsOn, endsOn: event.endsOn } }));
      onAccepted(event);
    } catch (err) {
      if (err instanceof ApiError && err.code === "EVENT_ALREADY_ACCEPTED") {
        setAccepted((a) => ({ ...a, [c.id]: { startsOn: d.start, endsOn: d.end || null } }));
      } else {
        fail(err instanceof ApiError ? err.message : "The event could not be accepted. Check the connection and try again.");
      }
    } finally {
      setActing(null);
    }
  }

  /** Opens the step a candidate rests on: the passage, as the search returned it. */
  function cite(id: string) {
    setTraceOpen(true);
    setOpenStep(id);
  }

  const proposal = result?.answer ?? null;
  const candidates = proposal?.candidates ?? [];
  const removed = result ? result.struck.length : 0;

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2 p-3">
        <p className="text-[11.5px] text-ink-muted">
          Searches official sources for what was happening around the network: measures, closures, weather, outbreaks. Name a
          place, a period and a kind of event.
        </p>

        <form
          className="flex items-end gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void search(draft);
          }}
        >
          <label htmlFor="event-request" className="sr-only">What to look for in official sources</label>
          <textarea
            id="event-request"
            ref={box}
            rows={2}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setHint(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void search(draft);
              }
            }}
            placeholder="What measures were in force in Montréal between 2021-12-01 and 2022-02-28?"
            className="min-w-0 flex-1 resize-none rounded border border-line bg-surface px-2 py-1.5 text-[12.5px] text-ink focus:border-brand focus:outline-none"
          />
          {searching ? (
            <button type="button" onClick={stop} className="rounded border border-line px-2.5 py-1.5 text-[12px] text-ink-body hover:bg-surface-hover">
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={draft.trim().length < 3}
              className="flex items-center gap-1 rounded bg-brand px-2.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
            >
              <Search className="h-3.5 w-3.5" aria-hidden="true" /> Search
            </button>
          )}
        </form>
        {hint ? <p role="status" className="text-[11.5px] text-warn-ink">{hint}</p> : null}

        {!asked ? (
          <div className="flex flex-wrap gap-1.5">
            {suggestions(period).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => suggest(s)}
                className="rounded-full border border-line bg-surface px-2.5 py-1 text-left text-[11.5px] text-ink-body hover:border-brand hover:bg-brand-soft"
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}

        <Sources env={env} locked={searching} />
      </div>

      {asked ? (
        <div className="flex flex-col gap-2 border-t border-line-soft p-3">
          <p className="text-[12.5px] font-semibold text-ink">{asked}</p>

          {searching ? (
            <p role="status" className="flex items-center gap-2 text-[12px] text-ink-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> {status}…
            </p>
          ) : null}

          {error ? <p role="alert" className="rounded bg-danger-soft px-2 py-1.5 text-[12px] text-danger-ink">{error}</p> : null}

          {result && !proposal ? (
            <p role="alert" className="rounded bg-warn-soft px-2 py-1.5 text-[12px] text-warn-ink">{result.message ?? "No candidate was delivered."}</p>
          ) : null}

          {proposal ? (
            <>
              {candidates.length === 0 ? (
                <p className="rounded bg-canvas-raised px-2 py-1.5 text-[12px] text-ink-body">
                  No candidate event was found in the allowed sources. Nothing was made up in its place.
                </p>
              ) : result!.verified ? (
                <p className="flex items-start gap-1.5 rounded bg-ok-soft px-2 py-1.5 text-[11.5px] text-ok-ink">
                  <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Every link, quotation and date below was found in a passage the search returned. Each candidate is a proposal
                  until you accept it.
                </p>
              ) : (
                <p role="alert" className="flex items-start gap-1.5 rounded bg-warn-soft px-2 py-1.5 text-[11.5px] text-warn-ink">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {removed} thing{removed === 1 ? "" : "s"} the analyst wrote could not be found in the passages and{" "}
                  {removed === 1 ? "was" : "were"} taken out. The candidates concerned say what to check in the source.
                </p>
              )}

              <ul className="flex flex-col gap-2">
                {candidates.map((c) => {
                  const d = dates[c.id] ?? { start: "", end: "" };
                  const done = accepted[c.id];
                  if (rejected.includes(c.id)) {
                    return (
                      <li key={c.id} className="flex items-center justify-between gap-2 rounded-md border border-line-soft bg-canvas-raised px-2 py-1.5 text-[11.5px] text-ink-muted">
                        <span className="min-w-0 truncate">Rejected, not recorded: {c.title}</span>
                        <button type="button" onClick={() => setRejected((r) => r.filter((id) => id !== c.id))} className="shrink-0 underline hover:text-ink-body">
                          Undo
                        </button>
                      </li>
                    );
                  }
                  const corrected = d.start !== (c.startDate ?? "") || d.end !== (c.endDate ?? "");
                  return (
                    <li key={c.id} aria-label={c.title} className={cn("flex flex-col gap-1.5 rounded-md border p-2", done ? "border-ok-ink/40 bg-ok-soft/40" : "border-line-soft bg-surface")}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span title={DOOR_LABEL[c.door].title} className="rounded bg-canvas px-1 py-px text-[9.5px] font-bold uppercase tracking-wide text-ink-body">
                          {DOOR_LABEL[c.door].label}
                        </span>
                        <EvidenceBadge evidence="published" />
                        <WebChip url={c.url} title={c.sourceTitle || undefined} />
                      </div>
                      <p className="text-[12.5px] font-semibold leading-snug text-ink"><Text text={c.title} /></p>
                      <p className="text-[11.5px] text-ink-muted"><Text text={c.place} /></p>
                      <blockquote className="border-l-2 border-brand-soft pl-2 text-[12px] italic text-ink-body">
                        “{c.quote}”
                        <span className="not-italic text-ink-muted">
                          {" — "}
                          {isWebLink(c.url) ? (
                            <a href={c.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-ink-body">
                              {c.sourceTitle || c.url}
                            </a>
                          ) : (
                            c.sourceTitle || c.url
                          )}
                        </span>
                      </blockquote>
                      {c.quoteReplaced ? (
                        <p className="text-[11px] text-warn-ink">The analyst’s quotation was not in the passage. These are the passage’s own opening words.</p>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="text-[10.5px] text-ink-faint">Rests on</span>
                        {c.passages.map((p) => (
                          <button
                            key={p.step}
                            type="button"
                            onClick={() => cite(p.step)}
                            title={p.text}
                            className="flex max-w-full items-center gap-1 rounded border border-line-soft bg-canvas-raised px-1.5 py-0.5 text-[10.5px] text-ink-body hover:border-brand"
                          >
                            <span className="font-mono font-bold text-brand-deep">{p.step}</span>
                            <span className="truncate">passage · {hostOf(p.url)}</span>
                          </button>
                        ))}
                      </div>

                      {done ? (
                        <p className="flex items-center gap-1 text-[11.5px] font-semibold text-ok-ink">
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          In the calendar: {done.startsOn}
                          {done.endsOn && done.endsOn !== done.startsOn ? ` to ${done.endsOn}` : ""}
                        </p>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-end gap-2">
                            <label className="flex flex-col gap-0.5">
                              <span className={LABEL}>Starts</span>
                              <input
                                type="date"
                                value={d.start}
                                onChange={(e) => setDates((all) => ({ ...all, [c.id]: { ...d, start: e.target.value } }))}
                                className={FIELD}
                              />
                            </label>
                            <label className="flex flex-col gap-0.5">
                              <span className={LABEL}>Ends</span>
                              <input
                                type="date"
                                value={d.end}
                                onChange={(e) => setDates((all) => ({ ...all, [c.id]: { ...d, end: e.target.value } }))}
                                className={FIELD}
                              />
                            </label>
                            <span className="pb-1 text-[11px] text-ink-faint">Leave the end blank for one day, or no stated end.</span>
                          </div>
                          {c.datesRemoved.length ? (
                            <p className="text-[11px] text-warn-ink">
                              The passage does not state the {c.datesRemoved.join(" or the ")} date the analyst gave, so it was taken out. Read the
                              source and enter it.
                            </p>
                          ) : !c.startDate ? (
                            <p className="text-[11px] text-warn-ink">The passage does not state the day it started. Read the source and enter it.</p>
                          ) : null}
                          {corrected ? (
                            <p className="text-[11px] text-ink-muted">
                              You changed the dates. Proposed: {c.startDate ?? "no start"}
                              {c.endDate ? ` to ${c.endDate}` : ""}. Both are kept.
                            </p>
                          ) : null}
                          {problems[c.id] ? <p role="alert" className="text-[11.5px] text-danger-ink">{problems[c.id]}</p> : null}
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              disabled={acting !== null}
                              onClick={() => void accept(c)}
                              className="flex items-center gap-1 rounded bg-brand px-2 py-1 text-[11.5px] font-semibold text-white disabled:opacity-60"
                            >
                              {acting === c.id ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Check className="h-3 w-3" aria-hidden="true" />}
                              Accept
                            </button>
                            <button
                              type="button"
                              disabled={acting !== null}
                              onClick={() => setRejected((r) => [...r, c.id])}
                              className="flex items-center gap-1 rounded border border-line bg-surface px-2 py-1 text-[11.5px] font-semibold text-ink hover:bg-surface-hover disabled:opacity-60"
                            >
                              <X className="h-3 w-3" aria-hidden="true" /> Reject
                            </button>
                          </div>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>

              {proposal.notFound.length ? (
                <div className="flex flex-col gap-1">
                  <span className={LABEL}>Not found in the allowed sources</span>
                  <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[12px] text-ink-body">
                    {proposal.notFound.map((t, i) => (
                      <li key={i}><Text text={t} /></li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {proposal.limits.length ? (
                <div className="flex flex-col gap-1">
                  <span className={LABEL}>What these cannot say</span>
                  <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[12px] text-ink-body">
                    {proposal.limits.map((t, i) => (
                      <li key={i}><Text text={t} /></li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {asked ? (
        <Trace steps={steps} open={traceOpen} onToggle={() => setTraceOpen((o) => !o)} openStep={openStep} onOpenStep={setOpenStep} done={!searching && result !== null} />
      ) : null}

      <p className="border-t border-line-soft px-3 py-2 text-[10.5px] text-ink-faint">
        {result
          ? `Written by ${result.model} from ${result.steps.length} step${result.steps.length === 1 ? "" : "s"} · ${result.usage.webSearches ?? 0} web search${(result.usage.webSearches ?? 0) === 1 ? "" : "es"} · ${(result.usage.inputTokens + result.usage.outputTokens).toLocaleString("en-CA")} tokens. `
          : ""}
        Only your request goes into a search: nothing from the twin, the scenario or a run is sent. A candidate enters the
        calendar when you accept it; a rejected one is recorded nowhere.
      </p>
    </div>
  );
}

/** The sources the search is restricted to, and the place to change them. */
function Sources({ env, locked }: { env: string; locked: boolean }) {
  const [sources, setSources] = useState<WebSources | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchWebSources(env)
      .then((s) => live && setSources(s))
      // Not knowing the list does not stop a search: the server applies it either way.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [env]);

  if (!sources) return null;

  async function save() {
    setSaving(true);
    setProblem(null);
    try {
      setSources(await saveWebSources(env, text.split(/[\n,]/).map((d) => d.trim()).filter(Boolean)));
      setEditing(false);
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : "The list could not be saved. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <p className="text-[11px] text-ink-muted">
        <span className="font-semibold text-ink-body">Sources searched{sources.isDefault ? " (starting list)" : ""}:</span>{" "}
        {sources.domains.length ? sources.domains.join(", ") : "none — the search is off for this project"}.{" "}
        <button
          type="button"
          disabled={locked}
          onClick={() => {
            setText(sources.domains.join("\n"));
            setProblem(null);
            setEditing(true);
          }}
          className="underline hover:text-ink-body disabled:opacity-50"
        >
          Change
        </button>
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1.5 rounded border border-line-soft bg-canvas-raised p-2">
      <label htmlFor="web-sources" className={LABEL}>Sources the search may use · one domain a line, at most {sources.max}</label>
      <textarea
        id="web-sources"
        rows={Math.min(8, Math.max(3, text.split("\n").length))}
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        className="resize-y rounded border border-line bg-surface px-2 py-1 font-mono text-[11.5px] text-ink focus:border-brand focus:outline-none"
      />
      <p className="text-[11px] text-ink-muted">
        Write a domain like quebec.ca, without https://. It covers its subdomains. Results come from these sources only, for
        everyone working in this project.
      </p>
      {problem ? <p role="alert" className="text-[11.5px] text-danger-ink">{problem}</p> : null}
      <div className="flex flex-wrap gap-1.5">
        <button type="button" disabled={saving} onClick={() => void save()} className="flex items-center gap-1 rounded bg-brand px-2 py-1 text-[11.5px] font-semibold text-white disabled:opacity-60">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null} Save
        </button>
        <button type="button" disabled={saving} onClick={() => setText(sources.defaults.join("\n"))} className="rounded border border-line bg-surface px-2 py-1 text-[11.5px] text-ink-body hover:bg-surface-hover disabled:opacity-60">
          Starting list
        </button>
        <button type="button" disabled={saving} onClick={() => setEditing(false)} className="rounded border border-line bg-surface px-2 py-1 text-[11.5px] text-ink-body hover:bg-surface-hover disabled:opacity-60">
          Cancel
        </button>
      </div>
    </div>
  );
}
