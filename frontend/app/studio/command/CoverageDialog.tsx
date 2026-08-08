"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Crosshair, Loader2, Trash2, X } from "lucide-react";

import { cn } from "@/lib/cn";
import {
  deleteGeoShape,
  listGeoOverlaps,
  listGeoUncovered,
  type GeoCapability,
  type InstanceShape,
  type ShapeOverlap,
  type UncoveredSite,
} from "@/lib/platform-api";

import { formatArea } from "./polygon-draw";

// ---------------------------------------------------------------------------
// Coverage.
//
// The three questions a drawn map can answer that a list of coordinates cannot:
// what did we draw, where do the areas overlap, and who falls outside all of
// them. Each is a PostGIS query; none of them is a value you could have stored.
//
// When the extension is absent the dialog says so plainly and shows nothing
// else, because there is nothing else to show. That is the state of the current
// deployment, so it is the first thing this component had to get right.
// ---------------------------------------------------------------------------

export default function CoverageDialog({
  env,
  capability,
  shapes,
  onFlyTo,
  onDeleted,
  onClose,
}: {
  env: string;
  capability: GeoCapability | null;
  shapes: InstanceShape[];
  onFlyTo: (shape: InstanceShape) => void;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [overlaps, setOverlaps] = useState<ShapeOverlap[]>([]);
  const [uncovered, setUncovered] = useState<UncoveredSite[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const available = capability?.available === true;

  const load = useCallback(async () => {
    if (!available) return;
    setLoading(true);
    try {
      const [o, u] = await Promise.all([listGeoOverlaps(env), listGeoUncovered(env)]);
      setOverlaps(o.overlaps);
      setUncovered(u.uncovered);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [env, available]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function remove(shape: InstanceShape) {
    setRemoving(shape.instanceId);
    try {
      await deleteGeoShape(env, shape.instanceId);
      onDeleted();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-[8vh]"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[80vh] w-[560px] flex-col overflow-hidden rounded-md border border-line bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="presentation"
      >
        <div className="flex items-center gap-2 border-b border-line-soft px-4 py-2.5">
          <p className="flex-1 text-xs font-medium text-ink">Coverage</p>
          {loading ? <Loader2 className="h-3 w-3 animate-spin text-ink-faint" /> : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-0.5 text-ink-faint hover:bg-canvas-raised hover:text-ink-body"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {error ? (
          <div className="border-b border-danger/20 bg-danger-soft px-4 py-1.5 text-[11px] text-danger">
            {error}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {!available ? (
            <div className="rounded border border-warn-line bg-warn-soft p-3">
              <p className="mb-1 flex items-center gap-1.5 text-[11.5px] font-medium text-warn-ink">
                <AlertTriangle className="h-3.5 w-3.5" />
                Spatial queries are not available on this database
              </p>
              <p className="text-[11px] leading-relaxed text-warn-ink/90">
                {capability?.reason ??
                  "PostGIS is not installed, so shapes cannot be stored or intersected."}
              </p>
              <p className="mt-2 text-[10.5px] leading-relaxed text-ink-muted">
                Nothing else is affected — every other view works as usual. Enabling it is a
                decision about the database, not a setting in the app: see{" "}
                <span className="text-ink-body">design/SPATIAL.md</span>.
              </p>
            </div>
          ) : (
            <>
              <Section
                title="Shapes"
                count={shapes.length}
                empty="Nothing drawn yet. Select a site, then use Draw area."
              >
                {shapes.map((s) => (
                  <div
                    key={s.instanceId}
                    className="flex items-center gap-2 border-b border-line-faint py-1.5 last:border-0"
                  >
                    <button
                      type="button"
                      onClick={() => onFlyTo(s)}
                      title="Show on the map"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-brand"
                    >
                      <Crosshair className="h-3 w-3 shrink-0 text-ink-faint" />
                      <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">
                        {s.instanceName}
                      </span>
                    </button>
                    <span className="shrink-0 rounded bg-canvas px-1.5 py-0.5 text-[10px] text-ink-muted">
                      {s.kind}
                    </span>
                    <span className="w-20 shrink-0 text-right text-[11px] tabular-nums text-ink-body">
                      {formatArea(s.areaM2)}
                    </span>
                    <button
                      type="button"
                      disabled={removing === s.instanceId}
                      onClick={() => void remove(s)}
                      aria-label={`Remove the shape on ${s.instanceName}`}
                      className="shrink-0 rounded p-0.5 text-ink-faint hover:bg-danger-soft hover:text-danger disabled:opacity-40"
                    >
                      {removing === s.instanceId ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                    </button>
                  </div>
                ))}
              </Section>

              <Section
                title="Overlaps"
                count={overlaps.length}
                empty={
                  shapes.length < 2
                    ? "Two areas are needed before they can overlap."
                    : "No two areas share ground."
                }
                note="Each pair once. Areas that only share a border are left out — that is a touch, not an overlap."
              >
                {overlaps.map((o) => (
                  <div
                    key={`${o.aId}-${o.bId}`}
                    className="border-b border-line-faint py-1.5 last:border-0"
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">
                        {o.aName} <span className="text-ink-faint">∩</span> {o.bName}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-ink-body">
                        {formatArea(o.sharedM2)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1 min-w-0 flex-1 overflow-hidden rounded bg-line-faint">
                        <div
                          className="h-full rounded bg-brand"
                          style={{ width: `${Math.min(100, o.sharedOfSmaller * 100)}%` }}
                        />
                      </div>
                      <span className="shrink-0 text-[10px] tabular-nums text-ink-faint">
                        {Math.round(o.sharedOfSmaller * 100)}% of the smaller
                      </span>
                    </div>
                  </div>
                ))}
              </Section>

              <Section
                title="Covered by nobody"
                count={uncovered.length}
                tone={uncovered.length > 0 ? "warn" : "ok"}
                empty="Every located site falls inside an area."
                note="Sites whose coordinates fall in no drawn area — either unserved, or not yet modelled."
              >
                {uncovered.map((u) => (
                  <div
                    key={u.instanceId}
                    className="flex items-center gap-2 border-b border-line-faint py-1.5 last:border-0"
                  >
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">{u.name}</span>
                    <span className="shrink-0 text-[10px] text-ink-faint">{u.objectType}</span>
                  </div>
                ))}
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  count,
  empty,
  note,
  tone = "neutral",
  children,
}: {
  title: string;
  count: number;
  empty: string;
  note?: string;
  tone?: "neutral" | "ok" | "warn";
  children: React.ReactNode;
}) {
  return (
    <section className="mb-4 last:mb-0">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-faint">
          {title}
        </h3>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
            count === 0
              ? "bg-canvas text-ink-faint"
              : tone === "warn"
                ? "bg-warn-soft text-warn-ink"
                : tone === "ok"
                  ? "bg-ok-soft text-ok-ink"
                  : "bg-brand-soft text-brand-deep",
          )}
        >
          {count}
        </span>
      </div>
      {note ? <p className="mb-1 text-[10px] leading-relaxed text-ink-faint">{note}</p> : null}
      {count === 0 ? (
        <p className="py-1 text-[11px] text-ink-faint">{empty}</p>
      ) : (
        <div>{children}</div>
      )}
    </section>
  );
}
