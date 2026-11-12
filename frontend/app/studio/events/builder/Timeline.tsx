"use client";

/**
 * Over time: one lane per change, drawn the way the engine reads it. A bar is
 * the period; drag it to move it, its ends to resize it, the diamond to move a
 * peak. The ruler is the step being looked at, for the map and the numbers.
 */

import { useRef } from "react";

import { cn } from "@/lib/cn";
import { magnitudeAt } from "./engine";
import { coefOf, exposureSeries, riseSeries } from "./exposures";
import { clamp, u1, uN, type Ctx } from "./format";
import { itemLabel, itemId, type Item } from "./items";
import { fam } from "./model";
import type { BuilderTwin } from "./twin";

type Grip = "m" | "l" | "r" | "p";

interface Drag {
  kind: Grip;
  x: number;
  w: number;
  start: number;
  end: number | null;
  pt: number;
  ex?: { start: number; days: number; spread: number };
}

function moveExposure(it: Extract<Item, { kind: "exposure" }>, g: Drag, d: number, H: number) {
  const x = it.x, attack = coefOf(x).kind === "attack", ex = g.ex!, len = attack ? ex.spread : ex.days;
  if (g.kind === "m") x.start = clamp(ex.start + d, 0, H - 1);
  else if (g.kind === "l") {
    const s = clamp(ex.start + d, 0, ex.start + len - 1);
    x.start = s;
    if (attack) x.attack.spread = ex.spread - (s - ex.start);
    else x.days = ex.days - (s - ex.start);
  } else if (g.kind === "r") {
    if (attack) x.attack.spread = Math.max(1, ex.spread + d);
    else x.days = Math.max(1, ex.days + d);
  }
}

