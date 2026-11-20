"use client";

import { cn } from "@/lib/cn";

export type WorkflowRunState = "idle" | "running" | "done" | "error";

type Props = {
  index: number;
  x: number;
  y: number;
  state: WorkflowRunState;
  running: boolean;
  onRun: () => void;
};

const STATE_DOT: Record<WorkflowRunState, string> = {
  idle: "bg-ink-ghost",
  running: "bg-indigo-500 animate-pulse",
  done: "bg-ok",
  error: "bg-danger",
};

export default function WorkflowRunChip({
  index,
  x,
  y,
  state,
  running,
  onRun,
}: Props) {
  return (
    <div
      className="pointer-events-auto absolute z-10 flex items-center gap-1.5 rounded-md border border-line bg-surface/95 px-2 py-1 shadow-sm backdrop-blur-sm"
      style={{ left: x, top: y }}
    >
      <span
        className={cn("h-2 w-2 shrink-0 rounded-full", STATE_DOT[state])}
        title={state}
      />
      <span className="text-[10px] text-ink-muted">
        Workflow {index + 1}
      </span>
      <button
        type="button"
        disabled={running}
        onClick={(e) => {
          e.stopPropagation();
          onRun();
        }}
        className="rounded bg-indigo-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
      >
        Run
      </button>
    </div>
  );
}
