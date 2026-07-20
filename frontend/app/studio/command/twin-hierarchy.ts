/**
 * Shared hierarchy helpers for the Twin Command canvas (tree + treemap modes).
 * The twin snapshot is a proper parent/child forest, so we render it as a
 * hierarchy (containment or dendrogram) instead of a free graph.
 */

import {
  BedDouble,
  Building2,
  FlaskConical,
  Hospital,
  Layers,
  type LucideIcon,
} from "lucide-react";

import type { TwinTreeSnapshot, TwinUnitNode } from "@/lib/platform-api";
import { kindIconName, type TwinKindIcon } from "../twin-ui";

const KIND_ICONS: Record<TwinKindIcon, LucideIcon> = {
  Building2,
  Hospital,
  FlaskConical,
  BedDouble,
  Layers,
};

/** Lucide icon for an OrgUnit kind — the same vocabulary the rest of Studio uses. */
export function kindIcon(kind: string): LucideIcon {
  return KIND_ICONS[kindIconName(kind)];
}

export interface TreeNode {
  node: TwinUnitNode;
  children: TreeNode[];
  /** Sum of leaf sizes in this subtree (min 1). Drives treemap area. */
  weight: number;
  depth: number;
}

/** Best available "size" for a unit — beds, then patients, then linked count. */
export function unitSize(node: TwinUnitNode): number {
  const bed = node.metrics.instanceCountByType["Bed"] ?? 0;
  const patient = node.metrics.instanceCountByType["Patient"] ?? 0;
  const linked = node.metrics.linkedInstanceCount ?? 0;
  return Math.max(bed, patient, linked, 1);
}

/** Build the forest from a snapshot's parent links (falling back to edges). */
export function buildForest(snapshot: TwinTreeSnapshot): TreeNode[] {
  const byId = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string, TwinUnitNode[]>();

  // Prefer explicit parentId; fall back to edges (from = parent, to = child).
  const parentAssigned = new Set<string>();
  for (const n of snapshot.nodes) {
    if (n.parentId && byId.has(n.parentId)) {
      (childrenOf.get(n.parentId) ?? childrenOf.set(n.parentId, []).get(n.parentId)!).push(n);
      parentAssigned.add(n.id);
    }
  }
  for (const e of snapshot.edges) {
    if (parentAssigned.has(e.toId)) continue;
    if (!byId.has(e.fromId) || !byId.has(e.toId)) continue;
    (childrenOf.get(e.fromId) ?? childrenOf.set(e.fromId, []).get(e.fromId)!).push(byId.get(e.toId)!);
    parentAssigned.add(e.toId);
  }

  const seen = new Set<string>();
  function build(node: TwinUnitNode, depth: number): TreeNode {
    seen.add(node.id);
    const kids = (childrenOf.get(node.id) ?? [])
      .filter((c) => !seen.has(c.id))
      .map((c) => build(c, depth + 1));
    const weight = kids.length > 0 ? kids.reduce((s, k) => s + k.weight, 0) : unitSize(node);
    return { node, children: kids, weight: Math.max(weight, 1), depth };
  }

  const rootIds = snapshot.roots.length > 0
    ? snapshot.roots.filter((id) => byId.has(id))
    : snapshot.nodes.filter((n) => !parentAssigned.has(n.id)).map((n) => n.id);

  const roots = rootIds
    .filter((id) => !seen.has(id))
    .map((id) => build(byId.get(id)!, 0));

  // Any nodes not reached (cycles / orphans) become their own roots.
  for (const n of snapshot.nodes) {
    if (!seen.has(n.id)) roots.push(build(n, 0));
  }
  return roots;
}

export interface OccTone {
  bg: string;
  text: string;
  bar: string;
  border: string;
}

const TONE_OK: OccTone = { bg: "#e8f4ec", text: "#1c6e42", bar: "#1d9e75", border: "#9fe1cb" };
const TONE_WARN: OccTone = { bg: "#fdf0e6", text: "#935610", bar: "#d97706", border: "#f5c4b3" };
const TONE_CRIT: OccTone = { bg: "#fceaef", text: "#a82255", bar: "#e11d48", border: "#f4c0d1" };
const TONE_NONE: OccTone = { bg: "#eef2f6", text: "#5f6b7c", bar: "#c5cbd3", border: "#d3d8de" };
const TONE_INFO: OccTone = { bg: "#e7f2fd", text: "#215db0", bar: "#2d72d2", border: "#b5d4f4" };

/** Color a unit by occupancy: green <80, amber 80–95, red ≥95, neutral if none. */
export function occTone(node: TwinUnitNode): OccTone {
  const occ = node.metrics.occupancyPct;
  if (occ == null) {
    // Support units (labs, pharmacy, radiology) with no occupancy → accent tint.
    return /lab|pharmac|radiolog|imaging|diagnostic/i.test(node.kind) ? TONE_INFO : TONE_NONE;
  }
  if (occ >= 95) return TONE_CRIT;
  if (occ >= 80) return TONE_WARN;
  return TONE_OK;
}

/** Depth-first leaf-first flatten (used to lay out the tree left-to-right). */
export function flattenLeaves(roots: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (t: TreeNode) => {
    if (t.children.length === 0) out.push(t);
    else t.children.forEach(walk);
  };
  roots.forEach(walk);
  return out;
}
