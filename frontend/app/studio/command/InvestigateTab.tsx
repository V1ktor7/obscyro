"use client";

/**
 * Investigate: what was going on around a unit while its series moved.
 *
 * The person has a unit selected on the map and a measure painted on it. They
 * send one sentence. From there two things work, and both are shown as they
 * go: the program reads the series the twin kept, its episodes beyond the
 * alert threshold, the calendar and the nearest units; the analyst searches
 * the project's allowed sources for events. Then the program sets each event
 * beside the series.
 *
 * Three things are kept apart on every event, as everywhere in the Studio:
 * what a source published (the event, its passage, its dates), what the twin
 * measured (the days around it), and what is only supposed (that the two have
 * anything to do with each other). The last is never written as a finding.
 *
 * Only the sentence goes into a search. The series, the threshold and the
 * neighbours are read by the server and stay there.
 */

import { Check, ChevronRight, History, Loader2, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ApiError } from "@/lib/auth";
import { cn } from "@/lib/cn";

import {
  DOOR_LABEL,
  acceptEvent,
  investigate,
  isWebLink,
  listInvestigations,
  readInvestigation,
  type AnalystStep,
  type Comparison,
  type EventCandidate,
  type InvestigationEvent,
  type InvestigationLine,
  type InvestigationResult,
} from "../analyst-api";
import { Elapsed, EvidenceBadge, LABEL, Text, Trace, WebChip } from "../simulation/hex/analyst-parts";
import { formatMetricValue } from "../twin-ui";
import {
  SPANS,
  dayOn,
  doubtText,
  episodeNumber,
  measuredLines,
  pairingOf,
  proposedRequest,
  signedChange,
  spanFrom,
  spanLabel,
  stagesOf,
  verdictOf,
  type Pairing,
} from "./investigation";

type Unit = "percent" | "ratio" | "count" | "number" | "hours";

/** What the tab hands the page once an investigation has delivered: enough to draw it on the timeline. */
export interface InvestigationOnPage {
  unitId: string;
  metric: string;
  from: string;
  to: string;
  result: InvestigationResult;
}

const FIELD = "rounded border border-line bg-surface px-1.5 py-1 text-[11.5px] text-ink focus:border-brand focus:outline-none";
const DOT: Record<Pairing, string> = { before: "bg-brand", inside: "bg-warn", none: "bg-ink-ghost", unplaced: "bg-ink-ghost" };
const zoneHere = (): string | null => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
};

