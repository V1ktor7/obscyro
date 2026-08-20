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
        ? `${n.children.length} installation${n.children.length === 1 ? "" : "s"} · ${capacity} lits et places`
        : capacity > 0
          ? `${capacity} lits et places`
          : "Aucune capacité déclarée — un événement ici n'atteindrait rien.",
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

export function unitsTree(snapshot: TwinTreeSnapshot | null): TreeItem[] {
  if (!snapshot) return [];
  const items = buildForest(snapshot).map(toItem);
  items.sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.label.localeCompare(b.label));
  return items;
}
