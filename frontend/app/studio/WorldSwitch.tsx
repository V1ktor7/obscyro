"use client";

/**
 * Live or Scenario: which world the map in front of you shows.
 *
 * The twin has two maps. One shows the network as it stands now, with its
 * alerts; the other lays a what-if over it and runs it through the engine.
 * They are two pages, and nothing on either said the other existed: going from
 * "what is happening" to "what if" meant knowing which tab to look for.
 *
 * This is the same switch on both, in the same place, at the head of the map's
 * bar. The world you are in is marked; the other is a link to its page, on the
 * same project. It changes nothing by itself: it is navigation.
 */

import Link from "next/link";

import { cn } from "@/lib/cn";

export type World = "live" | "scenario";

const WORLDS: { key: World; label: string; path: string; title: string }[] = [
  { key: "live", label: "Live", path: "/studio/command", title: "The network as it stands now" },
  { key: "scenario", label: "Scenario", path: "/studio/simulation", title: "A what-if laid over the twin and run through the engine. A run is not a forecast." },
];

export function worldHref(world: World, env: string | null): string {
  const path = WORLDS.find((w) => w.key === world)!.path;
  return env ? `${path}?env=${encodeURIComponent(env)}` : path;
}

export default function WorldSwitch({ world, env }: { world: World; env: string | null }) {
  return (
    <span role="group" aria-label="What the map shows" className="flex shrink-0 overflow-hidden rounded border border-line">
      {WORLDS.map((w) =>
        w.key === world ? (
          <span key={w.key} aria-current="page" title={w.title} className="bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-deep">
            {w.label}
          </span>
        ) : (
          <Link key={w.key} href={worldHref(w.key, env)} title={w.title} className={cn("px-2 py-0.5 text-[11px] text-ink-muted hover:bg-surface-hover hover:text-ink")}>
            {w.label}
          </Link>
        ),
      )}
    </span>
  );
}