export default function InvestigateTab({
  env,
  unit,
  several,
  metric,
  kept,
  hours,
  onHours,
  onOff,
  onInvestigation,
}: {
  env: string;
  /** The unit whose series is read: the one unit counted at the selected site. Null when nothing is selected. */
  unit: { id: string; name: string } | null;
  /** The selected site counts several units: their histories were not kept together. */
  several: boolean;
  /** The measure the map paints. */
  metric: { key: string; label: string; unit: Unit };
  /** False when the measure is not one the twin keeps over time. */
  kept: boolean;
  /** The span, shared with the timeline. */
  hours: number;
  onHours: (hours: number) => void;
  /** The server said the analyst is switched off. */
  onOff: () => void;
  /** An investigation delivered, or the one on screen was cleared. */
  onInvestigation?: (shown: InvestigationOnPage | null) => void;
}) {
  const zone = useMemo(zoneHere, []);
  const [draft, setDraft] = useState("");
  // The sentence proposed last: the box follows the selection until the person writes in it.
  const proposed = useRef("");
  const [asked, setAsked] = useState<{ request: string; unit: string; span: string } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [steps, setSteps] = useState<AnalystStep[]>([]);
  const [result, setResult] = useState<InvestigationResult | null>(null);
  const [exchangeId, setExchangeId] = useState<string | null>(null);
  const [reread, setReread] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [traceOpen, setTraceOpen] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [dates, setDates] = useState<Record<string, { start: string; end: string }>>({});
  const [accepted, setAccepted] = useState<Record<string, { startsOn: string; endsOn: string | null }>>({});
  const [rejected, setRejected] = useState<string[]>([]);
  const [acting, setActing] = useState<string | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [past, setPast] = useState<InvestigationLine[] | null>(null);
  const [pastOpen, setPastOpen] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const working = status !== null;
  const unitId = unit?.id ?? null;
  const unitName = unit?.name ?? null;

  // The proposed sentence follows the unit and the span, unless the person has written their own.
  useEffect(() => {
    if (!unitName) return;
    const span = spanFrom(hours, new Date());
    const next = proposedRequest(unitName, dayOn(span.from, zone), dayOn(span.to, zone));
    setDraft((cur) => (cur === "" || cur === proposed.current ? next : cur));
    proposed.current = next;
  }, [unitName, hours, zone]);

  // The investigations already made of this unit: the trace they left can be read again.
  useEffect(() => {
    if (!unitId) {
      setPast(null);
      return;
    }
    let live = true;
    listInvestigations(env, unitId)
      .then((r) => live && setPast(r.investigations))
      // Not knowing the earlier ones takes nothing from a new one.
      .catch(() => live && setPast(null));
    return () => {
      live = false;
    };
  }, [env, unitId, exchangeId]);

  function show(r: InvestigationResult, id: string | null, at: { unitId: string; metric: string; from: string; to: string } | null) {
    setResult(r);
    setSteps(r.steps);
    setExchangeId(id);
    setTraceOpen(r.status !== "answered");
    setDates(Object.fromEntries((r.answer?.candidates ?? []).map((c) => [c.id, { start: c.startDate ?? "", end: c.endDate ?? "" }])));
    onInvestigation?.(r.answer && at ? { ...at, result: r } : null);
  }

  function reset() {
    setSteps([]);
    setResult(null);
    setExchangeId(null);
    setReread(null);
    setError(null);
    setOpenStep(null);
    setOpenRow(null);
    setDates({});
    setAccepted({});
    setRejected([]);
    setProblems({});
  }

  async function run() {
    const request = draft.trim();
    if (!unit || request.length < 3 || working) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const span = spanFrom(hours, new Date());
    reset();
    onInvestigation?.(null);
    setAsked({ request, unit: unit.name, span: spanLabel(hours) });
    setTraceOpen(true);
    setStartedAt(Date.now());
    setStatus("Sending the request");
    const at = { unitId: unit.id, metric: metric.key, ...span };
    const onEvent = (e: InvestigationEvent) => {
      if (e.type === "status") setStatus(e.message);
      else if (e.type === "step") setSteps((s) => [...s, e.step]);
      else if (e.type === "failed") setError(e.message);
      else if (e.type === "done") show(e.result, e.exchangeId ?? null, at);
    };
    try {
      await investigate(env, { unitId: unit.id, metric: metric.key, ...span, request, zone }, onEvent, controller.signal);
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
    setError("Stopped. Nothing was found, and nothing was recorded.");
  }

  async function open(line: InvestigationLine) {
    if (working) return;
    reset();
    setPastOpen(false);
    setAsked({ request: line.request, unit: line.unit?.name ?? "", span: line.from && line.to ? `${dayOn(line.from, zone)} to ${dayOn(line.to, zone)}` : "" });
    try {
      const kept = await readInvestigation(env, line.id);
      setReread(kept.askedAt);
      show(kept.result, kept.exchangeId, line.unit && line.metric && line.from && line.to ? { unitId: line.unit.id, metric: line.metric, from: line.from, to: line.to } : null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That investigation could not be read again. Check the connection and try again.");
    }
  }

  async function accept(c: EventCandidate) {
    const d = dates[c.id] ?? { start: "", end: "" };
    const fail = (message: string) => setProblems((p) => ({ ...p, [c.id]: message }));
    if (!exchangeId) return fail("This investigation was not kept in the journal, so there is nothing to accept an event from. Investigate again.");
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

  const proposal = result?.answer ?? null;
  const inv = proposal?.investigation ?? null;
  const candidates = proposal?.candidates ?? [];
  const comparedBy = new Map((inv?.compared ?? []).map((c) => [c.ref, c]));
  const titleOf = (ref: string) => comparedBy.get(ref)?.title ?? ref;
  const format = (v: number) => formatMetricValue(v, metric.unit);
  const signed = (d: number) => signedChange(d, metric.unit);
  const stages = stagesOf(steps, !working && (result !== null || error !== null));
  const fromCalendar = (inv?.compared ?? []).filter((c) => c.from === "calendar");

  const blocked = !unit
    ? several
      ? "This site counts several units, and what a figure was earlier is kept unit by unit. Open the unit canvas and pick one to investigate its series."
      : "Select a site on the map. Its series over the span is what the events are set beside."
    : !kept
      ? `${metric.label} is counted on the spot and not kept over time, so there is no series to investigate. Paint the map with a measure the organisation defined.`
      : null;

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2 p-3">
        <p className="text-[11.5px] leading-snug text-ink-muted">
          Searches official sources for what was going on around a unit, then sets each event beside the series the twin kept there.
        </p>

        {blocked ? (
          <p className="rounded bg-canvas-raised px-2 py-1.5 text-[11.5px] text-ink-body">{blocked}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-body">
              <span className="font-semibold text-ink">{unit!.name}</span>
              <span className="text-ink-faint">·</span>
              <span>{metric.label}</span>
              <span className="ml-auto flex gap-1" role="group" aria-label="Span of the series">
                {SPANS.map((s) => (
                  <button
                    key={s.hours}
                    type="button"
                    disabled={working}
                    aria-pressed={hours === s.hours}
                    onClick={() => onHours(s.hours)}
                    className={cn("rounded px-1.5 py-0.5 text-[10.5px]", hours === s.hours ? "bg-brand-soft font-medium text-brand-deep" : "border border-line text-ink-faint hover:text-ink-body")}
                  >
                    {s.label}
                  </button>
                ))}
              </span>
            </div>

            <label htmlFor="investigate-request" className={LABEL}>
              The only thing that goes to the web
            </label>
            <textarea
              id="investigate-request"
              rows={3}
              value={draft}
              disabled={working}
              onChange={(e) => setDraft(e.target.value)}
              className="min-w-0 resize-none rounded border border-line bg-surface px-2 py-1.5 text-[12px] leading-snug text-ink focus:border-brand focus:outline-none disabled:opacity-70"
            />
            <div className="flex items-center gap-2">
              {working ? (
                <button type="button" onClick={stop} className="rounded border border-line px-2.5 py-1.5 text-[12px] text-ink-body hover:bg-surface-hover">
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  disabled={draft.trim().length < 3}
                  onClick={() => void run()}
                  className="flex items-center gap-1 rounded bg-brand px-2.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
                >
                  <Search className="h-3.5 w-3.5" aria-hidden="true" /> Investigate this span
                </button>
              )}
              <span className="min-w-0 text-[10.5px] leading-snug text-ink-faint">It names the unit and the dates. None of its figures is sent.</span>
            </div>
          </>
        )}

        {past && past.length > 0 ? (
          <div className="flex flex-col gap-1">
            <button type="button" aria-expanded={pastOpen} onClick={() => setPastOpen((o) => !o)} className="flex items-center gap-1.5 text-left">
              <ChevronRight className={cn("h-3 w-3 text-ink-muted transition-transform", pastOpen && "rotate-90")} aria-hidden="true" />
              <History className="h-3 w-3 text-ink-faint" aria-hidden="true" />
              <span className={LABEL}>
                Kept in the journal · {past.length} investigation{past.length === 1 ? "" : "s"} of this unit
              </span>
            </button>
            {pastOpen ? (
              <ul className="flex flex-col gap-1">
                {past.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      disabled={working}
                      onClick={() => void open(p)}
                      className={cn(
                        "flex w-full flex-col rounded border px-2 py-1 text-left hover:border-brand disabled:opacity-60",
                        exchangeId === p.id ? "border-brand bg-surface" : "border-line-soft bg-canvas-raised",
                      )}
                    >
                      <span className="text-[11px] text-ink-body">
                        {new Date(p.askedAt).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}
                        {p.from && p.to ? ` · ${dayOn(p.from, zone)} to ${dayOn(p.to, zone)}` : ""}
                      </span>
                      <span className="text-[10.5px] text-ink-faint">
                        {p.status === "answered"
                          ? `${p.candidates} candidate${p.candidates === 1 ? "" : "s"} · ${p.episodes} episode${p.episodes === 1 ? "" : "s"}`
                          : (p.message ?? "No answer was delivered.")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      {asked ? (
        <div className="flex flex-col gap-2 border-t border-line-soft p-3">
          <p className="text-[12px] font-semibold leading-snug text-ink">{asked.request}</p>
          {reread ? (
            <p className="text-[10.5px] text-ink-faint">
              Read again from the journal, as it was delivered on {new Date(reread).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}. Nothing
              was recomputed.
            </p>
          ) : null}

          {working || steps.length > 0 ? (
            <div className="flex flex-col gap-1" aria-label="Where the investigation stands">
              <ol className="flex gap-0.5">
                {stages.map((s) => (
                  <li
                    key={s.key}
                    title={`${s.label}: ${s.state === "done" ? "done" : s.state === "now" ? "in progress" : s.state === "failed" ? "could not be read" : "not reached"}`}
                    className={cn(
                      "h-1.5 flex-1 rounded-sm",
                      s.state === "done" ? "bg-brand" : s.state === "now" ? "animate-pulse bg-brand/50" : s.state === "failed" ? "bg-warn" : "bg-line",
                    )}
                  />
                ))}
              </ol>
              <p className="flex justify-between text-[10px] text-ink-faint">
                <span>{stages.filter((s) => s.state === "done").length} of {stages.length} pieces of work done</span>
                <span>{stages.find((s) => s.state === "now")?.label ?? ""}</span>
              </p>
            </div>
          ) : null}

          {working ? (
            <p role="status" className="flex items-center gap-2 text-[12px] text-ink-muted">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
              <span className="min-w-0 flex-1">{status}…</span>
              {startedAt ? <Elapsed since={startedAt} /> : null}
            </p>
          ) : null}

          {error ? <p role="alert" className="rounded bg-danger-soft px-2 py-1.5 text-[12px] text-danger-ink">{error}</p> : null}

          {result && !proposal ? (
            <p role="alert" className="rounded bg-warn-soft px-2 py-1.5 text-[12px] text-warn-ink">{result.message ?? "Nothing was delivered."}</p>
          ) : null}

          {inv && proposal ? (
            <>
              <SeriesSummary inv={inv} format={format} label={metric.label} />

              <span className={LABEL}>
                Found · {candidates.length} candidate{candidates.length === 1 ? "" : "s"}
              </span>
              {candidates.length === 0 ? (
                <p className="rounded bg-canvas-raised px-2 py-1.5 text-[12px] text-ink-body">
                  No candidate event was found in the allowed sources. Nothing was made up in its place.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {candidates.map((c) => {
                    const cmp = comparedBy.get(c.id);
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
                    const isOpen = openRow === c.id;
                    const measured = cmp ? measuredLines(cmp, format, signed) : null;
                    const episode = cmp?.episode ? inv.episodes.find((e) => e.id === cmp.episode) : undefined;
                    return (
                      <li key={c.id} aria-label={c.title} className={cn("rounded-md border", done ? "border-ok-ink/40 bg-ok-soft/40" : isOpen ? "border-brand bg-surface" : "border-line-soft bg-surface")}>
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          onClick={() => setOpenRow(isOpen ? null : c.id)}
                          className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 px-2 py-1.5 text-left"
                        >
                          <span className={cn("mt-[5px] h-2 w-2 shrink-0 rounded-full", DOT[cmp ? pairingOf(cmp) : "unplaced"])} aria-hidden="true" />
                          <span className="min-w-0">
                            <span className="block text-[12px] font-semibold leading-snug text-ink"><Text text={c.title} /></span>
                            <span className="block text-[11px] leading-snug text-ink-muted">
                              {c.startDate ?? "no date"}
                              {c.endDate && c.endDate !== c.startDate ? ` to ${c.endDate}` : ""} · {cmp ? verdictOf(cmp, inv) : "Not set beside the series."}
                            </span>
                          </span>
                          {done ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok-ink" aria-label="In the calendar" /> : <ChevronRight className={cn("mt-0.5 h-3 w-3 shrink-0 text-ink-muted transition-transform", isOpen && "rotate-90")} aria-hidden="true" />}
                        </button>

                        {isOpen ? (
                          <div className="flex flex-col gap-2 border-t border-line-soft px-2 py-2">
                            <div className="flex flex-col gap-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <EvidenceBadge evidence="published" />
                                <span title={DOOR_LABEL[c.door].title} className="rounded bg-canvas px-1 py-px text-[9.5px] font-bold uppercase tracking-wide text-ink-body">
                                  {DOOR_LABEL[c.door].label}
                                </span>
                                <WebChip url={c.url} title={c.sourceTitle || undefined} />
                              </div>
                              <p className="text-[11px] text-ink-muted"><Text text={c.place} /></p>
                              <blockquote className="border-l-2 border-brand-soft pl-2 text-[11.5px] italic text-ink-body">
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
                                    title={p.text}
                                    onClick={() => {
                                      setTraceOpen(true);
                                      setOpenStep(p.step);
                                    }}
                                    className="rounded border border-line-soft bg-canvas-raised px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-brand-deep hover:border-brand"
                                  >
                                    {p.step}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {measured ? (
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-1.5">
                                  <EvidenceBadge evidence="measured" />
                                  <span className="text-[10.5px] text-ink-faint">{metric.label}, read from the twin’s history</span>
                                </div>
                                <ul className="flex flex-col text-[11.5px] tabular-nums text-ink-body">
                                  {measured.map((line) => (
                                    <li key={line}>{line}</li>
                                  ))}
                                  {episode ? (
                                    <li>
                                      Episode {episodeNumber(episode.id)}: {episode.startDay} to {episode.endsAt ? episode.endDay : "the end of the span, still open"}, furthest at{" "}
                                      {format(episode.peak)}
                                      {episode.sharedWith.length ? ` · also at ${episode.sharedWith.join(", ")}` : inv.neighbours.length ? " · at none of the nearest units" : ""}
                                    </li>
                                  ) : null}
                                </ul>
                              </div>
                            ) : null}

                            {cmp && cmp.doubts.length > 0 ? (
                              <div className="flex flex-col gap-1">
                                <span className={LABEL}>Reasons to doubt</span>
                                <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[11.5px] text-ink-body">
                                  {cmp.doubts.map((doubt, i) => (
                                    <li key={i}>{doubtText(doubt, titleOf)}</li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}

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
                                    <input type="date" value={d.start} onChange={(e) => setDates((all) => ({ ...all, [c.id]: { ...d, start: e.target.value } }))} className={FIELD} />
                                  </label>
                                  <label className="flex flex-col gap-0.5">
                                    <span className={LABEL}>Ends</span>
                                    <input type="date" value={d.end} onChange={(e) => setDates((all) => ({ ...all, [c.id]: { ...d, end: e.target.value } }))} className={FIELD} />
                                  </label>
                                </div>
                                {c.datesRemoved.length ? (
                                  <p className="text-[11px] text-warn-ink">
                                    The passage does not state the {c.datesRemoved.join(" or the ")} date the analyst gave, so it was taken out. Read the source and enter it.
                                  </p>
                                ) : !c.startDate ? (
                                  <p className="text-[11px] text-warn-ink">The passage does not state the day it started. Read the source and enter it.</p>
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
                                    Accept into the calendar
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
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}

              {fromCalendar.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <span className={LABEL}>Already in the calendar for this span · {fromCalendar.length}</span>
                  <ul className="flex flex-col gap-1">
                    {fromCalendar.map((c) => (
                      <CalendarRow key={c.ref} cmp={c} verdict={verdictOf(c, inv)} />
                    ))}
                  </ul>
                </div>
              ) : null}

              {proposal.notFound.length ? (
                <div className="flex flex-col gap-1">
                  <span className={LABEL}>Not found in the allowed sources</span>
                  <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[11.5px] text-ink-body">
                    {proposal.notFound.map((t, i) => (
                      <li key={i}><Text text={t} /></li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="flex flex-col gap-1">
                <span className={LABEL}>What this cannot say</span>
                <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[11.5px] text-ink-body">
                  {[...inv.limits, ...proposal.limits].map((t, i) => (
                    <li key={i}><Text text={t} /></li>
                  ))}
                </ul>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {asked ? (
        <Trace steps={steps} open={traceOpen} onToggle={() => setTraceOpen((o) => !o)} openStep={openStep} onOpenStep={setOpenStep} done={!working && result !== null} />
      ) : null}

      <p className="border-t border-line-soft px-3 py-2 text-[10.5px] leading-snug text-ink-faint">
        {result
          ? `${result.steps.length} step${result.steps.length === 1 ? "" : "s"} · ${result.usage.webSearches ?? 0} web search${(result.usage.webSearches ?? 0) === 1 ? "" : "es"} · ${(result.usage.inputTokens + result.usage.outputTokens).toLocaleString("en-CA")} tokens · ${result.model}. `
          : ""}
        {exchangeId ? `Kept in the journal as ${exchangeId.slice(0, 8)}, every step included. ` : ""}
        A candidate enters the calendar when you accept it; a rejected one is recorded nowhere.
      </p>
    </div>
  );
}

/** What the program read of the series, in two lines. */
function SeriesSummary({ inv, format, label }: { inv: NonNullable<InvestigationResult["answer"]>["investigation"]; format: (v: number) => string; label: string }) {
  const s = inv.series;
  const n = inv.episodes.length;
  return (
    <div className="flex flex-col gap-0.5 rounded bg-canvas-raised px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <EvidenceBadge evidence="measured" />
        <span className="text-[11.5px] text-ink-body">
          {label} at {inv.unit.name}
        </span>
      </div>
      <p className="text-[11.5px] tabular-nums text-ink-body">
        {s.valued} reading{s.valued === 1 ? "" : "s"}
        {s.low !== null && s.high !== null ? ` · lowest ${format(s.low)} · highest ${format(s.high)}` : ""}
      </p>
      <p className="text-[11.5px] tabular-nums text-ink-body">
        {inv.line
          ? `${n} episode${n === 1 ? "" : "s"} beyond the alert threshold (${inv.line.op} ${format(inv.line.threshold)})`
          : "No alert threshold on this measure: no episode is marked."}
      </p>
      {inv.neighbours.length > 0 ? (
        <p className="text-[11px] text-ink-muted">
          Nearest units read: {inv.neighbours.map((nb) => `${nb.name} (${nb.km} km)`).join(", ")}.
        </p>
      ) : null}
    </div>
  );
}

/** A validated event of the calendar, set beside the series like a candidate. */
function CalendarRow({ cmp, verdict }: { cmp: Comparison; verdict: string }) {
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 rounded-md border border-line-soft bg-canvas-raised px-2 py-1.5">
      <span className={cn("mt-[5px] h-2 w-2 shrink-0 rounded-full", DOT[pairingOf(cmp)])} aria-hidden="true" />
      <span className="min-w-0">
        <span className="block text-[12px] font-semibold leading-snug text-ink">{cmp.title}</span>
        <span className="block text-[11px] leading-snug text-ink-muted">
          {cmp.startsOn}
          {cmp.endsOn && cmp.endsOn !== cmp.startsOn ? ` to ${cmp.endsOn}` : ""} · {verdict}
        </span>
      </span>
    </li>
  );
}
