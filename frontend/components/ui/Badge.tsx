import { type ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "default" | "method-get" | "method-post" | "method-head" | "success" | "warning" | "danger";

const TONE: Record<Tone, string> = {
  default: "bg-bg-tertiary text-fg-secondary border-border-subtle",
  "method-get": "bg-sky-500/10 text-sky-300 border-sky-400/20",
  "method-post": "bg-ok/10 text-ok-ink border-ok/20",
  "method-head": "bg-warn/10 text-warn-ink border-warn/20",
  success: "bg-ok/10 text-ok-ink border-ok/20",
  warning: "bg-warn/10 text-warn-ink border-warn/20",
  danger: "bg-danger/10 text-danger border-danger/20",
};

export function Badge({
  children,
  tone = "default",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[0.65rem] font-semibold uppercase tracking-[0.18em]",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
