"use client";

import { useState } from "react";

import StudioEditor from "../StudioEditor";
import DataStudioView from "./DataStudioView";

/**
 * Data Studio — Pipeline Builder-style flow canvas by default; the previous
 * workspace graph editor stays reachable as the legacy mode.
 */
export default function WorkspacePage() {
  const [mode, setMode] = useState<"studio" | "legacy">("studio");

  if (mode === "legacy") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-[#d3d8de] bg-white px-4 py-1.5">
          <button
            type="button"
            onClick={() => setMode("studio")}
            className="text-[11px] text-[#5f6b7c] hover:text-[#2d72d2] hover:underline"
          >
            ← Back to Data Studio
          </button>
          <span className="text-[11px] text-[#8f99a8]">Legacy workspace graph editor</span>
        </div>
        <StudioEditor variant="workspace" />
      </div>
    );
  }

  return <DataStudioView onOpenLegacy={() => setMode("legacy")} />;
}
