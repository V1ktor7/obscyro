"use client";

import { Activity, BellRing, SlidersHorizontal } from "lucide-react";
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
  KIND_FILTER_OPTIONS,
  loadTwinPreferences,
  saveTwinPreferences,
} from "../twin-preferences";
import { DISPLAY_METRIC_OPTIONS } from "../twin-ui";
import LiveMetricsDialog from "./LiveMetricsDialog";
import AlertRuleEditor from "./AlertRuleEditor";
import MetricEditor from "./MetricEditor";
import TwinAlertToasts from "./TwinAlertToasts";
import TwinCanvas from "./TwinCanvas";
import UnitDetailDialog from "./UnitDetailDialog";

export default function LiveTwinView() {
  const { hasKey, selectedEnv, environments, bumpOntology, setSelectedEnv } = useStudio();
  const env = selectedEnv;

  const envMeta = useMemo(
    () => environments.find((e) => e.slug === env),
    [environments, env],
  );
  const isOperations = envMeta?.type === "operations";

  const operationsEnvs = useMemo(
    () => environments.filter((e) => e.type === "operations"),
    [environments],
  );

  const [snapshot, setSnapshot] = useState<TwinTreeSnapshot | null>(null);
  const [streamMode, setStreamMode] = useState<"stream" | "poll" | "idle">("idle");
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [unitDetail, setUnitDetail] = useState<TwinUnitDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const [displayMetric, setDisplayMetric] = useState("occupancyPct");
  const [metricDefs, setMetricDefs] = useState<TwinMetric[]>([]);
  const [editingMetrics, setEditingMetrics] = useState(false);
  const [editingRules, setEditingRules] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [showMetrics, setShowMetrics] = useState(false);
  const [metricsVersion, setMetricsVersion] = useState(0);
  const [kindFilter, setKindFilter] = useState<string | null>(null);

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
  }, [env, hasKey, metricsVersion]);

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

  // The tree lays itself out from the `contains` links, so a snapshot is the
  // only state it needs.
  const applySnapshot = useCallback((snap: TwinTreeSnapshot) => {
    setSnapshot(snap);
  }, []);

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
          {/*
            This used to read "Switch env type in Ontology Manager", which sent
            you to convert *this* environment into an operations one — when the
            thing you almost always want is to select a different environment.
            Name the ones that would work, so the instruction matches the fix.
          */}
          <p className="text-sm text-ink-muted">
            The live twin runs on an <strong>operations</strong> environment.{" "}
            <span className="text-ink-body">{envMeta?.name ?? env}</span> is a{" "}
            {envMeta?.type ?? "non-operations"} environment.
          </p>
          {operationsEnvs.length > 0 ? (
            <p className="mt-3 text-xs text-ink-muted">
              Switch to{" "}
              {operationsEnvs.map((e, i) => (
                <span key={e.slug}>
                  {i > 0 ? ", " : ""}
                  <button
                    type="button"
                    onClick={() => setSelectedEnv(e.slug)}
                    className="font-medium text-brand-deep hover:underline"
                  >
                    {e.name}
                  </button>
                </span>
              ))}{" "}
              using the picker in the header, or seed a demo skeleton here.
            </p>
          ) : (
            <p className="mt-3 text-xs text-ink-muted">
              No operations environment exists yet. Seed a demo skeleton here, or change this
              environment&apos;s type in Ontology Manager.
            </p>
          )}
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
          <button
            type="button"
            onClick={() => setEditingMetrics(true)}
            title="Define what the twin displays"
            className="rounded border border-line p-1 text-ink-faint hover:border-brand hover:text-brand"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setEditingRules(true)}
            title="Set the thresholds that raise an alert"
            className="rounded border border-line p-1 text-ink-faint hover:border-brand hover:text-brand"
          >
            <BellRing className="h-3.5 w-3.5" />
          </button>
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
          {/*
            Details open from here rather than on selection: clicking around a
            network to compare sites should not throw a modal each time.
          */}
          <Button
            size="sm"
            variant="secondary"
            disabled={!selectedUnitId}
            title={selectedUnitId ? undefined : "Select a site on the map first"}
            onClick={() => setShowDetail(true)}
          >
            Details
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void handleSeedDemo()} disabled={seeding}>
            {seeding ? "Seeding…" : "Seed demo"}
          </Button>
        </div>

        {error ? (
          <p className="mx-3 mt-2 rounded border border-danger/40 bg-danger-soft px-2 py-1 text-xs text-danger-ink">
            {error}
          </p>
        ) : null}

        <div className="relative flex min-h-0 flex-1">
          <div className="relative min-h-0 min-w-0 flex-1">
            <TwinCanvas
              snapshot={snapshot}
              selectedUnitId={selectedUnitId}
              displayMetric={displayMetric}
              displayUnit={displayUnit}
              kindFilter={kindFilter}
              onSelectUnit={setSelectedUnitId}
              onOpenUnit={() => setShowDetail(true)}
            />
          </div>

          {/* A map control rather than a column: the twin gets its width back. */}
          <button
            type="button"
            onClick={() => setShowMetrics(true)}
            title="Live metrics"
            className="absolute right-3 top-3 rounded-md border border-line bg-white p-1.5 text-ink-muted shadow-sm hover:border-brand hover:text-brand"
          >
            <Activity className="h-4 w-4" />
          </button>
        </div>
      </div>

      <TwinAlertToasts
        alerts={toastAlerts}
        onDismiss={(id) => setToastAlerts((cur) => cur.filter((a) => a.id !== id))}
      />

      {showDetail && selectedUnitId ? (
        <UnitDetailDialog
          unitId={selectedUnitId}
          nodeName={snapshot?.nodes.find((n) => n.id === selectedUnitId)?.name}
          detail={unitDetail}
          loading={detailLoading}
          onAck={(id) => void handleAck(id)}
          onClose={() => setShowDetail(false)}
        />
      ) : null}

      {showMetrics && env ? (
        <LiveMetricsDialog
          env={env}
          hasKey={hasKey}
          onClose={() => setShowMetrics(false)}
        />
      ) : null}

      {editingRules && env ? (
        <AlertRuleEditor env={env} onClose={() => setEditingRules(false)} />
      ) : null}

      {editingMetrics && env ? (
        <MetricEditor
          env={env}
          onClose={() => setEditingMetrics(false)}
          onSaved={() => setMetricsVersion((v) => v + 1)}
        />
      ) : null}
    </div>
  );
}
