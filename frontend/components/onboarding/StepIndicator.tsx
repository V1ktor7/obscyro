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
  const activeStep = steps[current - 1];

  return (
    <div>
      {/* Mobile: pastilles + active label only, gives a clean compact summary */}
      <div className="flex items-center gap-3 sm:hidden">
        <ol className="flex items-center gap-1.5">
          {steps.map((s, i) => {
            const idx = i + 1;
            const done = idx < current;
            const active = idx === current;
            return (
              <li key={s.id} aria-current={active ? "step" : undefined}>
                <span
                  className={cn(
                    "inline-flex h-2.5 w-2.5 rounded-full transition-colors",
                    done && "bg-fg-primary",
                    active && "bg-fg-primary ring-2 ring-fg-primary/20",
                    !active && !done && "bg-border-subtle",
                  )}
                />
              </li>
            );
          })}
        </ol>
        {activeStep ? (
          <span className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-fg-primary">
            {activeStep.label}
          </span>
        ) : null}
      </div>

      {/* sm+: full pastille-with-label-with-connector treatment */}
      <ol className="hidden items-center gap-2 sm:flex">
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
                <span className="mx-1 inline-block h-px w-6 bg-border-subtle md:w-8" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
