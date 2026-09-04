import type { TwinTreeSnapshot, TwinUnitNode } from "@/lib/platform-api";
import type { Frame } from "../events/replay-frames";

/**
 * The units view, showing a replayed step instead of now.
 *
 * The timeline already existed on the network globe, where a frame moves pins
 * on a map. Under the units section there was nothing to move it against — the
 * tree, the treemap and the grid all read one snapshot, and that snapshot is
 * always live. This is the join: it takes the snapshot the view already renders
 * and returns the same shape with the replayed occupancy written in.
 *
 * Three rules, and each one is a thing that would otherwise mislead:
 *
 * - **A unit the run never touched is blanked, not left alone.** Leaving its
 *   live occupancy in place would put a real number from this morning next to
 *   simulated numbers from day 42, on the same screen, with nothing to tell
 *   them apart. Absent is honest; stale is not.
 * - **Alert counts are cleared.** Alerts are raised against the live network.
 *   A replayed step has no alerts of its own, and carrying today's over would
 *   attach real warnings to a hypothetical state.
 * - **`freshnessSeconds` is cleared.** "Updated 3 minutes ago" is true of the
 *   live reading and false of a replay, and freshness is exactly the field
 *   somebody checks before trusting a figure.
 */
export function applyFrame(
  snapshot: TwinTreeSnapshot | null,
  frame: Frame | null,
): TwinTreeSnapshot | null {
  if (!snapshot) return null;
  if (!frame) return snapshot;

  const byId = new Map(frame.facilities.map((f) => [f.id, f]));

  const nodes: TwinUnitNode[] = snapshot.nodes.map((node) => {
    const f = byId.get(node.id);
    if (!f) {
      return {
        ...node,
        metrics: {
          ...node.metrics,
          values: {},
          occupancyPct: null,
          numericMeans: {},
          freshnessSeconds: null,
        },
        worstAlertSeverity: null,
        openAlertCount: 0,
      };
    }
    const pct = Math.round(f.worst * 1000) / 10;
    return {
      ...node,
      metrics: {
        ...node.metrics,
        values: {
          ...node.metrics.values,
          occupancy: pct,
          waiting: f.waiting,
        },
        occupancyPct: pct,
        freshnessSeconds: null,
      },
      worstAlertSeverity: null,
      openAlertCount: 0,
    };
  });

  return { ...snapshot, nodes };
}

/** How much of the network the replayed step actually says anything about. */
export function frameCoverage(
  snapshot: TwinTreeSnapshot | null,
  frame: Frame | null,
): { covered: number; total: number } {
  if (!snapshot) return { covered: 0, total: 0 };
  if (!frame) return { covered: snapshot.nodes.length, total: snapshot.nodes.length };
  const ids = new Set(frame.facilities.map((f) => f.id));
  return {
    covered: snapshot.nodes.filter((n) => ids.has(n.id)).length,
    total: snapshot.nodes.length,
  };
}
