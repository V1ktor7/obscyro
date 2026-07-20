"use client";

/**
 * Studio Blueprint-styled primitives for the Unit command canvas only.
 * Local clones of command-ui.tsx so Crisis / Data Flux keep their own look.
 */

import { type ReactNode } from "react";

import { cn } from "@/lib/cn";

import { SEV_HEX } from "../command-ui";

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
        "text-[9px] font-medium uppercase tracking-wide text-[#8f99a8]",
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
        "flex shrink-0 items-center justify-between gap-2 border-b border-[#d3d8de] px-3 py-1.5",
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
        "inline-flex items-center gap-1.5 rounded border border-[#d3d8de] bg-white px-2 py-0.5 text-[10px] text-[#5f6b7c]",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Sparkline({
  values,
  width = 64,
  height = 18,
  stroke = "#2d72d2",
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
    <div className="relative flex flex-col justify-center overflow-hidden border-r border-[#d3d8de] px-3.5 py-1.5 last:border-r-0">
      <MicroLabel>{label}</MicroLabel>
      <span
        className={cn(
          "font-mono text-lg font-semibold leading-tight",
          tone === "crit"
            ? "text-rose-600"
            : tone === "warn"
              ? "text-amber-600"
              : "text-[#1c2127]",
        )}
      >
        {value}
      </span>
      {sub ? (
        <span className="truncate text-[9px] text-[#8f99a8]">{sub}</span>
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
    <div
      className={cn(
        "inline-flex rounded border border-[#d3d8de] bg-white",
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "px-3 py-1 text-[10px] font-medium uppercase tracking-wide transition-colors",
            value === o.value
              ? "bg-[#e7f2fd] text-[#215db0]"
              : "text-[#5f6b7c] hover:text-[#1c2127]",
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
      ? "#8f99a8"
      : clamped >= 95
        ? SEV_HEX.critical
        : clamped >= 85
          ? SEV_HEX.warn
          : "#2d72d2";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="#e5e8eb"
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
        className="fill-[#1c2127] font-mono text-[13px] font-semibold"
      >
        {pct == null ? "—" : `${Math.round(clamped)}%`}
      </text>
    </svg>
  );
}

export function occFillColor(pct: number): string {
  if (pct >= 95) return SEV_HEX.critical;
  if (pct >= 85) return SEV_HEX.warn;
  return "#2d72d2";
}
