"use client";

/**
 * The responses prepared for the kind of signal a situation card is about.
 *
 * In an emergency nobody builds a scenario: what was tested in calm time is
 * applied. Each response here is a test that was kept, shown with what that
 * test gave, what it rests on, what it does not say, and what it is worth now.
 * One click engages one: a decision is recorded on the signal, and the signal
 * moves to its next stage.
 *
 * When the signal opened, the server ran each response through the engine
 * again, on the network as it is. The card shows the last test it knows first,
 * with its date; when that retest finishes, its figures take the place of the
 * kept test's, and the line above them says when it ran. A retest that is
 * waiting, running, abandoned or failed is never shown as a result: the line
 * says where it stands, and the figures stay those of the last test known.
 *
 * Three things the section never does. It does not rank: the order is the
 * order they were kept in. It does not hide an old or displaced test: the
 * reason is written above the button, before the click. And it does not
 * pretend to act: nothing is triggered in any other system.
 */

import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/cn";

import type { OptionFigures } from "../analyst-api";
import { engageResponse, type Engaged, type PreparedResponseCard } from "../prepared-api";

const LABEL = "text-[10px] font-semibold uppercase tracking-wide text-ink-faint";

const whole = (n: number): string => (n > 0 && n < 1 ? "under 1" : Math.round(n).toLocaleString("en-CA"));

/** A run in one line, in the Result panel's own terms. */
export function runLine(f: OptionFigures): string {
  const peak = f.peakOccupancy === null ? "no peak reported" : `peak ${Math.round(f.peakOccupancy * 100)} %${f.peakDay === null ? "" : ` on day ${f.peakDay}`}`;
  const first = f.firstQueueDay === null ? "nobody waits" : `first wait on day ${f.firstQueueDay}`;
  return `${whole(f.waitingDays)} patient-days waiting · ${f.sitesWithQueue} of ${f.sitesWithActivity} sites with a queue · ${peak} · ${first}`;
}