export default function Timeline({ items, tw, ctx, day, selected, colourOf, onSelect, onDay, change }: {
  items: Item[]; tw: BuilderTwin; ctx: Ctx; day: number; selected: string | null; colourOf: (key: string) => string;
  onSelect: (key: string) => void; onDay: (t: number) => void; change: (fn: () => void) => void;
}) {
  const H = ctx.horizon;
  const axisRef = useRef<HTMLDivElement | null>(null);
  const every = H <= 40 ? 5 : H <= 120 ? 10 : 30;

  function dayAt(clientX: number) {
    const r = axisRef.current?.getBoundingClientRect();
    if (!r || !(r.width > 0)) return day;
    return clamp(Math.floor(((clientX - r.left) / r.width) * H), 0, H - 1);
  }
  function startDay(ev: React.PointerEvent) {
    ev.preventDefault();
    onDay(dayAt(ev.clientX));
    const move = (m: PointerEvent) => onDay(dayAt(m.clientX));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  function startBar(ev: React.PointerEvent, it: Item, grip: Grip) {
    const lane = (ev.currentTarget as HTMLElement).closest("[data-lane]")?.getBoundingClientRect();
    if (!lane || !(lane.width > 0)) return;
    ev.preventDefault();
    ev.stopPropagation();
    onSelect(it.key);
    const p = it.kind === "effect" ? it.e.profile : { start: it.x.start, end: it.x.start, peak_tick: null as number | null | undefined };
    const g: Drag = { kind: grip, x: ev.clientX, w: lane.width, start: p.start, end: p.end ?? null, pt: p.peak_tick != null ? p.peak_tick : Math.round((p.start + (p.end == null ? p.start : p.end)) / 2) };
    if (it.kind === "exposure") g.ex = { start: it.x.start, days: it.x.days, spread: it.x.attack.spread };
    let last = 0;
    const move = (m: PointerEvent) => {
      const d = Math.round(((m.clientX - g.x) / g.w) * H);
      if (d === last) return;
      last = d;
      change(() => {
        if (it.kind === "exposure") { moveExposure(it, g, d, H); return; }
        const q = it.e.profile;
        if (g.kind === "m") {
          q.start = clamp(g.start + d, 0, H - 1);
          if (g.end != null) q.end = q.start + (g.end - g.start);
          if (q.peak_tick != null) q.peak_tick = g.pt + (q.start - g.start);
        } else if (g.kind === "l") {
          q.start = clamp(g.start + d, 0, g.end == null ? H - 1 : g.end);
          if (q.shape === "pulse") q.end = q.start;
          if (q.peak_tick != null) q.peak_tick = Math.max(q.peak_tick, q.start);
        } else if (g.kind === "r") {
          q.end = Math.max(g.start, (g.end == null ? H - 1 : g.end) + d);
          if (q.peak_tick != null) q.peak_tick = Math.min(q.peak_tick, q.end);
        } else if (q.end != null) {
          q.peak_tick = clamp(g.pt + d, q.start, q.end);
        }
      });
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const ruler = `${((day + 0.5) / H) * 100}%`;
  return (
    <div className="grid grid-cols-[minmax(110px,170px)_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">{uN(ctx)}</span>
      <div ref={axisRef} onPointerDown={startDay} role="slider" aria-label={`${u1(ctx)} being looked at`} aria-valuemin={0} aria-valuemax={H - 1} aria-valuenow={day} tabIndex={0}
        onKeyDown={(ev) => { if (ev.key === "ArrowRight") onDay(clamp(day + 1, 0, H - 1)); if (ev.key === "ArrowLeft") onDay(clamp(day - 1, 0, H - 1)); }}
        className="relative h-6 cursor-ew-resize touch-none select-none border-b border-line-soft text-[10px] text-ink-faint focus:outline-none focus-visible:ring-1 focus-visible:ring-brand">
        {Array.from({ length: Math.ceil(H / every) }, (_, k) => k * every).map((t) => (
          <b key={t} className="absolute top-1 -translate-x-1/2 font-normal tabular-nums" style={{ left: `${((t + 0.5) / H) * 100}%` }}>{t}</b>
        ))}
        <span className="absolute -top-0.5 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-ink px-1.5 py-0.5 text-[10px] text-white" style={{ left: ruler }}>{u1(ctx)} {day}</span>
      </div>
      {items.map((it) => {
        const fg = colourOf(it.key), sel = it.key === selected;
        let d = "M0,1", first = 0, last = 0, resizable = true, dashed = false, peak: number | null = null;
        if (it.kind === "exposure") {
          const x = it.x, c = coefOf(x), mid = exposureSeries(x, tw, ctx), top = Math.max(1e-9, ...mid.map(Math.abs));
          for (let t = 0; t < H; t++) { const y = (1 - (Math.abs(mid[t] ?? 0) / top) * 0.92).toFixed(3); d += ` L${t},${y} L${t + 1},${y}`; }
          const len = c.kind === "attack" ? x.lag + x.attack.spread : c.kind === "curve" ? c.days ?? 1 : (riseSeries(x) || []).length || 1;
          first = clamp(x.start, 0, H - 1); last = clamp(x.start + len - 1, first, H - 1);
          resizable = c.kind !== "curve" && (c.kind !== "rr" || x.where.mode === "each" || x.rise.mode === "same");
          dashed = true;
        } else {
          const p = it.e.profile, obj = fam(it.e) === "object";
          for (let t = 0; t < H; t++) { const m = obj ? (magnitudeAt(p, t) > 0 ? 1 : 0) : Math.min(1, magnitudeAt(p, t)); d += ` L${t},${(1 - m * 0.92).toFixed(3)} L${t + 1},${(1 - m * 0.92).toFixed(3)}`; }
          last = Math.min(H - 1, p.shape === "pulse" ? p.start : p.end == null ? H - 1 : Math.max(p.end, p.start));
          first = Math.min(p.start, H - 1);
          resizable = p.shape !== "pulse";
          if (!obj && p.shape === "gaussian" && p.end != null) {
            const centre = p.peak_tick != null ? p.peak_tick : (p.start + p.end) / 2;
            peak = clamp(((centre + 0.5 - first) / (last - first + 1)) * 100, 0, 100);
          }
        }
        d += ` L${H},1 Z`;
        const label = itemLabel(it, tw);
        return [
          <button key={`n-${it.key}`} type="button" onClick={() => onSelect(it.key)} title={itemId(it)}
            className={cn("flex min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11.5px]", sel ? "bg-brand-soft text-brand-deep" : "text-ink-body hover:bg-canvas")}>
            <i className="h-2 w-2 shrink-0 rounded-full" style={{ background: fg }} />
            <span className="truncate">{label}</span>
          </button>,
          <div key={`l-${it.key}`} data-lane className="relative h-8 rounded border border-line-soft bg-white">
            <svg viewBox={`0 0 ${H} 1`} preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0 h-full w-full">
              <path d={d} fill={fg} fillOpacity={first >= H ? 0 : 0.22} stroke={fg} strokeWidth={1.3} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            </svg>
            <div onPointerDown={(ev) => startBar(ev, it, "m")} title={it.kind === "exposure" ? "The exposure. The curve is the arrivals it brings." : itemId(it)}
              className={cn("absolute inset-y-0.5 cursor-grab touch-none rounded border-2 active:cursor-grabbing", sel ? "bg-white/30" : "bg-transparent")}
              style={{ left: `${(first / H) * 100}%`, width: `${Math.max(((last - first + 1) / H) * 100, 0.8)}%`, borderColor: fg, borderStyle: dashed ? "dashed" : "solid" }}>
              {resizable ? <>
                <span onPointerDown={(ev) => startBar(ev, it, "l")} className="absolute inset-y-0 -left-1 w-2 cursor-ew-resize" aria-hidden="true" />
                <span onPointerDown={(ev) => startBar(ev, it, "r")} className="absolute inset-y-0 -right-1 w-2 cursor-ew-resize" aria-hidden="true" />
              </> : null}
              {peak != null ? <span onPointerDown={(ev) => startBar(ev, it, "p")} title="Drag to move the peak" className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-ew-resize" style={{ left: `${peak}%`, background: fg }} /> : null}
            </div>
            <span className="pointer-events-none absolute inset-y-0 w-px bg-ink" style={{ left: ruler }} />
          </div>,
        ];
      })}
    </div>
  );
}
