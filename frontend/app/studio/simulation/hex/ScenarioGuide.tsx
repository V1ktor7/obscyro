"use client";

/**
 * The guide: three steps, with the one to do next and a button that does it.
 *
 * It lives in a folding panel on the map like everything else. It opens on a
 * first visit and folds itself once the three steps are done; after that it
 * stays folded, one line under the toolbar, for whoever wants it back.
 */

import { Check, Loader2 } from "lucide-react";

import { cn } from "@/lib/cn";

import { guideSteps, type GuideInput, type StepKey } from "./guide";

export default function ScenarioGuide({
  state,
  onConditions,
  onSeed,
  onRun,
  onAsk,
}: {
  state: GuideInput;
  /** Open the starting-conditions tool. */
  onConditions: () => void;
  /** Pick the outbreak tool. */
  onSeed: () => void;
  onRun: () => void;
  /** Open the analyst panel. */
  onAsk: () => void;
}) {
  const steps = guideSteps(state);

  const actions: Record<StepKey, { label: string; run: () => void; busy?: boolean }[]> = {
    describe: [
      { label: "Set starting conditions", run: onConditions },
      { label: "Seed an outbreak", run: onSeed },
    ],
    run: [
      {
        label: state.running ? "Running" : state.hasRun && state.stale ? "Run the scenario again" : "Run the scenario",
        run: onRun,
        busy: state.running,
      },
    ],
    ask: [{ label: "Open the analyst", run: onAsk }],
  };

  return (
    <ol className="flex flex-col gap-2 p-3" aria-label="Steps to build and read a scenario">
      {steps.map((s, i) => (
        <li
          key={s.key}
          aria-current={s.state === "now" ? "step" : undefined}
          className={cn("grid grid-cols-[22px_minmax(0,1fr)] gap-x-2", s.state === "later" && "opacity-60")}
        >
          <span
            aria-hidden="true"
            className={cn(
              "mt-0.5 flex h-[22px] w-[22px] items-center justify-center rounded-full text-[11px] font-bold tabular-nums",
              s.state === "done" && "bg-ok-soft text-ok-ink",
              s.state === "now" && "bg-brand text-white",
              s.state === "later" && "border border-line text-ink-muted",
            )}
          >
            {s.state === "done" ? <Check className="h-3 w-3" /> : i + 1}
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[12.5px] font-semibold text-ink">
              {s.title}
              <span className="sr-only">{s.state === "done" ? " (done)" : s.state === "now" ? " (next)" : " (later)"}</span>
            </span>
            <span className="text-[11.5px] text-ink-muted">{s.detail}</span>
            {s.state === "now" ? (
              <div className="flex flex-wrap gap-1.5">
                {actions[s.key].map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    disabled={a.busy}
                    onClick={a.run}
                    className="flex items-center gap-1 rounded border border-brand bg-brand-soft px-2 py-1 text-[11.5px] font-semibold text-brand-deep hover:bg-white disabled:opacity-60"
                  >
                    {a.busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
                    {a.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
