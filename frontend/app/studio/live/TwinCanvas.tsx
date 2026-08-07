"use client";

import { motion } from "framer-motion";
import {
  BedDouble,
  Building2,
  FlaskConical,
  Hospital,
  Info,
  Layers,
} from "lucide-react";
import { useMemo } from "react";

import { cn } from "@/lib/cn";
import type { TwinTreeSnapshot } from "@/lib/platform-api";

import { GRAPH_EDGE } from "../GraphNode";
import {
  TREE_NODE_H,
  TREE_NODE_W,
  edgePath,
  layoutTree,
  treeExtent,
} from "../twin-tree-layout";
import {
  formatTwinMetric,
  kindIconName,
  severityDotClass,
  type TwinKindIcon,
} from "../twin-ui";

// ---------------------------------------------------------------------------
// The twin's tree.
//
// Read-only, and laid out rather than arranged: the hierarchy comes from the
// `contains` links, so it is a fact about the network and not a drawing anyone
// should be rearranging. Dragging also meant the layout lived in one browser's
// storage — two people looking at the same twin saw different trees.
//
// Root on the left, depth to the right, straight branches. A parent sits at the
// midpoint of its children so a branch reads in one glance; elbows and curves
// gave the eye corners to follow that carry no information.
// ---------------------------------------------------------------------------

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
  displayUnit?: "percent" | "ratio" | "count" | "number";
  kindFilter: string | null;
  onSelectUnit: (unitId: string) => void;
  /** Opens the unit's details. Omitted where the tree is only a picker. */
  onOpenUnit?: (unitId: string) => void;
};

export default function TwinCanvas({
  snapshot,
  selectedUnitId,
  displayMetric,
  displayUnit,
  kindFilter,
  onSelectUnit,
  onOpenUnit,
}: TwinCanvasProps) {
  const positions = useMemo(
    () =>
      snapshot
        ? layoutTree(
            snapshot.nodes.map((n) => n.id),
            snapshot.edges,
            snapshot.roots,
          )
        : new Map(),
    [snapshot],
  );

  const extent = useMemo(() => treeExtent(positions), [positions]);

  if (!snapshot || snapshot.nodes.length === 0) {
    return (
      <div className="flex min-h-[240px] flex-1 items-center justify-center p-6">
        <p className="text-sm text-ink-faint">
          No OrgUnits in this environment. Seed the CHUM demo to get started.
        </p>
      </div>
    );
  }

  const visibleIds = new Set(
    snapshot.nodes.filter((n) => !kindFilter || n.kind === kindFilter).map((n) => n.id),
  );

  return (
    <div className="relative min-h-0 flex-1 overflow-auto bg-canvas">
      <div
        className="relative"
        style={{ width: Math.max(extent.width, 600), height: Math.max(extent.height, 400) }}
      >
        <svg
          className="pointer-events-none absolute left-0 top-0"
          width={Math.max(extent.width, 600)}
          height={Math.max(extent.height, 400)}
        >
          {snapshot.edges.map((e) => {
            if (!visibleIds.has(e.fromId) || !visibleIds.has(e.toId)) return null;
            const from = positions.get(e.fromId);
            const to = positions.get(e.toId);
            if (!from || !to) return null;
            return (
              <path
                key={`${e.fromId}-${e.toId}`}
                d={edgePath(from, to)}
                fill="none"
                stroke={GRAPH_EDGE}
                strokeWidth={1.4}
              />
            );
          })}
        </svg>

        {snapshot.nodes.map((node) => {
          const pos = positions.get(node.id);
          if (!pos) return null;
          if (kindFilter != null && node.kind !== kindFilter) return null;

          const Icon = KIND_ICONS[kindIconName(node.kind)];
          const metricVal = formatTwinMetric(node.metrics, displayMetric, displayUnit);
          const isSelected = selectedUnitId === node.id;

          return (
            <div
              key={node.id}
              className={cn(
                "absolute cursor-pointer rounded-md border bg-white shadow-sm transition-colors",
                isSelected ? "border-brand ring-2 ring-brand-soft" : "border-line",
              )}
              style={{ left: pos.x, top: pos.y, width: TREE_NODE_W, minHeight: TREE_NODE_H }}
              onClick={() => onSelectUnit(node.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectUnit(node.id);
                }
              }}
            >
              <div className="flex items-center gap-1.5 border-b border-line-soft px-2 py-1.5">
                <Icon className="h-3 w-3 shrink-0 text-ink-muted" />
                <span
                  className={cn("h-2 w-2 shrink-0 rounded-full", severityDotClass(node.worstAlertSeverity))}
                  title={node.worstAlertSeverity ?? "ok"}
                />
                <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-ink">
                  {node.name}
                </span>
                {/*
                  Details on the node itself. A single button in the toolbar
                  meant selecting a unit, moving the eye away from it, and
                  clicking — three moves to read the thing under the cursor.
                */}
                {onOpenUnit ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectUnit(node.id);
                      onOpenUnit(node.id);
                    }}
                    aria-label={`Details for ${node.name}`}
                    title="Details"
                    className="shrink-0 rounded p-0.5 text-ink-faint hover:bg-canvas-raised hover:text-brand"
                  >
                    <Info className="h-3 w-3" />
                  </button>
                ) : null}
              </div>
              <div className="flex items-center justify-between gap-1 px-2 py-1 text-[10px] text-ink-faint">
                <span className="min-w-0 truncate">{node.kind}</span>
                <motion.span
                  key={metricVal}
                  initial={{ opacity: 0.5, y: 1 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className="shrink-0 text-ink-body"
                >
                  {metricVal}
                </motion.span>
              </div>

              {node.openAlertCount > 0 ? (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-warn px-1 text-[9px] font-medium text-white">
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
