"use client";

/**
 * Per-factor SVG lane — live history (solid), simulation (dashed + band),
 * warn/crit thresholds, NOW marker, and crisis onset markers.
 */

import { useMemo } from "react";

import { cn } from "@/lib/cn";

import { MicroLabel } from "../command-ui";
import type { ProjPoint } from "./crisis-lib";
import type { StackItem } from "./crisis-lib";
import { CRISES } from "./crisis-lib";
import type { WatchFactor } from "./crisis-lib";

export interface LiveTick {
  t: number;
  v: number;
}

export default function CrisisLaneChart({
  factor,
  liveHistory,
  simSeries,
  baselineSeries,
  stack,
  horizonH,
  mode,
  dataSource,
  height = 120,
}: {
  factor: WatchFactor;
  liveHistory: LiveTick[];
  simSeries?: ProjPoint[];
  baselineSeries?: ProjPoint[];
  stack: StackItem[];
  horizonH: number;
  mode: "overlay" | "split";
  /** "backend" | "projection" — shown as badge */
  dataSource?: "backend" | "projection" | null;
  height?: number;
}) {
  const width = 640;
  const padL = 36;
  const padR = 12;
  const padT = 8;
  const padB = 22;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const { livePath, simPath, bandPath, basePath, warnY, critY } =
    useMemo(() => {
      const vals: number[] = [factor.base, factor.warn, factor.crit];
      for (const pt of liveHistory) vals.push(pt.v);
      for (const pt of simSeries ?? []) {
        vals.push(pt.v, pt.lo, pt.hi);
      }
      let minY = Math.min(...vals, 0);
      let maxY = Math.max(...vals, factor.crit * 1.1, 1);
      if (factor.fmt(factor.base).includes("%")) {
        minY = Math.max(0, minY - 5);
        maxY = Math.min(100, maxY + 5);
      } else {
        const pad = (maxY - minY) * 0.1 || 1;
        minY = Math.max(0, minY - pad);
        maxY = maxY + pad;
      }

      const xOf = (t: number) => padL + (t / Math.max(horizonH, 1)) * plotW;
      const yOf = (v: number) =>
        padT + plotH - ((v - minY) / (maxY - minY || 1)) * plotH;

      const livePath = liveHistory
        .map((p, i) => `${i === 0 ? "M" : "L"} ${xOf(p.t).toFixed(1)} ${yOf(p.v).toFixed(1)}`)
        .join(" ");

      const simPath =
        simSeries
          ?.map((p, i) => `${i === 0 ? "M" : "L"} ${xOf(p.t).toFixed(1)} ${yOf(p.v).toFixed(1)}`)
          .join(" ") ?? "";

      let bandPath = "";
      if (simSeries?.length) {
        const upper = simSeries.map(
          (p) => `${xOf(p.t).toFixed(1)},${yOf(p.hi).toFixed(1)}`,
        );
        const lower = [...simSeries]
          .reverse()
          .map((p) => `${xOf(p.t).toFixed(1)},${yOf(p.lo).toFixed(1)}`);
        bandPath = [...upper, ...lower].join(" ");
      }

      const basePath =
        baselineSeries && mode === "split"
          ? baselineSeries
              .map(
                (p, i) =>
                  `${i === 0 ? "M" : "L"} ${xOf(p.t).toFixed(1)} ${yOf(p.v).toFixed(1)}`,
              )
              .join(" ")
          : "";

      return {
        livePath,
        simPath,
        bandPath,
        basePath,
        warnY: yOf(factor.warn),
        critY: yOf(factor.crit),
      };
    }, [
      factor,
      liveHistory,
      simSeries,
      baselineSeries,
      horizonH,
      mode,
      plotW,
      plotH,
      padL,
      padT,
    ]);

  const nowX = padL + (0 / Math.max(horizonH, 1)) * plotW;

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <MicroLabel>{factor.scope}</MicroLabel>
          <div className="flex items-center gap-2">
            <span className="truncate text-xs font-medium text-gray-800">
              {factor.name}
            </span>
            <span
              className="font-mono text-[10px] tabular-nums"
              style={{ color: factor.color }}
            >
              {factor.fmt(factor.base)}
            </span>
            {dataSource && (
              <span
                className={cn(
                  "rounded px-1 py-0.5 font-mono text-[8px] uppercase tracking-wide",
                  dataSource === "backend"
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-amber-50 text-amber-700",
                )}
              >
                {dataSource === "backend" ? "backend" : "client projection"}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-3 font-mono text-[9px] text-gray-400">
          <span>warn {factor.fmt(factor.warn)}</span>
          <span>crit {factor.fmt(factor.crit)}</span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label={`${factor.name} lane chart`}
      >
        <line
          x1={padL}
          y1={warnY}
          x2={width - padR}
          y2={warnY}
          stroke="#f59e0b"
          strokeWidth={0.75}
          strokeDasharray="4 3"
          opacity={0.6}
        />
        <line
          x1={padL}
          y1={critY}
          x2={width - padR}
          y2={critY}
          stroke="#f43f5e"
          strokeWidth={0.75}
          strokeDasharray="4 3"
          opacity={0.6}
        />
        {bandPath && (
          <polygon
            points={bandPath}
            fill={factor.color}
            opacity={0.12}
          />
        )}
        {basePath && (
          <path
            d={basePath}
            fill="none"
            stroke="#94a3b8"
            strokeWidth={1}
            strokeDasharray="2 3"
          />
        )}
        {livePath && (
          <path
            d={livePath}
            fill="none"
            stroke="#334155"
            strokeWidth={1.5}
          />
        )}
        {simPath && (
          <path
            d={simPath}
            fill="none"
            stroke={factor.color}
            strokeWidth={1.5}
            strokeDasharray="5 3"
          />
        )}
        <line
          x1={nowX}
          y1={padT}
          x2={nowX}
          y2={height - padB}
          stroke="#6366f1"
          strokeWidth={1}
          opacity={0.7}
        />
        <text x={nowX + 2} y={padT + 8} fontSize={8} fill="#6366f1">
          NOW
        </text>
        {stack.map((s) => {
          const c = CRISES.find((x) => x.id === s.cid);
          if (!c) return null;
          const x = padL + (s.onsetH / Math.max(horizonH, 1)) * plotW;
          return (
            <g key={`${s.cid}-${s.onsetH}`}>
              <line
                x1={x}
                y1={padT}
                x2={x}
                y2={height - padB}
                stroke="#cbd5e1"
                strokeWidth={0.75}
                strokeDasharray="2 2"
              />
              <text x={x + 2} y={height - 4} fontSize={7} fill="#94a3b8">
                {c.icon} T+{s.onsetH}h
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
