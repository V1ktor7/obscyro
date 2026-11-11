"use client";

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * A panel that floats over a full-page map.
 *
 * The maps used to sit in a box between columns, and on a laptop the columns
 * took half the screen. Now the map is the page and everything else is laid on
 * it: a panel is a title bar that opens downwards, and it starts folded, so the
 * first thing seen on arrival is the map.
 *
 * The overlay layer around it lets clicks through (`pointer-events-none`); the
 * panel takes them back. That is what keeps the map draggable everywhere a
 * panel is not.
 */
export function OverlayPanel({
  title,
  meta,
  open,
  onToggle,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  /** A short line beside the title, read even when the panel is folded. */
  meta?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn(
        "pointer-events-auto flex max-h-full min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-white/95 shadow-sm backdrop-blur",
        className,
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full shrink-0 items-center gap-2 px-3 py-2 text-left hover:bg-canvas-raised"
      >
        <span className="shrink-0 text-[12px] font-semibold text-ink">{title}</span>
        {meta ? <span className="min-w-0 truncate text-[11px] text-ink-muted">{meta}</span> : null}
        <ChevronDown
          className={cn("ml-auto h-3.5 w-3.5 shrink-0 text-ink-muted transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div className={cn("min-h-0 overflow-y-auto border-t border-line-soft", bodyClassName)}>{children}</div>
      ) : null}
    </section>
  );
}

/** The same frame without a fold, for bars that are always there. */
export const OVERLAY_BAR =
  "pointer-events-auto rounded-lg border border-line bg-white/95 shadow-sm backdrop-blur";
