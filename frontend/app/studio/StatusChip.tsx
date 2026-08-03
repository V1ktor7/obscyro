import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * The Studio's status chip.
 *
 * There were three of these: the shared `components/ui/Badge`, built for the
 * API docs where a monospace GET/POST is the right call; a private copy inside
 * the simulation view with its own tone names; and loose pill spans in the twin
 * toolbars. Same job, three shapes, and only the twin's were round.
 *
 * The docs keep their Badge. This is the Studio's, it matches the cards around
 * it, and it is not monospace.
 */

export type ChipTone = "neutral" | "ok" | "warn" | "danger" | "brand" | "scenario";

const TONE: Record<ChipTone, string> = {
  neutral: "border-line bg-canvas-raised text-ink-muted",
  ok: "border-ok/40 bg-ok-soft text-ok-ink",
  warn: "border-warn-line bg-warn-soft text-warn-ink",
  danger: "border-danger/40 bg-danger-soft text-danger-ink",
  brand: "border-brand/40 bg-brand-soft text-brand-deep",
  scenario: "border-scenario/40 bg-scenario-soft text-scenario",
};

export function StatusChip({
  tone = "neutral",
  dot,
  title,
  className,
  children,
}: {
  tone?: ChipTone;
  /** Background class for a leading state dot, when the chip reports live state. */
  dot?: string;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-medium",
        TONE[tone],
        className,
      )}
    >
      {dot ? <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dot)} /> : null}
      {children}
    </span>
  );
}
