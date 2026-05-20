import { type ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "default" | "method-get" | "method-post" | "method-head" | "success" | "warning" | "danger";

const TONE: Record<Tone, string> = {
  default: "bg-bg-tertiary text-fg-secondary border-border-subtle",
  "method-get": "bg-sky-500/10 text-sky-600 border-sky-500/20",
  "method-post": "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  "method-head": "bg-amber-500/10 text-amber-600 border-amber-500/20",
  success: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  warning: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  danger: "bg-rose-500/10 text-rose-600 border-rose-500/20",
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
