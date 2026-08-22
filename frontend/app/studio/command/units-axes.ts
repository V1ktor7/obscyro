/**
 * The same 190 installations, grouped three ways.
 *
 * They are three different questions and none of them is the "real" hierarchy:
 *
 *   Établissement  who owns it. An organigram — it reads as a list and has no
 *                  geography. Measured on the real data, an envelope drawn
 *                  around a CIUSSS puts 135 of 190 installations inside
 *                  somebody else's, because Centre-Sud spans 21 km of an island
 *                  it shares with four others.
 *   Territoire     where it is. The RLS, whose official boundaries are a real
 *                  polygon rather than a hull fitted to points — 190 of 190
 *                  installations fall inside their own.
 *   Mission        what it does. CHSLD, hospital, CLSC — the axis a clinician
 *                  reaches for first.
 *
 * Forcing them into one tree would mean picking a winner, and the map would
 * then be wrong two thirds of the time. The tree takes an axis instead, and the
 * map draws boundaries only for the axis that has any.
 */

import type { TwinTreeSnapshot, TwinUnitNode } from "@/lib/platform-api";

import type { TreeItem } from "../TreeExplorer";
import { buildForest, type TreeNode } from "./twin-hierarchy";
import { capacityOf, worstOccupancy } from "./units-tree";

export type GroupingAxis = "etablissement" | "territoire" | "mission";

export const AXES: Array<{ id: GroupingAxis; label: string; hint: string }> = [
  {
    id: "etablissement",
    label: "Établissement",
    hint: "Qui possède quoi. Aucune frontière sur la carte — un CIUSSS n'est pas un lieu.",
  },
  {
    id: "territoire",
    label: "Territoire",
    hint: "Les RLS, limites officielles du MSSS. La carte dessine leurs frontières.",
  },
  {
    id: "mission",
    label: "Mission",
    hint: "Ce que fait l'installation. Aucune frontière — une mission est partout.",
  },
];

/** Only one axis has real boundaries to draw. The others would be a fiction. */
export function axisHasBoundaries(axis: GroupingAxis): boolean {
  return axis === "territoire";
}

/**
 * The missions declared on an installation.
 *
 * This is the one property name the axis knows, and it knows it because the
 * axis is named for it — `mission` is the question being asked, not a value
 * being assumed. Everything past the key belongs to the institution: the
 * vocabulary is whatever they wrote, so a network filing its sites under
 * "urgence" and "réadaptation" gets those headings and not a translation into
 * somebody else's register.
 *
 * Singular or plural, one string or a list, because both are things a person
 * reasonably types when declaring the property. Blanks are dropped rather than
 * becoming a heading with no name.
 */
