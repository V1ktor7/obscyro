"use client";

/**
 * Treemap mode for the Twin Command canvas. Nested rectangles: area = a unit's
 * size (beds / patients / linked instances), color = live occupancy. The whole
 * facility fits one screen and the overloaded unit pops. Replaces the old
 * force-graph — tree-shaped data rendered as containment, not tangle.
 */

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import type { TwinTreeSnapshot } from "@/lib/platform-api";

import { severityHex } from "../command-ui";
import { formatTwinMetric } from "../twin-ui";
import { buildForest, occTone, type TreeNode } from "./twin-hierarchy";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Placed {
  node: TreeNode;
  rect: Rect;
  isLeaf: boolean;
  hasHeader: boolean;
}

const HEADER_H = 17;
const GAP = 3;

/** Squarified treemap of siblings within a rectangle (Bruls et al.). */
function squarify(items: TreeNode[], rect: Rect): { node: TreeNode; rect: Rect }[] {
  const out: { node: TreeNode; rect: Rect }[] = [];
  const total = items.reduce((s, i) => s + i.weight, 0);
  if (total <= 0 || rect.w <= 0 || rect.h <= 0) return out;
  const scale = (rect.w * rect.h) / total;
  const sorted = [...items].sort((a, b) => b.weight - a.weight);
  const values = sorted.map((i) => Math.max(i.weight * scale, 0.0001));

  const worst = (row: number[], side: number): number => {
    const sum = row.reduce((a, b) => a + b, 0);
    if (sum <= 0) return Infinity;
    const max = Math.max(...row);
    const min = Math.min(...row);
    const s2 = side * side;
    return Math.max((s2 * max) / (sum * sum), (sum * sum) / (s2 * min));
  };

  let remaining: Rect = { ...rect };
  let i = 0;
  while (i < values.length) {
    const side = Math.min(remaining.w, remaining.h);
    const row: number[] = [];
    const rowItems: TreeNode[] = [];
    let j = i;
    while (j < values.length) {
      const candidate = [...row, values[j]];
      if (row.length === 0 || worst(candidate, side) <= worst(row, side)) {
        row.push(values[j]);
        rowItems.push(sorted[j]);
        j++;
      } else break;
    }
    const rowSum = row.reduce((a, b) => a + b, 0);
    if (remaining.w >= remaining.h) {
      const colW = rowSum / remaining.h;
      let y = remaining.y;
      for (let k = 0; k < row.length; k++) {
        const h = row[k] / colW;
        out.push({ node: rowItems[k], rect: { x: remaining.x, y, w: colW, h } });
        y += h;
      }
      remaining = { x: remaining.x + colW, y: remaining.y, w: remaining.w - colW, h: remaining.h };
    } else {
      const rowH = rowSum / remaining.w;
      let x = remaining.x;
      for (let k = 0; k < row.length; k++) {
        const w = row[k] / rowH;
        out.push({ node: rowItems[k], rect: { x, y: remaining.y, w, h: rowH } });
        x += w;
      }
      remaining = { x: remaining.x, y: remaining.y + rowH, w: remaining.w, h: remaining.h - rowH };
    }
    i = j;
  }
  return out;
}

/** Recursively lay out the forest, reserving a header strip for internal nodes. */
function layout(roots: TreeNode[], area: Rect): Placed[] {
  const out: Placed[] = [];
  const walk = (nodes: TreeNode[], rect: Rect) => {
    for (const { node, rect: r } of squarify(nodes, rect)) {
      const inset: Rect = { x: r.x + GAP / 2, y: r.y + GAP / 2, w: r.w - GAP, h: r.h - GAP };
      const canNest = node.children.length > 0 && inset.w > 66 && inset.h > 54;
      if (canNest) {
        out.push({ node, rect: inset, isLeaf: false, hasHeader: true });
        walk(node.children, {
          x: inset.x + 3,
          y: inset.y + HEADER_H,
          w: inset.w - 6,
          h: inset.h - HEADER_H - 4,
        });
      } else {
        out.push({ node, rect: inset, isLeaf: node.children.length === 0, hasHeader: false });
      }
    }
  };
  walk(roots, area);
  return out;
}

