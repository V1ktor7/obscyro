"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

export interface Step {
  id: string;
  label: string;
}

export default function StepIndicator({
  steps,
  current,
}: {
  steps: Step[];
  current: number;
}) {
  return (
    <ol className="flex items-center gap-2">
      {steps.map((s, i) => {
        const idx = i + 1;
        const done = idx < current;
        const active = idx === current;
        return (
          <li key={s.id} className="flex items-center gap-2">
            <div
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-full border font-mono text-[0.65rem] font-semibold tracking-tight transition-colors",
                done && "border-fg-primary bg-fg-primary text-bg-primary",
                active && "border-fg-primary text-fg-primary",
                !active && !done && "border-border-subtle text-fg-secondary",
              )}
              aria-current={active ? "step" : undefined}
            >
              {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : idx}
            </div>
            <span
              className={cn(
                "font-mono text-[0.65rem] uppercase tracking-[0.2em]",
                active ? "text-fg-primary" : "text-fg-secondary",
              )}
            >
              {s.label}
            </span>
            {i < steps.length - 1 ? (
              <span className="mx-1 hidden h-px w-8 bg-border-subtle sm:inline-block" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
