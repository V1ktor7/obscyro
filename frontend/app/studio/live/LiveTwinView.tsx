"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import {
  ackTwinAlert,
  fetchTwinTree,
  fetchTwinUnit,
  seedTwinDemo,
  subscribeTwinStream,
  type TwinTreeSnapshot,
  type TwinUnitDetail,
} from "@/lib/platform-api";

import { useStudio } from "../StudioShell";
import {
  loadTwinLayout,
  mergeTwinPositions,
  saveTwinLayout,
} from "../twin-layout-persist";
import {
  KIND_FILTER_OPTIONS,
  loadTwinPreferences,
  saveTwinPreferences,
} from "../twin-preferences";
import {
  DISPLAY_METRIC_OPTIONS,
  formatFreshness,
  formatTwinMetric,
  severityBadgeTone,
} from "../twin-ui";
import LiveMetricsPanel from "./LiveMetricsPanel";
import TwinAlertToasts from "./TwinAlertToasts";
import TwinCanvas from "./TwinCanvas";

export default function LiveTwinView() {
  const { hasKey, selectedEnv, environments, bumpOntology } = useStudio();
  const env = selectedEnv;

  const envMeta = useMemo(
    () => environments.find((e) => e.slug === env),
    [environments, env],
  );
  const isOperations = envMeta?.type === "operations";

  const [snapshot, setSnapshot] = useState<TwinTreeSnapshot | null>(null);
  const [streamMode, setStreamMode] = useState<"stream" | "poll" | "idle">("idle");
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [unitDetail, setUnitDetail] = useState<TwinUnitDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const [displayMetric, setDisplayMetric] = useState("occupancyPct");
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(
    () => new Map(),
  );

  const [toastAlerts, setToastAlerts] = useState<
    Array<{ id: string; severity: "info" | "warn" | "critical"; message: string; unitInstanceId: string }>
  >([]);
  const seenAlertIds = useRef(new Set<string>());

  useEffect(() => {
    if (!env) return;
    const prefs = loadTwinPreferences(env);
    setDisplayMetric(prefs.displayMetric);
    setKindFilter(prefs.kindFilter);
  }, [env]);

  const applySnapshot = useCallback(
    (snap: TwinTreeSnapshot) => {
      setSnapshot(snap);
      if (!env) return;
      const ids = snap.nodes.map((n) => n.id);
      setPositions(mergeTwinPositions(ids, snap.edges, snap.roots, loadTwinLayout(env)));
    },
    [env],
  );

  const collectNewAlerts = useCallback(async (snap: TwinTreeSnapshot) => {
    if (!env) return;
    const newToasts: typeof toastAlerts = [];
    for (const node of snap.nodes) {
      if (node.openAlertCount === 0) continue;
      try {
        const detail = await fetchTwinUnit(env, node.id);
        for (const a of detail.alerts) {
          if (seenAlertIds.current.has(a.id)) continue;
          seenAlertIds.current.add(a.id);
          newToasts.push({
            id: a.id,
            severity: a.severity,
            message: a.message,
            unitInstanceId: a.unitInstanceId,
          });
        }
      } catch {
        /* skip unit on error */
      }
    }
    if (newToasts.length) {
      setToastAlerts((cur) => [...cur, ...newToasts].slice(-5));
    }
  }, [env]);

  const onSnapshot = useCallback(
    (snap: TwinTreeSnapshot) => {
      applySnapshot(snap);
      void collectNewAlerts(snap);
    },
    [applySnapshot, collectNewAlerts],
  );

  useEffect(() => {
    if (!env || !hasKey || !isOperations) {
      setSnapshot(null);
      setStreamMode("idle");
      return;
    }

    let pollId: ReturnType<typeof setInterval> | undefined;
    let stopped = false;

    void fetchTwinTree(env)
      .then((snap) => { if (!stopped) onSnapshot(snap); })
      .catch((err) => { if (!stopped) setError((err as Error).message); });

    const startPoll = () => {
      if (pollId) return;
      setStreamMode("poll");
      pollId = setInterval(() => {
        void fetchTwinTree(env)
          .then((snap) => { if (!stopped) onSnapshot(snap); })
          .catch(() => { /* keep last */ });
      }, 5000);
    };

    setStreamMode("stream");
    const stop = subscribeTwinStream(
      env,
      (snap) => { if (!stopped) onSnapshot(snap); },
      startPoll,
    );

    return () => {
      stopped = true;
      stop();
      if (pollId) clearInterval(pollId);
    };
  }, [env, hasKey, isOperations, onSnapshot]);

  useEffect(() => {
    if (!env || !selectedUnitId || !isOperations) {
      setUnitDetail(null);
      return;
    }
    setDetailLoading(true);
    void fetchTwinUnit(env, selectedUnitId)
      .then(setUnitDetail)
      .catch((err) => setError((err as Error).message))
      .finally(() => setDetailLoading(false));
  }, [env, selectedUnitId, isOperations, snapshot?.computedAt]);

  const handlePositionChange = useCallback(
    (unitId: string, pos: { x: number; y: number }) => {
      setPositions((cur) => {
        const next = new Map(cur);
        next.set(unitId, pos);
        if (env) {
          const layout = Object.fromEntries(next);
          saveTwinLayout(env, layout);
        }
        return next;
      });
    },
    [env],
  );

  const handleMetricChange = (key: string) => {
    setDisplayMetric(key);
    if (env) saveTwinPreferences(env, { displayMetric: key, kindFilter });
  };

  const handleKindFilterChange = (value: string | null) => {
    setKindFilter(value);
    if (env) saveTwinPreferences(env, { displayMetric, kindFilter: value });
  };

  async function handleSeedDemo() {
    if (!env) return;
    setSeeding(true);
    setError(null);
    try {
      await seedTwinDemo(env);
      bumpOntology();
      const snap = await fetchTwinTree(env);
      onSnapshot(snap);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSeeding(false);
    }
  }

  async function handleAck(alertId: string) {
    if (!env) return;
    try {
      await ackTwinAlert(env, alertId);
      if (selectedUnitId) {
        const detail = await fetchTwinUnit(env, selectedUnitId);
        setUnitDetail(detail);
      }
      const snap = await fetchTwinTree(env);
      onSnapshot(snap);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!hasKey) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <p className="max-w-sm text-center text-sm text-gray-500">
          Sign in and create an API key to view the live digital twin.
        </p>
      </div>
    );
  }

  if (!env) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <p className="text-sm text-gray-500">Select an environment in the header.</p>
      </div>
    );
  }

  if (!isOperations) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white p-6">
        <Card className="max-w-md p-6 text-center">
          <p className="text-sm text-gray-600">
            Live Twin requires an <strong>operations</strong> environment. Switch env type in
            Ontology Manager, or seed a demo skeleton here.
          </p>
          <Button className="mt-4" onClick={() => void handleSeedDemo()} disabled={seeding}>
            {seeding ? "Seeding…" : "Seed CHUM demo"}
          </Button>
          {error ? (
            <p className="mt-2 text-xs text-rose-600">{error}</p>
          ) : null}
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-3 py-2">
          <select
            value={displayMetric}
            onChange={(e) => handleMetricChange(e.target.value)}
            className="rounded border border-gray-200 px-2 py-1 text-[11px] focus:border-gray-400 focus:outline-none"
          >
            {DISPLAY_METRIC_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={kindFilter ?? ""}
            onChange={(e) =>
              handleKindFilterChange(e.target.value === "" ? null : e.target.value)
            }
            className="rounded border border-gray-200 px-2 py-1 text-[11px] focus:border-gray-400 focus:outline-none"
          >
            {KIND_FILTER_OPTIONS.map((o) => (
              <option key={o.label} value={o.value ?? ""}>
                {o.label}
              </option>
            ))}
          </select>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[9px]",
              streamMode === "stream"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : streamMode === "poll"
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-gray-200 text-gray-400",
            )}
          >
            twin {streamMode === "stream" ? "stream" : streamMode === "poll" ? "polling" : "…"}
          </span>
          <Button size="sm" variant="secondary" onClick={() => void handleSeedDemo()} disabled={seeding}>
            {seeding ? "Seeding…" : "Seed demo"}
          </Button>
        </div>

        {error ? (
          <p className="mx-3 mt-2 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">
            {error}
          </p>
        ) : null}

        <div className="flex min-h-0 flex-1">
          <div className="relative min-h-0 min-w-0 flex-1">
            <TwinCanvas
              snapshot={snapshot}
              selectedUnitId={selectedUnitId}
              displayMetric={displayMetric}
              kindFilter={kindFilter}
              positions={positions}
              onSelectUnit={setSelectedUnitId}
              onPositionChange={handlePositionChange}
            />
          </div>

          {selectedUnitId ? (
            <aside className="w-72 shrink-0 overflow-y-auto border-l border-gray-200 bg-white p-3">
              <UnitDetailPanel
                unitId={selectedUnitId}
                nodeName={snapshot?.nodes.find((n) => n.id === selectedUnitId)?.name}
                detail={unitDetail}
                loading={detailLoading}
                onAck={(id) => void handleAck(id)}
                onClose={() => setSelectedUnitId(null)}
              />
            </aside>
          ) : null}
        </div>
      </div>

      <div className="w-full shrink-0 lg:w-72">
        <LiveMetricsPanel env={env} hasKey={hasKey} />
      </div>

      <TwinAlertToasts
        alerts={toastAlerts}
        onDismiss={(id) => setToastAlerts((cur) => cur.filter((a) => a.id !== id))}
      />
    </div>
  );
}

