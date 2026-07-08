"use client";

/**
 * Animated ingest flow canvas — sources → pipeline stages → digital twin
 * ontology types with real freshness from metrics.
 */

import { useEffect, useState } from "react";

import type { IngestSource } from "@/lib/platform-api";
import type { MetricsSnapshot } from "../live-api";

const STAGES = ["Parse", "Normalize", "Ontology map"];

export default function FluxCanvas({
  sources,
  metrics,
}: {
  sources: IngestSource[];
  metrics: MetricsSnapshot | null;
}) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1200);
    return () => clearInterval(id);
  }, []);

  const types = metrics?.byType ?? [];
  const w = 720;
  const h = 220;
  const sourceX = 40;
  const stageStart = 180;
  const twinX = 520;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full min-h-[180px]">
      <defs>
        <linearGradient id="flowGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#6366f1" stopOpacity={0.2} />
          <stop offset="100%" stopColor="#6366f1" stopOpacity={0.05} />
        </linearGradient>
      </defs>

      {/* Source nodes */}
      {sources.slice(0, 5).map((s, i) => {
        const y = 30 + i * 36;
        const pulse = (tick + i) % 3 === 0;
        return (
          <g key={s.id}>
            <rect
              x={sourceX}
              y={y}
              width={100}
              height={28}
              rx={4}
              fill={pulse ? "#eef2ff" : "#f8fafc"}
              stroke="#c7d2fe"
              strokeWidth={1}
            />
            <text x={sourceX + 8} y={y + 12} fontSize={9} fill="#334155" fontWeight={600}>
              {s.name.slice(0, 14)}
            </text>
            <text x={sourceX + 8} y={y + 22} fontSize={7} fill="#94a3b8">
              {s.type}/{s.method}
            </text>
            <line
              x1={sourceX + 100}
              y1={y + 14}
              x2={stageStart - 8}
              y2={y + 14}
              stroke="#6366f1"
              strokeWidth={1}
              strokeDasharray={pulse ? "0" : "4 3"}
              opacity={0.5}
            />
          </g>
        );
      })}

      {sources.length === 0 && (
        <text x={sourceX} y={60} fontSize={10} fill="#94a3b8">
          No sources — attach flux
        </text>
      )}

      {/* Pipeline stages */}
      {STAGES.map((label, i) => {
        const x = stageStart + i * 100;
        const y = h / 2 - 20;
        return (
          <g key={label}>
            <rect
              x={x}
              y={y}
              width={88}
              height={40}
              rx={4}
              fill="url(#flowGrad)"
              stroke="#e2e8f0"
              strokeWidth={1}
            />
            <text x={x + 44} y={y + 24} fontSize={9} fill="#64748b" textAnchor="middle">
              {label}
            </text>
            {i < STAGES.length - 1 && (
              <polygon
                points={`${x + 92},${y + 20} ${x + 100},${y + 16} ${x + 100},${y + 24}`}
                fill="#cbd5e1"
              />
            )}
          </g>
        );
      })}

      {/* Digital twin column */}
      <rect
        x={twinX}
        y={16}
        width={170}
        height={h - 32}
        rx={6}
        fill="#fafafa"
        stroke="#e2e8f0"
        strokeWidth={1}
      />
      <text x={twinX + 85} y={32} fontSize={9} fill="#6366f1" textAnchor="middle" fontWeight={600}>
        Digital Twin
      </text>
      {types.slice(0, 8).map((t, i) => {
        const y = 44 + i * 20;
        const fresh =
          t.freshnessSeconds != null
            ? t.freshnessSeconds < 300
              ? "#10b981"
              : t.freshnessSeconds < 3600
                ? "#f59e0b"
                : "#f43f5e"
            : "#94a3b8";
        return (
          <g key={t.typeName}>
            <circle cx={twinX + 12} cy={y - 3} r={3} fill={fresh} />
            <text x={twinX + 20} y={y} fontSize={8} fill="#475569">
              {t.typeName} ({t.count})
            </text>
            <text x={twinX + 155} y={y} fontSize={7} fill="#94a3b8" textAnchor="end">
              {t.freshnessSeconds != null ? `${t.freshnessSeconds}s` : "—"}
            </text>
          </g>
        );
      })}
      {!types.length && (
        <text x={twinX + 85} y={h / 2} fontSize={9} fill="#94a3b8" textAnchor="middle">
          No metrics yet
        </text>
      )}

      {/* Flow arrow to twin */}
      <line
        x1={stageStart + STAGES.length * 100}
        y1={h / 2}
        x2={twinX - 4}
        y2={h / 2}
        stroke="#6366f1"
        strokeWidth={1.5}
        markerEnd="url(#arrow)"
        opacity={0.4 + (tick % 3) * 0.1}
      />
    </svg>
  );
}
