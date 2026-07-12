"use client";

import { useState } from "react";

import StudioEditor from "../StudioEditor";
import ChannelsView from "./ChannelsView";

/**
 * Ontology Parser — data channels by default (saved linear pipelines edited
 * as a step list); the node-graph editor remains available as the advanced
 * mode for branching/custom pipelines.
 */
export default function ParserPage() {
  const [mode, setMode] = useState<"channels" | "graph">("channels");

  if (mode === "graph") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-[#d3d8de] bg-white px-4 py-1.5">
          <button
            type="button"
            onClick={() => setMode("channels")}
            className="text-[11px] text-[#5f6b7c] hover:text-[#2d72d2] hover:underline"
          >
            ← Back to data channels
          </button>
          <span className="text-[11px] text-[#8f99a8]">
            Advanced graph editor — for branching or custom-code pipelines
          </span>
        </div>
        <StudioEditor variant="parser" />
      </div>
    );
  }

  return <ChannelsView onOpenGraph={() => setMode("graph")} />;
}
