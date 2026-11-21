/**
 * The twin's unit hierarchy, as rows an explorer can draw.
 *
 * The forest itself is `buildForest` — one model of the hierarchy, not two.
 * This only decides what a row *says*, which is where the judgement is: a tree
 * of 241 bare names is a list you scroll past, and the whole reason to put it
 * beside the map is that a collapsed establishment can answer "is anything
 * wrong under here" without being expanded.
 */

import type { TwinTreeSnapshot, TwinUnitNode } from "@/lib/platform-api";

import type { TreeItem } from "../TreeExplorer";
import { buildForest, type TreeNode } from "./twin-hierarchy";

/**
 * Beds and places under a unit — what the network is made of, and what a
 * marker's size should mean. Exported because the map sizes its dots from the
 * same number the tree counts with; two definitions of "how big is this site"
 * would put a 500-bed hospital and a 9-place home at the same radius on one
 * screen and not the other.
 */
export function capacityOf(node: TwinUnitNode): number {
  const byType = node.metrics.instanceCountByType ?? {};
  return Object.entries(byType)
    .filter(([t]) => t.startsWith("Lit") || t.startsWith("Place") || t.startsWith("Civiere"))
    .reduce((n, [, c]) => n + c, 0);
}

/**
 * The worst occupancy anywhere beneath a node, not the average.
 *
 * An establishment whose ten sites sit at 60% and whose eleventh is at 140% is
 * not "a bit busy at 67%". Averaging is what lets a collapsed parent look calm
 * while something underneath is on fire, and the point of a collapsed parent is
 * to tell you whether to expand it.
 */
export function worstOccupancy(n: TreeNode): number | null {
  const own = n.node.metrics.occupancyPct ?? null;
  const kids = n.children.map(worstOccupancy).filter((v): v is number => v != null);
  const all = own != null ? [own, ...kids] : kids;
  return all.length ? Math.max(...all) : null;
}

function toneFor(pct: number | null): TreeItem["tone"] {
  if (pct == null) return null;
  if (pct >= 100) return "danger";
  if (pct >= 85) return "warn";
  return "ok";
}

function sumCapacity(n: TreeNode): number {
  return capacityOf(n.node) + n.children.reduce((s, c) => s + sumCapacity(c), 0);
}

function toItem(n: TreeNode): TreeItem {
  const worst = worstOccupancy(n);
  const capacity = sumCapacity(n);
  const children = n.children.map(toItem);
  // Biggest first: with 51 roots, 38 of which hold a single site, alphabetical
  // order buries the five establishments that hold two thirds of the network.
  children.sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.label.localeCompare(b.label));
  return {
    id: n.node.id,
    label: n.node.name,
    children: children.length ? children : undefined,
    count: capacity || null,
    value: worst != null ? `${Math.round(worst)}%` : null,
    tone: toneFor(worst),
    hint:
      n.children.length > 0
        ? `${n.children.length} facilit${n.children.length === 1 ? "y" : "ies"} · ${capacity} beds and places`
        : capacity > 0
          ? `${capacity} beds and places`
          : "No capacity declared — an event here would reach nothing.",
  };
}

/**
 * Whether a map marker should be drawn, given what the tree has hidden.
 *
 * The map and the tree do not share identifiers. The map draws `Site`
 * instances — the ones carrying latitude and longitude — while the tree is
 * built from the `OrgUnit`s that stand on them. Matching `site.id` against a
 * set of unit ids therefore matched nothing, and hiding the entire tree left
 * every pin on the map.
 *
 * The join is `contributingUnits`, which each site already carries. A site
 * disappears when every unit standing on it is hidden, and stays while any one
 * of them is visible — a shared address should not vanish because one of its
 * two tenants was hidden.
 *
 * A site with no contributing unit is never hidden: nothing in the tree can
 * speak for it, so nothing in the tree should be able to silence it.
 */
export function isSiteHidden(
  site: { id: string; contributingUnits?: Array<{ id: string }> | null },
  hidden: Set<string>,
): boolean {
  if (hidden.size === 0) return false;
  const units = site.contributingUnits ?? [];
  if (units.length === 0) return hidden.has(site.id);
  return units.every((u) => hidden.has(u.id));
}

/**
 * The alerts raised on a site.
 *
 * The same trap as `isSiteHidden`, one panel over. An alert names the unit it
 * fired on, and a site is not a unit: comparing `unitInstanceId` to `site.id`
 * compares two id spaces that share nothing. So the inspector read "Open
 * alerts · 0" under a hospital the map was ringing in red at 165% occupancy —
 * one panel contradicting the dot beside it, on the screen where somebody
 * decides whether to divert an ambulance.
 *
 * Matched against the site's contributing units, which is the same list the
 * server counts to decide whether to draw the ring. A site that is itself a
 * unit — an environment with no placement links — matches on its own id.
 */
export function alertsForSite<T extends { unitInstanceId: string }>(
  site: { id: string; contributingUnits?: Array<{ id: string }> | null },
  alerts: readonly T[],
): T[] {
  const ids = new Set<string>([site.id, ...(site.contributingUnits ?? []).map((u) => u.id)]);
  return alerts.filter((a) => ids.has(a.unitInstanceId));
}

