"use client";

import type { LucideIcon } from "lucide-react";
import type { ComponentPropsWithoutRef, PointerEvent, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * The Studio's graph node.
 *
 * Four canvases draw boxes on a grid — the ontology schema, the lineage chain,
 * the pipeline editor and the twin network — and each had grown its own box.
 * Same job every time: name the thing, measure it, show where it connects.
 *
 * This follows the pipeline editor's node rather than lineage's. Both are the
 * same visual family, but lineage exposes a single outlet, which is right for a
 * chain and wrong for a schema: a link type runs *between* two object types in
 * a direction, so the reader needs an inlet and an outlet to tell which way it
 * goes. Lineage and the pipeline editor keep their own copies; this one serves
 * the schema and the twin.
 */

export const GRAPH_NODE_W = 168;

/** Edge stroke and arrowhead. Reads on white without competing with the nodes. */
export const GRAPH_EDGE = "#8a94a0";

type GraphNodeProps = {
  name: string;
  icon?: LucideIcon;
  /** Severity dot class, for nodes that carry state. Omitted where they don't. */
  dot?: string | null;
  dotTitle?: string;
  /** Footer, left and right. The measurement under the name. */
  meta?: ReactNode;
  metaRight?: ReactNode;
  /** Corner count, e.g. open alerts. */
  badge?: ReactNode;
  selected?: boolean;
  /** A connection is being dragged and this node is a legal target. */
  targeted?: boolean;
  dimmed?: boolean;
  x: number;
  y: number;
  width?: number;
  minHeight?: number;
  /** Drag from anywhere on the node, or from the header only. */
  onNodePointerDown?: (e: PointerEvent) => void;
  onHeaderPointerDown?: (e: PointerEvent) => void;
  onClick?: () => void;
  /** Ports. */
  children?: ReactNode;
};

export function GraphNode({
  name,
  icon: Icon,
  dot,
  dotTitle,
  meta,
  metaRight,
  badge,
  selected,
  targeted,
  dimmed,
  x,
  y,
  width = GRAPH_NODE_W,
  minHeight,
  onNodePointerDown,
  onHeaderPointerDown,
  onClick,
  children,
}: GraphNodeProps) {
  const draggable = Boolean(onNodePointerDown ?? onHeaderPointerDown);
  return (
    <div
      className={cn(
        "absolute rounded-md border bg-white shadow-sm transition-colors",
        selected ? "border-brand ring-2 ring-brand-soft" : "border-line",
        targeted && "border-brand ring-2 ring-brand",
        dimmed && "opacity-40",
        onNodePointerDown && "cursor-grab active:cursor-grabbing",
        !draggable && onClick && "cursor-pointer",
      )}
      style={{ left: x, top: y, width, minHeight }}
      onPointerDown={onNodePointerDown}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <div
        className={cn(
          "flex items-center gap-1.5 border-b border-line-soft px-2 py-1.5",
          onHeaderPointerDown && "cursor-grab active:cursor-grabbing",
        )}
        onPointerDown={onHeaderPointerDown}
      >
        {Icon ? <Icon className="h-3 w-3 shrink-0 text-ink-muted" /> : null}
        {dot !== undefined ? (
          <span
            className={cn("h-2 w-2 shrink-0 rounded-full", dot)}
            title={dotTitle}
          />
        ) : null}
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-ink">
          {name}
        </span>
      </div>
      <div className="flex items-center justify-between gap-1 px-2 py-1 text-[10px] text-ink-faint">
        <span className="min-w-0 truncate">{meta}</span>
        {metaRight ? <span className="shrink-0">{metaRight}</span> : null}
      </div>

      {badge ? (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-warn px-1 text-[9px] font-medium text-white">
          {badge}
        </span>
      ) : null}

      {children}
    </div>
  );
}

/** An inlet or outlet on a node's edge. */
export function GraphPort({
  side,
  offset = 0,
  label,
  active,
  className,
  style,
  ...rest
}: {
  side: "in" | "out";
  offset?: number;
  label?: string;
  active?: boolean;
} & Omit<ComponentPropsWithoutRef<"span">, "children">) {
  return (
    <span
      className={cn(
        "absolute flex h-3.5 w-3.5 items-center justify-center rounded-full border bg-white text-[7px] font-bold",
        side === "in" ? "-left-[7px]" : "-right-[7px]",
        active
          ? "border-brand bg-brand-soft text-brand-deep"
          : "border-ink-faint text-ink-faint hover:border-brand hover:bg-brand-soft",
        className,
      )}
      style={{ top: `calc(50% + ${offset}px)`, transform: "translateY(-50%)", ...style }}
      {...rest}
    >
      {label ?? ""}
    </span>
  );
}

/** Arrowhead marker for directed edges. Render once per SVG. */
export function GraphArrowhead({ id = "graph-arrow" }: { id?: string }) {
  return (
    <defs>
      <marker
        id={id}
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="5"
        markerHeight="5"
        orient="auto-start-reverse"
      >
        <path d="M0,0 L10,5 L0,10 z" fill={GRAPH_EDGE} />
      </marker>
    </defs>
  );
}