export function missionsIn(properties: Record<string, unknown> | undefined): string[] {
  if (!properties) return [];
  const raw = properties["missions"] ?? properties["mission"];
  const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const out: string[] = [];
  for (const v of list) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

function toneFor(pct: number | null): TreeItem["tone"] {
  if (pct == null) return null;
  if (pct >= 100) return "danger";
  if (pct >= 85) return "warn";
  return "ok";
}

function leafItem(n: TwinUnitNode, capacity: number): TreeItem {
  const occ = n.metrics.occupancyPct ?? null;
  return {
    id: n.id,
    label: n.name,
    count: capacity || null,
    value: occ != null ? `${Math.round(occ)}%` : null,
    tone: toneFor(occ),
    hint:
      capacity > 0
        ? `${capacity} lits et places`
        : "Aucune capacité déclarée — un événement ici n'atteindrait rien.",
  };
}

/**
 * Group leaves under headings computed from each leaf.
 *
 * Used for territory and mission, which are *attributes* of an installation
 * rather than a parent in the twin's hierarchy — so there is no forest to walk,
 * only a key to bucket on. A leaf whose key is missing lands under a named
 * bucket rather than vanishing: an installation that quietly stops appearing
 * when you switch axis is worse than one you can see is unclassified.
 *
 * `keysOf` returns a *list*, because one of the two axes is not a partition. An
 * installation sits in exactly one territory, but 46 of Montréal's 328 declare
 * more than one mission — a hospital that also runs a CHSLD wing and a CLSC is
 * three things at once in the MSSS register. Forcing a primary mission would
 * mean inventing a rank the source does not state, and the axis exists to
 * answer "show me everything that does CHSLD", which that hospital does.
 *
 * The consequence is that capacities across mission headings sum to more than
 * the network holds. That is a property of an overlapping grouping rather than
 * a bug, and the hint on each heading says so instead of leaving the reader to
 * add the columns up and get a wrong total.
 */
function groupBy(
  leaves: TreeNode[],
  keysOf: (n: TwinUnitNode) => string[],
  unknownLabel: string,
): TreeItem[] {
  const buckets = new Map<string, TreeNode[]>();
  for (const leaf of leaves) {
    const keys = keysOf(leaf.node);
    for (const key of keys.length ? keys : [unknownLabel]) {
      const list = buckets.get(key);
      if (list) list.push(leaf);
      else buckets.set(key, [leaf]);
    }
  }

  // How many headings each leaf landed under. Anything above one means the
  // capacities on screen no longer add up to the network, and the reader has to
  // be told that on the heading rather than left to sum the columns.
  const bucketsPer = new Map<string, number>();
  for (const group of Array.from(buckets.values())) {
    for (const g of group) bucketsPer.set(g.node.id, (bucketsPer.get(g.node.id) ?? 0) + 1);
  }

  const items: TreeItem[] = [];
  for (const [label, group] of Array.from(buckets)) {
    const children = group
      .map((g) => leafItem(g.node, capacityOf(g.node)))
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.label.localeCompare(b.label));
    const capacity = children.reduce((n, c) => n + (c.count ?? 0), 0);
    const worst = group
      .map((g) => g.node.metrics.occupancyPct)
      .filter((v): v is number => v != null);
    const pct = worst.length ? Math.max(...worst) : null;
    const shared = group.filter((g) => (bucketsPer.get(g.node.id) ?? 1) > 1).length;
    items.push({
      id: `axis:${label}`,
      label,
      children,
      count: capacity || null,
      value: pct != null ? `${Math.round(pct)}%` : null,
      tone: toneFor(pct),
      hint:
        `${children.length} installation${children.length === 1 ? "" : "s"} · ${capacity} lits et places` +
        (shared > 0 ? ` · ${shared} compté${shared === 1 ? "e" : "es"} aussi ailleurs` : ""),
    });
  }
  return items.sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.label.localeCompare(b.label));
}

function allLeaves(roots: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (n: TreeNode) => {
    if (n.children.length === 0) out.push(n);
    else n.children.forEach(walk);
  };
  roots.forEach(walk);
  return out;
}

function sumCapacity(n: TreeNode): number {
  return capacityOf(n.node) + n.children.reduce((s, c) => s + sumCapacity(c), 0);
}

function fromForest(n: TreeNode): TreeItem {
  const worst = worstOccupancy(n);
  const capacity = sumCapacity(n);
  const children = n.children.map(fromForest);
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

export function treeForAxis(
  snapshot: TwinTreeSnapshot | null,
  axis: GroupingAxis,
  /**
   * unit id → territory name. Territory is a link, not a field on the unit, so
   * it is resolved by the caller and handed in rather than invented here as a
   * metric that does not exist.
   */
  territoryOf: Map<string, string> = new Map(),
  /**
   * unit id → the missions that installation declares. A list, not a value:
   * the register lets one installation be a hospital, a CHSLD and a CLSC.
   */
  missionsOf: Map<string, string[]> = new Map(),
): TreeItem[] {
  if (!snapshot) return [];
  const forest = buildForest(snapshot);

  if (axis === "etablissement") {
    const items = forest.map(fromForest);
    return items.sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.label.localeCompare(b.label));
  }

  const leaves = allLeaves(forest);
  if (axis === "territoire") {
    const t = (n: TwinUnitNode) => {
      const name = territoryOf.get(n.id);
      return name ? [name] : [];
    };
    return groupBy(leaves, t, "Territoire non attribué");
  }
  // Before the register is imported every installation lands in one honest
  // bucket rather than the axis being hidden — an empty grouping you can see is
  // a prompt; a missing tab is a mystery.
  return groupBy(leaves, (n) => missionsOf.get(n.id) ?? [], "Mission non déclarée");
}