function UnitDetailPanel({
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
    <div>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-gray-900">{nodeName ?? "Unit"}</p>
          <p className="font-mono text-[9px] text-gray-400">{unitId.slice(0, 12)}…</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[10px] text-gray-400 hover:text-gray-600"
        >
          Close
        </button>
      </div>

      {loading || !detail ? (
        <p className="text-[11px] text-gray-400">Loading…</p>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <Card className="p-2">
              <p className="text-[9px] uppercase text-gray-400">Occupancy</p>
              <p className="text-sm font-semibold">
                {formatTwinMetric(detail.metrics, "occupancyPct")}
              </p>
            </Card>
            <Card className="p-2">
              <p className="text-[9px] uppercase text-gray-400">Linked</p>
              <p className="text-sm font-semibold">
                {detail.metrics.linkedInstanceCount}
              </p>
            </Card>
            <Card className="p-2 col-span-2">
              <p className="text-[9px] uppercase text-gray-400">Freshness</p>
              <p className="text-sm font-semibold">
                {formatFreshness(detail.metrics.freshnessSeconds)}
              </p>
            </Card>
          </div>

          {Object.keys(detail.metrics.instanceCountByType).length > 0 ? (
            <div className="mb-3">
              <p className="mb-1 font-mono text-[9px] uppercase text-gray-400">By type</p>
              {Object.entries(detail.metrics.instanceCountByType).map(([t, c]) => (
                <p key={t} className="text-[11px] text-gray-600">
                  {t}: {c}
                </p>
              ))}
            </div>
          ) : null}

          <div className="mb-3">
            <p className="mb-1 font-mono text-[9px] uppercase text-gray-400">Open alerts</p>
            {detail.alerts.length === 0 ? (
              <p className="text-[11px] text-gray-400">None</p>
            ) : (
              detail.alerts.map((a) => (
                <div key={a.id} className="mb-2 rounded border border-gray-100 p-2">
                  <Badge tone={severityBadgeTone(a.severity)}>{a.severity}</Badge>
                  <p className="mt-1 text-[11px] text-gray-700">{a.message}</p>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-1"
                    onClick={() => onAck(a.id)}
                  >
                    Ack
                  </Button>
                </div>
              ))
            )}
          </div>

          {detail.recommendations.length > 0 ? (
            <div>
              <p className="mb-1 font-mono text-[9px] uppercase text-gray-400">Recommendations</p>
              <ul className="list-inside list-disc text-[11px] text-gray-600">
                {detail.recommendations.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