export default function PreparedResponses({
  env,
  signalId,
  kind,
  responses,
  engage,
  onEngaged,
}: {
  env: string;
  signalId: string;
  /** The kind of signal, by name. */
  kind: string;
  responses: PreparedResponseCard[];
  /** Whether a response can be engaged on this signal now, and why not. */
  engage: { possible: boolean; why: string | null };
  /** A response was engaged: the card has to be read again. */
  onEngaged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; result: Engaged } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function go(r: PreparedResponseCard) {
    if (busy) return;
    setBusy(r.id);
    setError(null);
    try {
      const result = await engageResponse(env, signalId, { responseId: r.id });
      setDone({ id: r.id, result });
      onEngaged();
    } catch (e) {
      setError(`“${r.label}” was not engaged: ${e instanceof Error ? e.message : String(e)} Nothing was recorded.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Prepared responses" className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3">
      <p className={LABEL}>Prepared responses · for “{kind}”</p>

      {responses.length === 0 ? (
        <p className="text-[12px] text-ink-body">
          No response is prepared for this kind of signal yet. One is kept from a tested option: Scenarios, Analyst panel, Options tab,
          “Keep as a prepared response for…”.
        </p>
      ) : null}

      {responses.map((r) => {
        const engaged = done?.id === r.id ? done.result : null;
        // The figures on the card: those of the retest once one has finished, the kept test's until then.
        const retest = r.live.figures;
        const shown = retest ? { withIt: retest.withOption, without: retest.asItIs } : { withIt: r.withIt, without: r.without };
        // What to know before the click: about the retest when its figures are shown, about the kept test otherwise.
        const caution = retest ? !r.live.current : r.standing.stale;
        const recorded = engaged?.decision.expected?.retested
          ? "with the figures of the test it was kept from as what is expected, and those of the test on the current state beside them"
          : "with these figures as what is expected";
        return (
          <article key={r.id} aria-label={r.label} className="flex flex-col gap-1.5 rounded-md border border-line bg-canvas-raised p-2.5">
            <div className="flex flex-wrap items-start gap-2">
              <h2 className="min-w-0 flex-1 break-words text-[13px] font-semibold leading-snug text-ink">{r.label}</h2>
              {r.approver ? <span className="rounded border border-line px-1.5 py-px text-[10.5px] text-ink-muted">Can be approved by: {r.approver}</span> : null}
            </div>

            <p className="text-[11.5px] text-ink-muted">
              {retest ? "Run" : `Tested ${r.standing.age} ago`} on “{r.scenarioName}” · {r.horizon} days · {r.activity}
              {retest ? ` · first tested ${r.standing.age} ago` : ""}
              {r.keptBy ? ` · kept by ${r.keptBy}` : ""}
            </p>

            <p
              role="status"
              aria-label={`Test of “${r.label}” on the current state`}
              className={cn(
                "flex items-start gap-1.5 rounded px-2 py-1.5 text-[11.5px]",
                r.live.state === "testing" ? "bg-canvas text-ink-body" : retest && r.live.current ? "bg-ok-soft text-ok-ink" : retest || r.live.problem ? "bg-warn-soft text-warn-ink" : "bg-canvas text-ink-muted",
              )}
            >
              {r.live.state === "testing" ? (
                <Loader2 className="mt-px h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
              ) : retest && r.live.current ? (
                <Check className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              ) : retest || r.live.problem ? (
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              ) : null}
              <span>
                {retest && !r.live.current && r.live.state === "tested" ? <span className="font-semibold">Read this before engaging it. </span> : null}
                {r.live.says}
                {retest && r.live.state === "tested" && !r.live.problem && r.live.seconds !== null ? ` The engine took ${r.live.seconds} s.` : ""}
              </span>
            </p>

            {!retest && r.standing.stale ? (
              <div role="note" className="flex items-start gap-1.5 rounded bg-warn-soft px-2 py-1.5 text-[11.5px] text-warn-ink">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-semibold">Read this before engaging it.</p>
                  <ul className="flex list-disc flex-col gap-0.5 pl-4">
                    {r.standing.reasons.map((why) => (
                      <li key={why}>{why}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}

            <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11.5px]">
              <dt className="font-semibold text-ink">With it</dt>
              <dd className="text-ink-body">{runLine(shown.withIt)}</dd>
              <dt className="text-ink-muted">Without it</dt>
              <dd className="text-ink-muted">{runLine(shown.without)}</dd>
            </dl>
            {retest ? (
              <p className="text-[11px] text-ink-faint">
                In the test it was kept from: {whole(r.withIt.waitingDays)} patient-days waiting with it, {whole(r.without.waitingDays)} without.
              </p>
            ) : null}

            {r.changes.length ? (
              <div>
                <p className={LABEL}>What it changes</p>
                <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[11.5px] text-ink-body">
                  {r.changes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {r.mechanism ? <p className="text-[11.5px] text-ink-body">{r.mechanism}</p> : null}

            <p className="text-[11px] text-ink-muted">
              {retest
                ? "This test starts from the twin as it was read when the test ran, which is measured. The response, and the events and choices of the scenario, are assumptions. The test it was kept from rested"
                : "Its run rests"}{" "}
              on {r.evidence.measured} measured, {r.evidence.published} published and {r.evidence.assumption} assumed
              {r.evidence.assumption === 1 ? " element" : " elements"}. A run is the result of a model under the conditions of its test, not a
              forecast.
            </p>

            {r.notTested.length ? (
              <div>
                <p className={LABEL}>What its test does not say</p>
                <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[11.5px] text-ink-body">
                  {r.notTested.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {engaged ? (
              <p className="flex items-start gap-1.5 rounded bg-ok-soft px-2 py-1.5 text-[11.5px] text-ok-ink">
                <Check className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                  Engaged{engaged.by ? ` by ${engaged.by}` : ""}. The decision is recorded on this signal {recorded}, and the signal moved
                  to “{engaged.stage.name}”
                  {engaged.stage.needsApproval ? `, a stage that needs an approval: ${engaged.by ?? "the person engaging"} is named as approving` : ""}
                  {engaged.stage.closes ? ", which closes it" : ""}. Nothing was triggered in any other system.
                </span>
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!engage.possible || busy !== null || done !== null}
                  onClick={() => void go(r)}
                  title={engage.why ?? undefined}
                  className={cn(
                    "flex h-7 items-center gap-1 px-3 text-[12px] font-semibold text-white disabled:opacity-60",
                    caution ? "bg-warn" : "bg-brand hover:bg-brand-deep",
                  )}
                >
                  {busy === r.id ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null} Engage
                </button>
                {!engage.possible && engage.why ? <span className="text-[11px] text-ink-muted">{engage.why}</span> : null}
              </div>
            )}
          </article>
        );
      })}

      {error ? (
        <p role="alert" className="rounded bg-danger-soft px-2 py-1.5 text-[12px] text-danger-ink">
          {error}
        </p>
      ) : null}

      <p className="text-[10.5px] text-ink-faint">
        Engaging records a decision on this signal and moves it to its next stage. Nothing is triggered in any other system: Obscyro
        records and follows. In the order they were kept; nothing here ranks them.
      </p>
    </section>
  );
}
