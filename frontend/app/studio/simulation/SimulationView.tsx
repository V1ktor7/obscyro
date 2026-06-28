"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { listEnvObjects, type EnvInstance } from "@/lib/platform-api";

import { useStudio } from "../StudioShell";
import {
  createScenario,
  getScenarioRun,
  listScenarioRuns,
  runScenario,
  type OutbreakParams,
  type OutbreakSummary,
  type RunResult,
  type SimulationRun,
} from "../sim-api";
import { loadScenarios, saveScenario, type StoredScenario } from "../sim-scenario-store";
import TrajectoryChart from "./TrajectoryChart";

function instanceLabel(inst: EnvInstance): string {
  const p = inst.properties;
  return (
    (p.span as string) ||
    (p.display as string) ||
    (p.label as string) ||
    (p.identifier as string) ||
    (p.snomed_code as string) ||
    inst.id.slice(0, 8)
  );
}

const DEFAULT_PARAMS: OutbreakParams = {
  r0: 2.5,
  incubationDays: 3,
  infectiousDays: 5,
  isolationCapacity: 10,
  runs: 10,
};

export default function SimulationView() {
  const { hasKey, selectedEnv } = useStudio();
  const env = selectedEnv;

  const [scenarios, setScenarios] = useState<StoredScenario[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [runs, setRuns] = useState<SimulationRun[]>([]);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);

  const [params, setParams] = useState<OutbreakParams>({ ...DEFAULT_PARAMS });
  const [seed, setSeed] = useState<string>("");
  const [indexNodeIds, setIndexNodeIds] = useState<string[]>([]);
  const [instances, setInstances] = useState<EnvInstance[]>([]);

  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [loadingRun, setLoadingRun] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!env) {
      setScenarios([]);
      return;
    }
    setScenarios(loadScenarios(env));
  }, [env]);

  useEffect(() => {
    if (!env) {
      setInstances([]);
      return;
    }
    void listEnvObjects(env, { limit: 500 })
      .then(({ objects }) => setInstances(objects))
      .catch(() => setInstances([]));
  }, [env]);

  const loadRuns = useCallback(async (scenarioId: string) => {
    if (!env) return;
    try {
      const { runs: r } = await listScenarioRuns(env, scenarioId);
      setRuns(r);
    } catch {
      setRuns([]);
    }
  }, [env]);

  useEffect(() => {
    if (selectedScenarioId && env) {
      void loadRuns(selectedScenarioId);
    } else {
      setRuns([]);
    }
  }, [selectedScenarioId, env, loadRuns]);

  async function handleCreateScenario(e: React.FormEvent) {
    e.preventDefault();
    if (!env || !newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const created = await createScenario(env, { name: newName.trim(), params });
      const stored: StoredScenario = {
        id: created.id,
        name: created.name,
        createdAt: created.createdAt,
        params,
      };
      saveScenario(env, stored);
      setScenarios(loadScenarios(env));
      setSelectedScenarioId(created.id);
      setNewName("");
      setShowNewForm(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function handleRun() {
    if (!env || !selectedScenarioId) return;
    setRunning(true);
    setError(null);
    try {
      const runParams: OutbreakParams = {
        ...params,
        indexNodeIds: indexNodeIds.length ? indexNodeIds : undefined,
      };
      const body: { params: OutbreakParams; seed?: number } = { params: runParams };
      if (seed.trim()) body.seed = Number(seed);
      const res = await runScenario(env, selectedScenarioId, body);
      setResult(res);
      void loadRuns(selectedScenarioId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  async function handleSelectRun(runId: string) {
    if (!env || !selectedScenarioId) return;
    setLoadingRun(true);
    setError(null);
    try {
      const detail = await getScenarioRun(env, selectedScenarioId, runId);
      if (detail.summary && detail.trajectories) {
        setResult({
          runId: detail.id,
          summary: detail.summary,
          trajectories: detail.trajectories,
        });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingRun(false);
    }
  }

  function toggleIndex(id: string) {
    setIndexNodeIds((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
  }

  if (!hasKey) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <p className="max-w-sm text-center text-sm text-gray-500">
          Sign in and create an API key to run outbreak simulations.
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

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-gray-200 bg-white">
        <div className="border-b border-gray-100 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gray-400">
              Scenarios
            </span>
            <button
              type="button"
              onClick={() => setShowNewForm((v) => !v)}
              className="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-600 hover:border-gray-400"
            >
              + New
            </button>
          </div>
          {showNewForm ? (
            <form onSubmit={handleCreateScenario} className="mb-2 flex flex-col gap-1.5">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Scenario name"
                className="rounded border border-gray-200 px-2 py-1 text-xs focus:border-gray-400 focus:outline-none"
              />
              <Button type="submit" size="sm" disabled={creating || !newName.trim()}>
                {creating ? "Creating…" : "Create"}
              </Button>
            </form>
          ) : null}
          {scenarios.length === 0 ? (
            <p className="text-[11px] text-gray-400">No scenarios yet.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {scenarios.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSelectedScenarioId(s.id);
                    setResult(null);
                  }}
                  className={cn(
                    "rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors",
                    selectedScenarioId === s.id
                      ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                      : "border-gray-200 text-gray-700 hover:border-gray-400 hover:bg-gray-50",
                  )}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedScenarioId && runs.length > 0 ? (
          <div className="p-3">
            <span className="mb-2 block font-mono text-[10px] uppercase tracking-[0.2em] text-gray-400">
              Run history
            </span>
            <div className="flex flex-col gap-1">
              {runs.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  disabled={loadingRun}
                  onClick={() => void handleSelectRun(r.id)}
                  className="rounded border border-gray-200 px-2 py-1 text-left text-[11px] text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  <span className={cn(r.status === "completed" ? "text-emerald-600" : "text-gray-400")}>
                    {r.status}
                  </span>
                  {" · "}
                  seed {r.seed.slice(0, 8)}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </aside>

      <main className="min-h-0 flex-1 overflow-y-auto p-4">
        {!selectedScenarioId ? (
          <p className="text-sm text-gray-400">Select or create a scenario to configure and run.</p>
        ) : (
          <div className="mx-auto max-w-3xl space-y-6">
            {error ? (
              <p className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {error}
              </p>
            ) : null}

            <section>
              <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-gray-400">
                Parameters
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <ParamField label="R₀" value={params.r0} onChange={(v) => setParams((p) => ({ ...p, r0: v }))} />
                <ParamField
                  label="Beta (optional)"
                  value={params.beta}
                  onChange={(v) => setParams((p) => ({ ...p, beta: v }))}
                  hint="Leave blank to derive from R₀"
                />
                <ParamField
                  label="Incubation days"
                  value={params.incubationDays}
                  onChange={(v) => setParams((p) => ({ ...p, incubationDays: v }))}
                  int
                />
                <ParamField
                  label="Infectious days"
                  value={params.infectiousDays}
                  onChange={(v) => setParams((p) => ({ ...p, infectiousDays: v }))}
                  int
                />
                <ParamField
                  label="Isolation capacity"
                  value={params.isolationCapacity}
                  onChange={(v) => setParams((p) => ({ ...p, isolationCapacity: v }))}
                  int
                />
                <ParamField label="Monte Carlo runs" value={params.runs} onChange={(v) => setParams((p) => ({ ...p, runs: v }))} int />
                <div className="col-span-2 sm:col-span-1">
                  <label className="mb-1 block text-[10px] uppercase tracking-wide text-gray-400">
                    Seed (optional)
                  </label>
                  <input
                    type="number"
                    value={seed}
                    onChange={(e) => setSeed(e.target.value)}
                    placeholder="Random"
                    className="w-full rounded border border-gray-200 px-2 py-1 text-xs focus:border-gray-400 focus:outline-none"
                  />
                </div>
              </div>
            </section>

            <section>
              <h2 className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-gray-400">
                Index cases
              </h2>
              <p className="mb-2 text-[11px] text-gray-400">
                Select instances to seed as initially infected. Defaults to first node if none selected.
              </p>
              <div className="max-h-40 overflow-y-auto rounded border border-gray-200 p-2">
                {instances.length === 0 ? (
                  <p className="text-[11px] text-gray-400">No instances in this environment.</p>
                ) : (
                  instances.map((inst) => (
                    <label
                      key={inst.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        checked={indexNodeIds.includes(inst.id)}
                        onChange={() => toggleIndex(inst.id)}
                        className="rounded border-gray-300"
                      />
                      <span className="text-gray-700">{instanceLabel(inst)}</span>
                      <span className="text-gray-400">{inst.typeName}</span>
                    </label>
                  ))
                )}
              </div>
            </section>

            <Button onClick={() => void handleRun()} disabled={running}>
              {running ? "Running…" : "Run simulation"}
            </Button>

            {result ? <ResultsPanel summary={result.summary} trajectories={result.trajectories} /> : null}
          </div>
        )}
      </main>
    </div>
  );
}

function ParamField({
  label,
  value,
  onChange,
  int,
  hint,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  int?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] uppercase tracking-wide text-gray-400">
        {label}
      </label>
      <input
        type="number"
        step={int ? 1 : 0.1}
        value={value ?? ""}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw === "" ? undefined : int ? parseInt(raw, 10) : parseFloat(raw));
        }}
        className="w-full rounded border border-gray-200 px-2 py-1 text-xs focus:border-gray-400 focus:outline-none"
      />
      {hint ? <p className="mt-0.5 text-[10px] text-gray-400">{hint}</p> : null}
    </div>
  );
}

function ResultsPanel({
  summary,
  trajectories,
}: {
  summary: OutbreakSummary;
  trajectories: RunResult["trajectories"];
}) {
  return (
    <section className="space-y-4 border-t border-gray-100 pt-4">
      <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-gray-400">
        Results
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <MetricCard label="Peak infected" value={String(Math.round(summary.peakInfected))} />
        <MetricCard label="Peak isolation" value={String(Math.round(summary.peakIsolationDemand))} />
        <MetricCard label="Attack rate" value={`${(summary.attackRate * 100).toFixed(1)}%`} />
        <MetricCard
          label="Days to contain"
          value={summary.daysToContain != null ? String(Math.round(summary.daysToContain)) : "—"}
        />
        <MetricCard label="HCW infections" value={String(Math.round(summary.hcwInfections))} />
      </div>
      <Card className="p-4">
        <p className="mb-2 text-xs font-medium text-gray-700">Infected trajectory (p50, p5–p95 band)</p>
        <TrajectoryChart
          p5={trajectories.p5}
          p50={trajectories.p50}
          p95={trajectories.p95}
        />
      </Card>
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-3">
      <p className="text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-gray-900">{value}</p>
    </Card>
  );
}
