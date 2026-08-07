"use client";

import { X } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import type { TwinUnitDetail } from "@/lib/platform-api";

import { StatusChip } from "../StatusChip";
import { formatFreshness, formatTwinMetric, severityBadgeTone } from "../twin-ui";

// ---------------------------------------------------------------------------
// A unit, in full.
//
// This was a 288px rail pinned to the right of the canvas, which cost the map a
// fifth of its width whenever a site was selected — and the map is the thing
// being read. It is a dialog now, on the same shell as the metric and alert
// editors, and it opens from a button rather than on selection: clicking around
// a network to compare sites should not throw a modal each time.
//
// Two columns because the content divides cleanly: what the unit *is* on the
// left, what it *needs* on the right. In a rail those were stacked, so the
// alerts — the only part anyone acts on — sat below the fold.
// ---------------------------------------------------------------------------

export default function UnitDetailDialog({
  unitId,
  nodeName,
  detail,
  loading,
  onAck,
  onClose,
}: {
  unitId: string;
  nodeName?: string;
  detail: TwinUnitDetail | null;
  loading: boolean;
  onAck: (alertId: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-[8vh]"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[80vh] w-[720px] flex-col overflow-hidden rounded-md border border-line bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="presentation"
      >
        <div className="flex items-start gap-2 border-b border-line-soft px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-ink">{nodeName ?? "Unit"}</p>
            <p className="text-[9.5px] text-ink-faint">{unitId.slice(0, 12)}…</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-0.5 text-ink-faint hover:bg-canvas-raised hover:text-ink-body"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {loading || !detail ? (
          <p className="p-6 text-center text-[11.5px] text-ink-faint">Loading…</p>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-line-soft overflow-hidden">
            {/* what it is */}
            <section className="min-h-0 overflow-y-auto p-3">
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Occupancy" value={formatTwinMetric(detail.metrics, "occupancyPct")} />
                <Stat label="Linked" value={String(detail.metrics.linkedInstanceCount)} />
                <Stat
                  label="Freshness"
                  value={formatFreshness(detail.metrics.freshnessSeconds)}
                />
              </div>

              <p className="mb-1 mt-3 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
                By type
              </p>
              {Object.keys(detail.metrics.instanceCountByType).length === 0 ? (
                <p className="text-[11px] text-ink-faint">Nothing linked to this unit.</p>
              ) : (
                <table className="w-full text-left text-[11px]">
                  <tbody>
                    {Object.entries(detail.metrics.instanceCountByType).map(([t, c]) => (
                      <tr key={t} className="border-b border-line-faint last:border-0">
                        <td className="py-1 text-ink-body">{t}</td>
                        <td className="py-1 text-right tabular-nums text-ink">{c}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {/* what it needs */}
            <section className="min-h-0 overflow-y-auto p-3">
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
                Open alerts
              </p>
              {detail.alerts.length === 0 ? (
                <p className="text-[11px] text-ink-faint">None.</p>
              ) : (
                detail.alerts.map((a) => (
                  <div key={a.id} className="mb-2 rounded-md border border-line p-2">
                    <StatusChip tone={severityBadgeTone(a.severity)}>{a.severity}</StatusChip>
                    <p className="mt-1 text-[11.5px] leading-snug text-ink-body">{a.message}</p>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="mt-1.5"
                      onClick={() => onAck(a.id)}
                    >
                      Ack
                    </Button>
                  </div>
                ))
              )}

              {/*
                What the tree cannot show. Its lines are the `contains`
                hierarchy; a transfer route or a data feed between two units has
                no line on it, so it is named here.
              */}
              <p className="mb-1.5 mt-3 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
                Exchanges with other units
              </p>
              {(detail.exchanges ?? []).length === 0 ? (
                <p className="text-[11px] leading-snug text-ink-faint">
                  None. This unit is only connected by the hierarchy.
                </p>
              ) : (
                <table className="w-full text-left text-[11px]">
                  <tbody>
                    {detail.exchanges.map((x) => (
                      <tr
                        key={`${x.linkType}-${x.direction}-${x.otherUnitId}`}
                        className="border-b border-line-faint last:border-0"
                      >
                        <td className="w-4 py-1 text-ink-faint" title={x.direction === "out" ? "outgoing" : "incoming"}>
                          {x.direction === "out" ? "→" : "←"}
                        </td>
                        <td className="py-1 text-ink-body">{x.otherUnitName}</td>
                        <td className="py-1 text-right text-ink-muted">{x.linkType}</td>
                        <td className="w-8 py-1 text-right tabular-nums text-ink-faint">
                          {x.count}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {detail.recommendations.length > 0 ? (
                <>
                  <p className="mb-1.5 mt-3 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
                    Recommendations
                  </p>
                  <ul className="list-inside list-disc text-[11px] leading-relaxed text-ink-muted">
                    {detail.recommendations.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn("rounded-md border border-line bg-canvas-raised p-2")}>
      <p className="text-[9.5px] uppercase tracking-wide text-ink-faint">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}
