"use client";

/**
 * The situation card: what a person needs in front of them when an alert or a
 * signal asks for their attention.
 *
 * It opens in one click from an alert, a signal or a unit, and it is whole
 * without the language model: the unit's live figures with their age, the
 * alert, where the signal stands in its workflow, and what the card cannot
 * say. The analyst comes after, on the person's own click, with a question
 * already written; if it is slow or switched off, nothing above it is missing.
 *
 * Every figure here is one the analyst would be handed for the same unit: the
 * server builds both from one reading. Nothing on this page decides anything or
 * writes anything.
 */

import { AlertTriangle, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "@/lib/auth";
import { cn } from "@/lib/cn";
import type { TwinAlertSeverity } from "@/lib/platform-api";

import { useStudio } from "../StudioShell";
import { ALERT_PARAM, SIGNAL_PARAM, UNIT_PARAM, signalHref, unitHref } from "../alert-feed-state";
import { AskTab } from "../simulation/hex/AnalystPanel";
import { getSituation, printed, type AlertReading, type SituationCard, type ValueAge } from "../situation-api";
import PreparedResponses from "./PreparedResponses";

/** The card reads itself again this often: a figure left on screen grows old without saying so. */
export const REREAD_MS = 30_000;
/** While a prepared response is being tested on the current state, the card is read again sooner: that result is what the person is waiting for. */
export const REREAD_TESTING_MS = 5_000;

const LABEL = "text-[10px] font-semibold uppercase tracking-wide text-ink-faint";
const CARD = "rounded-md border border-line bg-surface";
const LINK = "rounded border border-line bg-surface px-2 py-0.5 text-[11.5px] font-semibold text-ink hover:border-brand hover:bg-brand-soft";

const TONE: Record<TwinAlertSeverity, { chip: string; label: string }> = {
  critical: { chip: "bg-danger-soft text-danger-ink", label: "Critical" },
  warn: { chip: "bg-warn-soft text-warn-ink", label: "Warning" },
  info: { chip: "bg-brand-soft text-brand-deep", label: "Info" },
};

/** An age, with its reason beside it when it is not exact: the qualifier is in the text, not in a hover. */
function Age({ age }: { age: ValueAge }) {
  return (
    <span className={cn(age.known === "exact" ? "text-ink-muted" : "text-warn-ink")}>
      {age.says}
      {age.why ? <span className="text-ink-muted"> · {age.why}</span> : null}
    </span>
  );
}

function Alert({ a }: { a: AlertReading }) {
  const tone = TONE[a.severity];
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-start gap-2">
        <span className={cn("rounded px-1 py-px text-[9.5px] font-bold uppercase tracking-wide", tone.chip)}>{tone.label}</span>
        <p className="min-w-0 flex-1 break-words text-[12.5px] font-semibold leading-snug text-ink">{a.says}</p>
      </div>
      <p className="text-[11.5px] text-ink-muted">
        {a.measure}: <span className="font-semibold text-ink">{printed(a.value, a.counted_in)}</span> · open for {a.open_for} · <Age age={a.value_age} />
      </p>
    </div>
  );
}

