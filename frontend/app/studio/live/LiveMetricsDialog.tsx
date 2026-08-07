"use client";

import { X } from "lucide-react";

import LiveMetricsPanel from "./LiveMetricsPanel";

// ---------------------------------------------------------------------------
// The live metrics panel, on the studio's dialog shell.
//
// It used to be a 288px column welded to the right of the twin, always on
// screen whether or not anyone was reading it. The panel itself is unchanged;
// only where it lives has.
// ---------------------------------------------------------------------------

export default function LiveMetricsDialog({
  env,
  hasKey,
  onClose,
}: {
  env: string;
  hasKey: boolean;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-[8vh]"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[80vh] w-[420px] flex-col overflow-hidden rounded-md border border-line bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="presentation"
      >
        <div className="flex items-center gap-2 border-b border-line-soft px-4 py-2.5">
          <p className="flex-1 text-xs font-medium text-ink">Live metrics</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-0.5 text-ink-faint hover:bg-canvas-raised hover:text-ink-body"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <LiveMetricsPanel env={env} hasKey={hasKey} />
        </div>
      </div>
    </div>
  );
}
