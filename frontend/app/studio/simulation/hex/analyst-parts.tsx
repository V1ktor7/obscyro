"use client";

/**
 * What the analyst's tabs show the same way: a sentence with the places a
 * figure was taken out, a step with what it asked and what came back, the list
 * of steps, and the three levels of evidence.
 */

import { Check, ChevronRight, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";

import { hostOf, isWebLink, stepLabel, type AnalystStep, type Evidence } from "../../analyst-api";

export const LABEL = "text-[10px] font-semibold uppercase tracking-wide text-ink-faint";

/** A duration as a person says it: "42 s", then "2 min 05 s". */
export function elapsedText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

/**
 * How long the thing on this line has been going on.
 *
 * A test in the engine can take a minute on a large twin, and a spinner alone
 * does not say whether that minute is the first or the fifth. It stays silent
 * for the first seconds, so a step that lands at once does not flicker, and it
 * is kept out of the live region around it: a counter read aloud every second
 * helps nobody.
 */
export function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [since]);
  const seconds = Math.floor((now - since) / 1000);
  if (seconds < 3) return null;
  return (
    <span aria-hidden="true" className="tabular-nums text-ink-faint">
      · {elapsedText(seconds)}
    </span>
  );
}

/** What replaces a figure the server could not trace. Must match the server's. */
export const STRUCK = "[unverified]";

/** A paragraph, with the places a figure was taken out made visible. */
export function Text({ text }: { text: string }) {
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

export function StepRow({ step, open, onToggle }: { step: AnalystStep; open: boolean; onToggle: () => void }) {
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

/** Every step of an exchange, folded under one line. */
export function Trace({
  steps,
  open,
  onToggle,
  openStep,
  onOpenStep,
  done,
}: {
  steps: AnalystStep[];
  open: boolean;
  onToggle: () => void;
  openStep: string | null;
  onOpenStep: (id: string | null) => void;
  /** The exchange ended with a result. */
  done: boolean;
}) {
  if (!steps.length) return null;
  return (
    <div className="flex flex-col gap-1.5 border-t border-line-soft p-3">
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex items-center gap-1.5 text-left">
        <ChevronRight className={cn("h-3 w-3 text-ink-muted transition-transform", open && "rotate-90")} aria-hidden="true" />
        <span className={LABEL}>
          What it read · {steps.length} step{steps.length === 1 ? "" : "s"}
        </span>
        {done ? <Check className="h-3 w-3 text-ok-ink" aria-hidden="true" /> : null}
      </button>
      {open ? (
        <ul className="flex flex-col gap-1">
          {steps.map((s) => (
            <StepRow key={s.id} step={s} open={openStep === s.id} onToggle={() => onOpenStep(openStep === s.id ? null : s.id)} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const EVIDENCE: Record<Evidence, { label: string; title: string; className: string }> = {
  measured: { label: "Measured", title: "Read from the twin or the network's own data.", className: "bg-ok-soft text-ok-ink" },
  published: { label: "Published", title: "Taken from an official source.", className: "bg-brand-soft text-brand-deep" },
  assumption: { label: "Assumption", title: "Put there by a person, the scenario or the engine's rules. Not a fact about the network.", className: "bg-warn-soft text-warn-ink" },
};

/** One of the three levels of evidence, never mixed: the same word and the same colour everywhere. */
export function EvidenceBadge({ evidence }: { evidence: Evidence }) {
  const e = EVIDENCE[evidence];
  return (
    <span title={e.title} className={cn("shrink-0 rounded px-1 py-px text-[9.5px] font-bold uppercase tracking-wide", e.className)}>
      {e.label}
    </span>
  );
}

/**
 * Something taken from the web: the site it was published by, as a link to the
 * page. Always beside a "Published" badge, never beside "Measured": what a
 * source states is not what the twin recorded.
 */
export function WebChip({ url, title }: { url: string; title?: string }) {
  const className = "flex max-w-full items-center gap-1 rounded border border-brand-soft bg-brand-soft px-1.5 py-0.5 text-[10.5px] text-brand-deep";
  const label = (
    <>
      <span className="font-mono font-bold">WEB</span>
      <span className="truncate">{hostOf(url)}</span>
    </>
  );
  // Only a web address becomes a link: nothing else is ever given an href.
  if (!isWebLink(url)) {
    return (
      <span title={title} className={className}>
        {label}
      </span>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title={title} className={cn(className, "hover:border-brand")}>
      {label}
      <ExternalLink className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
      <span className="sr-only">(opens the source in a new tab)</span>
    </a>
  );
}
