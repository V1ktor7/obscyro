"use client";

/**
 * What a tested option's card is made of, shared by Options and Decisions.
 *
 * A card shows a run's figures as marks before it shows them as sentences: a
 * bar for the patient-days waiting, one square per site for the queues, and a
 * line for what the run rests on. The explanation is still all there, folded
 * under the card, one click away.
 *
 * Nothing here computes a fact about the network. Every figure is the engine's
 * own count, read from the record of a test. The only arithmetic is a
 * subtraction of two of those counts, done on the figures as they are shown,
 * so a reader can redo it by eye.
 */

import { ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";

import type { Basis, Evidence, OptionCost, OptionFigures, OptionStamp } from "../../analyst-api";
import { dominatedBy } from "../../command/options";
import { EvidenceBadge } from "./analyst-parts";
import { people } from "./results";

const pct = (share: number | null) => (share === null ? "—" : `${Math.round(share * 100)} %`);

/** Patient-days waiting, as the Result panel counts them: none when no site has a queue. */
export const waitingOf = (f: OptionFigures): number => (f.sitesWithQueue ? f.waitingDays : 0);
export const waitingText = (f: OptionFigures): string => (f.sitesWithQueue ? people(f.waitingDays) : "0");

/**
 * How many patient-days of waiting a run has more or less than another.
 *
 * Taken from the two figures as they are shown (rounded), not from the raw
 * counts: "267" beside "7,316" has to give the gap a reader finds by hand.
 */
export function waitingGap(of: OptionFigures, against: OptionFigures): number {
  return Math.round(waitingOf(of)) - Math.round(waitingOf(against));
}

/** Whether an option places a recorded response: its card then says what the run cost, or why nothing was counted. */
export const placesResponse = (o: { stamps: OptionStamp[] }): boolean => o.stamps.some((s) => s.body.kind === "response");

/**
 * Which tested options another one dominates, by their own runs.
 *
 * Only an option whose whole cost the engine counted can be weighed: one made
 * of a priced recorded response and nothing else. Capacity and measures carry
 * no price, so an option that changes any is neither dominated nor
 * dominating: saying so would rest on a cost nobody gave. What an option
 * achieves is the waiting it avoids against the scenario as it is, people
 * waiting where no site serves them included.
 */
export function weighOptions(
  asItIs: OptionFigures,
  options: { step: string; label: string; figures: OptionFigures; cost?: OptionCost }[],
): { dominated: Map<string, string>; weighed: number } {
  const waiting = (f: OptionFigures) => waitingOf(f) + (f.strandedWaitingDays ?? 0);
  const whole = options.filter((o) => o.cost?.complete && o.cost.counted !== null);
  return {
    dominated: dominatedBy(whole.map((o) => ({ id: o.step, label: o.label, achieved: waiting(asItIs) - waiting(o.figures), cost: o.cost!.counted! }))),
    weighed: whole.length,
  };
}

/** What a run cost, on its card: the count when there is one, and the sentence that says what it is a count of. */
export function CostLine({ cost }: { cost: OptionCost }) {
  return (
    <p className="text-[11px] leading-snug text-ink-muted">
      {cost.counted !== null ? (
        <span className="font-semibold text-ink-body">
          Cost counted: {Math.round(cost.counted).toLocaleString("en-CA")} ${cost.complete ? "" : " (not the whole cost)"}.{" "}
        </span>
      ) : null}
      {cost.says}
    </p>
  );
}

/** The longest wait among the runs shown together: what every bar is drawn against. */
export function waitingScale(runs: OptionFigures[]): number {
  return Math.max(1, ...runs.map(waitingOf));
}

const LEVELS: Evidence[] = ["measured", "published", "assumption"];
const LEVEL_FILL: Record<Evidence, string> = { measured: "bg-ok", published: "bg-brand", assumption: "bg-warn" };

/** How many of the things a run rests on are measured, published, or assumed. */
export function evidenceCounts(items: Basis[]): Record<Evidence, number> {
  const n: Record<Evidence, number> = { measured: 0, published: 0, assumption: 0 };
  for (const b of items) n[b.evidence]++;
  return n;
}

/**
 * The three levels of evidence of a run, as one line: how much of it was read
 * from the network, how much comes from an official source, how much was put
 * there by a person or the scenario. The three are never added together.
 */
export function EvidenceMeter({ items }: { items: Basis[] }) {
  if (!items.length) return null;
  const n = evidenceCounts(items);
  const said = LEVELS.filter((l) => n[l] > 0).map((l) => `${n[l]} ${l}`).join(" · ");
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span aria-hidden="true" className="flex h-1.5 w-16 shrink-0 gap-px overflow-hidden">
        {LEVELS.filter((l) => n[l] > 0).map((l) => (
          <span key={l} className={LEVEL_FILL[l]} style={{ flexGrow: n[l] }} />
        ))}
      </span>
      <span className="text-[10.5px] font-normal tabular-nums text-ink-faint">{said}</span>
    </span>
  );
}

