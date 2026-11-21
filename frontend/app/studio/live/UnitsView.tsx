"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  ackTwinAlert,
  fetchTwinTree,
  fetchTwinUnit,
  listTwinAlertRules,
  listTwinMetrics,
  seedTwinDemo,
  subscribeTwinStream,
  type TwinAlertRule,
  type TwinMetric,
  type TwinTreeSnapshot,
  type TwinUnitDetail,
} from "@/lib/platform-api";

import { useAlertFeed } from "../AlertFeed";
import { useAnalystFocus, useOpenAnalyst } from "../AnalystDock";
import { UNIT_PARAM, situationHref } from "../alert-feed-state";
import { useStudio } from "../StudioShell";
import { loadTwinPreferences, saveTwinPreferences } from "../twin-preferences";
import { DISPLAY_METRIC_OPTIONS, twinMetricNumber } from "../twin-ui";
import AlertRuleEditor from "./AlertRuleEditor";
import LiveMetricsDialog from "./LiveMetricsDialog";
import MetricEditor from "./MetricEditor";
import UnitSheet, { type OtherMeasure } from "./UnitSheet";
import UnitsBoard, { type StreamMode } from "./UnitsBoard";
import { formatMeasure, type Measure } from "./units-list";

// ---------------------------------------------------------------------------
// Units: every unit of the twin, live, ranked on one measure.
//
// This file reads: the tree of units (a stream, with a five-second reading as
// a fallback), the measures the organisation defined, the thresholds that raise
// an alert, and the detail of the unit selected. What is drawn from them is in
// `UnitsBoard` and `UnitSheet`.
// ---------------------------------------------------------------------------

/** The counts every twin has, whatever its organisation defined. */
const BUILT_IN: Measure[] = DISPLAY_METRIC_OPTIONS.filter((o) => o.key !== "occupancyPct").map((o) => ({
  key: o.key,
  label: o.label,
}));

