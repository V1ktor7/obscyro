"use client";

/**
 * Data Flux view — real ingest sources, animated flow canvas, ingest log,
 * tiered detections (real quality/twin alerts, client heuristics, LLM preview
 * triage), and a notification drawer with toasts on new detections.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import {
  listIngestEvents,
  listIngestSources,
  listTwinAlerts,
  type IngestSource,
} from "@/lib/platform-api";

import {
  Chip,
  LiveDot,
  MicroLabel,
  PanelHead,
  SEV_HEX,
  timeAgo,
} from "../command-ui";
import { fetchMetrics, type MetricsSnapshot } from "../live-api";
import { listQualityFlags, type QualityFlag } from "../quality-api";
import { useStudio } from "../StudioShell";
import AttachFluxModal from "./AttachFluxModal";
import FluxCanvas from "./FluxCanvas";
import {
  deriveSourceStats,
  detectGaps,
  detectRateAnomalies,
  type FluxDetection,
} from "./flux-detectors";
import { getRecommendation, type TriageRecommendation } from "./triage";

export default function FluxView() {
  const { hasKey, selectedEnv } = useStudio();
  const env = selectedEnv;

  const [sources, setSources] = useState<IngestSource[]>([]);
  const [events, setEvents] = useState<
    Awaited<ReturnType<typeof listIngestEvents>>["events"]
  >([]);
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [qualityFlags, setQualityFlags] = useState<QualityFlag[]>([]);
  const [twinAlerts, setTwinAlerts] = useState<
    Awaited<ReturnType<typeof listTwinAlerts>>["alerts"]
  >([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toasts, setToasts] = useState<FluxDetection[]>([]);
  const [triage, setTriage] = useState<
    Map<string, TriageRecommendation>
  >(() => new Map());
  const seenIds = useRef(new Set<string>());

  const loadAll = useCallback(async () => {
    if (!env) return;
    try {
  const [{ sources: srcs }, evRes, m, { flags: flagsL4 }, { flags: flagsL5 }, { flags: flagsL6 }, { alerts }] =
        await Promise.all([
          listIngestSources(),
          listIngestEvents(),
          fetchMetrics(env),
          listQualityFlags(env, { status: "open", layer: 4 }),
          listQualityFlags(env, { status: "open", layer: 5 }),
          listQualityFlags(env, { status: "open", layer: 6 }),
          listTwinAlerts(env, { limit: 30 }),
        ]);
      const flags = [...flagsL4, ...flagsL5, ...flagsL6];
      setSources(srcs);
      setEvents(evRes.events);
      setMetrics(m);
      setQualityFlags(flags);
      setTwinAlerts(alerts);
    } catch {
      /* keep stale */
    }
  }, [env]);

  useEffect(() => {
    if (!hasKey) return;
    void loadAll();
    const id = setInterval(() => void loadAll(), 12_000);
    return () => clearInterval(id);
  }, [hasKey, loadAll]);

  const sourceStats = useMemo(() => {
    const m = new Map<
      string,
      ReturnType<typeof deriveSourceStats>
    >();
    for (const s of sources) {
      m.set(s.id, deriveSourceStats(events, s.id));
    }
    return m;
  }, [sources, events]);

  const realDetections = useMemo((): FluxDetection[] => {
    const out: FluxDetection[] = [];
    for (const f of qualityFlags) {
      if (f.code === "STALE_SOURCE" || f.code === "FLATLINE" || f.layer >= 5) {
        out.push({
          id: `qf-${f.id}`,
          tier: "real",
          severity: f.severity === "error" ? "critical" : f.severity === "warn" ? "warn" : "info",
          title: f.code,
          detail: f.message,
          at: f.createdAt,
          code: f.code,
        });
      }
    }
    for (const a of twinAlerts.filter((x) => x.status === "open")) {
      out.push({
        id: `ta-${a.id}`,
        tier: "real",
        severity: a.severity === "critical" ? "critical" : a.severity === "warn" ? "warn" : "info",
        title: `Twin alert · ${a.ruleId ?? "rule"}`,
        detail: a.message,
        at: a.createdAt ?? new Date().toISOString(),
        sourceId: a.unitInstanceId,
      });
    }
    return out;
  }, [qualityFlags, twinAlerts]);

  const heuristicDetections = useMemo((): FluxDetection[] => {
    const ids = selectedSourceId ? [selectedSourceId] : sources.map((s) => s.id);
    const out: FluxDetection[] = [];
    for (const id of ids) {
      out.push(...detectGaps(events, id));
      out.push(...detectRateAnomalies(events, id));
    }
    if (!ids.length) {
      out.push(...detectGaps(events));
      out.push(...detectRateAnomalies(events));
    }
    return out;
  }, [events, sources, selectedSourceId]);

  const allDetections = useMemo(
    () => [...realDetections, ...heuristicDetections],
    [realDetections, heuristicDetections],
  );

  useEffect(() => {
    const fresh = allDetections.filter((d) => !seenIds.current.has(d.id));
    if (fresh.length) {
      for (const d of fresh) seenIds.current.add(d.id);
      setToasts((t) => [...fresh.slice(0, 3), ...t].slice(0, 5));
      const timer = setTimeout(() => setToasts((t) => t.slice(0, 2)), 5000);
      return () => clearTimeout(timer);
    }
  }, [allDetections]);

  async function handleTriage(d: FluxDetection) {
    if (triage.has(d.id)) return;
    const rec = await getRecommendation(d, {
      sourceName: sources.find((s) => s.id === d.sourceId)?.name,
      recentEventCount: events.length,
      env: env ?? undefined,
    });
    setTriage((m) => new Map(m).set(d.id, rec));
  }

  const logLines = useMemo(() => {
    const lines: Array<{ ts: string; text: string; kind: "event" | "detect" }> = [];
    for (const e of events.slice(0, 15)) {
      const src = sources.find((s) => s.id === e.sourceId)?.name ?? e.sourceId ?? "?";
      lines.push({
        ts: e.receivedAt,
        text: `${src} · ${e.status}`,
        kind: "event",
      });
    }
    for (const d of heuristicDetections.slice(0, 5)) {
      lines.push({
        ts: d.at,
        text: `[heuristic] ${d.title}: ${d.detail}`,
        kind: "detect",
      });
    }
    lines.sort((a, b) => b.ts.localeCompare(a.ts));
    return lines.slice(0, 20);
  }, [events, sources, heuristicDetections]);

  function tierBadge(tier: FluxDetection["tier"]) {
    if (tier === "real") return "Real";
    if (tier === "heuristic") return "Client heuristic";
    return "LLM · preview";
  }

  return (
    <div className="relative flex h-[calc(100vh-7.5rem)] min-h-[520px] flex-col gap-2">
      {/* Toasts */}
      <div className="pointer-events-none fixed right-4 top-20 z-40 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-md"
          >
            <div className="text-[10px] font-medium text-gray-800">{t.title}</div>
            <div className="text-[9px] text-gray-500">{t.detail}</div>
          </div>
        ))}
      </div>

      {/* Top bar */}
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
        <MicroLabel>Data flux</MicroLabel>
        <Chip>{sources.length} sources</Chip>
        <Chip>{allDetections.length} detections</Chip>
        <Button size="sm" onClick={() => setAttachOpen(true)}>
          Attach flux
        </Button>
        <button
          type="button"
          onClick={() => setDrawerOpen((o) => !o)}
          className="relative ml-auto rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
        >
          🔔
          {allDetections.length > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] text-white">
              {Math.min(allDetections.length, 9)}
            </span>
          )}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 gap-2">
        {/* Sources rail */}
        <aside className="flex w-52 shrink-0 flex-col gap-1 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2">
          <PanelHead title={<MicroLabel>Sources</MicroLabel>} />
          {sources.length === 0 ? (
            <p className="text-[10px] text-gray-400">No ingest sources yet</p>
          ) : (
            sources.map((s) => {
              const st = sourceStats.get(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() =>
                    setSelectedSourceId((id) => (id === s.id ? null : s.id))
                  }
                  className={cn(
                    "w-full rounded border px-2 py-1.5 text-left text-[10px]",
                    selectedSourceId === s.id
                      ? "border-indigo-300 bg-indigo-50"
                      : "border-gray-100 hover:border-gray-200",
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <LiveDot
                      mode={
                        st?.status === "critical"
                          ? "error"
                          : st?.status === "warn"
                            ? "poll"
                            : st?.status === "idle"
                              ? "idle"
                              : "stream"
                      }
                    />
                    <span className="truncate font-medium text-gray-800">
                      {s.name}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[9px] text-gray-400">
                    {s.type}/{s.method}
                  </div>
                  <div className="mt-0.5 font-mono text-[9px] text-gray-500">
                    Last{" "}
                    {st?.lastEventAt ? timeAgo(st.lastEventAt) : "—"} ·{" "}
                    {st?.eventsPerMin != null
                      ? `${st.eventsPerMin.toFixed(1)}/min`
                      : "—"}
                  </div>
                </button>
              );
            })
          )}
        </aside>

        {/* Center */}
        <main className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="min-h-[200px] flex-1 rounded-lg border border-gray-200 bg-white p-2">
            <PanelHead title={<MicroLabel>Flow canvas</MicroLabel>} />
            <FluxCanvas sources={sources} metrics={metrics} />
          </div>
          <div className="max-h-36 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2">
            <PanelHead title={<MicroLabel>Ingest log</MicroLabel>} />
            <div className="space-y-0.5 font-mono text-[9px]">
              {logLines.map((l, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex gap-2",
                    l.kind === "detect" ? "text-amber-700" : "text-gray-600",
                  )}
                >
                  <span className="shrink-0 text-gray-400">
                    {l.ts.slice(11, 19)}
                  </span>
                  <span className="truncate">{l.text}</span>
                </div>
              ))}
              {!logLines.length && (
                <span className="text-gray-400">No events yet</span>
              )}
            </div>
          </div>
        </main>

        {/* Detections panel */}
        <aside className="flex w-56 shrink-0 flex-col gap-2 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2">
          <PanelHead title={<MicroLabel>Detections</MicroLabel>} />
          {(["real", "heuristic"] as const).map((tier) => {
            const items = allDetections.filter((d) => d.tier === tier);
            if (!items.length && tier === "heuristic") return null;
            return (
              <div key={tier}>
                <MicroLabel className="mb-1 block">
                  {tier === "real" ? "Real (L4–6 + twin)" : "Client heuristics"}
                </MicroLabel>
                {items.length === 0 ? (
                  <p className="text-[9px] text-gray-400">None</p>
                ) : (
                  items.map((d) => (
                    <DetectionCard
                      key={d.id}
                      d={d}
                      tierLabel={tierBadge(d.tier)}
                      triage={triage.get(d.id)}
                      onTriage={() => void handleTriage(d)}
                    />
                  ))
                )}
              </div>
            );
          })}
        </aside>
      </div>

      {/* Notification drawer */}
      {drawerOpen && (
        <div className="absolute inset-y-0 right-0 z-30 w-72 border-l border-gray-200 bg-white p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <MicroLabel>Notifications</MicroLabel>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="text-gray-400 hover:text-gray-600"
            >
              ×
            </button>
          </div>
          <div className="space-y-2 overflow-y-auto">
            {allDetections.map((d) => (
              <DetectionCard
                key={d.id}
                d={d}
                tierLabel={tierBadge(d.tier)}
                triage={triage.get(d.id)}
                onTriage={() => void handleTriage(d)}
              />
            ))}
            {!allDetections.length && (
              <p className="text-[10px] text-gray-400">No detections</p>
            )}
          </div>
        </div>
      )}

      <AttachFluxModal
        open={attachOpen}
        onClose={() => setAttachOpen(false)}
        onCreated={() => void loadAll()}
      />
    </div>
  );
}