export default function SituationView() {
  const { selectedEnv } = useStudio();
  const params = useSearchParams();
  const unit = params.get(UNIT_PARAM);
  const alert = params.get(ALERT_PARAM);
  const signal = params.get(SIGNAL_PARAM);

  const [card, setCard] = useState<SituationCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [analystOff, setAnalystOff] = useState(false);
  // Only the newest reading may land: a slow one must not overwrite a later one.
  const turn = useRef(0);

  const read = useCallback(async () => {
    if (!selectedEnv || (!unit && !alert && !signal)) return;
    const mine = ++turn.current;
    setReading(true);
    try {
      const next = await getSituation(selectedEnv, { unit, alert, signal });
      if (turn.current !== mine) return;
      setCard(next);
      setError(null);
    } catch (e) {
      if (turn.current !== mine) return;
      // The last card read stays on screen, marked as not updating: silence is not calm.
      setError(
        e instanceof ApiError && e.status === 404
          ? "This link names a unit or a signal that is not in this project."
          : e instanceof ApiError
            ? e.message
            : "The card could not be read. Check the connection.",
      );
    } finally {
      if (turn.current === mine) setReading(false);
    }
  }, [selectedEnv, unit, alert, signal]);

  useEffect(() => {
    setCard(null);
    setError(null);
    void read();
  }, [read]);

  const testing = card?.responses?.some((r) => r.live.state === "testing") ?? false;
  const every = testing ? REREAD_TESTING_MS : REREAD_MS;
  useEffect(() => {
    const timer = setInterval(() => void read(), every);
    return () => clearInterval(timer);
  }, [read, every]);

  if (!selectedEnv) {
    return <p className="p-6 text-[12.5px] text-ink-muted">Choose a project to read a situation.</p>;
  }
  if (!unit && !alert && !signal) {
    return (
      <p className="p-6 text-[12.5px] text-ink-muted">
        A situation card opens from an alert, a signal or a unit. Use “Situation” on an alert in the list at the top right.
      </p>
    );
  }

  const u = card?.unit ?? null;
  const opened = card?.alert ?? null;
  const main = opened?.state === "open" ? opened.reading : null;
  const others = (u?.open_alerts ?? []).filter((a) => a.id !== main?.id);
  const sig = card?.signal ?? null;
  const title = u?.unit.name ?? sig?.title ?? "Situation";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-canvas">
      <div className="mx-auto flex max-w-[860px] flex-col gap-3 p-4">
        <header className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className={LABEL}>Situation</p>
            <h1 className="break-words text-[18px] font-semibold leading-tight text-ink">{title}</h1>
            {u ? (
              <p className="text-[11.5px] text-ink-muted">
                {u.unit.inside ? `Inside ${u.unit.inside}` : "Top of its tree"}
                {u.unit.sub_units ? ` · ${u.unit.sub_units} sub-unit${u.unit.sub_units === 1 ? "" : "s"}` : ""}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {u ? (
              <Link href={unitHref(u.unit.id, selectedEnv)} className={LINK}>
                Open unit
              </Link>
            ) : null}
            {sig ? (
              <Link href={signalHref(sig.id, selectedEnv)} className={LINK}>
                Signal
              </Link>
            ) : null}
            <button type="button" onClick={() => void read()} disabled={reading} className={cn(LINK, "flex items-center gap-1 disabled:opacity-60")}>
              <RefreshCw className={cn("h-3 w-3", reading && "animate-spin")} aria-hidden="true" /> Read again
            </button>
          </div>
        </header>

        {error ? (
          <p role="alert" className="flex items-start gap-1.5 rounded bg-warn-soft px-2 py-1.5 text-[12px] text-warn-ink">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              {error}
              {card ? " What is below is the last reading that worked: it is not updating." : ""}
            </span>
          </p>
        ) : null}

        {!card && !error ? <p className="text-[12px] text-ink-muted">Reading the unit…</p> : null}

        {card ? (
          <>
            <p className="text-[11px] text-ink-muted">
              Read at {new Date(card.at).toLocaleTimeString("en-CA", { hour12: false })} on the server&apos;s clock, and again every{" "}
              {every / 1000} s · {card.checked.says}
              {card.alertRules > 0 ? ` · ${card.alertRules} alert rule${card.alertRules === 1 ? "" : "s"} in this project` : ""}
            </p>

            {opened ? (
              <section aria-label="The alert" className={cn(CARD, "flex flex-col gap-1.5 p-3")}>
                <p className={LABEL}>The alert</p>
                {main ? (
                  <Alert a={main} />
                ) : (
                  <p className="text-[12px] text-ink-body">
                    This alert is no longer open: it cleared, or the link is old. The figures below are read now.
                  </p>
                )}
              </section>
            ) : null}

            {u ? (
              <section aria-label="Live figures" className={cn(CARD, "flex flex-col gap-2 p-3")}>
                <p className={LABEL}>Live figures · as the unit page shows them</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {u.measures.map((m) => (
                    <div key={m.key} className="rounded-md border border-line bg-canvas-raised p-2">
                      <p className="text-[10.5px] text-ink-muted">{m.measure}</p>
                      <p className="mt-0.5 text-[18px] font-semibold tabular-nums text-ink">{printed(m.value, m.counted_in)}</p>
                      {m.value === null ? <p className="text-[10.5px] text-ink-faint">Nothing here to compute it from.</p> : null}
                      {m.about?.length ? <p className="text-[10.5px] text-ink-muted">About {m.about.join(", ")}</p> : null}
                      {/* The age of this figure: of what this measure reads. */}
                      {m.value_age ? (
                        <p className="mt-0.5 text-[10.5px]">
                          <Age age={m.value_age} />
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
                {/* The unit as a whole answers another question, and is named for it: one figure above can be newer. */}
                <p className="text-[11.5px]">
                  <span className="text-ink-muted">Oldest source under this unit: </span>
                  <Age age={u.value_age} />
                </p>
                <p className="text-[11px] text-ink-muted">
                  {u.last_written_here ? `Last written to the twin ${u.last_written_here}: that is when the data arrived, not when it was true. ` : ""}
                  {u.unit.sub_units ? "These figures count everything under this unit, its sub-units included." : ""}
                </p>
                {Object.keys(u.under_it_by_type).length ? (
                  <table className="w-full text-left text-[11.5px]">
                    <caption className={cn(LABEL, "pb-1 text-left")}>Under this unit, by type</caption>
                    <tbody>
                      {Object.entries(u.under_it_by_type)
                        .sort((a, b) => b[1] - a[1])
                        .map(([type, n]) => (
                          <tr key={type} className="border-b border-line-faint last:border-0">
                            <th scope="row" className="py-1 font-normal text-ink-body">
                              {type}
                            </th>
                            <td className="py-1 text-right tabular-nums text-ink">{n.toLocaleString("en-CA")}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-[11.5px] text-ink-faint">Nothing is linked to this unit.</p>
                )}
              </section>
            ) : (
              <section aria-label="Live figures" className={cn(CARD, "p-3")}>
                <p className="text-[12px] text-ink-body">This card names no unit, so there are no live figures to show.</p>
              </section>
            )}

            {others.length ? (
              <section aria-label="Other open alerts at this unit" className={cn(CARD, "flex flex-col gap-2 p-3")}>
                <p className={LABEL}>
                  {main ? "Also open at this unit" : "Open at this unit"} · {others.length}
                </p>
                {others.map((a) => (
                  <Alert key={a.id} a={a} />
                ))}
              </section>
            ) : u && !main ? (
              <section aria-label="Open alerts at this unit" className={cn(CARD, "p-3")}>
                <p className="text-[12px] text-ink-body">
                  {card.alertRules === 0
                    ? "No alert is open at this unit, and none could be: this project has no alert rule. That is not a sign that nothing is wrong."
                    : "No alert is open at this unit. That is what the rules saw when they were last checked."}
                </p>
              </section>
            ) : null}

            {sig ? (
              <section aria-label="The signal" className={cn(CARD, "flex flex-col gap-2 p-3")}>
                <p className={LABEL}>The signal</p>
                <p className="text-[12.5px] font-semibold text-ink">{sig.title}</p>
                <p className="text-[11.5px] text-ink-muted">
                  {sig.type} · {sig.domain} · step {sig.stageNo} of {sig.stages}
                  {sig.closedAt ? " · closed" : ""}
                </p>
                <ol className="flex flex-wrap gap-1.5" aria-label="Where the signal stands in its workflow">
                  {sig.path.map((s, i) => (
                    <li
                      key={`${s.name}-${i}`}
                      aria-current={s.current ? "step" : undefined}
                      className={cn(
                        "rounded border px-2 py-0.5 text-[11.5px]",
                        s.current ? "border-brand bg-brand-soft font-semibold text-brand-deep" : "border-line bg-canvas-raised text-ink-muted",
                      )}
                    >
                      {i + 1}. {s.name}
                      {s.needsApproval ? " · needs approval" : ""}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {sig && card.responses ? (
              <PreparedResponses
                env={selectedEnv}
                signalId={sig.id}
                kind={sig.type}
                responses={card.responses}
                engage={card.engage}
                onEngaged={() => void read()}
              />
            ) : null}

            <section aria-label="Decisions" className={cn(CARD, "flex flex-col gap-1.5 p-3")}>
              <p className={LABEL}>Decisions already taken on this kind of signal</p>
              {card.decisions.items.length ? (
                <ul className="flex flex-col gap-1">
                  {card.decisions.items.map((d) => (
                    <li key={d.id} className="text-[12px] text-ink-body">
                      <span className="font-semibold text-ink">{d.label}</span>
                      {" · "}
                      {d.decidedBy ?? "Someone"}, {new Date(d.decidedAt).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" })}
                      {d.onThisSignal ? " · on this signal" : d.signalTitle ? ` · on “${d.signalTitle}”` : ""}
                      <span className="text-ink-muted">
                        {" · "}expected {Math.round(d.waitingWith).toLocaleString("en-CA")} patient-days waiting, against{" "}
                        {Math.round(d.waitingWithout).toLocaleString("en-CA")} without it
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="text-[11.5px] text-ink-muted">{card.decisions.note}</p>
            </section>

            <section aria-label="Ask the analyst" className={cn(CARD, "flex flex-col")}>
              <p className={cn(LABEL, "px-3 pt-3")}>Ask the analyst</p>
              {analystOff || !card.analyst.configured ? (
                <p className="p-3 text-[12px] text-ink-body">
                  The analyst is not switched on for this server. Everything above is read without it; an administrator has to set its key
                  on the API service to ask it a question.
                </p>
              ) : (
                <AskTab
                  env={selectedEnv}
                  scenario={null}
                  run={null}
                  live
                  siteName={() => null}
                  onFocusSite={() => {}}
                  onOff={() => setAnalystOff(true)}
                  prepared={card.question}
                  focus={{ page: "situation", ...(u ? { unitId: u.unit.id } : {}), ...(sig ? { signalId: sig.id } : {}) }}
                  hints={["What is open right now, and where?"]}
                />
              )}
            </section>

            <section aria-label="What this card cannot say" className="flex flex-col gap-1 px-1">
              <p className={LABEL}>What this card cannot say</p>
              <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[11.5px] text-ink-muted">
                {card.limits.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
