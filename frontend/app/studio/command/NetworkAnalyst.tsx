"use client";

/**
 * The analyst, on the network map.
 *
 * The map is where a person notices that a unit is in trouble. The analyst
 * sits under the inspector of that unit, in a panel that folds like every
 * other on the map, so the question is asked where the trouble is seen:
 *
 *   Ask          a question about the network as it stands, with the selected
 *                unit carried along.
 *   Investigate  what was going on around the selected unit while its series
 *                moved: a search of official sources, each event set beside
 *                the series the twin kept.
 *
 *   What it can  the tools those two rest on, each with what it reads.
 *   use
 *
 * Ask and Investigate stay in the page while the panel is folded or another
 * tab is shown: an exchange that is running goes on, and its answer is there
 * on return.
 */

import { useState } from "react";

import { cn } from "@/lib/cn";

import { OverlayPanel } from "../map-overlay";
import { AskTab } from "../simulation/hex/AnalystPanel";
import ToolsTab from "../simulation/hex/ToolsTab";
import InvestigateTab, { type InvestigationOnPage } from "./InvestigateTab";

type Tab = "ask" | "investigate" | "tools";
const TABS: { key: Tab; label: string }[] = [
  { key: "ask", label: "Ask" },
  { key: "investigate", label: "Investigate" },
  { key: "tools", label: "What it can use" },
];

export default function NetworkAnalyst({
  env,
  open,
  onToggle,
  unit,
  several,
  metric,
  kept,
  hours,
  onHours,
  onInvestigation,
}: {
  env: string;
  open: boolean;
  onToggle: () => void;
  /** The one unit counted at the selected site; null when nothing is selected or the site counts several. */
  unit: { id: string; name: string } | null;
  several: boolean;
  /** The measure the map paints. */
  metric: { key: string; label: string; unit: "percent" | "ratio" | "count" | "number" | "hours" };
  /** Whether that measure is kept over time. */
  kept: boolean;
  /** The span shared with the timeline. */
  hours: number;
  onHours: (hours: number) => void;
  onInvestigation?: (shown: InvestigationOnPage | null) => void;
}) {
  const [tab, setTab] = useState<Tab>("investigate");
  const [off, setOff] = useState(false);
  // The list is read the first time its tab is opened, and kept after.
  const [toolsOpened, setToolsOpened] = useState(false);

  return (
    <OverlayPanel
      title="Analyst"
      meta={unit ? `about ${unit.name}` : "about the network"}
      open={open}
      onToggle={onToggle}
      keepMounted
      // Folded, it is its title bar and keeps its height; open, it shares the column and scrolls inside itself.
      className={cn("max-h-none w-full", open ? "min-h-[12rem] shrink" : "shrink-0")}
    >
      {off ? (
        <p className="p-3 text-[12px] text-ink-body">
          The analyst is not switched on for this server. An administrator has to set its key on the API service.
        </p>
      ) : (
        <>
          <div role="tablist" aria-label="Analyst" className="flex gap-1 border-b border-line-soft px-3 pt-2">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                id={`network-analyst-tab-${t.key}`}
                aria-selected={tab === t.key}
                aria-controls={`network-analyst-${t.key}`}
                onClick={() => {
                  if (t.key === "tools") setToolsOpened(true);
                  setTab(t.key);
                }}
                className={cn(
                  "-mb-px border-b-2 px-2 pb-1.5 text-[12px]",
                  tab === t.key ? "border-brand font-semibold text-ink" : "border-transparent text-ink-muted hover:text-ink-body",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div role="tabpanel" id="network-analyst-ask" aria-labelledby="network-analyst-tab-ask" hidden={tab !== "ask"}>
            <AskTab
              env={env}
              scenario={null}
              run={null}
              live
              siteName={() => null}
              onFocusSite={() => {}}
              onOff={() => setOff(true)}
              focus={{ page: "command", ...(unit ? { unitId: unit.id } : {}) }}
              hints={["What is open right now, and where?", ...(unit ? ["What do this unit's live figures show, and how old are they?"] : [])]}
            />
          </div>
          <div role="tabpanel" id="network-analyst-investigate" aria-labelledby="network-analyst-tab-investigate" hidden={tab !== "investigate"}>
            <InvestigateTab
              env={env}
              unit={unit}
              several={several}
              metric={metric}
              kept={kept}
              hours={hours}
              onHours={onHours}
              onOff={() => setOff(true)}
              onInvestigation={onInvestigation}
            />
          </div>
          {toolsOpened ? (
            <div role="tabpanel" id="network-analyst-tools" aria-labelledby="network-analyst-tab-tools" hidden={tab !== "tools"}>
              <ToolsTab env={env} offeredIn={["ask", "investigate"]} />
            </div>
          ) : null}
        </>
      )}
    </OverlayPanel>
  );
}
