"use client";

/**
 * Tree mode for the Twin Command canvas. A tidy top-down dendrogram of the
 * org hierarchy (facility → departments → units) with orthogonal connectors,
 * one root per facility, collapsible branches, and occupancy-colored nodes.
 * Replaces the tangled force-graph for structural navigation.
 */

import { useMemo, useState } from "react";

import { cn } from "@/lib/cn";
import type { TwinTreeSnapshot } from "@/lib/platform-api";

import { severityHex } from "../command-ui";
import { formatTwinMetric } from "../twin-ui";
import { buildForest, occTone, type TreeNode } from "./twin-hierarchy";

const NODE_W = 124;
const NODE_H = 48;
const H_GAP = 18;
const LEVEL_GAP = 92;
const PAD = 24;

interface Placed {
  node: TreeNode;
  cx: number;
  y: number;
  collapsed: boolean;
  childCount: number;
}

interface Edge {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

function elbow(e: Edge): string {
  const midY = (e.ay + e.by) / 2;
  const r = Math.min(6, Math.abs(e.bx - e.ax) / 2, Math.abs(midY - e.ay));
  if (Math.abs(e.bx - e.ax) < 1) return `M ${e.ax},${e.ay} V ${e.by}`;
  const dir = e.bx > e.ax ? 1 : -1;
  return (
    `M ${e.ax},${e.ay} V ${midY - r} ` +
    `Q ${e.ax},${midY} ${e.ax + dir * r},${midY} ` +
    `H ${e.bx - dir * r} ` +
    `Q ${e.bx},${midY} ${e.bx},${midY + r} ` +
    `V ${e.by}`
  );
}

export default function CommandTree({
  snapshot,
  selectedUnitId,
  displayMetric,
  kindFilter,
  search,
  onSelectUnit,
}: {
  snapshot: TwinTreeSnapshot | null;
  selectedUnitId: string | null;
  displayMetric: string;
  kindFilter: string | null;
  search: string;
  onSelectUnit: (unitId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const roots = useMemo(() => (snapshot ? buildForest(snapshot) : []), [snapshot]);
  const filtered = useMemo(
    () => (kindFilter ? pruneByKind(roots, kindFilter) : roots),
    [roots, kindFilter],
  );

  const { placed, edges, width, height } = useMemo(() => {
    const placedList: Placed[] = [];
    const edgeList: Edge[] = [];
    let leaf = 0;
    let maxDepth = 0;

    const assign = (t: TreeNode, depth: number): number => {
      const y = PAD + depth * LEVEL_GAP;
      maxDepth = Math.max(maxDepth, depth);
      const isCollapsed = collapsed.has(t.node.id) || t.children.length === 0;
      let cx: number;
      if (isCollapsed) {
        cx = PAD + leaf * (NODE_W + H_GAP) + NODE_W / 2;
        leaf++;
      } else {
        const childXs = t.children.map((c) => assign(c, depth + 1));
        cx = (childXs[0] + childXs[childXs.length - 1]) / 2;
        const childY = PAD + (depth + 1) * LEVEL_GAP;
        for (const childCx of childXs) {
          edgeList.push({ ax: cx, ay: y + NODE_H, bx: childCx, by: childY });
        }
      }
      placedList.push({
        node: t,
        cx,
        y,
        collapsed: isCollapsed,
        childCount: t.children.length,
      });
      return cx;
    };

    filtered.forEach((r) => assign(r, 0));
    const w = Math.max(leaf * (NODE_W + H_GAP) + PAD * 2, 320);
    const h = (maxDepth + 1) * LEVEL_GAP + NODE_H + PAD;
    return { placed: placedList, edges: edgeList, width: w, height: h };
  }, [filtered, collapsed]);

  if (!snapshot || snapshot.nodes.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <p className="text-sm text-[#8f99a8]">
          No OrgUnits in this environment. Seed the CHUM demo to get started.
        </p>
      </div>
    );
  }

  const q = search.trim().toLowerCase();

  return (
    <div
      className="relative min-h-0 flex-1 overflow-auto p-3"
      style={{
        backgroundImage: "radial-gradient(circle, rgba(0,0,0,0.05) 1px, transparent 1px)",
        backgroundSize: "22px 22px",
      }}
    >
      <div className="relative" style={{ width, height }}>
        <svg className="pointer-events-none absolute inset-0" width={width} height={height}>
          {edges.map((e, i) => (
            <path key={i} d={elbow(e)} fill="none" stroke="#c5cbd3" strokeWidth={1.3} />
          ))}
        </svg>

        {placed.map(({ node, cx, y, collapsed: isCol, childCount }) => {
          const n = node.node;
          const tone = occTone(n);
          const dimmed = q.length > 0 && !n.name.toLowerCase().includes(q);
          const selected = selectedUnitId === n.id;
          const isLeaf = childCount === 0;
          const metricVal = formatTwinMetric(n.metrics, displayMetric);
          const collapsible = childCount > 0;
          return (
            <div
              key={n.id}
              className={cn(
                "absolute rounded-md border transition-opacity",
                selected ? "ring-2 ring-[#2d72d2]" : "",
                dimmed && "opacity-35",
              )}
              style={{
                left: cx - NODE_W / 2,
                top: y,
                width: NODE_W,
                height: NODE_H,
                background: isLeaf ? tone.bg : "#ffffff",
                borderColor: selected ? "#2d72d2" : isLeaf ? tone.border : "#d3d8de",
              }}
            >
              <button
                type="button"
                onClick={() => onSelectUnit(n.id)}
                className="flex h-full w-full flex-col justify-center gap-0.5 px-2 text-left"
              >
                <span className="flex items-center gap-1">
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: severityHex(n.worstAlertSeverity) }}
                  />
                  <span
                    className="truncate text-[11.5px] font-medium"
                    style={{ color: isLeaf ? tone.text : "#1c2127" }}
                    title={n.name}
                  >
                    {n.name}
                  </span>
                </span>
                <span className="flex items-center justify-between">
                  <span className="text-[9px] font-medium uppercase tracking-wide text-[#8f99a8]">
                    {n.kind}
                  </span>
                  <span
                    className="font-mono text-[13px] font-semibold leading-none"
                    style={{ color: isLeaf ? tone.text : "#404854" }}
                  >
                    {isLeaf ? metricVal : `${node.children.length}`}
                  </span>
                </span>
              </button>
              {n.openAlertCount > 0 ? (
                <span
                  className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[9px] font-bold text-white"
                  style={{
                    background:
                      n.worstAlertSeverity === "critical"
                        ? severityHex("critical")
                        : severityHex("warn"),
                  }}
                >
                  {n.openAlertCount}
                </span>
              ) : null}
              {collapsible ? (
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((cur) => {
                      const next = new Set(cur);
                      if (next.has(n.id)) next.delete(n.id);
                      else next.add(n.id);
                      return next;
                    })
                  }
                  className="absolute -bottom-2 left-1/2 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full border border-[#d3d8de] bg-white text-[9px] leading-none text-[#5f6b7c] hover:border-[#2d72d2] hover:text-[#2d72d2]"
                  title={isCol ? "Expand" : "Collapse"}
                  aria-label={isCol ? "Expand branch" : "Collapse branch"}
                >
                  {isCol ? "+" : "−"}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function pruneByKind(roots: TreeNode[], kind: string): TreeNode[] {
  const keep = (t: TreeNode): TreeNode | null => {
    const kids = t.children.map(keep).filter((k): k is TreeNode => k !== null);
    if (t.node.kind === kind || kids.length > 0) return { ...t, children: kids };
    return null;
  };
  return roots.map(keep).filter((k): k is TreeNode => k !== null);
}
