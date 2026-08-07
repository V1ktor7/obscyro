"use client";

import { useState } from "react";

import { cn } from "@/lib/cn";

import ScenarioComposer from "./ScenarioComposer";
import SimulationView from "./SimulationView";

/**
 * Scenarios.
 *
 * Two mechanisms exist and both are useful, so neither is deleted. The composer
 * holds a scenario as edits resolved over the live ontology — reality keeps
 * moving underneath it, which is what you want when asking "should we do this".
 * The outbreak simulation clones a subtree and runs a model over the copy, which
 * is what you want when the model has to be free to diverge from reality.
 *
 * The composer leads because it answers the operational question. The clone was
 * the default for months while the overlay it superseded had no way in at all.
 */
export default function SimulationPage() {
  const [mode, setMode] = useState<"compose" | "outbreak">("compose");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-line bg-white px-4 py-1.5">
        {(
          [
            ["compose", "Compose"],
            ["outbreak", "Outbreak model"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={cn(
              "rounded px-2 py-1 text-[11.5px]",
              mode === value
                ? "bg-brand-soft font-medium text-brand-deep"
                : "text-ink-muted hover:bg-canvas-raised",
            )}
          >
            {label}
          </button>
        ))}
        <span className="ml-2 text-[10px] text-ink-faint">
          {mode === "compose"
            ? "Edits over the live ontology — reality moves underneath."
            : "A cloned copy, frozen at clone time, for running a model over."}
        </span>
      </div>

      {mode === "compose" ? <ScenarioComposer /> : <SimulationView />}
    </div>
  );
}
