"use client";

/**
 * Crisis Simulation view — composable crisis stack, hybrid run engine
 * (real clone/inject/run/simulate where supported, labeled client projection
 * elsewhere), live-vs-sim factor lanes, projected alert timeline, results panel.
 */

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/Button";
import {
  fetchTwinTree,
  subscribeTwinStream,
  type TwinTreeSnapshot,
} from "@/lib/platform-api";

import {
  Chip,
  KpiCell,
  MicroLabel,
  ModeToggle,
  PanelHead,
  SEV_HEX,
} from "../command-ui";
import { useStudio } from "../StudioShell";
import CrisisLaneChart, { type LiveTick } from "./CrisisLaneChart";
import {
  CRISES,
  deriveFactors,
  type StackItem,
} from "./crisis-lib";
import {
  backendMappedCrises,
  executeHybridRun,
  type HybridRunOutput,
} from "./crisis-run";

const LIVE_HIST_CAP = 24;

export default function CrisisView() {
  const { hasKey, selectedEnv } = useStudio();
  const env = selectedEnv;

  const [snapshot, setSnapshot] = useState<TwinTreeSnapshot | null>(null);
  const [streamMode, setStreamMode] = useState<"stream" | "poll" | "idle">(
    "idle",
  );
  const [stack, setStack] = useState<StackItem[]>([]);
  const [selectedFactors, setSelectedFactors] = useState<Set<string>>(
    () => new Set(),
  );
  const [laneMode, setLaneMode] = useState<"overlay" | "split">("overlay");
  const [engine, setEngine] = useState<"mechanistic" | "ml">("mechanistic");
  const [horizonH, setHorizonH] = useState(72);
  const [runs, setRuns] = useState(10);
  const [seed, setSeed] = useState("");
  const [running, setRunning] = useState(false);
  const [runOutput, setRunOutput] = useState<HybridRunOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [liveHist, setLiveHist] = useState<Map<string, LiveTick[]>>(
    () => new Map(),
  );
  const tickRef = useRef(0);

  const factors = useMemo(
    () => (snapshot ? deriveFactors(snapshot) : []),
    [snapshot],
  );

  useEffect(() => {
    if (!factors.length) return;
    setSelectedFactors((prev) => {
      if (prev.size) return prev;
      const next = new Set<string>();
      for (const f of factors.slice(0, 4)) next.add(f.id);
      return next;
    });
  }, [factors]);

  const loadTree = useCallback(async () => {
    if (!env) return;
    try {
      const snap = await fetchTwinTree(env);
      setSnapshot(snap);
      setError(null);
    } catch (err) {
      setSnapshot(null);
      setError((err as Error).message);
    }
  }, [env]);

  useEffect(() => {
    if (!env || !hasKey) {
      setSnapshot(null);
      return;
    }
    void loadTree();
  }, [env, hasKey, loadTree]);

  const recordLiveTick = useCallback(
    (snap: TwinTreeSnapshot) => {
      const derived = deriveFactors(snap);
      tickRef.current += 1;
      const t = tickRef.current;
      setLiveHist((prev) => {
        const next = new Map(prev);
        for (const f of derived) {
          const arr = [...(next.get(f.id) ?? []), { t: -t, v: f.base }];
          if (arr.length > LIVE_HIST_CAP) arr.shift();
          next.set(f.id, arr);
        }
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    if (!env || !hasKey) return;
    setStreamMode("idle");
    const unsub = subscribeTwinStream(
      env,
      (snap) => {
        setSnapshot(snap);
        setStreamMode("stream");
        recordLiveTick(snap);
      },
      () => {
        setStreamMode("poll");
        void loadTree();
      },
    );
    const poll = setInterval(() => {
      if (streamMode !== "stream") void loadTree();
    }, 15_000);
    return () => {
      unsub();
      clearInterval(poll);
    };
  }, [env, hasKey, loadTree, recordLiveTick, streamMode]);

  function addToStack(cid: string) {
    setStack((s) => [...s, { cid, intensity: 1, onsetH: 0 }]);
  }

  function updateStackItem(idx: number, patch: Partial<StackItem>) {
    setStack((s) => s.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
  }

  function removeStackItem(idx: number) {
    setStack((s) => s.filter((_, i) => i !== idx));
  }

  function toggleFactor(id: string) {
    setSelectedFactors((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleRun() {
    if (!env || !snapshot) return;
    setRunning(true);
    setError(null);
    try {
      const out = await executeHybridRun({
        env,
        snapshot,
        factors,
        selectedFactorIds: selectedFactors,
        stack,
        horizonH,
        runs,
        seed,
        engine,
      });
      setRunOutput(out);
      if (out.error) setError(out.error);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const projection = runOutput?.projection ?? null;
  const backend = runOutput?.backend ?? null;
  const mappedCrises = backendMappedCrises(stack);

  const baselineChip = snapshot
    ? `${snapshot.computedAt.slice(11, 19)} · ${snapshot.nodes.reduce((a, n) => a + n.metrics.linkedInstanceCount, 0)} linked`
    : "—";

  const visibleFactors = factors.filter((f) => selectedFactors.has(f.id));

  return (
    <div className="flex h-[calc(100vh-7.5rem)] min-h-[520px] flex-col gap-2">
      {/* Run bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
        <Chip>Baseline · {baselineChip}</Chip>
        <ModeToggle
          value={laneMode}
          onChange={setLaneMode}
          options={[
            { value: "overlay", label: "Overlay" },
            { value: "split", label: "Split" },
          ]}
        />
        <label className="flex items-center gap-1 font-mono text-[10px] text-gray-500">
          Horizon
          <input
            type="number"
            min={12}
            max={336}
            value={horizonH}
            onChange={(e) => setHorizonH(Number(e.target.value))}
            className="w-14 rounded border border-gray-200 px-1 py-0.5 text-gray-800"
          />
          h
        </label>
        <label className="flex items-center gap-1 font-mono text-[10px] text-gray-500">
          Runs
          <input
            type="number"
            min={1}
            max={100}
            value={runs}
            onChange={(e) => setRuns(Number(e.target.value))}
            className="w-12 rounded border border-gray-200 px-1 py-0.5 text-gray-800"
          />
        </label>
        <label className="flex items-center gap-1 font-mono text-[10px] text-gray-500">
          Seed
          <input
            type="text"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            placeholder="auto"
            className="w-16 rounded border border-gray-200 px-1 py-0.5 text-gray-800"
          />
        </label>
        <ModeToggle
          value={engine}
          onChange={setEngine}
          options={[
            { value: "mechanistic", label: "Mechanistic" },
            { value: "ml", label: "ML" },
          ]}
        />
        <Button size="sm" onClick={() => void handleRun()} disabled={running || !stack.length}>
          {running ? "Running…" : "Run"}
        </Button>
        <Link
          href="/studio/command"
          className="ml-auto font-mono text-[10px] text-indigo-600 hover:underline"
        >
          ← Live Twin
        </Link>
      </div>

      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-800">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-2">
        {/* Left rail */}
        <aside className="flex w-56 shrink-0 flex-col gap-2 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2">
          <PanelHead title={<MicroLabel>Crisis library</MicroLabel>} />
          <div className="space-y-1">
            {CRISES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => addToStack(c.id)}
                className="flex w-full items-start gap-2 rounded border border-gray-100 px-2 py-1.5 text-left hover:border-indigo-200 hover:bg-indigo-50/50"
              >
                <span className="text-sm">{c.icon}</span>
                <div className="min-w-0">
                  <div className="truncate text-[11px] font-medium text-gray-800">
                    {c.name}
                  </div>
                  <div className="line-clamp-2 text-[9px] text-gray-400">
                    {c.description}
                  </div>
                  {c.backendKind && (
                    <span className="mt-0.5 inline-block rounded bg-emerald-50 px-1 font-mono text-[8px] text-emerald-700">
                      backend
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>

          <PanelHead title={<MicroLabel>Active stack</MicroLabel>} />
          {stack.length === 0 ? (
            <p className="text-[10px] text-gray-400">Add crises from library</p>
          ) : (
            <div className="space-y-2">
              {stack.map((s, idx) => {
                const c = CRISES.find((x) => x.id === s.cid);
                return (
                  <div
                    key={`${s.cid}-${idx}`}
                    className="rounded border border-gray-100 p-2 text-[10px]"
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span>
                        {c?.icon} {c?.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeStackItem(idx)}
                        className="text-gray-400 hover:text-rose-500"
                      >
                        ×
                      </button>
                    </div>
                    <label className="flex items-center gap-1 text-gray-500">
                      Intensity
                      <input
                        type="range"
                        min={0.25}
                        max={2}
                        step={0.25}
                        value={s.intensity}
                        onChange={(e) =>
                          updateStackItem(idx, { intensity: Number(e.target.value) })
                        }
                        className="flex-1"
                      />
                      <span className="w-6 tabular-nums">{s.intensity}×</span>
                    </label>
                    <label className="mt-1 flex items-center gap-1 text-gray-500">
                      Onset T+
                      <input
                        type="number"
                        min={0}
                        max={horizonH}
                        value={s.onsetH}
                        onChange={(e) =>
                          updateStackItem(idx, { onsetH: Number(e.target.value) })
                        }
                        className="w-12 rounded border border-gray-200 px-1"
                      />
                      h
                    </label>
                  </div>
                );
              })}
            </div>
          )}

          <PanelHead title={<MicroLabel>Watch factors</MicroLabel>} />
          <div className="space-y-1">
            {factors.map((f) => (
              <label
                key={f.id}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-gray-50"
              >
                <input
                  type="checkbox"
                  checked={selectedFactors.has(f.id)}
                  onChange={() => toggleFactor(f.id)}
                />
                <span className="truncate text-[10px] text-gray-700">
                  {f.scope} · {f.name}
                </span>
                <span
                  className="ml-auto font-mono text-[9px] tabular-nums"
                  style={{ color: f.color }}
                >
                  {f.fmt(f.base)}
                </span>
              </label>
            ))}
          </div>
        </aside>

        {/* Center lanes + timeline */}
        <main className="flex min-w-0 flex-1 flex-col gap-2 overflow-y-auto">
          {visibleFactors.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-gray-200 text-sm text-gray-400">
              Select watch factors to render lanes
            </div>
          ) : (
            visibleFactors.map((f) => {
              const sim = projection?.proj[f.id];
              const base = projection?.baseline[f.id];
              const isBackend =
                backend &&
                mappedCrises.length > 0 &&
                (f.id === "hosp-occ" || f.id.startsWith("ward-") || f.id === "iso-demand");
              return (
                <CrisisLaneChart
                  key={f.id}
                  factor={f}
                  liveHistory={liveHist.get(f.id) ?? [{ t: 0, v: f.base }]}
                  simSeries={sim}
                  baselineSeries={base}
                  stack={stack}
                  horizonH={horizonH}
                  mode={laneMode}
                  dataSource={
                    sim
                      ? isBackend
                        ? "backend"
                        : "projection"
                      : null
                  }
                />
              );
            })
          )}

          {/* Alert timeline ribbon */}
          {projection && projection.events.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white p-2">
              <PanelHead title={<MicroLabel>Projected alert timeline</MicroLabel>} />
              <div className="relative mt-2 h-10">
                <svg viewBox="0 0 600 40" className="h-10 w-full">
                  <line x1={20} y1={20} x2={580} y2={20} stroke="#e2e8f0" strokeWidth={1} />
                  {projection.events.map((evt, i) => {
                    const x = 20 + (evt.t / Math.max(horizonH, 1)) * 560;
                    const color =
                      evt.severity === "critical"
                        ? SEV_HEX.critical
                        : evt.severity === "warn"
                          ? SEV_HEX.warn
                          : SEV_HEX.info;
                    return (
                      <g key={i}>
                        <circle cx={x} cy={20} r={4} fill={color} />
                        <title>{evt.message}</title>
                      </g>
                    );
                  })}
                </svg>
              </div>
              <div className="mt-1 flex flex-wrap gap-2">
                {projection.events.slice(0, 6).map((evt, i) => (
                  <span
                    key={i}
                    className="rounded bg-gray-50 px-1.5 py-0.5 font-mono text-[9px] text-gray-600"
                  >
                    T+{evt.t}h · {evt.message}
                    {evt.source === "projection" && " · projection"}
                  </span>
                ))}
              </div>
            </div>
          )}
        </main>

        {/* Results panel */}
        <aside className="flex w-52 shrink-0 flex-col gap-2 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2">
          <PanelHead title={<MicroLabel>Results</MicroLabel>} />
          {!runOutput ? (
            <p className="text-[10px] text-gray-400">Run a scenario to see outcomes</p>
          ) : (
            <>
              <div className="space-y-1 text-[10px]">
                <MicroLabel>Stack</MicroLabel>
                {stack.map((s, i) => {
                  const c = CRISES.find((x) => x.id === s.cid);
                  return (
                    <div key={i} className="text-gray-700">
                      {c?.icon} {c?.name} · {s.intensity}× · T+{s.onsetH}h
                    </div>
                  );
                })}
              </div>

              {visibleFactors.map((f) => {
                const series = projection?.proj[f.id];
                if (!series?.length) return null;
                const peak = series.reduce((a, b) => (b.v > a.v ? b : a), series[0]!);
                const critCross = series.find((p) =>
                  f.invert ? p.v <= f.crit : p.v >= f.crit,
                );
                return (
                  <div key={f.id} className="border-t border-gray-100 pt-2">
                    <MicroLabel>{f.name}</MicroLabel>
                    <KpiCell label="Peak" value={f.fmt(peak.v)} />
                    <KpiCell
                      label="Δ vs baseline"
                      value={f.fmt(peak.v - f.base)}
                    />
                    <KpiCell
                      label="Time to critical"
                      value={critCross ? `T+${critCross.t}h` : "—"}
                    />
                  </div>
                );
              })}

              {backend && (
                <div className="border-t border-gray-100 pt-2 text-[10px]">
                  <MicroLabel>Engine</MicroLabel>
                  <div className="mt-1 space-y-0.5 text-gray-700">
                    <div>Run {backend.runId.slice(0, 8)}…</div>
                    <div>Seed {backend.seed}</div>
                    <div className="capitalize">{backend.engine}</div>
                    {backend.engine === "ml" && backend.ml && (
                      <>
                        <div>
                          Model {backend.ml.model.type}
                          {backend.ml.model.version
                            ? ` v${backend.ml.model.version}`
                            : ""}
                        </div>
                        {backend.ml.usedFallback && (
                          <Chip className="bg-amber-50 text-amber-800">
                            Mechanistic fallback
                          </Chip>
                        )}
                      </>
                    )}
                    {backend.engine === "mechanistic" && backend.mechanistic && (
                      <div>
                        Peak infected{" "}
                        {backend.mechanistic.summary.peakInfected.toFixed(0)}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {!backend && stack.length > 0 && (
                <Chip className="bg-amber-50 text-amber-800">
                  Client projection only
                </Chip>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
