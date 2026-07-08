"use client";

/**
 * Graph canvas for the Twin Command view. Derived from live/TwinCanvas but
 * with denser command-style unit cards: per-node occupancy sparkline,
 * occupancy fill bar, and a severity-tinted alert badge.
 */

import { useCallback, useEffect, useRef } from "react";

import { cn } from "@/lib/cn";
import type { TwinTreeSnapshot } from "@/lib/platform-api";

import { severityHex, occFillColor, Sparkline } from "../command-ui";
import { EDGE_HEX, pathD, pointGeom } from "../studio-graph";
import { TWIN_NODE_H, TWIN_NODE_W } from "../twin-layout-persist";
import { formatTwinMetric } from "../twin-ui";

type CommandCanvasProps = {
  snapshot: TwinTreeSnapshot | null;
  selectedUnitId: string | null;
  displayMetric: string;
  kindFilter: string | null;
  search: string;
  positions: Map<string, { x: number; y: number }>;
  history: Map<string, number[]>;
  onSelectUnit: (unitId: string) => void;
  onPositionChange: (unitId: string, pos: { x: number; y: number }) => void;
};

export default function CommandCanvas({
  snapshot,
  selectedUnitId,
  displayMetric,
  kindFilter,
  search,
  positions,
  history,
  onSelectUnit,
  onPositionChange,
}: CommandCanvasProps) {
  const dragRef = useRef<{
    unitId: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const movedRef = useRef(false);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) movedRef.current = true;
      onPositionChange(drag.unitId, { x: drag.origX + dx, y: drag.origY + dy });
    }
    function onUp() {
      dragRef.current = null;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [onPositionChange]);

  const startDrag = useCallback(
    (e: React.PointerEvent, unitId: string) => {
      e.stopPropagation();
      e.preventDefault();
      const pos = positions.get(unitId);
      if (!pos) return;
      movedRef.current = false;
      dragRef.current = {
        unitId,
        startX: e.clientX,
        startY: e.clientY,
        origX: pos.x,
        origY: pos.y,
      };
    },
    [positions],
  );

  if (!snapshot || snapshot.nodes.length === 0) {
    return (
      <div className="flex min-h-[240px] flex-1 items-center justify-center p-6">
        <p className="text-sm text-gray-400">
          No OrgUnits in this environment. Seed the CHUM demo to get started.
        </p>
      </div>
    );
  }

  const q = search.trim().toLowerCase();
  const visibleIds = new Set(
    snapshot.nodes
      .filter((n) => !kindFilter || n.kind === kindFilter)
      .map((n) => n.id),
  );

  return (
    <div
      className="relative min-h-0 flex-1 overflow-auto"
      style={{
        backgroundImage:
          "radial-gradient(circle, rgba(0,0,0,0.06) 1px, transparent 1px)",
        backgroundSize: "22px 22px",
      }}
    >
      <div className="relative" style={{ width: 5000, height: 3000 }}>
        <svg
          className="pointer-events-none absolute left-0 top-0"
          width={5000}
          height={3000}
        >
          {snapshot.edges.map((e) => {
            if (!visibleIds.has(e.fromId) || !visibleIds.has(e.toId)) return null;
            const from = positions.get(e.fromId);
            const to = positions.get(e.toId);
            if (!from || !to) return null;
            const a = { x: from.x + TWIN_NODE_W / 2, y: from.y + TWIN_NODE_H };
            const b = { x: to.x + TWIN_NODE_W / 2, y: to.y };
            const g = pointGeom(a, b);
            const hot =
              selectedUnitId === e.fromId || selectedUnitId === e.toId;
            return (
              <path
                key={`${e.fromId}-${e.toId}`}
                d={pathD(g)}
                fill="none"
                stroke={hot ? "#6366f1" : EDGE_HEX}
                strokeWidth={hot ? 1.8 : 1.5}
              />
            );
          })}
        </svg>

        {snapshot.nodes.map((node) => {
          if (kindFilter != null && node.kind !== kindFilter) return null;
          const pos = positions.get(node.id);
          if (!pos) return null;

          const dimmed = q.length > 0 && !node.name.toLowerCase().includes(q);
          const metricVal = formatTwinMetric(node.metrics, displayMetric);
          const isSelected = selectedUnitId === node.id;
          const occ = node.metrics.occupancyPct;
          const hist = history.get(node.id) ?? [];

          return (
            <div
              key={node.id}
              className={cn(
                "absolute rounded border bg-white shadow-sm transition-opacity",
                isSelected
                  ? "border-indigo-400 ring-2 ring-indigo-100"
                  : "border-gray-300 hover:border-indigo-300",
                dimmed && "opacity-30",
                "cursor-grab active:cursor-grabbing",
              )}
              style={{ left: pos.x, top: pos.y, width: TWIN_NODE_W }}
              onPointerDown={(e) => startDrag(e, node.id)}
              onClick={() => {
                if (movedRef.current) return;
                onSelectUnit(node.id);
              }}
            >
              <div className="flex items-center gap-1.5 px-2 pt-1.5">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: severityHex(node.worstAlertSeverity) }}
                  title={node.worstAlertSeverity ?? "ok"}
                />
                <span className="truncate text-[11px] font-semibold text-gray-800">
                  {node.name}
                </span>
              </div>
              {hist.length > 1 ? (
                <Sparkline
                  values={hist.slice(-20)}
                  width={TWIN_NODE_W - 16}
                  height={14}
                  stroke="#9ca3af"
                  className="mx-2 mt-0.5 opacity-80"
                />
              ) : (
                <div style={{ height: 15 }} />
              )}
              <div className="flex items-end justify-between px-2 pb-1.5">
                <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-gray-400">
                  {node.kind}
                </span>
                <span className="font-mono text-sm font-semibold leading-none text-gray-800">
                  {metricVal}
                </span>
              </div>
              {occ != null ? (
                <div className="h-[3px] w-full overflow-hidden rounded-b bg-gray-100">
                  <div
                    className="h-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, Math.max(0, occ))}%`,
                      background: occFillColor(occ),
                    }}
                  />
                </div>
              ) : null}
              {node.openAlertCount > 0 ? (
                <span
                  className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[9px] font-bold text-white"
                  style={{
                    background:
                      node.worstAlertSeverity === "critical"
                        ? severityHex("critical")
                        : severityHex("warn"),
                  }}
                >
                  {node.openAlertCount}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
