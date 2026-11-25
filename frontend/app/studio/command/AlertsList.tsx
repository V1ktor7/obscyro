"use client";

/**
 * The open alerts, in the explorer of the network map.
 *
 * An alert is where a person's work often starts, and it used to start on
 * another page: the alert was read on Response or in the bell, and the map had
 * to be found again by hand. This list puts the open alerts beside the map. A
 * click on one selects the site that counts its unit, moves the map there and
 * opens its inspector; from there the analyst is one fold away.
 *
 * It lists and points, nothing else: acknowledging, moving a signal through
 * its workflow and the thresholds themselves stay on the Response page. The
 * alerts are the Studio's single feed, the one every page reads.
 */

import Link from "next/link";

import { cn } from "@/lib/cn";
import type { TwinAlert } from "@/lib/platform-api";

import { duration, situationHref } from "../alert-feed-state";

const RANK: Record<string, number> = { critical: 0, warn: 1, info: 2 };
const DOT: Record<string, string> = { critical: "bg-danger", warn: "bg-warn", info: "bg-brand" };

/** Most severe first, then the most recently opened. */
export function inOrder(alerts: readonly TwinAlert[]): TwinAlert[] {
  return [...alerts].sort(
    (a, b) => (RANK[a.severity] ?? 3) - (RANK[b.severity] ?? 3) || Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? "") || a.id.localeCompare(b.id),
  );
}

export default function AlertsList({
  alerts,
  siteOf,
  env,
  selectedSiteId,
  onPick,
  now = Date.now(),
}: {
  alerts: readonly TwinAlert[];
  /** The site that counts an alert's unit, when the map has one. */
  siteOf: (unitId: string) => { id: string; name: string } | null;
  env: string | null;
  selectedSiteId: string | null;
  /** Select a site: the page moves the map to it and opens its inspector. */
  onPick: (siteId: string) => void;
  now?: number;
}) {
  if (alerts.length === 0) {
    return <p className="p-3 text-[11.5px] leading-snug text-ink-muted">No alert is open. An alert opens when a measure crosses the threshold of one of the project&apos;s rules.</p>;
  }
  const critical = alerts.filter((a) => a.severity === "critical").length;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="px-3 pb-1.5 pt-2 text-[10.5px] text-ink-faint">
        {alerts.length} open{critical ? ` · ${critical} critical` : ""}. A click selects the site on the map.
      </p>
      <ul className="flex min-h-0 flex-col gap-1 overflow-y-auto px-2 pb-2">
        {inOrder(alerts).map((a) => {
          const site = siteOf(a.unitInstanceId);
          const opened = a.createdAt ? Date.parse(a.createdAt) : NaN;
          const since = Number.isFinite(opened) ? `open for ${duration(now - opened)}` : "open";
          const on = site !== null && site.id === selectedSiteId;
          return (
            <li key={a.id} className={cn("rounded border", on ? "border-brand bg-surface" : "border-line-soft bg-canvas-raised")}>
              <button
                type="button"
                disabled={!site}
                aria-pressed={site ? on : undefined}
                onClick={() => site && onPick(site.id)}
                className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-2 px-2 py-1.5 text-left disabled:cursor-default"
              >
                <span className={cn("mt-[5px] h-2 w-2 shrink-0 rounded-full", DOT[a.severity] ?? "bg-ink-ghost")} aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-[11.5px] leading-snug text-ink">{a.message}</span>
                  <span className="block text-[10.5px] text-ink-faint">
                    {a.severity} · {since}
                    {site ? "" : " · its unit has no site on the map"}
                  </span>
                </span>
              </button>
              <div className="flex justify-end border-t border-line-faint px-2 py-1">
                <Link href={situationHref({ unit: a.unitInstanceId, alert: a.id }, env)} className="text-[10.5px] text-brand hover:underline">
                  Situation
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
