"use client";

/**
 * Shared primitives for the command-style Studio views (Twin Command,
 * Crisis Simulation, Data Flux). Light palette adaptation of the design
 * prototypes in design/twin-command-view.html and design/twin-sim-flux-view.html.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import type { TwinAlertSeverity } from "@/lib/platform-api";

export const SEV_HEX: Record<TwinAlertSeverity | "ok", string> = {
  critical: "#f43f5e", // rose-500
  warn: "#f59e0b", // amber-500
  info: "#0ea5e9", // sky-500
  ok: "#10b981", // emerald-500
};

export function severityHex(sev: TwinAlertSeverity | null): string {
  return SEV_HEX[sev ?? "ok"];
}

export function MicroLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-mono text-[9px] uppercase tracking-[0.14em] text-gray-400",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function PanelHead({
  title,
  right,
  className,
}: {
  title: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 px-3 py-1.5",
        className,
      )}
    >
      <MicroLabel>{title}</MicroLabel>
      {right ?? null}
    </div>
  );
}

export function Chip({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border border-gray-200 bg-white px-2 py-0.5 font-mono text-[10px] text-gray-500",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function LiveDot({
  mode,
}: {
  mode: "stream" | "poll" | "idle" | "error";
}) {
  const color =
    mode === "stream"
      ? "bg-emerald-500"
      : mode === "poll"
        ? "bg-amber-500"
        : mode === "error"
          ? "bg-rose-500"
          : "bg-gray-300";
  return (
    <span
      className={cn(
        "h-1.5 w-1.5 rounded-full",
        color,
        (mode === "stream" || mode === "poll") && "animate-pulse",
      )}
    />
  );
}

export function Sparkline({
  values,
  width = 64,
  height = 18,
  stroke = "#6366f1",
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  className?: string;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map(
      (v, i) =>
        `${((i / (values.length - 1)) * width).toFixed(1)},${(
          height - 2 - ((v - min) / span) * (height - 4)
        ).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg width={width} height={height} className={className} aria-hidden>
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth={1.2} />
    </svg>
  );
}

export function KpiCell({
  label,
  value,
  sub,
  tone = "default",
  spark,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "warn" | "crit";
  spark?: number[];
}) {
  return (
    <div className="relative flex flex-col justify-center overflow-hidden border-r border-gray-200 px-3.5 py-1.5 last:border-r-0">
      <MicroLabel>{label}</MicroLabel>
      <span
        className={cn(
          "font-mono text-lg font-semibold leading-tight",
          tone === "crit"
            ? "text-rose-600"
            : tone === "warn"
              ? "text-amber-600"
              : "text-gray-900",
        )}
      >
        {value}
      </span>
      {sub ? (
        <span className="truncate font-mono text-[9px] text-gray-400">{sub}</span>
      ) : null}
      {spark && spark.length > 1 ? (
        <Sparkline
          values={spark}
          className="absolute bottom-1.5 right-2.5 opacity-60"
        />
      ) : null}
    </div>
  );
}

export function ModeToggle<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("inline-flex rounded border border-gray-200 bg-white", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "px-3 py-1 font-mono text-[10px] uppercase tracking-wide transition-colors",
            value === o.value
              ? "bg-indigo-50 text-indigo-700"
              : "text-gray-500 hover:text-gray-800",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Circular gauge with a centered percentage label. */
export function GaugeArc({
  pct,
  size = 66,
}: {
  pct: number | null;
  size?: number;
}) {
  const r = size / 2 - 7;
  const c = 2 * Math.PI * r;
  const clamped = pct == null ? 0 : Math.min(100, Math.max(0, pct));
  const off = c * (1 - clamped / 100);
  const color =
    pct == null
      ? "#9ca3af"
      : clamped >= 95
        ? SEV_HEX.critical
        : clamped >= 85
          ? SEV_HEX.warn
          : "#6366f1";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="#e5e7eb"
        strokeWidth={5}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={5}
        strokeDasharray={c}
        strokeDashoffset={off}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x={size / 2}
        y={size / 2 + 4}
        textAnchor="middle"
        className="fill-gray-800 font-mono text-[13px] font-semibold"
      >
        {pct == null ? "—" : `${Math.round(clamped)}%`}
      </text>
    </svg>
  );
}

export function occFillColor(pct: number): string {
  if (pct >= 95) return SEV_HEX.critical;
  if (pct >= 85) return SEV_HEX.warn;
  return "#6366f1";
}

/** Observe an element's width (for full-bleed SVG panels). */
export function useElementWidth<T extends HTMLElement>(): [
  React.RefObject<T>,
  number,
] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w != null) setWidth(w);
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "now";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
