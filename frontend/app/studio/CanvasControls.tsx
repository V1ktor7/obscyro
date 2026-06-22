"use client";

import { cn } from "@/lib/cn";

type Props = {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onFit: () => void;
};

export default function CanvasControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onFit,
}: Props) {
  return (
    <div className="pointer-events-auto absolute bottom-4 right-4 z-20 flex flex-col gap-1 rounded-lg border border-gray-200 bg-white/95 p-1 shadow-sm backdrop-blur-sm">
      <button
        type="button"
        onClick={onZoomIn}
        title="Zoom in"
        className="rounded px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
      >
        +
      </button>
      <button
        type="button"
        onClick={onResetZoom}
        title="Reset zoom to 100%"
        className="rounded px-2 py-1 font-mono text-[10px] text-gray-500 hover:bg-gray-100"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        onClick={onZoomOut}
        title="Zoom out"
        className="rounded px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
      >
        −
      </button>
      <button
        type="button"
        onClick={onFit}
        title="Fit to content"
        className={cn(
          "rounded border-t border-gray-100 px-2 py-1.5 font-mono text-[9px] uppercase tracking-wide text-gray-500 hover:bg-gray-100",
        )}
      >
        Fit
      </button>
    </div>
  );
}