// --- A line of the explorer, on the map --------------------------------------
//
// The same trap as `isSiteHidden` and `alertsForSite`, on the click this time.
// A line of the explorer is a unit; the panel beside the map opens on a site.
// Looking for a site that carries the unit's id found none, in every project:
// the line lit up and nothing else happened. The join is the same one, the
// units each site says it counts.

type PlacedSite = { id: string; contributingUnits?: Array<{ id: string }> | null };

/** What a click on a line of the explorer does to the map. */
export interface ExplorerPick {
  /** The line picked: a unit, or a heading of the territory and mission groupings. */
  line: string;
  /** The site whose panel opens. Null when the line stands on no single site. */
  siteId: string | null;
  /** The sites to bring into view when no panel opens: those of the units under the line. */
  fit: string[];
  /** Said beside the explorer when the click cannot simply open the line's own site. */
  note: string | null;
}

/** The sites that count a unit: the site that is that unit, or those that list it. */
function sitesCounting(sites: readonly PlacedSite[]): (unitId: string) => string[] {
  const by = new Map<string, string[]>();
  const add = (unitId: string, siteId: string) => {
    const list = by.get(unitId);
    if (!list) by.set(unitId, [siteId]);
    else if (!list.includes(siteId)) list.push(siteId);
  };
  for (const s of sites) {
    // A site that is itself a unit: a twin with no placement links.
    add(s.id, s.id);
    for (const u of s.contributingUnits ?? []) add(u.id, s.id);
  }
  return (unitId) => by.get(unitId) ?? [];
}

/**
 * Where a line of the explorer is on the map.
 *
 * Its own site first. Failing that, the site of the nearest unit above it: a
 * site lists only the topmost unit standing on it, so a ward inside a hospital
 * is on the hospital's site without being named there. Failing that, the sites
 * of what is under it: an establishment is nowhere itself, its installations
 * are. And when none of these holds, the line is not on the map, which is said
 * rather than left as a click that does nothing.
 */
export function pickFromExplorer(
  line: { id: string; label: string },
  around: { above: readonly string[]; under: readonly string[] },
  sites: readonly PlacedSite[],
): ExplorerPick {
  const counting = sitesCounting(sites);
  const name = `“${line.label}”`;

  const own = counting(line.id);
  if (own.length > 0) {
    return {
      line: line.id,
      siteId: own[0]!,
      fit: [],
      note: own.length > 1 ? `${name} is counted at ${own.length} sites. This is one of them.` : null,
    };
  }

  for (const id of around.above) {
    const there = counting(id);
    if (there.length === 0) continue;
    return {
      line: line.id,
      siteId: there[0]!,
      fit: [],
      note: `${name} has no place of its own on the map. This is the site of the unit it belongs to.`,
    };
  }

  const below: string[] = [];
  for (const id of around.under) {
    for (const siteId of counting(id)) if (!below.includes(siteId)) below.push(siteId);
  }
  if (below.length > 0) {
    return {
      line: line.id,
      siteId: null,
      fit: below,
      note: `${name} has no place of its own on the map. The map shows the ${below.length} ${
        below.length === 1 ? "site" : "sites"
      } of what is under it.`,
    };
  }

  return { line: line.id, siteId: null, fit: [], note: `${name} is not on the map: no site counts it.` };
}

/**
 * The line of the explorer that stands for a site: the site itself when it is a
 * unit, otherwise the first unit it counts that the explorer shows. Null for a
 * site nothing in the tree speaks for, a sensor for instance.
 */
export function lineOfSite(site: PlacedSite, lines: ReadonlySet<string>): string | null {
  if (lines.has(site.id)) return site.id;
  for (const u of site.contributingUnits ?? []) if (lines.has(u.id)) return u.id;
  return null;
}

/** A line of the explorer and every id under it. Null when no line has that id. */
export function lineAndBelow(items: readonly TreeItem[], id: string): { label: string; under: string[] } | null {
  for (const item of items) {
    if (item.id === id) {
      const under: string[] = [];
      const walk = (list: readonly TreeItem[]) => {
        for (const child of list) {
          under.push(child.id);
          if (child.children) walk(child.children);
        }
      };
      walk(item.children ?? []);
      return { label: item.label, under };
    }
    const deeper = item.children ? lineAndBelow(item.children, id) : null;
    if (deeper) return deeper;
  }
  return null;
}

/** The units above a unit, nearest first. Empty for a heading, which is not a unit. */
export function unitsAbove(nodes: readonly { id: string; parentId: string | null }[], id: string): string[] {
  const parentOf = new Map(nodes.map((n) => [n.id, n.parentId]));
  const above: string[] = [];
  let cur = parentOf.get(id) ?? null;
  // The guard is for a twin whose links loop: it must not hang the click.
  while (cur && !above.includes(cur) && above.length < 64) {
    above.push(cur);
    cur = parentOf.get(cur) ?? null;
  }
  return above;
}

export function unitsTree(snapshot: TwinTreeSnapshot | null): TreeItem[] {
  if (!snapshot) return [];
  const items = buildForest(snapshot).map(toItem);
  items.sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.label.localeCompare(b.label));
  return items;
}
