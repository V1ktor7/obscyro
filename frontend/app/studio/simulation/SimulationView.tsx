"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import {
  cloneTwinUnit,
  fetchTwinTree,
  getScenario,
  getScenarioRun,
  injectScenario,
  listScenarios,
  runMlSimulation,
  runScenario,
  type MlIntervention,
  type MlSimResult,
  type OutbreakParams,
  type RunResult,
  type ScenarioSummary,
  type TwinTreeSnapshot,
} from "@/lib/platform-api";

import { useStudio } from "../StudioShell";
import {
  loadTwinLayout,
  mergeTwinPositions,
} from "../twin-layout-persist";
import TwinCanvas from "../live/TwinCanvas";
import { type ScenarioRunSummary } from "../sim-api";
import AlertTimelinePanel from "./AlertTimelinePanel";
import TrajectoryChart from "./TrajectoryChart";

const DEFAULT_PARAMS: OutbreakParams = {
  r0: 2.5,
  incubationDays: 3,
  infectiousDays: 5,
  isolationCapacity: 10,
  runs: 10,
  horizonDays: 60,
};

type Step = 1 | 2 | 3;

export default function SimulationView() {
  const { hasKey, selectedEnv } = useStudio();
  const env = selectedEnv;

  const [step, setStep] = useState<Step>(1);
  const [tree, setTree] = useState<TwinTreeSnapshot | null>(null);
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(
    () => new Map(),
  );
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [cloneName, setCloneName] = useState("");
  const [cloning, setCloning] = useState(false);

  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [scenarioDetail, setScenarioDetail] = useState<{
    instanceCount: number;
    linkCount: number;
    rootUnitInstanceId: string | null;
    runs: ScenarioRunSummary[];
  } | null>(null);

  const [indexLabel, setIndexLabel] = useState("Index case");
  const [indexIdentifier, setIndexIdentifier] = useState("IDX-001");
  const [indexNodeId, setIndexNodeId] = useState<string | null>(null);
  const [injecting, setInjecting] = useState(false);

  const [params, setParams] = useState<OutbreakParams>({ ...DEFAULT_PARAMS });
  const [seed, setSeed] = useState("");
  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [runMode, setRunMode] = useState<"mechanistic" | "ml">("mechanistic");
  const [mlResult, setMlResult] = useState<MlSimResult | null>(null);
  const [interventionKind, setInterventionKind] =
    useState<MlIntervention["kind"]>("none");
  const [interventionBeds, setInterventionBeds] = useState("10");

  const loadTree = useCallback(async () => {
    if (!env) return;
    try {
      const snap = await fetchTwinTree(env);
      setTree(snap);
      const ids = snap.nodes.map((n) => n.id);
      setPositions(
        mergeTwinPositions(ids, snap.edges, snap.roots, loadTwinLayout(env)),
      );
    } catch {
      setTree(null);
    }
  }, [env]);

  const loadScenariosList = useCallback(async () => {
    if (!env) return;
    try {
      const { scenarios: list } = await listScenarios(env);
      setScenarios(list);
    } catch {
      setScenarios([]);
    }
  }, [env]);

  useEffect(() => {
    if (!env) {
      setTree(null);
      setScenarios([]);
      return;
    }
    void loadTree();
    void loadScenariosList();
  }, [env, loadTree, loadScenariosList]);

  const unitNames = useMemo(() => {
    const m = new Map<string, string>();
    if (tree) {
      for (const n of tree.nodes) m.set(n.id, n.name);
    }
    return m;
  }, [tree]);

  async function handleClone() {
    if (!env || !selectedUnitId || !cloneName.trim()) return;
    setCloning(true);
    setError(null);
    try {
      const { scenarioId: id } = await cloneTwinUnit(
        env,
        selectedUnitId,
        cloneName.trim(),
      );
      setScenarioId(id);
      const detail = await getScenario(env, id);
      setScenarioDetail({
        instanceCount: detail.instanceCount,
        linkCount: detail.linkCount,
        rootUnitInstanceId: detail.rootUnitInstanceId,
        runs: detail.runs,
      });
      await loadScenariosList();
      setStep(2);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCloning(false);
    }
  }

  async function handleInject() {
    if (!env || !scenarioId) return;
    setInjecting(true);
    setError(null);
    try {
      const { instanceIds } = await injectScenario(env, scenarioId, {
        instances: [
          {
            objectTypeName: "Patient",
            properties: {
              identifier: indexIdentifier.trim() || "IDX-001",
              label: indexLabel.trim() || "Index case",
            },
          },
        ],
        paramOverrides: {
          r0: params.r0,
          beta: params.beta,
          incubationDays: params.incubationDays,
          infectiousDays: params.infectiousDays,
          isolationCapacity: params.isolationCapacity,
          runs: params.runs,
          horizonDays: params.horizonDays,
        },
      });
      setIndexNodeId(instanceIds[0] ?? null);
      setStep(3);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setInjecting(false);
    }
  }

  async function handleRun() {
    if (!env || !scenarioId) return;
    setRunning(true);
    setError(null);
    try {
      const runParams: OutbreakParams = {
        ...params,
        indexNodeIds: indexNodeId ? [indexNodeId] : undefined,
      };
      const body: { params: OutbreakParams; seed?: number } = { params: runParams };
      if (seed.trim()) body.seed = Number(seed);
      const res = await runScenario(env, scenarioId, body);
      setResult(res);
      const detail = await getScenario(env, scenarioId);
      setScenarioDetail({
        instanceCount: detail.instanceCount,
        linkCount: detail.linkCount,
        rootUnitInstanceId: detail.rootUnitInstanceId,
        runs: detail.runs,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  async function handleRunMl() {
    if (!env || !scenarioId) return;
    setRunning(true);
    setError(null);
    try {
      const runParams: OutbreakParams = {
        ...params,
        indexNodeIds: indexNodeId ? [indexNodeId] : undefined,
      };
      const intervention: MlIntervention | undefined =
        interventionKind === "none"
          ? undefined
          : interventionKind === "close_unit"
            ? { kind: "close_unit", unitId: scenarioDetail?.rootUnitInstanceId ?? null }
            : { kind: "add_isolation_beds", beds: Number(interventionBeds) || 0 };
      const body: {
        params: OutbreakParams;
        seed?: number;
        intervention?: MlIntervention;
      } = { params: runParams };
      if (seed.trim()) body.seed = Number(seed);
      if (intervention) body.intervention = intervention;
      const res = await runMlSimulation(env, scenarioId, body);
      setMlResult(res);
      setResult(null);
      const detail = await getScenario(env, scenarioId);
      setScenarioDetail({
        instanceCount: detail.instanceCount,
        linkCount: detail.linkCount,
        rootUnitInstanceId: detail.rootUnitInstanceId,
        runs: detail.runs,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  async function handleSelectScenario(id: string) {
    if (!env) return;
    setScenarioId(id);
    setResult(null);
    setMlResult(null);
    setIndexNodeId(null);
    setStep(2);
    try {
      const detail = await getScenario(env, id);
      setScenarioDetail({
        instanceCount: detail.instanceCount,
        linkCount: detail.linkCount,
        rootUnitInstanceId: detail.rootUnitInstanceId,
        runs: detail.runs,
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleSelectRun(runId: string) {
    if (!env || !scenarioId) return;
    try {
      const detail = await getScenarioRun(env, scenarioId, runId);
      if (detail.summary && detail.trajectories) {
        setResult({
          runId: detail.id,
          summary: detail.summary,
          trajectories: detail.trajectories,
          alertTimeline: detail.alertTimeline ?? [],
        });
        setStep(3);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!hasKey) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <p className="max-w-sm text-center text-sm text-gray-500">
          Sign in and create an API key to run twin-clone simulations.
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
      <aside className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-gray-200 bg-white p-3">
        <span className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-gray-400">
          Past clones
        </span>
        {scenarios.length === 0 ? (
          <p className="text-[11px] text-gray-400">No scenarios yet.</p>
        ) : (
          scenarios.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => void handleSelectScenario(s.id)}
              className={cn(
                "mb-1 rounded border px-2 py-1.5 text-left text-[11px]",
                scenarioId === s.id
                  ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                  : "border-gray-200 text-gray-600 hover:bg-gray-50",
              )}
            >
              {s.name}
            </button>
          ))
        )}
        {scenarioDetail && scenarioDetail.runs.length > 0 ? (
          <div className="mt-4 border-t border-gray-100 pt-3">
            <span className="mb-1 block font-mono text-[9px] uppercase text-gray-400">
              Runs
            </span>
            {scenarioDetail.runs.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => void handleSelectRun(r.id)}
                className="mb-1 block w-full text-left text-[10px] text-gray-500 hover:text-indigo-600"
              >
                {r.status} · {r.createdAt.slice(0, 10)}
              </button>
            ))}
          </div>
        ) : null}
      </aside>

      <main className="min-h-0 flex-1 overflow-y-auto p-4">
        <StepIndicator current={step} />

        {error ? (
          <p className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </p>
        ) : null}

        {step === 1 ? (
          <section className="space-y-4">
            <div>
              <h2 className="mb-1 text-sm font-medium text-gray-800">1. Clone a unit</h2>
              <p className="text-[11px] text-gray-500">
                Pick an OrgUnit from the live twin. Cloning creates an isolated scenario copy —
                the live twin is never modified.
              </p>
            </div>
            <div className="h-64 overflow-hidden rounded border border-gray-200">
              <TwinCanvas
                snapshot={tree}
                selectedUnitId={selectedUnitId}
                displayMetric="occupancyPct"
                kindFilter={null}
                positions={positions}
                readOnly
                onSelectUnit={setSelectedUnitId}
                onPositionChange={() => {}}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
                placeholder="Scenario name"
                className="rounded border border-gray-200 px-2 py-1 text-xs focus:border-gray-400 focus:outline-none"
              />
              <Button
                onClick={() => void handleClone()}
                disabled={cloning || !selectedUnitId || !cloneName.trim()}
              >
                {cloning ? "Cloning…" : "Clone twin"}
              </Button>
            </div>
          </section>
        ) : null}

        {step >= 2 && scenarioDetail ? (
          <div className="mb-4 rounded border border-indigo-100 bg-indigo-50/50 px-3 py-2 text-[11px] text-indigo-800">
            Isolated copy · {scenarioDetail.instanceCount} instances ·{" "}
            {scenarioDetail.linkCount} links
            {scenarioDetail.rootUnitInstanceId
              ? ` · root ${unitNames.get(scenarioDetail.rootUnitInstanceId) ?? "unit"}`
              : null}
          </div>
        ) : null}

        {step === 2 ? (
          <section className="space-y-4">
            <div>
              <h2 className="mb-1 text-sm font-medium text-gray-800">2. Inject index case</h2>
              <p className="text-[11px] text-gray-500">
                Add a patient to the scenario copy and set simulation parameters.
              </p>
            </div>
            <div className="grid max-w-lg grid-cols-2 gap-3">
              <ParamField label="Index label" value={indexLabel} onChange={(v) => setIndexLabel(String(v ?? ""))} text />
              <ParamField
                label="Identifier"
                value={indexIdentifier}
                onChange={(v) => setIndexIdentifier(String(v ?? ""))}
                text
              />
              <ParamField label="R₀" value={params.r0} onChange={(v) => setParams(setNumParam("r0", v))} />
              <ParamField
                label="Beta (optional)"
                value={params.beta}
                onChange={(v) => setParams(setNumParam("beta", v))}
                hint="Blank = derive from R₀"
              />
              <ParamField
                label="Incubation days"
                value={params.incubationDays}
                onChange={(v) => setParams(setNumParam("incubationDays", v))}
                int
              />
              <ParamField
                label="Infectious days"
                value={params.infectiousDays}
                onChange={(v) => setParams(setNumParam("infectiousDays", v))}
                int
              />
              <ParamField
                label="Isolation capacity"
                value={params.isolationCapacity}
                onChange={(v) => setParams(setNumParam("isolationCapacity", v))}
                int
              />
              <ParamField
                label="Monte Carlo runs"
                value={params.runs}
                onChange={(v) => setParams(setNumParam("runs", v))}
                int
              />
              <ParamField label="Seed (optional)" value={seed} onChange={(v) => setSeed(String(v ?? ""))} text />
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button onClick={() => void handleInject()} disabled={injecting}>
                {injecting ? "Injecting…" : "Introduce index case"}
              </Button>
            </div>
          </section>
        ) : null}

        {step === 3 ? (
          <section className="space-y-4">
            <div>
              <h2 className="mb-1 text-sm font-medium text-gray-800">3. Run simulation</h2>
              <p className="text-[11px] text-gray-500">
                Runs on the scenario copy only. Index node:{" "}
                {indexNodeId ? indexNodeId.slice(0, 8) + "…" : "—"}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded border border-gray-200 p-0.5">
                <ModeTab
                  active={runMode === "mechanistic"}
                  label="Mechanistic"
                  onClick={() => setRunMode("mechanistic")}
                />
                <ModeTab
                  active={runMode === "ml"}
                  label="ML forecast"
                  onClick={() => setRunMode("ml")}
                />
              </div>
              {runMode === "ml" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={interventionKind}
                    onChange={(e) =>
                      setInterventionKind(e.target.value as MlIntervention["kind"])
                    }
                    className="rounded border border-gray-200 px-2 py-1 text-[11px] focus:border-gray-400 focus:outline-none"
                  >
                    <option value="none">No intervention</option>
                    <option value="close_unit">Close / cohort root unit</option>
                    <option value="add_isolation_beds">Add isolation beds</option>
                  </select>
                  {interventionKind === "add_isolation_beds" ? (
                    <input
                      type="number"
                      step={1}
                      value={interventionBeds}
                      onChange={(e) => setInterventionBeds(e.target.value)}
                      className="w-20 rounded border border-gray-200 px-2 py-1 text-[11px] focus:border-gray-400 focus:outline-none"
                      aria-label="Isolation beds to add"
                    />
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setStep(2)}>
                Back
              </Button>
              {runMode === "mechanistic" ? (
                <Button onClick={() => void handleRun()} disabled={running || !indexNodeId}>
                  {running ? "Running…" : "Run simulation"}
                </Button>
              ) : (
                <Button onClick={() => void handleRunMl()} disabled={running || !indexNodeId}>
                  {running ? "Running…" : "Run ML forecast"}
                </Button>
              )}
            </div>

            {runMode === "mechanistic" && result ? (
              <ResultsPanel result={result} unitNames={unitNames} />
            ) : null}
            {runMode === "ml" && mlResult ? <MlResultsPanel result={mlResult} /> : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}

function StepIndicator({ current }: { current: Step }) {
  const steps = [
    { n: 1 as const, label: "Clone" },
    { n: 2 as const, label: "Inject" },
    { n: 3 as const, label: "Run" },
  ];
  return (
    <div className="mb-4 flex gap-2">
      {steps.map((s) => (
        <span
          key={s.n}
          className={cn(
            "rounded-full border px-2.5 py-0.5 font-mono text-[10px]",
            current === s.n
              ? "border-indigo-400 bg-indigo-50 text-indigo-700"
              : current > s.n
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-gray-200 text-gray-400",
          )}
        >
          {s.n}. {s.label}
        </span>
      ))}
    </div>
  );
}

function ParamField({
  label,
  value,
  onChange,
  int,
  text,
  hint,
}: {
  label: string;
  value: string | number | undefined;
  onChange: (v: string | number | undefined) => void;
  int?: boolean;
  text?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] uppercase tracking-wide text-gray-400">
        {label}
      </label>
      <input
        type={text ? "text" : "number"}
        step={int ? 1 : 0.1}
        value={value ?? ""}
        onChange={(e) => {
          const raw = e.target.value;
          if (text) onChange(raw);
          else
            onChange(
              raw === "" ? undefined : int ? parseInt(raw, 10) : parseFloat(raw),
            );
        }}
        className="w-full rounded border border-gray-200 px-2 py-1 text-xs focus:border-gray-400 focus:outline-none"
      />
      {hint ? <p className="mt-0.5 text-[10px] text-gray-400">{hint}</p> : null}
    </div>
  );
}

function setNumParam(
  key: keyof OutbreakParams,
  v: string | number | undefined,
): (p: OutbreakParams) => OutbreakParams {
  return (p) => ({
    ...p,
    [key]: typeof v === "number" ? v : undefined,
  });
}

function ResultsPanel({
  result,
  unitNames,
}: {
  result: RunResult;
  unitNames: Map<string, string>;
}) {
  const { summary, trajectories, alertTimeline } = result;
  return (
    <section className="space-y-4 border-t border-gray-100 pt-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="Peak infected" value={String(Math.round(summary.peakInfected))} />
        <MetricCard
          label="Peak isolation"
          value={String(Math.round(summary.peakIsolationDemand))}
        />
        <MetricCard label="Attack rate" value={`${(summary.attackRate * 100).toFixed(1)}%`} />
        <MetricCard
          label="Days to contain"
          value={
            summary.daysToContain != null ? String(Math.round(summary.daysToContain)) : "—"
          }
        />
      </div>
      <Card className="p-4">
        <p className="mb-2 text-xs font-medium text-gray-700">
          Infected trajectory (p50, p5–p95 band)
        </p>
        <TrajectoryChart p5={trajectories.p5} p50={trajectories.p50} p95={trajectories.p95} />
      </Card>
      <Card className="p-4">
        <p className="mb-2 text-xs font-medium text-gray-700">
          Alerts that would fire on the live twin
        </p>
        <AlertTimelinePanel events={alertTimeline} unitNames={unitNames} />
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

function ModeTab({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded px-2.5 py-1 text-[11px] font-medium transition-colors",
        active ? "bg-indigo-600 text-white" : "text-gray-500 hover:text-gray-700",
      )}
    >
      {label}
    </button>
  );
}

function MlResultsPanel({ result }: { result: MlSimResult }) {
  const { summary, quantiles, model, mlBaselineError, featureImportances } = result;
  return (
    <section className="space-y-4 border-t border-gray-100 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={model.fallback ? "amber" : "emerald"}>
          {model.fallback ? "Mechanistic fallback" : "ML model"}
        </Badge>
        <Badge tone="slate">{model.type}</Badge>
        {model.version ? <Badge tone="slate">v{model.version}</Badge> : null}
        <Badge tone="slate">seed {result.seed}</Badge>
        {result.usedFallback ? (
          <Badge tone="amber">service offline → in-process baseline</Badge>
        ) : null}
      </div>
      {model.fallback && model.fallback_reason ? (
        <p className="text-[11px] text-amber-700">{model.fallback_reason}</p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="Peak infected" value={String(Math.round(summary.peakInfected))} />
        <MetricCard
          label="Peak isolation"
          value={String(Math.round(summary.peakIsolationDemand))}
        />
        <MetricCard label="Attack rate" value={`${(summary.attackRate * 100).toFixed(1)}%`} />
        <MetricCard
          label="Days to contain"
          value={summary.daysToContain != null ? String(Math.round(summary.daysToContain)) : "—"}
        />
      </div>

      <Card className="p-4">
        <p className="mb-2 text-xs font-medium text-gray-700">
          ML forecast — infected (p50, p10–p90 band)
        </p>
        <TrajectoryChart p5={quantiles.p10} p50={quantiles.p50} p95={quantiles.p90} />
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <p className="mb-2 text-xs font-medium text-gray-700">ML vs mechanistic baseline</p>
          <dl className="space-y-1 text-[11px] text-gray-600">
            <ErrRow label="RMSE (infected)" value={mlBaselineError.rmse} />
            <ErrRow label="MAE (infected)" value={mlBaselineError.mae} />
            <ErrRow label="Peak abs error" value={mlBaselineError.peakAbsError} />
          </dl>
          <p className="mt-2 text-[10px] text-gray-400">
            Lower = ML output closer to the mechanistic SEIR baseline (0 at cold-start).
          </p>
        </Card>
        <Card className="p-4">
          <p className="mb-2 text-xs font-medium text-gray-700">Feature importances</p>
          {featureImportances.length === 0 ? (
            <p className="text-[11px] text-gray-400">No importances reported.</p>
          ) : (
            <ul className="space-y-1.5">
              {featureImportances.map((fi) => (
                <li key={fi.feature} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 truncate text-[11px] text-gray-600">
                    {fi.feature}
                  </span>
                  <span className="h-2 flex-1 overflow-hidden rounded bg-gray-100">
                    <span
                      className="block h-full rounded bg-indigo-500"
                      style={{ width: `${Math.round(fi.importance * 100)}%` }}
                    />
                  </span>
                  <span className="w-10 shrink-0 text-right font-mono text-[10px] text-gray-500">
                    {(fi.importance * 100).toFixed(0)}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <p className="text-[10px] text-gray-400">
        {result.predictedWritten} predicted unit propert
        {result.predictedWritten === 1 ? "y" : "ies"} written to the scenario branch with
        provenance · DAG: {result.graphTrace.map((t) => t.node).join(" → ")}
      </p>
    </section>
  );
}

function ErrRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <dt>{label}</dt>
      <dd className="font-mono text-gray-800">{value.toFixed(2)}</dd>
    </div>
  );
}

function Badge({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "emerald" | "amber" | "slate";
}) {
  const tones: Record<string, string> = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    slate: "border-gray-200 bg-gray-50 text-gray-600",
  };
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}
