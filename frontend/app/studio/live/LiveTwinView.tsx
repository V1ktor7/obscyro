"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  ackTwinAlert,
  fetchTwinTree,
  fetchTwinUnit,
  listTwinMetrics,
  seedTwinDemo,
  subscribeTwinStream,
  type TwinMetric,
  type TwinTreeSnapshot,
  type TwinUnitDetail,
} from "@/lib/platform-api";

import { StatusChip } from "../StatusChip";
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
  const [metricDefs, setMetricDefs] = useState<TwinMetric[]>([]);
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

  // The metric list is the organization's, not a constant: what the twin can
  // display is whatever it has defined.
  useEffect(() => {
    if (!env || !hasKey) return;
    let cancelled = false;
    void listTwinMetrics(env)
      .then(({ metrics }) => { if (!cancelled) setMetricDefs(metrics); })
      .catch(() => { if (!cancelled) setMetricDefs([]); });
    return () => { cancelled = true; };
  }, [env, hasKey]);

  const metricOptions = useMemo(
    () => [
      ...metricDefs.map((m) => ({ key: m.key, label: m.label, unit: m.unit })),
      ...DISPLAY_METRIC_OPTIONS.filter((o) => o.key !== "occupancyPct").map((o) => ({
        key: o.key,
        label: o.label,
        unit: undefined,
      })),
    ],
    [metricDefs],
  );

  const displayUnit = metricDefs.find((m) => m.key === displayMetric)?.unit;

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
        <p className="max-w-sm text-center text-sm text-ink-muted">
          Sign in and create an API key to view the live digital twin.
        </p>
      </div>
    );
  }

  if (!env) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <p className="text-sm text-ink-muted">Select an environment in the header.</p>
      </div>
    );
  }

  if (!isOperations) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white p-6">
        <Card className="max-w-md p-6 text-center">
          <p className="text-sm text-ink-muted">
            Live Twin requires an <strong>operations</strong> environment. Switch env type in
            Ontology Manager, or seed a demo skeleton here.
          </p>
          <Button className="mt-4" onClick={() => void handleSeedDemo()} disabled={seeding}>
            {seeding ? "Seeding…" : "Seed CHUM demo"}
          </Button>
          {error ? (
            <p className="mt-2 text-xs text-danger">{error}</p>
          ) : null}
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-line-faint px-3 py-2">
          <select
            value={displayMetric}
            onChange={(e) => handleMetricChange(e.target.value)}
            className="rounded border border-line px-2 py-1 text-[11px] focus:border-brand focus:outline-none"
          >
            {metricOptions.map((o) => (
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
            className="rounded border border-line px-2 py-1 text-[11px] focus:border-brand focus:outline-none"
          >
            {KIND_FILTER_OPTIONS.map((o) => (
              <option key={o.label} value={o.value ?? ""}>
                {o.label}
              </option>
            ))}
          </select>
          <StatusChip
            tone={streamMode === "stream" ? "ok" : streamMode === "poll" ? "warn" : "neutral"}
            dot={
              streamMode === "stream"
                ? "bg-ok"
                : streamMode === "poll"
                  ? "bg-warn"
                  : "bg-ink-ghost"
            }
          >
            {streamMode === "stream"
              ? "Live stream"
              : streamMode === "poll"
                ? "Polling"
                : "Connecting"}
          </StatusChip>
          <Button size="sm" variant="secondary" onClick={() => void handleSeedDemo()} disabled={seeding}>
            {seeding ? "Seeding…" : "Seed demo"}
          </Button>
        </div>

        {error ? (
          <p className="mx-3 mt-2 rounded border border-danger/40 bg-danger-soft px-2 py-1 text-xs text-danger-ink">
            {error}
          </p>
        ) : null}

        <div className="flex min-h-0 flex-1">
          <div className="relative min-h-0 min-w-0 flex-1">
            <TwinCanvas
              snapshot={snapshot}
              selectedUnitId={selectedUnitId}
              displayMetric={displayMetric}
              displayUnit={displayUnit}
              kindFilter={kindFilter}
              positions={positions}
              onSelectUnit={setSelectedUnitId}
              onPositionChange={handlePositionChange}
            />
          </div>

          {selectedUnitId ? (
            <aside className="w-72 shrink-0 overflow-y-auto border-l border-line bg-white p-3">
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
          <p className="text-xs font-medium text-ink">{nodeName ?? "Unit"}</p>
          <p className="text-[9px] text-ink-faint">{unitId.slice(0, 12)}…</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[10px] text-ink-faint hover:text-ink-muted"
        >
          Close
        </button>
      </div>

      {loading || !detail ? (
        <p className="text-[11px] text-ink-faint">Loading…</p>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <Card className="p-2">
              <p className="text-[9px] uppercase text-ink-faint">Occupancy</p>
              <p className="text-sm font-semibold">
                {formatTwinMetric(detail.metrics, "occupancyPct")}
              </p>
            </Card>
            <Card className="p-2">
              <p className="text-[9px] uppercase text-ink-faint">Linked</p>
              <p className="text-sm font-semibold">
                {detail.metrics.linkedInstanceCount}
              </p>
            </Card>
            <Card className="p-2 col-span-2">
              <p className="text-[9px] uppercase text-ink-faint">Freshness</p>
              <p className="text-sm font-semibold">
                {formatFreshness(detail.metrics.freshnessSeconds)}
              </p>
            </Card>
          </div>

          {Object.keys(detail.metrics.instanceCountByType).length > 0 ? (
            <div className="mb-3">
              <p className="mb-1 text-[9px] uppercase text-ink-faint">By type</p>
              {Object.entries(detail.metrics.instanceCountByType).map(([t, c]) => (
                <p key={t} className="text-[11px] text-ink-muted">
                  {t}: {c}
                </p>
              ))}
            </div>
          ) : null}

          <div className="mb-3">
            <p className="mb-1 text-[9px] uppercase text-ink-faint">Open alerts</p>
            {detail.alerts.length === 0 ? (
              <p className="text-[11px] text-ink-faint">None</p>
            ) : (
              detail.alerts.map((a) => (
                <div key={a.id} className="mb-2 rounded-md border border-line p-2">
                  <StatusChip tone={severityBadgeTone(a.severity)}>{a.severity}</StatusChip>
                  <p className="mt-1 text-[11px] text-ink-body">{a.message}</p>
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
              <p className="mb-1 text-[9px] uppercase text-ink-faint">Recommendations</p>
              <ul className="list-inside list-disc text-[11px] text-ink-muted">
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