export default function UnitsView() {
  const { hasKey, selectedEnv, environments, bumpOntology, setSelectedEnv } = useStudio();
  const env = selectedEnv;

  const envMeta = useMemo(() => environments.find((e) => e.slug === env), [environments, env]);
  const isOperations = envMeta?.type === "operations";
  const operationsEnvs = useMemo(() => environments.filter((e) => e.type === "operations"), [environments]);

  const [snapshot, setSnapshot] = useState<TwinTreeSnapshot | null>(null);
  const [streamMode, setStreamMode] = useState<StreamMode>("idle");
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  // Kept with the unit it was read for: a sheet must never show one unit's alerts under another's name.
  const [held, setHeld] = useState<{ unitId: string; detail: TwinUnitDetail } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const [displayMetric, setDisplayMetric] = useState("occupancyPct");
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const [metricDefs, setMetricDefs] = useState<TwinMetric[] | null>(null);
  const [rules, setRules] = useState<TwinAlertRule[]>([]);
  const [metricsVersion, setMetricsVersion] = useState(0);
  const [rulesVersion, setRulesVersion] = useState(0);
  const [editingMetrics, setEditingMetrics] = useState(false);
  const [editingRules, setEditingRules] = useState(false);
  const [showMetrics, setShowMetrics] = useState(false);

  // New alerts are announced by the shell, on every page.
  const { refresh: refreshAlerts } = useAlertFeed();

  // An alert, or a signal, links here with its unit in the address: that unit is selected on arrival.
  const linkedUnit = useSearchParams().get(UNIT_PARAM);
  // The analyst is told which unit is selected: a question asked from here is about it.
  useAnalystFocus({ unitId: selectedUnitId ?? undefined });
  const openAnalyst = useOpenAnalyst();
  useEffect(() => {
    if (linkedUnit) setSelectedUnitId(linkedUnit);
  }, [linkedUnit]);

  useEffect(() => {
    if (!env) return;
    const prefs = loadTwinPreferences(env);
    setDisplayMetric(prefs.displayMetric);
    setKindFilter(prefs.kindFilter);
  }, [env]);

  // The measures are the organisation's, not a constant: what the page can rank on is whatever it defined.
  useEffect(() => {
    if (!env || !hasKey) return;
    let cancelled = false;
    void listTwinMetrics(env)
      .then(({ metrics }) => { if (!cancelled) setMetricDefs(metrics); })
      .catch(() => { if (!cancelled) setMetricDefs([]); });
    return () => { cancelled = true; };
  }, [env, hasKey, metricsVersion]);

  // The thresholds colour the list: a line is red exactly when its alert would fire. Losing them costs the
  // colour, never the list.
  useEffect(() => {
    if (!env || !hasKey) return;
    let cancelled = false;
    void listTwinAlertRules(env)
      .then((r) => { if (!cancelled) setRules(r.rules ?? []); })
      .catch(() => { if (!cancelled) setRules([]); });
    return () => { cancelled = true; };
  }, [env, hasKey, rulesVersion]);

  const defined: Measure[] = useMemo(
    () => (metricDefs ?? []).map((m) => ({ key: m.key, label: m.label, unit: m.unit })),
    [metricDefs],
  );

  // The measure kept from last time, when the project still has it. Until the definitions arrive the page
  // keeps the key it was given rather than jump to another measure and back.
  const { measure, measures } = useMemo(() => {
    const options = [...defined, ...BUILT_IN];
    const kept = options.find((o) => o.key === displayMetric);
    if (kept) return { measure: kept, measures: options };
    if (metricDefs === null) {
      const label = DISPLAY_METRIC_OPTIONS.find((o) => o.key === displayMetric)?.label ?? displayMetric;
      const pending: Measure = { key: displayMetric, label };
      return { measure: pending, measures: [pending, ...options] };
    }
    return { measure: options[0]!, measures: options };
  }, [defined, displayMetric, metricDefs]);

  useEffect(() => {
    if (!env || !hasKey || !isOperations) {
      setSnapshot(null);
      setStreamMode("idle");
      return;
    }

    let pollId: ReturnType<typeof setInterval> | undefined;
    let stopped = false;

    void fetchTwinTree(env)
      .then((snap) => { if (!stopped) setSnapshot(snap); })
      .catch((err) => { if (!stopped) setError((err as Error).message); });

    const startPoll = () => {
      if (pollId) return;
      setStreamMode("poll");
      pollId = setInterval(() => {
        void fetchTwinTree(env)
          .then((snap) => { if (!stopped) setSnapshot(snap); })
          .catch(() => { /* keep the last reading */ });
      }, 5000);
    };

    // "Live stream" is said once the stream has delivered something, not when it was asked for: a stream
    // the browser refuses used to read as live for half a minute while nothing arrived.
    setStreamMode("idle");
    const stop = subscribeTwinStream(
      env,
      (snap) => {
        if (stopped) return;
        setStreamMode("stream");
        setSnapshot(snap);
      },
      startPoll,
    );

    return () => {
      stopped = true;
      stop();
      if (pollId) clearInterval(pollId);
    };
  }, [env, hasKey, isOperations]);

  // Read again at each new reading of the tree, without emptying the sheet in between.
  const computedAt = snapshot?.computedAt;
  useEffect(() => {
    if (!env || !selectedUnitId || !isOperations) return;
    let cancelled = false;
    void fetchTwinUnit(env, selectedUnitId)
      .then((detail) => { if (!cancelled) setHeld({ unitId: selectedUnitId, detail }); })
      .catch((err) => { if (!cancelled) setError((err as Error).message); });
    return () => { cancelled = true; };
  }, [env, selectedUnitId, isOperations, computedAt]);

  const detail = held && held.unitId === selectedUnitId ? held.detail : null;

  const selectedNode = useMemo(
    () => snapshot?.nodes.find((n) => n.id === selectedUnitId) ?? null,
    [snapshot, selectedUnitId],
  );

  // What else the unit reports: a unit with no value for the measure shown is often not silent.
  const others: OtherMeasure[] = useMemo(() => {
    if (!selectedNode) return [];
    return defined
      .filter((m) => m.key !== measure.key)
      .flatMap((m) => {
        const value = twinMetricNumber(selectedNode.metrics, m.key);
        if (value === null) return [];
        return [{ key: m.key, label: m.label, text: formatMeasure(value, m), about: selectedNode.metrics.qualifiers?.[m.key] ?? [] }];
      });
  }, [defined, measure.key, selectedNode]);

  const handleMeasure = (key: string) => {
    setDisplayMetric(key);
    if (env) saveTwinPreferences(env, { displayMetric: key, kindFilter });
  };

  const handleKind = (value: string | null) => {
    setKindFilter(value);
    if (env) saveTwinPreferences(env, { displayMetric, kindFilter: value });
  };

  const handleSeedDemo = useCallback(async () => {
    if (!env) return;
    setSeeding(true);
    setError(null);
    try {
      await seedTwinDemo(env);
      bumpOntology();
      setSnapshot(await fetchTwinTree(env));
      setMetricsVersion((v) => v + 1);
      setRulesVersion((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSeeding(false);
    }
  }, [env, bumpOntology]);

  async function handleAck(alertId: string) {
    if (!env) return;
    try {
      await ackTwinAlert(env, alertId);
      if (selectedUnitId) {
        const fresh = await fetchTwinUnit(env, selectedUnitId);
        setHeld({ unitId: selectedUnitId, detail: fresh });
      }
      setSnapshot(await fetchTwinTree(env));
      // The banner must not go on showing an alert somebody just acknowledged.
      await refreshAlerts();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!hasKey) {
    return (
      <div className="flex flex-1 items-center justify-center bg-surface">
        <p className="max-w-sm text-center text-sm text-ink-muted">
          Sign in and create an API key to view the live digital twin.
        </p>
      </div>
    );
  }

  if (!env) {
    return (
      <div className="flex flex-1 items-center justify-center bg-surface">
        <p className="text-sm text-ink-muted">Select an environment in the header.</p>
      </div>
    );
  }

  if (!isOperations) {
    return (
      <div className="flex flex-1 items-center justify-center bg-surface p-6">
        <Card className="max-w-md p-6 text-center">
          {/*
            Name the environments that would work: what a person almost always
            wants here is to select another environment, not to convert this one.
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
          {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {error ? (
        <p role="alert" className="m-0 border-b border-danger-line bg-danger-soft px-4 py-1.5 text-xs text-danger-ink sm:px-6">
          {error}
        </p>
      ) : null}

      <UnitsBoard
        nodes={snapshot ? snapshot.nodes : null}
        measure={measure}
        measures={measures}
        rules={rules}
        kind={kindFilter}
        selectedId={selectedUnitId}
        revealId={linkedUnit}
        stream={streamMode}
        onMeasure={handleMeasure}
        onKind={handleKind}
        onSelect={setSelectedUnitId}
        onEditMeasures={() => setEditingMetrics(true)}
        onEditThresholds={() => setEditingRules(true)}
        onLiveMetrics={() => setShowMetrics(true)}
        onSeed={() => void handleSeedDemo()}
        seeding={seeding}
        sheet={(unit, scale) => (
          <UnitSheet
            unit={unit}
            missing={Boolean(selectedUnitId && snapshot && !unit)}
            measure={measure}
            scale={scale}
            detail={detail}
            others={others}
            situationHref={(alertId) => situationHref({ unit: selectedUnitId, alert: alertId }, env)}
            onAck={(id) => void handleAck(id)}
            onAsk={openAnalyst}
          />
        )}
      />

      {showMetrics ? <LiveMetricsDialog env={env} hasKey={hasKey} onClose={() => setShowMetrics(false)} /> : null}

      {editingRules ? (
        <AlertRuleEditor
          env={env}
          onClose={() => {
            setEditingRules(false);
            // A threshold just changed moves the colours and the ticks.
            setRulesVersion((v) => v + 1);
          }}
        />
      ) : null}

      {editingMetrics ? (
        <MetricEditor
          env={env}
          onClose={() => setEditingMetrics(false)}
          onSaved={() => setMetricsVersion((v) => v + 1)}
        />
      ) : null}
    </div>
  );
}
