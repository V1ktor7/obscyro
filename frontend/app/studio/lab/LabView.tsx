"use client";

/**
 * Simulation studio (Model Lab) — one context, four tabs.
 *
 * Context = entity (object type) + one or more data fluxes (channels). The
 * causality engine scans the signals those produce and saves directed lagged
 * influences; training pre-selects features from that causality (manual adds
 * allowed); the compare tab charts reality vs the model's prediction vs an
 * event-injected simulation, all through /v1/ontology/:env/lab/*.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AlertTriangle,
  ArrowRight,
  Brain,
  Check,
  ChartLine,
  GraduationCap,
  Loader2,
  Play,
  Plus,
  Trash2,
  X,
  Zap,
} from "lucide-react";

import { cn } from "@/lib/cn";
import { listEnvTypes, type EnvObjectType } from "@/lib/platform-api";
import { listChannels, type DataChannel } from "../channels-api";
import { numericColumns, parseCsvRows } from "../csv-parse";
import {
  deleteLabModel,
  forecastLabModel,
  listCausality,
  listLabModels,
  listLabSignals,
  scanCausality,
  trainLabModel,
  type CausalityEdge,
  type ForecastResult,
  type LabModel,
  type LabSignal,
} from "../lab-api";
import { useStudio } from "../StudioShell";

type Tab = "causality" | "train" | "compare";

const FIELD =
  "rounded border border-[#d3d8de] bg-[#f6f7f9] px-2 py-1 text-xs text-[#1c2127] focus:border-[#2d72d2] focus:outline-none";
const LABEL = "mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-[#8f99a8]";
const BTN_PRIMARY =
  "flex items-center gap-1 rounded bg-[#2d72d2] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#215db0] disabled:bg-[#c5cbd3]";
const BTN_SECONDARY =
  "flex items-center gap-1 rounded border border-[#d3d8de] bg-white px-2.5 py-1.5 text-xs text-[#404854] hover:border-[#2d72d2]";

export default function LabView() {
  const { hasKey, selectedEnv } = useStudio();
  const env = selectedEnv;

  const [tab, setTab] = useState<Tab>("causality");
  const [error, setError] = useState<string | null>(null);

  // Context
  const [types, setTypes] = useState<EnvObjectType[]>([]);
  const [channels, setChannels] = useState<DataChannel[]>([]);
  const [entity, setEntity] = useState<string | null>(null);
  const [fluxes, setFluxes] = useState<Set<string>>(new Set());
  const [signals, setSignals] = useState<LabSignal[]>([]);

  // Causality
  const [edges, setEdges] = useState<CausalityEdge[]>([]);
  const [scanWindow, setScanWindow] = useState(336);
  const [scanning, setScanning] = useState(false);
  const [scanInfo, setScanInfo] = useState<string | null>(null);

  // Models
  const [models, setModels] = useState<LabModel[]>([]);

  const labelOf = useMemo(() => {
    const m = new Map(signals.map((s) => [s.signal, s.label]));
    return (signal: string) => m.get(signal) ?? signal;
  }, [signals]);

  const loadContext = useCallback(async () => {
    if (!env) {
      setTypes([]);
      setChannels([]);
      setSignals([]);
      setEdges([]);
      setModels([]);
      return;
    }
    try {
      const [{ types: t }, ch, { signals: sig }, { edges: e }, { models: m }] =
        await Promise.all([
          listEnvTypes(env),
          listChannels(env).catch(() => ({ channels: [] as DataChannel[] })),
          listLabSignals(env),
          listCausality(env),
          listLabModels(env),
        ]);
      setTypes(t);
      setChannels(ch.channels);
      setSignals(sig);
      setEdges(e);
      setModels(m);
      setEntity((cur) => cur ?? t[0]?.name ?? null);
      setFluxes((cur) => (cur.size > 0 ? cur : new Set(ch.channels.map((c) => c.slug))));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [env]);

  useEffect(() => {
    setError(null);
    void loadContext();
  }, [loadContext]);

  // Signals in the current context: the entity's signals + selected fluxes'.
  const contextSignals = useMemo(
    () =>
      signals.filter(
        (s) =>
          (s.kind !== "channel" && s.entity === entity) ||
          (s.kind === "channel" && fluxes.has(s.entity)),
      ),
    [signals, entity, fluxes],
  );

  async function handleScan() {
    if (!env || scanning) return;
    setScanning(true);
    setError(null);
    try {
      const result = await scanCausality(env, { windowHours: scanWindow });
      setEdges(result.edges);
      setScanInfo(
        `${result.edges.length} influences found across ${result.signalCount} active signals (${Math.round(result.windowHours / 24)} days).`,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setScanning(false);
    }
  }

  const refreshModels = useCallback(async () => {
    if (!env) return;
    const { models: m } = await listLabModels(env).catch(() => ({ models: [] as LabModel[] }));
    setModels(m);
  }, [env]);

  if (!hasKey) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <p className="max-w-sm text-center text-sm text-gray-500">
          Sign in and create an API key to use the simulation lab.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#f6f7f9]">
      {/* Top bar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-[#d3d8de] bg-white px-4 py-2">
        <span className="flex h-6 w-6 items-center justify-center rounded bg-[#f2ebfb] text-[#6b3fa0]">
          <Brain className="h-3.5 w-3.5" />
        </span>
        <span className="text-[13px] font-semibold text-[#1c2127]">Simulation studio</span>
        <span className="hidden rounded border border-[#d3d8de] px-2 py-0.5 text-[11px] text-[#404854] sm:inline">
          {env ?? "no environment"}
        </span>
        <span className="flex-1" />
        <span className="text-[10.5px] text-[#8f99a8]">
          causality engine · watching {contextSignals.length} signals
        </span>
      </div>

      {/* Context bar: entity + fluxes */}
      <div className="flex shrink-0 flex-wrap items-end gap-3 border-b border-[#d3d8de] bg-white px-4 py-2">
        <label className="block">
          <span className={LABEL}>Entity</span>
          <select
            value={entity ?? ""}
            onChange={(e) => setEntity(e.target.value || null)}
            className={cn(FIELD, "min-w-[160px] font-medium")}
          >
            {types.length === 0 ? <option value="">no object types</option> : null}
            {types.map((t) => (
              <option key={t.id} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <ArrowRight className="mb-1.5 h-3.5 w-3.5 text-[#8f99a8]" />
        <div className="min-w-0">
          <span className={LABEL}>
            Data fluxes · {fluxes.size} selected
          </span>
          <div className="flex flex-wrap gap-1.5">
            {channels.length === 0 ? (
              <span className="text-[11px] text-[#8f99a8]">
                no data channels yet — create them in Ontology Parser
              </span>
            ) : (
              channels.map((c) => {
                const on = fluxes.has(c.slug);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() =>
                      setFluxes((cur) => {
                        const next = new Set(cur);
                        if (next.has(c.slug)) next.delete(c.slug);
                        else next.add(c.slug);
                        return next;
                      })
                    }
                    className={cn(
                      "flex items-center gap-1 rounded px-2 py-0.5 text-[11px]",
                      on
                        ? "bg-[#e7f2fd] font-medium text-[#215db0]"
                        : "border border-dashed border-[#c5cbd3] text-[#8f99a8] hover:text-[#404854]",
                    )}
                  >
                    {on ? <Check className="h-2.5 w-2.5" /> : <Plus className="h-2.5 w-2.5" />}
                    {c.name}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex shrink-0 gap-1 border-b border-[#d3d8de] bg-white px-4 py-1.5">
        {(
          [
            ["causality", "Causality", Brain],
            ["train", "Train", GraduationCap],
            ["compare", "Simulate + predict vs reality", ChartLine],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "flex items-center gap-1.5 rounded px-3 py-1 text-xs",
              tab === key
                ? "bg-[#e7f2fd] font-medium text-[#215db0]"
                : "text-[#5f6b7c] hover:bg-[#f6f7f9]",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="flex items-center gap-2 border-b border-rose-200 bg-rose-50 px-4 py-1.5 text-[11px] text-rose-700">
          <span className="min-w-0 flex-1 truncate">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "causality" ? (
          <CausalityTab
            edges={edges}
            labelOf={labelOf}
            scanWindow={scanWindow}
            scanning={scanning}
            scanInfo={scanInfo}
            onScanWindow={setScanWindow}
            onScan={() => void handleScan()}
          />
        ) : tab === "train" ? (
          <TrainTab
            env={env}
            entity={entity}
            contextSignals={contextSignals}
            allSignals={signals}
            edges={edges}
            models={models}
            labelOf={labelOf}
            onTrained={() => void refreshModels()}
            onDeleted={() => void refreshModels()}
            onError={setError}
          />
        ) : (
          <CompareTab env={env} models={models} labelOf={labelOf} onError={setError} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Causality tab
// ---------------------------------------------------------------------------

function CausalityTab({
  edges,
  labelOf,
  scanWindow,
  scanning,
  scanInfo,
  onScanWindow,
  onScan,
}: {
  edges: CausalityEdge[];
  labelOf: (s: string) => string;
  scanWindow: number;
  scanning: boolean;
  scanInfo: string | null;
  onScanWindow: (h: number) => void;
  onScan: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className={LABEL}>Window</span>
          <select
            value={scanWindow}
            onChange={(e) => onScanWindow(Number(e.target.value))}
            className={FIELD}
          >
            <option value={168}>7 days</option>
            <option value={336}>14 days</option>
            <option value={720}>30 days</option>
          </select>
        </label>
        <button type="button" disabled={scanning} onClick={onScan} className={BTN_PRIMARY}>
          {scanning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
          Scan for influences
        </button>
        <span className="pb-1.5 text-[11px] text-[#8f99a8]">
          {scanInfo ??
            (edges.length > 0
              ? `${edges.length} saved influences · last scan ${new Date(edges[0].computedAt).toLocaleString()}`
              : "no influences discovered yet — run a scan")}
        </span>
      </div>

      {edges.length > 0 ? <InfluenceGraph edges={edges.slice(0, 12)} labelOf={labelOf} /> : null}

      <div className="overflow-hidden rounded-md border border-[#d3d8de] bg-white">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-[#8f99a8]">
              <th className="border-b border-[#d3d8de] px-3 py-2 font-medium">Influence</th>
              <th className="border-b border-[#d3d8de] px-3 py-2 font-medium">Lag</th>
              <th className="border-b border-[#d3d8de] px-3 py-2 font-medium">Strength</th>
              <th className="border-b border-[#d3d8de] px-3 py-2 font-medium">Confidence</th>
              <th className="border-b border-[#d3d8de] px-3 py-2 font-medium">Samples</th>
            </tr>
          </thead>
          <tbody>
            {edges.map((e) => (
              <tr key={`${e.fromSignal}->${e.toSignal}`} className="text-[#404854]">
                <td className="border-b border-[#e5e8eb] px-3 py-1.5 font-medium text-[#1c2127]">
                  {labelOf(e.fromSignal)} <ArrowRight className="inline h-3 w-3 text-[#8f99a8]" />{" "}
                  {labelOf(e.toSignal)}
                </td>
                <td className="border-b border-[#e5e8eb] px-3 py-1.5">+{e.lagHours} h</td>
                <td
                  className={cn(
                    "border-b border-[#e5e8eb] px-3 py-1.5 font-medium",
                    e.strength >= 0.7 ? "text-rose-600" : "text-[#404854]",
                  )}
                >
                  {e.strength.toFixed(2)}
                </td>
                <td className="border-b border-[#e5e8eb] px-3 py-1.5">
                  {Math.round(e.confidence * 100)}%
                </td>
                <td className="border-b border-[#e5e8eb] px-3 py-1.5 text-[#8f99a8]">
                  {e.sampleCount}
                </td>
              </tr>
            ))}
            {edges.length === 0 ? (
              <tr>
                <td className="px-3 py-2 text-[#8f99a8]" colSpan={5}>
                  Influences discovered by the scan are saved here automatically. They require
                  signals with real variation — feed data through your channels first.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InfluenceGraph({
  edges,
  labelOf,
}: {
  edges: CausalityEdge[];
  labelOf: (s: string) => string;
}) {
  const nodes = useMemo(() => {
    const set = new Set<string>();
    for (const e of edges) {
      set.add(e.fromSignal);
      set.add(e.toSignal);
    }
    return Array.from(set).slice(0, 8);
  }, [edges]);

  const pos = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    const cx = 320;
    const cy = 90;
    nodes.forEach((n, i) => {
      const a = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
      m.set(n, { x: cx + Math.cos(a) * 240, y: cy + Math.sin(a) * 62 });
    });
    return m;
  }, [nodes]);

  return (
    <div className="rounded-md border border-[#d3d8de] bg-white p-3">
      <svg viewBox="0 0 640 180" className="w-full" role="img" aria-label="Influence graph">
        <defs>
          <marker
            id="lab-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="#8f99a8" />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const a = pos.get(e.fromSignal);
          const b = pos.get(e.toSignal);
          if (!a || !b) return null;
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={e.strength >= 0.7 ? "#d33d3d" : "#2d72d2"}
              strokeWidth={0.5 + e.strength * 2.5}
              strokeOpacity={0.55}
              markerEnd="url(#lab-arrow)"
            />
          );
        })}
        {nodes.map((n) => {
          const p = pos.get(n)!;
          const label = labelOf(n);
          const w = Math.min(Math.max(label.length * 5.4 + 12, 60), 170);
          return (
            <g key={n}>
              <rect
                x={p.x - w / 2}
                y={p.y - 11}
                width={w}
                height={22}
                rx={5}
                fill="#e7f2fd"
                stroke="#215db0"
                strokeWidth="0.75"
              />
              <text
                x={p.x}
                y={p.y + 3.5}
                textAnchor="middle"
                fontSize="9.5"
                fill="#215db0"
              >
                {label.length > 30 ? `${label.slice(0, 29)}…` : label}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-1 text-[10px] text-[#8f99a8]">
        edge width = influence strength · red = strong (≥ 0.7) · direction follows time
        precedence
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Train tab
// ---------------------------------------------------------------------------

function TrainTab({
  env,
  entity,
  contextSignals,
  allSignals,
  edges,
  models,
  labelOf,
  onTrained,
  onDeleted,
  onError,
}: {
  env: string | null;
  entity: string | null;
  contextSignals: LabSignal[];
  allSignals: LabSignal[];
  edges: CausalityEdge[];
  models: LabModel[];
  labelOf: (s: string) => string;
  onTrained: () => void;
  onDeleted: () => void;
  onError: (msg: string) => void;
}) {
  const entitySignals = useMemo(
    () => contextSignals.filter((s) => s.kind !== "channel"),
    [contextSignals],
  );
  const [name, setName] = useState("");
  const [target, setTarget] = useState<string>("");
  const [selected, setSelected] = useState<Map<string, number>>(new Map());
  const [manualSignal, setManualSignal] = useState("");
  const [manualLag, setManualLag] = useState(1);
  const [horizon, setHorizon] = useState(48);
  const [window_, setWindow_] = useState(336);
  const [training, setTraining] = useState(false);
  const [lastTrained, setLastTrained] = useState<LabModel | null>(null);

  // CSV training source
  const [mode, setMode] = useState<"signals" | "csv">("signals");
  const [csvName, setCsvName] = useState("");
  const [csvCols, setCsvCols] = useState<Record<string, number[]> | null>(null);
  const [csvTarget, setCsvTarget] = useState("");
  const [csvFeatures, setCsvFeatures] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  function readCsvFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCsvRows(String(reader.result ?? ""));
      const cols = numericColumns(rows);
      const names = Object.keys(cols);
      if (names.length === 0) {
        onError("No numeric columns found in that file — the CSV needs a header row and numeric values.");
        return;
      }
      setCsvName(file.name);
      setCsvCols(cols);
      setCsvTarget(names[0]);
      setCsvFeatures(new Set(names.slice(1)));
      setLastTrained(null);
    };
    reader.readAsText(file);
  }

  useEffect(() => {
    setTarget((cur) =>
      cur && entitySignals.some((s) => s.signal === cur)
        ? cur
        : entitySignals[0]?.signal ?? "",
    );
  }, [entitySignals]);

  // Causality recommendations for the chosen target.
  const recommended = useMemo(
    () =>
      edges
        .filter((e) => e.toSignal === target && e.fromSignal !== target)
        .sort((a, b) => b.strength - a.strength)
        .slice(0, 8),
    [edges, target],
  );

  // Preselect recommendations whenever the target changes.
  useEffect(() => {
    const next = new Map<string, number>();
    for (const r of recommended.slice(0, 5)) next.set(r.fromSignal, r.lagHours);
    setSelected(next);
    setLastTrained(null);
  }, [target, recommended]);

  function toggleFeature(signal: string, lag: number) {
    setSelected((cur) => {
      const next = new Map(cur);
      if (next.has(signal)) next.delete(signal);
      else next.set(signal, lag);
      return next;
    });
  }

  function addManual() {
    if (!manualSignal || manualSignal === target) return;
    setSelected((cur) => new Map(cur).set(manualSignal, Math.max(1, manualLag)));
    setManualSignal("");
    setManualLag(1);
  }

  async function handleTrain() {
    if (!env || training) return;
    if (!name.trim()) {
      onError("Give the model a name before training.");
      return;
    }
    if (mode === "csv") {
      if (!csvCols || !csvTarget) {
        onError("Import a CSV file and pick a target column first.");
        return;
      }
    } else if (!target) {
      onError("Pick a target signal.");
      return;
    }
    setTraining(true);
    try {
      const model = await trainLabModel(
        env,
        mode === "csv"
          ? {
              name: name.trim(),
              targetSignal: csvTarget,
              features: Array.from(csvFeatures, (signal) => ({ signal, lag: 1 })),
              horizonHours: horizon,
              dataset: csvCols!,
            }
          : {
              name: name.trim(),
              targetSignal: target,
              features: Array.from(selected, ([signal, lag]) => ({ signal, lag })),
              horizonHours: horizon,
              windowHours: window_,
            },
      );
      setLastTrained(model);
      onTrained();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setTraining(false);
    }
  }

  const manualOptions = allSignals.filter(
    (s) => s.signal !== target && !selected.has(s.signal),
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-[#d3d8de] bg-white p-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <label className="block sm:col-span-2">
            <span className={LABEL}>Model name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`e.g. ${entity ?? "Entity"} occupancy v1`}
              className={cn(FIELD, "w-full")}
            />
          </label>
          <label className="block">
            <span className={LABEL}>Horizon</span>
            <select
              value={horizon}
              onChange={(e) => setHorizon(Number(e.target.value))}
              className={cn(FIELD, "w-full")}
            >
              <option value={24}>24 h</option>
              <option value={48}>48 h</option>
              <option value={72}>72 h</option>
              <option value={168}>7 days</option>
            </select>
          </label>
          <label className="block">
            <span className={LABEL}>Training window</span>
            <select
              value={window_}
              onChange={(e) => setWindow_(Number(e.target.value))}
              className={cn(FIELD, "w-full")}
            >
              <option value={168}>7 days</option>
              <option value={336}>14 days</option>
              <option value={720}>30 days</option>
            </select>
          </label>
        </div>

        <div className="mt-2 flex items-center gap-1">
          <span className={cn(LABEL, "mb-0 mr-1")}>Training source</span>
          {(
            [
              ["signals", "Live signals"],
              ["csv", "CSV file"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setLastTrained(null);
              }}
              className={cn(
                "rounded px-2 py-0.5 text-[11px]",
                mode === m
                  ? "bg-[#e7f2fd] font-medium text-[#215db0]"
                  : "border border-[#d3d8de] text-[#8f99a8] hover:text-[#404854]",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "signals" ? (
        <>
        <label className="mt-2 block">
          <span className={LABEL}>Target (from {entity ?? "entity"})</span>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className={cn(FIELD, "w-full font-medium sm:w-1/2")}
          >
            {entitySignals.length === 0 ? (
              <option value="">no signals for this entity</option>
            ) : null}
            {entitySignals.map((s) => (
              <option key={s.signal} value={s.signal}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <p className={cn(LABEL, "mt-3")}>
          <Brain className="mr-1 inline h-3 w-3 align-[-2px]" />
          Recommended features — from causality
        </p>
        <div className="flex flex-wrap gap-1.5">
          {recommended.length === 0 ? (
            <span className="text-[11px] text-[#8f99a8]">
              no causality edges point at this target yet — run a scan, or add features
              manually below
            </span>
          ) : (
            recommended.map((r) => {
              const on = selected.has(r.fromSignal);
              return (
                <button
                  key={r.fromSignal}
                  type="button"
                  onClick={() => toggleFeature(r.fromSignal, r.lagHours)}
                  className={cn(
                    "flex items-center gap-1 rounded px-2 py-0.5 text-[11px]",
                    on
                      ? "bg-emerald-50 font-medium text-emerald-700"
                      : "border border-[#d3d8de] text-[#8f99a8] hover:text-[#404854]",
                  )}
                >
                  {on ? <Check className="h-2.5 w-2.5" /> : <Plus className="h-2.5 w-2.5" />}
                  {labelOf(r.fromSignal)} · {r.strength.toFixed(2)} · lag {r.lagHours}h
                </button>
              );
            })
          )}
        </div>

        <p className={cn(LABEL, "mt-3")}>Add features manually</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            value={manualSignal}
            onChange={(e) => setManualSignal(e.target.value)}
            className={cn(FIELD, "max-w-xs")}
          >
            <option value="">choose a signal…</option>
            {manualOptions.map((s) => (
              <option key={s.signal} value={s.signal}>
                {s.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-[11px] text-[#8f99a8]">
            lag
            <input
              type="number"
              min={1}
              max={48}
              value={manualLag}
              onChange={(e) => setManualLag(Number(e.target.value))}
              className={cn(FIELD, "w-14")}
            />
            h
          </label>
          <button
            type="button"
            disabled={!manualSignal}
            onClick={addManual}
            className={BTN_SECONDARY}
          >
            <Plus className="h-3 w-3" />
            Add feature
          </button>
        </div>

        {selected.size > 0 ? (
          <>
            <p className={cn(LABEL, "mt-3")}>Selected features · {selected.size}</p>
            <div className="flex flex-wrap gap-1.5">
              {Array.from(selected, ([signal, lag]) => (
                <span
                  key={signal}
                  className="flex items-center gap-1 rounded bg-[#e7f2fd] px-2 py-0.5 text-[11px] font-medium text-[#215db0]"
                >
                  {labelOf(signal)} · lag {lag}h
                  <button
                    type="button"
                    onClick={() => toggleFeature(signal, lag)}
                    aria-label={`Remove ${signal}`}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
            </div>
          </>
        ) : null}
        </>
        ) : (
        <>
        <p className={cn(LABEL, "mt-3")}>Training file</p>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) readCsvFile(file);
          }}
          onClick={() => fileRef.current?.click()}
          className={cn(
            "flex cursor-pointer flex-col items-center gap-1 rounded-md border border-dashed px-4 py-6 text-center transition-colors",
            dragOver
              ? "border-[#2d72d2] bg-[#e7f2fd]"
              : "border-[#c5cbd3] bg-[#f6f7f9] hover:border-[#8f99a8]",
          )}
        >
          <span className="text-xs font-medium text-[#1c2127]">
            {csvName || "Drop a CSV here, or click to browse"}
          </span>
          <span className="text-[10px] text-[#8f99a8]">
            header row = column names · rows ordered oldest → newest · numeric columns become
            signals
          </span>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) readCsvFile(file);
              e.target.value = "";
            }}
          />
        </div>
        {csvCols ? (
          <>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="block">
                <span className={LABEL}>Target column</span>
                <select
                  value={csvTarget}
                  onChange={(e) => {
                    const next = e.target.value;
                    setCsvTarget(next);
                    setCsvFeatures((cur) => {
                      const s = new Set(cur);
                      s.delete(next);
                      return s;
                    });
                  }}
                  className={cn(FIELD, "min-w-[160px] font-medium")}
                >
                  {Object.keys(csvCols).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <span className="pb-1 text-[11px] text-[#8f99a8]">
                {csvCols[csvTarget]?.length.toLocaleString() ?? 0} rows ·{" "}
                {Object.keys(csvCols).length} numeric columns
              </span>
            </div>
            <p className={cn(LABEL, "mt-2")}>Feature columns · {csvFeatures.size} selected</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(csvCols)
                .filter((c) => c !== csvTarget)
                .map((c) => {
                  const on = csvFeatures.has(c);
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() =>
                        setCsvFeatures((cur) => {
                          const s = new Set(cur);
                          if (s.has(c)) s.delete(c);
                          else s.add(c);
                          return s;
                        })
                      }
                      className={cn(
                        "flex items-center gap-1 rounded px-2 py-0.5 text-[11px]",
                        on
                          ? "bg-emerald-50 font-medium text-emerald-700"
                          : "border border-[#d3d8de] text-[#8f99a8] hover:text-[#404854]",
                      )}
                    >
                      {on ? <Check className="h-2.5 w-2.5" /> : <Plus className="h-2.5 w-2.5" />}
                      {c}
                    </button>
                  );
                })}
            </div>
          </>
        ) : null}
        </>
        )}

        <div className="mt-3 flex items-center gap-2">
          <span className="text-[10.5px] text-[#8f99a8]">
            one-step ridge ARX · backtested on the most recent 20% of the window
          </span>
          <span className="ml-auto" />
          <button
            type="button"
            disabled={training || !env}
            onClick={() => void handleTrain()}
            className={BTN_PRIMARY}
          >
            {training ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            Train model
          </button>
        </div>

        {lastTrained ? (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-[#e5e8eb] pt-2">
            <MetricPill label="Model" value={`${lastTrained.name} ${lastTrained.version}`} />
            <MetricPill label="Backtest MAE" value={lastTrained.metrics.mae.toFixed(3)} />
            <MetricPill
              label="MAPE"
              value={lastTrained.metrics.mape === null ? "—" : `${lastTrained.metrics.mape}%`}
            />
            <MetricPill
              label="vs naive baseline"
              value={`${lastTrained.metrics.improvement >= 0 ? "−" : "+"}${Math.abs(Math.round(lastTrained.metrics.improvement * 100))}% error`}
              good={lastTrained.metrics.improvement > 0}
              bad={lastTrained.metrics.improvement < 0}
            />
            <MetricPill label="Samples" value={String(lastTrained.metrics.samples)} />
          </div>
        ) : null}
      </div>

      {/* Saved models */}
      <div className="overflow-hidden rounded-md border border-[#d3d8de] bg-white">
        <div className="flex items-center gap-2 border-b border-[#d3d8de] px-3 py-2">
          <span className="text-xs font-semibold text-[#1c2127]">Saved models</span>
          <span className="rounded bg-[#eef1f4] px-1.5 text-[10px] text-[#5f6b7c]">
            {models.length}
          </span>
        </div>
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-[#8f99a8]">
              <th className="border-b border-[#d3d8de] px-3 py-1.5 font-medium">Name</th>
              <th className="border-b border-[#d3d8de] px-3 py-1.5 font-medium">Target</th>
              <th className="border-b border-[#d3d8de] px-3 py-1.5 font-medium">Features</th>
              <th className="border-b border-[#d3d8de] px-3 py-1.5 font-medium">MAE</th>
              <th className="border-b border-[#d3d8de] px-3 py-1.5 font-medium">vs baseline</th>
              <th className="border-b border-[#d3d8de] px-3 py-1.5 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.id} className="text-[#404854]">
                <td className="border-b border-[#e5e8eb] px-3 py-1.5 font-medium text-[#1c2127]">
                  {m.name}{" "}
                  <span className="font-normal text-[#8f99a8]">
                    {m.version}
                    {m.isActive ? " · active" : ""}
                  </span>
                </td>
                <td className="border-b border-[#e5e8eb] px-3 py-1.5">
                  {labelOf(m.targetSignal)}
                </td>
                <td className="border-b border-[#e5e8eb] px-3 py-1.5 text-[#8f99a8]">
                  {m.features.length}
                </td>
                <td className="border-b border-[#e5e8eb] px-3 py-1.5">
                  {m.metrics.mae.toFixed(3)}
                </td>
                <td
                  className={cn(
                    "border-b border-[#e5e8eb] px-3 py-1.5 font-medium",
                    m.metrics.improvement > 0 ? "text-emerald-700" : "text-amber-700",
                  )}
                >
                  {m.metrics.improvement >= 0 ? "−" : "+"}
                  {Math.abs(Math.round(m.metrics.improvement * 100))}%
                </td>
                <td className="border-b border-[#e5e8eb] px-3 py-1.5 text-right">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!env) return;
                      if (!window.confirm(`Delete model "${m.name} ${m.version}"?`)) return;
                      try {
                        await deleteLabModel(env, m.id);
                        onDeleted();
                      } catch (err) {
                        onError((err as Error).message);
                      }
                    }}
                    className="text-[#8f99a8] hover:text-rose-600"
                    aria-label={`Delete model ${m.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
            {models.length === 0 ? (
              <tr>
                <td className="px-3 py-2 text-[#8f99a8]" colSpan={6}>
                  No models yet — name one above and train it.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MetricPill({
  label,
  value,
  good,
  bad,
}: {
  label: string;
  value: string;
  good?: boolean;
  bad?: boolean;
}) {
  return (
    <span className="rounded bg-[#f6f7f9] px-2 py-1 text-[11px] text-[#404854]">
      <span className="text-[#8f99a8]">{label}: </span>
      <span
        className={cn("font-medium", good ? "text-emerald-700" : bad ? "text-rose-700" : "")}
      >
        {value}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Compare tab — reality vs prediction vs simulation
// ---------------------------------------------------------------------------

function CompareTab({
  env,
  models,
  labelOf,
  onError,
}: {
  env: string | null;
  models: LabModel[];
  labelOf: (s: string) => string;
  onError: (msg: string) => void;
}) {
  const [modelId, setModelId] = useState<string>("");
  const [withEvent, setWithEvent] = useState(false);
  const [eventSignal, setEventSignal] = useState("");
  const [eventDelta, setEventDelta] = useState(10);
  const [eventStart, setEventStart] = useState(2);
  const [eventDuration, setEventDuration] = useState(6);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ForecastResult | null>(null);

  const model = useMemo(() => models.find((m) => m.id === modelId) ?? null, [models, modelId]);

  useEffect(() => {
    setModelId((cur) => (cur && models.some((m) => m.id === cur) ? cur : models[0]?.id ?? ""));
  }, [models]);

  useEffect(() => {
    setEventSignal((cur) =>
      model && model.features.some((f) => f.signal === cur)
        ? cur
        : model?.features[0]?.signal ?? "",
    );
    setResult(null);
  }, [model]);

  async function handleRun() {
    if (!env || !model || running) return;
    setRunning(true);
    try {
      const event =
        withEvent && eventSignal
          ? {
              signal: eventSignal,
              delta: eventDelta,
              startHours: eventStart,
              durationHours: eventDuration,
            }
          : null;
      setResult(await forecastLabModel(env, model.id, event));
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const impact = useMemo(() => {
    if (!result?.simulated) return null;
    let peak = 0;
    for (let i = 0; i < result.simulated.length; i++) {
      const d = result.simulated[i] - result.forecast[i];
      if (Math.abs(d) > Math.abs(peak)) peak = d;
    }
    return Number(peak.toFixed(2));
  }, [result]);

  if (models.length === 0) {
    return (
      <p className="max-w-md text-sm text-[#5f6b7c]">
        Train and save a model first — the comparison runs a saved model against reality and
        an optional injected event.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-[#d3d8de] bg-white p-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className={LABEL}>Model</span>
            <select
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              className={cn(FIELD, "min-w-[200px] font-medium")}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} {m.version} → {labelOf(m.targetSignal)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setWithEvent((v) => !v)}
            className={cn(
              "mb-0.5 flex items-center gap-1 rounded px-2 py-1 text-[11px]",
              withEvent
                ? "bg-rose-50 font-medium text-rose-700"
                : "border border-dashed border-[#c5cbd3] text-[#8f99a8]",
            )}
          >
            <Zap className="h-3 w-3" />
            {withEvent ? "event on" : "inject event"}
          </button>
          {withEvent && model ? (
            <>
              <label className="block">
                <span className={LABEL}>Event signal</span>
                <select
                  value={eventSignal}
                  onChange={(e) => setEventSignal(e.target.value)}
                  className={FIELD}
                >
                  {model.features.map((f) => (
                    <option key={f.signal} value={f.signal}>
                      {labelOf(f.signal)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={LABEL}>Delta /h</span>
                <input
                  type="number"
                  value={eventDelta}
                  onChange={(e) => setEventDelta(Number(e.target.value))}
                  className={cn(FIELD, "w-20")}
                />
              </label>
              <label className="block">
                <span className={LABEL}>Starts in</span>
                <input
                  type="number"
                  min={0}
                  max={168}
                  value={eventStart}
                  onChange={(e) => setEventStart(Number(e.target.value))}
                  className={cn(FIELD, "w-16")}
                />
              </label>
              <label className="block">
                <span className={LABEL}>Duration h</span>
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={eventDuration}
                  onChange={(e) => setEventDuration(Number(e.target.value))}
                  className={cn(FIELD, "w-16")}
                />
              </label>
            </>
          ) : null}
          <span className="ml-auto" />
          <button
            type="button"
            disabled={running || !model}
            onClick={() => void handleRun()}
            className={BTN_PRIMARY}
          >
            {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            Run
          </button>
        </div>
      </div>

      {result ? (
        <div className="rounded-md border border-[#d3d8de] bg-white p-3">
          <CompareChart result={result} />
          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-[#5f6b7c]">
            <span className="flex items-center gap-1.5">
              <span className="h-[3px] w-3 rounded bg-[#1c2127]" /> reality (observed)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-[3px] w-3 rounded bg-[#2d72d2]" /> prediction
            </span>
            {result.simulated ? (
              <span className="flex items-center gap-1.5">
                <span className="h-[3px] w-3 rounded bg-[#d33d3d]" /> simulation (event injected)
              </span>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {model ? (
              <>
                <MetricPill label="Backtest MAE" value={model.metrics.mae.toFixed(3)} />
                <MetricPill
                  label="MAPE"
                  value={model.metrics.mape === null ? "—" : `${model.metrics.mape}%`}
                />
                <MetricPill
                  label="vs baseline"
                  value={`${model.metrics.improvement >= 0 ? "−" : "+"}${Math.abs(Math.round(model.metrics.improvement * 100))}% error`}
                  good={model.metrics.improvement > 0}
                />
              </>
            ) : null}
            {impact !== null ? (
              <MetricPill
                label="Event impact (peak)"
                value={`${impact > 0 ? "+" : ""}${impact}`}
                bad={Math.abs(impact) > 0}
              />
            ) : null}
          </div>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-[11px] text-[#8f99a8]">
          <AlertTriangle className="h-3 w-3" />
          Run the model to chart prediction against reality — left of “now” shows how the
          model would have predicted the recent past.
        </p>
      )}
    </div>
  );
}

function CompareChart({ result }: { result: ForecastResult }) {
  const pastShown = Math.min(result.pastHours.length, 96);
  const observed = result.observed.slice(-pastShown);
  const backtest = result.backtest.slice(-pastShown);
  const { forecast, simulated } = result;
  const total = pastShown + forecast.length;

  const all = [
    ...observed,
    ...forecast,
    ...(simulated ?? []),
    ...backtest.filter((v): v is number => v !== null),
  ];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const pad = (max - min || 1) * 0.1;
  const lo = min - pad;
  const hi = max + pad;

  const W = 640;
  const H = 190;
  const left = 42;
  const bottom = 168;
  const top = 10;
  const x = (i: number) => left + ((W - left - 8) * i) / Math.max(total - 1, 1);
  const y = (v: number) => bottom - ((bottom - top) * (v - lo)) / (hi - lo);

  const line = (values: (number | null)[], offset: number) =>
    values
      .map((v, i) => (v === null ? null : `${x(i + offset).toFixed(1)},${y(v).toFixed(1)}`))
      .filter((p): p is string => p !== null)
      .join(" ");

  const nowX = x(pastShown - 1);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Reality versus prediction versus simulation chart">
      <line x1={left} y1={top} x2={left} y2={bottom} stroke="#c5cbd3" strokeWidth="1" />
      <line x1={left} y1={bottom} x2={W - 8} y2={bottom} stroke="#c5cbd3" strokeWidth="1" />
      <text x={left - 6} y={top + 8} textAnchor="end" fontSize="9" fill="#8f99a8">
        {hi.toFixed(0)}
      </text>
      <text x={left - 6} y={bottom} textAnchor="end" fontSize="9" fill="#8f99a8">
        {lo.toFixed(0)}
      </text>
      <line
        x1={nowX}
        y1={top}
        x2={nowX}
        y2={bottom}
        stroke="#8f99a8"
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      <text x={nowX} y={H - 8} textAnchor="middle" fontSize="9" fill="#8f99a8">
        now
      </text>
      <text x={left} y={H - 8} fontSize="9" fill="#8f99a8">
        −{pastShown} h
      </text>
      <text x={W - 8} y={H - 8} textAnchor="end" fontSize="9" fill="#8f99a8">
        +{forecast.length} h
      </text>
      <polyline points={line(backtest, 0)} fill="none" stroke="#2d72d2" strokeWidth="1.2" strokeDasharray="5 3" strokeOpacity="0.8" />
      <polyline points={line(observed, 0)} fill="none" stroke="#1c2127" strokeWidth="1.8" />
      <polyline points={line(forecast, pastShown)} fill="none" stroke="#2d72d2" strokeWidth="1.6" />
      {simulated ? (
        <polyline points={line(simulated, pastShown)} fill="none" stroke="#d33d3d" strokeWidth="1.6" />
      ) : null}
    </svg>
  );
}
