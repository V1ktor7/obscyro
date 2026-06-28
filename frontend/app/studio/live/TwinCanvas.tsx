"use client";

import { motion } from "framer-motion";
import {
  BedDouble,
  Building2,
  FlaskConical,
  Hospital,
  Layers,
} from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

import { cn } from "@/lib/cn";
import type { TwinTreeSnapshot } from "@/lib/platform-api";

import { EDGE_HEX, pathD, pointGeom } from "../studio-graph";
import { TWIN_NODE_H, TWIN_NODE_W } from "../twin-layout-persist";
import {
  formatTwinMetric,
  kindIconName,
  severityDotClass,
  type TwinKindIcon,
} from "../twin-ui";

const KIND_ICONS: Record<TwinKindIcon, typeof Building2> = {
  Building2,
  Hospital,
  FlaskConical,
  BedDouble,
  Layers,
};

type TwinCanvasProps = {
  snapshot: TwinTreeSnapshot | null;
  selectedUnitId: string | null;
  displayMetric: string;
  kindFilter: string | null;
  positions: Map<string, { x: number; y: number }>;
  readOnly?: boolean;
  onSelectUnit: (unitId: string) => void;
  onPositionChange: (unitId: string, pos: { x: number; y: number }) => void;
};

export default function TwinCanvas({
  snapshot,
  selectedUnitId,
  displayMetric,
  kindFilter,
  positions,
  readOnly = false,
  onSelectUnit,
  onPositionChange,
}: TwinCanvasProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
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
      onPositionChange(drag.unitId, {
        x: drag.origX + dx,
        y: drag.origY + dy,
      });
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
      if (readOnly) return;
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
    [positions, readOnly],
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

  const visibleIds = new Set(
    snapshot.nodes
      .filter((n) => !kindFilter || n.kind === kindFilter)
      .map((n) => n.id),
  );

  return (
    <div
      ref={canvasRef}
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
            return (
              <path
                key={`${e.fromId}-${e.toId}`}
                d={pathD(g)}
                fill="none"
                stroke={EDGE_HEX}
                strokeWidth={1.5}
              />
            );
          })}
        </svg>

        {snapshot.nodes.map((node) => {
          const pos = positions.get(node.id);
          if (!pos) return null;
          const dimmed = kindFilter != null && node.kind !== kindFilter;
          const hidden = kindFilter != null && node.kind !== kindFilter;
          if (hidden) return null;

          const Icon = KIND_ICONS[kindIconName(node.kind)];
          const metricVal = formatTwinMetric(node.metrics, displayMetric);
          const isSelected = selectedUnitId === node.id;

          return (
            <div
              key={node.id}
              className={cn(
                "absolute rounded-lg border bg-white shadow-sm transition-opacity",
                isSelected ? "border-indigo-400 ring-2 ring-indigo-100" : "border-gray-300",
                dimmed && "opacity-40",
                readOnly ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
              )}
              style={{
                left: pos.x,
                top: pos.y,
                width: TWIN_NODE_W,
                minHeight: TWIN_NODE_H,
              }}
              onPointerDown={(e) => startDrag(e, node.id)}
              onClick={() => {
                if (movedRef.current) return;
                onSelectUnit(node.id);
              }}
            >
              <div className="flex items-start gap-2 px-2.5 py-2">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" strokeWidth={1.5} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        severityDotClass(node.worstAlertSeverity),
                      )}
                      title={node.worstAlertSeverity ?? "ok"}
                    />
                    <span className="truncate text-xs font-medium text-gray-800">
                      {node.name}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-baseline justify-between gap-1">
                    <span className="font-mono text-[9px] uppercase text-gray-400">
                      {node.kind}
                    </span>
                    <motion.span
                      key={metricVal}
                      initial={{ opacity: 0.5, y: 1 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2 }}
                      className="font-mono text-[10px] text-gray-600"
                    >
                      {metricVal}
                    </motion.span>
                  </div>
                </div>
              </div>
              {node.openAlertCount > 0 ? (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-medium text-white">
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
