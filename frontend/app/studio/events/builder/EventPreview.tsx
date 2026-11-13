"use client";

/**
 * A saved event, read the way it was written: one sentence per change, and
 * the changes over time. A helper (smoke, a COVID wave) shows as the one line
 * it was, not as the dozens of arrival changes it sends — and so does a curve a
 * model wrote day by day, which shows as one line per severity.
 */

import { useMemo, useState } from "react";

import type { SimEvent, SimExport } from "@/lib/platform-api";
import { dailySeries, seriesBar, seriesSummary, type DailySeries } from "./daily";
import { clamp, fmt, names, type Ctx } from "./format";
import { sentenceOf, toItems, truthOf, type Item } from "./items";
import Timeline from "./Timeline";
import { builderTwin, type BuilderTwin } from "./twin";
import { BTN, Rich, TINTS } from "./ui";

function Sparkline({ values, colour }: { values: number[]; colour: string }) {
  const max = Math.max(...values, 0);
  if (!(max > 0) || values.length < 2) return null;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(2)},${(28 - (v / max) * 26).toFixed(2)}`);
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="mt-1 h-7 w-full max-w-[260px]" aria-hidden>
      <polygon points={`0,30 ${pts.join(" ")} 100,30`} fill={colour} opacity={0.15} />
      <polyline points={pts.join(" ")} fill="none" stroke={colour} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function seriesLine(s: DailySeries, tw: BuilderTwin, horizon: number): { sentence: string; truth: string } {
  const where = s.pops.length === tw.pops.length && tw.pops.length > 1
    ? `every territory (${s.pops.length})`
    : s.pops.length === 1 ? (tw.popById.get(s.pops[0]!)?.name ?? s.pops[0]!) : names(s.pops.map((id) => tw.popById.get(id)?.name ?? id), "territories");
  const { peak, peakDay, total } = seriesSummary(s);
  return {
    sentence: `Arrivals as **${s.acuity}** from **${where}**, set day by day by a model, days ${s.first}–${s.last}.`,
    truth: `**${fmt(peak)}** arrivals a day at the peak (day ${peakDay}) · **${fmt(total)}** over the ${horizon} days · ${fmt(s.count)} stored changes.`,
  };
}

export default function EventPreview({ snapshot, event, onEdit }: { snapshot: SimExport; event: SimEvent; onEdit: () => void }) {
  const tw = useMemo(() => builderTwin(snapshot), [snapshot]);
  const ctx: Ctx = useMemo(() => ({ horizon: event.horizon, unit: "day" }), [event.horizon]);
  const { series, items, bars } = useMemo(() => {
    const { series, rest } = dailySeries(event.effects, (id) => tw.popById.get(id)?.size ?? 0);
    const items = toItems(rest, tw, ctx);
    // The timeline draws each curve as one bar; the bars are drawn, never sent.
    const bars: Item[] = series.map((s) => ({ kind: "effect", key: `daily-${s.acuity}`, e: seriesBar(s), mem: { pops: true, sevs: true } }));
    return { series, items, bars };
  }, [event.effects, tw, ctx]);
  const drawn = useMemo(() => [...bars, ...items], [bars, items]);
  const first = drawn[0];
  const [day, setDay] = useState(() => (first ? clamp(first.kind === "effect" ? first.e.profile.start : first.x.start, 0, event.horizon - 1) : 0));
  const colour = (key: string) => TINTS[Math.max(0, drawn.findIndex((it) => it.key === key)) % TINTS.length]![1];

  return (
    <section className="rounded-md border border-line bg-white p-4">
      <div className="mb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-ink">{event.name}</h2>
          {event.description ? <p className="mt-0.5 text-[11.5px] leading-snug text-ink-muted">{event.description}</p> : null}
        </div>
        <button type="button" className={BTN} onClick={onEdit}>Edit the event</button>
      </div>
      {drawn.length ? (
        <>
          <ul className="mb-3 flex flex-col gap-1.5">
            {series.map((s) => {
              const line = seriesLine(s, tw, event.horizon);
              const c = colour(`daily-${s.acuity}`);
              return (
                <li key={`daily-${s.acuity}`} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-body">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: c }} />
                  <span className="min-w-0 flex-1">
                    <Rich text={line.sentence} />
                    <span className="block text-[11px] text-ink-faint"><Rich text={line.truth} /></span>
                    <Sparkline values={s.perDay} colour={c} />
                  </span>
                </li>
              );
            })}
            {items.map((it) => (
              <li key={it.key} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-body">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: colour(it.key) }} />
                <span>
                  {sentenceOf(it, tw, ctx).map((p, k) => <Rich key={k} text={typeof p === "string" ? p : p.text} />)}
                  <span className="block text-[11px] text-ink-faint"><Rich text={truthOf(it, tw, ctx).text} /></span>
                </span>
              </li>
            ))}
          </ul>
          <Timeline items={drawn} tw={tw} ctx={ctx} day={day} selected={null} colourOf={colour}
            onSelect={onEdit} onDay={setDay} change={() => onEdit()} />
          <p className="mt-2 text-[11px] text-ink-faint">Dragging a bar opens the event for editing.</p>
        </>
      ) : <p className="text-[11.5px] text-ink-faint">This event has no change yet.</p>}
    </section>
  );
}
