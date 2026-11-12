"use client";

/**
 * A saved event, read the way it was written: one sentence per change, and
 * the changes over time. A helper (smoke, a COVID wave) shows as the one line
 * it was, not as the dozens of arrival changes it sends.
 */

import { useMemo, useState } from "react";

import type { SimEvent, SimExport } from "@/lib/platform-api";
import { clamp, type Ctx } from "./format";
import { sentenceOf, toItems, truthOf } from "./items";
import Timeline from "./Timeline";
import { builderTwin } from "./twin";
import { BTN, Rich, TINTS } from "./ui";

export default function EventPreview({ snapshot, event, onEdit }: { snapshot: SimExport; event: SimEvent; onEdit: () => void }) {
  const tw = useMemo(() => builderTwin(snapshot), [snapshot]);
  const ctx: Ctx = useMemo(() => ({ horizon: event.horizon, unit: "day" }), [event.horizon]);
  const items = useMemo(() => toItems(event.effects, tw, ctx), [event.effects, tw, ctx]);
  const first = items[0];
  const [day, setDay] = useState(() => (first ? clamp(first.kind === "effect" ? first.e.profile.start : first.x.start, 0, event.horizon - 1) : 0));
  const colour = (key: string) => TINTS[Math.max(0, items.findIndex((it) => it.key === key)) % TINTS.length]![1];

  return (
    <section className="rounded-md border border-line bg-white p-4">
      <div className="mb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-ink">{event.name}</h2>
          {event.description ? <p className="mt-0.5 text-[11.5px] leading-snug text-ink-muted">{event.description}</p> : null}
        </div>
        <button type="button" className={BTN} onClick={onEdit}>Edit the event</button>
      </div>
      {items.length ? (
        <>
          <ul className="mb-3 flex flex-col gap-1.5">
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
          <Timeline items={items} tw={tw} ctx={ctx} day={day} selected={null} colourOf={colour}
            onSelect={onEdit} onDay={setDay} change={() => onEdit()} />
          <p className="mt-2 text-[11px] text-ink-faint">Dragging a bar opens the event for editing.</p>
        </>
      ) : <p className="text-[11.5px] text-ink-faint">This event has no change yet.</p>}
    </section>
  );
}