function DetectionCard({
  d,
  tierLabel,
  triage,
  onTriage,
}: {
  d: FluxDetection;
  tierLabel: string;
  triage?: TriageRecommendation;
  onTriage: () => void;
}) {
  const color =
    d.severity === "critical"
      ? SEV_HEX.critical
      : d.severity === "warn"
        ? SEV_HEX.warn
        : SEV_HEX.info;

  return (
    <div className="mb-2 rounded border border-gray-100 p-2 text-[10px]">
      <div className="flex items-start gap-1.5">
        <span
          className="mt-0.5 h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-gray-800">{d.title}</div>
          <div className="text-[9px] text-gray-500">{d.detail}</div>
          <span
            className={cn(
              "mt-1 inline-block rounded px-1 font-mono text-[8px] uppercase",
              d.tier === "real"
                ? "bg-emerald-50 text-emerald-700"
                : d.tier === "heuristic"
                  ? "bg-amber-50 text-amber-700"
                  : "bg-violet-50 text-violet-700",
            )}
          >
            {tierLabel}
          </span>
        </div>
      </div>
      {triage ? (
        <div className="mt-2 rounded bg-gray-50 p-1.5 text-[9px] text-gray-600">
          <span className="font-mono text-[8px] text-violet-600">LLM · preview</span>
          <p>{triage.text}</p>
          <span className="text-gray-400">
            confidence {(triage.confidence * 100).toFixed(0)}%
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={onTriage}
          className="mt-1 text-[9px] text-indigo-600 hover:underline"
        >
          Preview triage
        </button>
      )}
    </div>
  );
}
