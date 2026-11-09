"use client";

import HexTwinView from "./hex/HexTwinView";

/**
 * Scenarios.
 *
 * One map, three verbs: add data as a layer, stamp a scenario on the map and
 * the timeline, compare it with the same events without your choices. It
 * replaced two screens — the overlay composer and the cloned outbreak model —
 * whose forms had to be filled in before anything could be seen.
 *
 * Stamps persist as overlay-scenario overrides, so a scenario is still a set of
 * proposed edits over the live ontology; Run sends them through the declared
 * spreading model and the network engine.
 */
export default function SimulationPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <HexTwinView />
    </div>
  );
}