export default function CommandTreemap({
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
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  if (!snapshot || snapshot.nodes.length === 0) {
    return (
      <div ref={ref} className="flex min-h-0 flex-1 items-center justify-center p-6">
        <p className="text-sm text-gray-400">
          No OrgUnits in this environment. Seed the CHUM demo to get started.
        </p>
      </div>
    );
  }

  // Kind filter: keep matching units plus their ancestors so containment holds.
  const roots = buildForest(snapshot);
  const filtered = kindFilter ? pruneByKind(roots, kindFilter) : roots;

  const placed =
    size.w > 20 && size.h > 20
      ? layout(filtered, { x: 0, y: 0, w: size.w, h: size.h - 26 })
      : [];
  const q = search.trim().toLowerCase();

  return (
    <div className="flex min-h-0 flex-1 flex-col p-2 pt-11">
      <div ref={ref} className="relative min-h-0 flex-1">
        {placed.map(({ node, rect, isLeaf }) => {
          const n = node.node;
          const tone = occTone(n);
          const dimmed = q.length > 0 && !n.name.toLowerCase().includes(q);
          const selected = selectedUnitId === n.id;
          const showMetric = isLeaf && rect.h > 40 && rect.w > 52;
          const metricVal = formatTwinMetric(n.metrics, displayMetric);

          if (!isLeaf) {
            // Internal container: header label + rollup, transparent body.
            return (
              <div
                key={n.id}
                className={cn(
                  "absolute rounded-md border transition-opacity",
                  selected ? "border-indigo-400 ring-1 ring-indigo-200" : "border-[#d3d8de]",
                  dimmed && "opacity-40",
                )}
                style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
              >
                <button
                  type="button"
                  onClick={() => onSelectUnit(n.id)}
                  className="flex w-full items-center gap-1.5 truncate px-2 text-left"
                  style={{ height: HEADER_H }}
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: severityHex(n.worstAlertSeverity) }}
                  />
                  <span className="truncate text-[10.5px] font-semibold text-[#404854]">
                    {n.name}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-[9px] uppercase tracking-wide text-[#8f99a8]">
                    {node.children.length}
                  </span>
                </button>
              </div>
            );
          }

          return (
            <button
              key={n.id}
              type="button"
              onClick={() => onSelectUnit(n.id)}
              className={cn(
                "absolute flex flex-col justify-between overflow-hidden rounded-md border p-1.5 text-left transition-opacity",
                selected ? "ring-2 ring-indigo-400" : "",
                dimmed && "opacity-40",
              )}
              style={{
                left: rect.x,
                top: rect.y,
                width: rect.w,
                height: rect.h,
                background: tone.bg,
                borderColor: selected ? "#6366f1" : tone.border,
              }}
            >
              <span className="flex items-start gap-1">
                <span
                  className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: severityHex(n.worstAlertSeverity) }}
                />
                <span
                  className="truncate text-[10.5px] font-medium leading-tight"
                  style={{ color: tone.text }}
                  title={n.name}
                >
                  {n.name}
                </span>
              </span>
              {showMetric ? (
                <span className="leading-none">
                  <span className="text-[14px] font-semibold" style={{ color: tone.text }}>
                    {metricVal}
                  </span>
                </span>
              ) : null}
              {n.openAlertCount > 0 && rect.w > 40 ? (
                <span
                  className="absolute right-1 top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 font-mono text-[8px] font-bold text-white"
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
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[10px] text-[#8f99a8]">
        <span>size = capacity</span>
        <span>·</span>
        <span>color = occupancy</span>
        <span className="ml-auto flex items-center gap-1">
          <span className="h-2 w-3.5 rounded-sm" style={{ background: "#e8f4ec" }} />
          &lt;80%
          <span className="ml-1 h-2 w-3.5 rounded-sm" style={{ background: "#fdf0e6" }} />
          80–95%
          <span className="ml-1 h-2 w-3.5 rounded-sm" style={{ background: "#fceaef" }} />
          &ge;95%
        </span>
      </div>
    </div>
  );
}

/** Keep subtrees that contain at least one node of the given kind. */
function pruneByKind(roots: TreeNode[], kind: string): TreeNode[] {
  const keep = (t: TreeNode): TreeNode | null => {
    const kids = t.children.map(keep).filter((k): k is TreeNode => k !== null);
    if (t.node.kind === kind || kids.length > 0) {
      return { ...t, children: kids };
    }
    return null;
  };
  return roots.map(keep).filter((k): k is TreeNode => k !== null);
}
