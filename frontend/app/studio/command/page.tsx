"use client";

import { useState } from "react";

import CommandView from "./CommandView";
import NetworkTwinView from "./NetworkTwinView";

/**
 * Live Twin — network globe by default; drilling into a site opens the
 * existing unit command canvas.
 */
export default function CommandPage() {
  const [mode, setMode] = useState<"network" | "site">("network");

  if (mode === "site") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-[#d3d8de] bg-white px-4 py-1.5">
          <button
            type="button"
            onClick={() => setMode("network")}
            className="text-[11px] text-[#5f6b7c] hover:text-[#2d72d2] hover:underline"
          >
            ← Back to network globe
          </button>
          <span className="text-[11px] text-[#8f99a8]">Unit command canvas</span>
        </div>
        <CommandView />
      </div>
    );
  }

  return <NetworkTwinView onDrillIn={() => setMode("site")} />;
}
