"use client";

/** The small pieces every panel of the builder draws with. */

import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export const BTN = "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md border border-line bg-white px-2.5 text-xs text-ink-body hover:border-brand hover:text-brand-deep disabled:cursor-not-allowed disabled:opacity-50";
export const BTN_P = "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md border border-brand-deep bg-brand px-3 text-xs font-medium text-white hover:bg-brand-deep disabled:cursor-not-allowed disabled:border-ink-ghost disabled:bg-ink-ghost";
export const BTN_SM = "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded border border-line bg-white px-2 text-[11.5px] text-ink-body hover:border-brand hover:text-brand-deep";
export const IN = "h-[26px] rounded border border-line bg-white px-2 text-xs text-ink focus:border-brand focus:outline-none";
export const LBL = "text-[10px] font-medium uppercase tracking-wide text-ink-faint";
export const HELP = "text-[11.5px] leading-snug text-ink-muted";

/** Sentences carry `code` for the ontology's own names and **bold** for a number worth reading first. */
export function Rich({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0, k = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    out.push(tok.startsWith("`")
      ? <code key={k++} className="rounded bg-canvas px-1 font-mono text-[0.9em]">{tok.slice(1, -1)}</code>
      : <b key={k++} className="font-semibold text-ink">{tok.slice(2, -2)}</b>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; label: ReactNode; disabled?: string }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <span role="group" aria-label={label} className="inline-flex flex-wrap overflow-hidden rounded-md border border-line bg-white">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          disabled={!!o.disabled}
          title={o.disabled}
          aria-pressed={o.v === value}
          onClick={() => onChange(o.v)}
          className={cn(
            "h-[26px] border-r border-line-soft px-2.5 text-xs last:border-r-0",
            o.v === value ? "bg-brand-soft font-medium text-brand-deep" : "text-ink-body hover:bg-canvas",
            o.disabled && "cursor-not-allowed text-ink-ghost hover:bg-transparent",
          )}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

/** A number field that keeps what the person types until it reads as a number. */
export function NumIn({ value, onChange, min, max, step, width = 74, label }: { value: number | null | undefined; onChange: (n: number | null) => void; min?: number; max?: number; step?: number | "any"; width?: number; label?: string }) {
  return (
    <input
      type="number"
      aria-label={label}
      className={IN}
      style={{ width }}
      min={min}
      max={max}
      step={step ?? "any"}
      value={value == null || !Number.isFinite(value) ? "" : value}
      onChange={(ev) => onChange(ev.target.value === "" ? null : Number(ev.target.value))}
    />
  );
}

export function Row({ label, children, top }: { label?: ReactNode; children: ReactNode; top?: boolean }) {
  return (
    <div className={cn("flex flex-wrap gap-2 text-xs", top ? "items-start" : "items-center")}>
      {label !== undefined ? <span className={cn(LBL, "w-[92px] shrink-0")}>{label}</span> : null}
      {children}
    </div>
  );
}

export interface Series {
  v?: (number | null)[];
  band?: [number[], number[]];
  c: string;
  fill?: boolean;
  dash?: boolean;
  dots?: boolean;
  w?: number;
}

/** A step chart over the run, with an optional band and the day being looked at. */
export function MiniChart({ series, horizon, day, label, zero = true, height = 128 }: { series: Series[]; horizon: number; day: number; label: string; zero?: boolean; height?: number }) {
  const W = 380, Hh = height, L = 34, R = 6, T = 8, B = 18;
  const vals = series.flatMap((s) => [...(s.v || []), ...(s.band ? [...s.band[0], ...s.band[1]] : [])]).filter((x): x is number => x != null && Number.isFinite(x));
  const top = Math.max(1e-9, ...vals) * 1.08;
  const lo = zero ? Math.min(0, ...vals) * 1.08 : Math.min(...vals) * 0.96;
  const X = (t: number) => L + (t / horizon) * (W - L - R), Y = (v: number) => T + (1 - (v - lo) / (top - lo)) * (Hh - T - B);
  const every = horizon <= 40 ? 10 : horizon <= 120 ? 20 : 60;
  const path = (arr: (number | null)[]) => arr.map((v, t) => (v == null ? "" : `${t ? "L" : "M"}${X(t).toFixed(1)},${Y(v).toFixed(1)} L${X(t + 1).toFixed(1)},${Y(v).toFixed(1)}`)).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${Hh}`} role="img" aria-label={label} className="block h-auto w-full rounded-md border border-line-soft bg-white">
      {[0, 0.5, 1].map((fr) => {
        const v = lo + (top / 1.08 - lo) * fr;
        return (
          <g key={fr}>
            <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="#eef1f4" />
            <text x={L - 4} y={Y(v) + 3} textAnchor="end" fontSize="9" fill="#8f99a8">{Math.abs(v) >= 100 ? Math.round(v) : Number(v.toPrecision(2))}</text>
          </g>
        );
      })}
      {Array.from({ length: Math.ceil(horizon / every) }, (_, k) => k * every).map((t) => (
        <text key={t} x={X(t + 0.5)} y={Hh - 5} textAnchor="middle" fontSize="9" fill="#8f99a8">{t}</text>
      ))}
      {series.map((s, k) => {
        if (s.band) {
          const [a, b] = s.band;
          let d = b.map((v, t) => `${t ? "L" : "M"}${X(t).toFixed(1)},${Y(v).toFixed(1)} L${X(t + 1).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
          for (let t = a.length - 1; t >= 0; t--) d += ` L${X(t + 1).toFixed(1)},${Y(a[t]!).toFixed(1)} L${X(t).toFixed(1)},${Y(a[t]!).toFixed(1)}`;
          return <path key={k} d={`${d} Z`} fill={s.c} fillOpacity={0.16} stroke="none" />;
        }
        if (s.dots) return <g key={k}>{(s.v || []).map((v, t) => (v == null ? null : <circle key={t} cx={X(t + 0.5)} cy={Y(v)} r={1.7} fill={s.c} />))}</g>;
        const d = path(s.v || []);
        return (
          <g key={k}>
            {s.fill ? <path d={`${d} L${X(horizon)},${Y(Math.max(lo, 0))} L${X(0)},${Y(Math.max(lo, 0))} Z`} fill={s.c} fillOpacity={0.14} /> : null}
            <path d={d} fill="none" stroke={s.c} strokeWidth={s.w || 1.6} strokeDasharray={s.dash ? "4 3" : undefined} strokeLinejoin="round" />
          </g>
        );
      })}
      <line x1={X(day + 0.5)} x2={X(day + 0.5)} y1={T} y2={Hh - B} stroke="#1c2127" />
    </svg>
  );
}

export function Key({ items }: { items: [string, string, ("dash" | "dots" | "band" | "line")?][] }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-muted">
      {items.map(([c, l, kind], k) => (
        <span key={k} className="inline-flex items-center gap-1">
          <i
            className="inline-block"
            style={kind === "dots"
              ? { width: 6, height: 6, borderRadius: 9, background: c }
              : kind === "band"
                ? { width: 14, height: 9, borderRadius: 2, background: c, opacity: 0.3 }
                : { width: 14, height: 3, borderRadius: 2, background: kind === "dash" ? "transparent" : c, borderTop: kind === "dash" ? `2px dashed ${c}` : undefined }}
          />
          {l}
        </span>
      ))}
    </div>
  );
}

/** The six categorical tints the Studio gives types: they mean nothing, they only tell changes apart. */
export const TINTS: [string, string][] = [["#e7f2fd", "#215db0"], ["#e8f4ec", "#1c6e42"], ["#fdf0e6", "#935610"], ["#f2ebfb", "#6b3fa0"], ["#fceaef", "#a82255"], ["#e9f5f4", "#0f6b68"]];