/** One thing a run rests on per line, each with its level of evidence. */
export function BasisList({ items }: { items: Basis[] }) {
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

/** What a run comes to, in three words: the first thing read on its card. */
export function Outcome({ figures }: { figures: OptionFigures }) {
  const n = figures.sitesWithQueue;
  return (
    <span
      className={cn(
        "flex h-5 shrink-0 items-center whitespace-nowrap rounded-full px-2 text-[10.5px] font-semibold",
        n === 0 ? "bg-teal-soft text-teal" : "bg-danger-soft text-danger-ink",
      )}
    >
      {n === 0 ? "Nobody waits" : `${n} site${n === 1 ? "" : "s"} with a queue`}
    </span>
  );
}

/** Past this many sites a square each no longer fits a card: the queue is drawn as a share of a bar. */
const SQUARES_MAX = 60;

/** The sites that have a queue, among the sites the run reads: one square each. */
export function SiteStrip({ on, of }: { on: number; of: number }) {
  if (of <= 0) return null;
  if (of > SQUARES_MAX) {
    return (
      <span aria-hidden="true" className="block h-1.5 w-full bg-line-strong">
        <span className="block h-full bg-danger" style={{ width: `${Math.min(100, (on / of) * 100)}%` }} />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="flex flex-wrap gap-[2px]">
      {Array.from({ length: of }, (_, i) => (
        <span key={i} className={cn("h-1.5 w-1.5", i < on ? "bg-danger" : "bg-line-strong")} />
      ))}
    </span>
  );
}

/**
 * A run's figures, drawn.
 *
 * `against` is the run it is read beside (the scenario as it is): it gives the
 * gap in patient-days and the tick on the bar. `scale` is shared by every card
 * shown together, so two bars can be compared across cards.
 */
export function Figures({
  figures: f,
  against,
  scale,
  beside = "as it is",
  stranded = false,
}: {
  figures: OptionFigures;
  against?: OptionFigures | null;
  /** How the run it is read beside is named in the gap: "as it is", "without it". */
  beside?: string;
  scale: number;
  /** Whether to show the waiting where no site serves: only when the scenario has some. */
  stranded?: boolean;
}) {
  const gap = against ? waitingGap(f, against) : null;
  const width = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[11px] text-ink-muted">
      <div className="flex min-w-0 flex-col gap-1">
        <dt>Patient-days waiting</dt>
        <dd className="flex flex-col gap-1.5">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[22px] font-light leading-none tabular-nums text-ink">{waitingText(f)}</span>
            {gap === null ? null : (
              <span className={cn("tabular-nums", gap < 0 ? "text-ok-ink" : gap > 0 ? "text-danger-ink" : "text-ink-faint")}>
                {`${gap < 0 ? "−" : gap > 0 ? "+" : "±"}${Math.abs(gap).toLocaleString("en-CA")} vs ${beside}`}
              </span>
            )}
          </span>
          <span aria-hidden="true" className="relative block h-1.5 w-full bg-line-strong">
            <span className="block h-full bg-danger" style={{ width: width(waitingOf(f)), minWidth: waitingOf(f) > 0 ? 2 : 0 }} />
            {against ? (
              <span className="absolute -bottom-0.5 -top-0.5 w-px bg-ink" style={{ left: width(waitingOf(against)) }} />
            ) : null}
          </span>
        </dd>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <dt>Sites with a queue</dt>
        <dd className="flex flex-col gap-1.5">
          <span className="text-[22px] font-light leading-none tabular-nums text-ink">
            {f.sitesWithQueue}
            <span className="text-[12px] font-normal text-ink-muted"> of {f.sitesWithActivity}</span>
          </span>
          <SiteStrip on={f.sitesWithQueue} of={f.sitesWithActivity} />
        </dd>
      </div>
      <div className="col-span-2 flex flex-wrap gap-x-5 gap-y-1">
        <div className="flex items-baseline gap-1.5 whitespace-nowrap">
          <dt>Peak occupancy</dt>
          <dd className="tabular-nums text-ink">
            {pct(f.peakOccupancy)}
            {f.peakDay === null ? null : <span className="text-ink-faint"> · day {f.peakDay}</span>}
          </dd>
        </div>
        <div className="flex items-baseline gap-1.5 whitespace-nowrap">
          <dt>First day somebody waits</dt>
          <dd className="tabular-nums text-ink">{f.firstQueueDay === null ? "nobody waits" : `day ${f.firstQueueDay}`}</dd>
        </div>
        {stranded ? (
          <div className="flex items-baseline gap-1.5">
            <dt>Patient-days waiting where no site serves</dt>
            <dd className="tabular-nums text-ink">{f.strandedWaitingDays === null ? "—" : people(f.strandedWaitingDays)}</dd>
          </div>
        ) : null}
      </div>
    </dl>
  );
}

/**
 * A line that opens downwards: the title is always read, the explanation on a
 * click. `meta` sits at the right of the title and `below` on a line under it;
 * both are read with it, folded or not.
 */
export function Fold({
  title,
  meta,
  below,
  defaultOpen = false,
  children,
}: {
  title: string;
  meta?: ReactNode;
  below?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-line-soft">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full flex-col gap-1.5 px-3 py-2 text-left hover:bg-surface-hover"
      >
        <span className="flex w-full items-center gap-2">
          <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-ink-muted transition-transform", open && "rotate-90")} aria-hidden="true" />
          <span className="shrink-0 text-[12px] font-semibold text-ink">{title}</span>
          {meta ? <span className="ml-auto flex min-w-0 items-center">{meta}</span> : null}
        </span>
        {below ? <span className="flex pl-[22px]">{below}</span> : null}
      </button>
      {open ? <div className="flex flex-col gap-1.5 pb-3 pl-[34px] pr-3">{children}</div> : null}
    </div>
  );
}
