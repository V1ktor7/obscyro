"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/cn";
import {
  fetchTwinTree,
  listTwinMetrics,
  type TwinMetric,
  type TwinTreeSnapshot,
} from "@/lib/platform-api";

import { StatusChip } from "../StatusChip";
import { useStudio } from "../StudioShell";
import TwinCanvas from "../live/TwinCanvas";
import {
  addScenarioOverride,
  createOverlayScenario,
  deleteScenarioOverride,
  listOverlayScenarios,
  listScenarioOverrides,
  type OverlayScenario,
  type OverrideIssue,
  type ScenarioOverride,
} from "../scenarios-api";
import { formatMetricValue } from "../twin-ui";

// ---------------------------------------------------------------------------
// The scenario composer.
//
// Two mechanisms have coexisted since the overlay landed. One clones a subtree
// into its own tables — frozen at clone time, invisible to everything else, and
// it is the one the Scenarios tab used. The other holds a scenario as a set of
// edits resolved over the live ontology, so a read through it sees the world as
// it would be. Three phases of that were built and nothing could reach them.
//
// A scenario here is proposed edits, not a copy. Reality keeps moving
// underneath: reopen the same scenario tomorrow and it answers the same
// question against tomorrow's occupancy. That is the whole reason for the
// overlay, and the comparison at the top is where you see it — the same tree,
// resolved twice, subtracted.
// ---------------------------------------------------------------------------

type Action = "close_unit" | "add_beds" | "set_property";

const MAX_BEDS = 48;

const FIELD =
  "w-full rounded border border-line bg-white px-2 py-1.5 text-[11.5px] text-ink focus:border-brand focus:outline-none";
const LABEL = "text-[10px] font-medium uppercase tracking-wide text-ink-faint";

export default function ScenarioComposer() {
  const { hasKey, selectedEnv } = useStudio();
  const env = selectedEnv;

  const [scenarios, setScenarios] = useState<OverlayScenario[]>([]);
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<ScenarioOverride[]>([]);
  const [issues, setIssues] = useState<OverrideIssue[]>([]);

  const [reality, setReality] = useState<TwinTreeSnapshot | null>(null);
  const [proposed, setProposed] = useState<TwinTreeSnapshot | null>(null);
  const [metrics, setMetrics] = useState<TwinMetric[]>([]);
  const [metricKey, setMetricKey] = useState("occupancy");
  const [offsetHours, setOffsetHours] = useState(0);

  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const metric = metrics.find((m) => m.key === metricKey);

  const loadScenarios = useCallback(async () => {
    if (!env) return;
    try {
      const [{ scenarios: list }, { metrics: m }] = await Promise.all([
        listOverlayScenarios(env),
        listTwinMetrics(env).catch(() => ({ metrics: [] as TwinMetric[] })),
      ]);
      setScenarios(list);
      setMetrics(m);
      setScenarioId((cur) => (cur && list.some((s) => s.id === cur) ? cur : list[0]?.id ?? null));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [env]);

  useEffect(() => {
    void loadScenarios();
  }, [loadScenarios]);

  /** Reality and the proposal, fetched the same way so they can be subtracted. */
  const loadTrees = useCallback(async () => {
    if (!env) return;
    try {
      const real = await fetchTwinTree(env);
      setReality(real);
      setProposed(
        scenarioId ? await fetchTwinTree(env, { scenarioId, atOffsetHours: offsetHours }) : real,
      );
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [env, scenarioId, offsetHours]);

  useEffect(() => {
    void loadTrees();
  }, [loadTrees]);

  const loadOverrides = useCallback(async () => {
    if (!scenarioId) {
      setOverrides([]);
      setIssues([]);
      return;
    }
    try {
      const { overrides: o, issues: i } = await listScenarioOverrides(scenarioId);
      setOverrides(o);
      setIssues(i);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [scenarioId]);

  useEffect(() => {
    void loadOverrides();
  }, [loadOverrides]);

  /**
   * What the scenario changes, root by root.
   *
   * Roots rather than every unit: a network's answer to "should we do this" is
   * read at the top, and a list of thirty deltas is not an answer.
   */
  const deltas = useMemo(() => {
    if (!reality || !proposed) return [];
    const after = new Map(proposed.nodes.map((n) => [n.id, n]));
    return reality.nodes
      .filter((n) => reality.roots.includes(n.id))
      .map((n) => {
        const before = n.metrics.values?.[metricKey] ?? null;
        const now = after.get(n.id)?.metrics.values?.[metricKey] ?? null;
        return { id: n.id, name: n.name, before, now };
      })
      .filter((d) => d.before !== null || d.now !== null);
  }, [reality, proposed, metricKey]);

  async function newScenario() {
    if (!env) return;
    const name = window.prompt("Scenario name");
    if (!name?.trim()) return;
    setBusy(true);
    try {
      const s = await createOverlayScenario(env, { name: name.trim() });
      await loadScenarios();
      setScenarioId(s.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeOverride(id: string) {
    if (!scenarioId) return;
    setBusy(true);
    try {
      await deleteScenarioOverride(scenarioId, id);
      await loadOverrides();
      await loadTrees();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!hasKey || !env) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <p className="text-sm text-ink-muted">
          Sign in and pick an environment to compose a scenario.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-white px-4 py-2">
        <span className={LABEL}>Scenario</span>
        <select
          value={scenarioId ?? ""}
          onChange={(e) => setScenarioId(e.target.value || null)}
          className="rounded border border-line px-2 py-1 text-[11.5px] focus:border-brand focus:outline-none"
        >
          {scenarios.length === 0 ? <option value="">no scenario yet</option> : null}
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.overrideCount} edit{s.overrideCount === 1 ? "" : "s"}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void newScenario()}
          className="rounded border border-line p-1 text-ink-faint hover:border-brand hover:text-brand"
          title="New scenario"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>

        <span className="ml-2 text-[10px] text-ink-faint">at</span>
        <span className="flex items-center gap-1">
          <span className="text-[11px] text-ink-muted">T+</span>
          <input
            value={offsetHours}
            onChange={(e) => setOffsetHours(Math.max(0, Number(e.target.value) || 0))}
            inputMode="numeric"
            className="w-14 rounded border border-line px-1.5 py-1 text-[11.5px] tabular-nums focus:border-brand focus:outline-none"
          />
          <span className="text-[11px] text-ink-muted">h</span>
        </span>

        <select
          value={metricKey}
          onChange={(e) => setMetricKey(e.target.value)}
          className="rounded border border-line px-2 py-1 text-[11.5px] focus:border-brand focus:outline-none"
        >
          {metrics.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>

        {error ? (
          <span className="max-w-[40ch] truncate text-[11px] text-danger-ink" title={error}>
            {error}
          </span>
        ) : null}
      </header>

      {/*
        The comparison. Reality and the proposal are the same computation over
        the same ontology, so the difference is the scenario and nothing else.
      */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line-soft bg-canvas px-4 py-2">
        {deltas.length === 0 ? (
          <span className="text-[11px] text-ink-faint">
            {scenarioId ? "Nothing to compare yet — add an edit." : "Create a scenario to begin."}
          </span>
        ) : (
          deltas.map((d) => {
            const moved = d.before !== null && d.now !== null && Math.abs(d.now - d.before) > 0.005;
            const better = moved && d.now! < d.before!;
            return (
              <span
                key={d.id}
                className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-2 py-1 text-[11px]"
              >
                <span className="font-medium text-ink">{d.name}</span>
                <span className="text-ink-faint">
                  {formatMetricValue(d.before, metric?.unit ?? "number")}
                </span>
                <span className="text-ink-ghost">→</span>
                <span
                  className={cn(
                    "font-semibold",
                    !moved ? "text-ink-faint" : better ? "text-ok-ink" : "text-danger-ink",
                  )}
                >
                  {formatMetricValue(d.now, metric?.unit ?? "number")}
                </span>
              </span>
            );
          })
        )}
        {issues.length > 0 ? (
          <StatusChip tone="warn" title={issues.map((i) => i.message).join("\n")}>
            {issues.length} unresolvable edit{issues.length === 1 ? "" : "s"}
          </StatusChip>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1">
          <TwinCanvas
            snapshot={proposed}
            selectedUnitId={selectedUnitId}
            displayMetric={metricKey}
            displayUnit={metric?.unit}
            kindFilter={null}
            onSelectUnit={setSelectedUnitId}
          />
        </div>

        <aside className="flex w-[320px] shrink-0 flex-col border-l border-line bg-white">
          <div className="flex items-center gap-2 border-b border-line-soft px-3 py-2">
            <p className="flex-1 text-xs font-medium text-ink">Edits</p>
            <button
              type="button"
              disabled={!scenarioId || !selectedUnitId}
              title={
                !scenarioId
                  ? "Create a scenario first"
                  : !selectedUnitId
                    ? "Pick a unit on the tree first"
                    : "Add an edit"
              }
              onClick={() => setAdding(true)}
              className="rounded p-0.5 text-ink-faint hover:bg-canvas-raised hover:text-brand disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {overrides.length === 0 ? (
              <p className="px-3 py-2 text-[10.5px] leading-snug text-ink-faint">
                No edit yet. Pick a unit on the tree, then add one — the comparison above is
                reality against this scenario, so an empty scenario reads as no change.
              </p>
            ) : (
              overrides.map((o) => (
                <div
                  key={o.id}
                  className="flex items-start gap-2 border-b border-line-faint px-3 py-1.5"
                >
                  <span className="mt-0.5 shrink-0 rounded bg-canvas-raised px-1 text-[9.5px] tabular-nums text-ink-muted">
                    T+{o.effectiveOffsetHours}h
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] text-ink-body">{describe(o, reality)}</span>
                    {o.durationHours ? (
                      <span className="block text-[10px] text-ink-faint">
                        for {o.durationHours}h
                      </span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => void removeOverride(o.id)}
                    aria-label="Remove this edit"
                    className="shrink-0 rounded p-0.5 text-ink-faint hover:text-danger"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))
            )}
          </div>

          <p className="border-t border-line-soft px-3 py-2 text-[10px] leading-snug text-ink-faint">
            A scenario is proposed edits, not a copy. Reality keeps moving underneath it — reopen
            this tomorrow and it answers the same question against tomorrow&apos;s numbers.
          </p>
        </aside>
      </div>

      {adding && scenarioId && selectedUnitId ? (
        <AddEditDialog
          scenarioId={scenarioId}
          unitId={selectedUnitId}
          unitName={reality?.nodes.find((n) => n.id === selectedUnitId)?.name ?? "unit"}
          busy={busy}
          onClose={() => setAdding(false)}
          onAdded={async () => {
            setAdding(false);
            await loadOverrides();
            await loadTrees();
            await loadScenarios();
          }}
        />
      ) : null}
    </div>
  );
}

/** A one-line reading of an override, in the terms someone typed it in. */
function describe(o: ScenarioOverride, reality: TwinTreeSnapshot | null): string {
  const name =
    (o.targetId && reality?.nodes.find((n) => n.id === o.targetId)?.name) ??
    o.targetLocalKey ??
    "an object";
  if (o.targetType === "instance" && o.op === "delete") return `Close ${name}`;
  if (o.targetType === "instance" && o.op === "create") {
    const t = String((o.payload as { objectType?: string }).objectType ?? "object");
    return `Add a ${t}`;
  }
  if (o.op === "set_property") {
    const p = o.payload as { property?: string; value?: unknown };
    return `${name}: ${p.property} = ${String(p.value)}`;
  }
  if (o.op === "link") {
    const p = o.payload as { linkType?: string };
    return `Attach it — ${p.linkType}`;
  }
  if (o.op === "unlink") return `Detach ${name}`;
  if (o.op === "set_param") {
    const p = o.payload as { key?: string; value?: unknown };
    return `Parameter ${p.key} = ${String(p.value)}`;
  }
  return `${o.op} on ${name}`;
}

function AddEditDialog({
  scenarioId,
  unitId,
  unitName,
  busy,
  onClose,
  onAdded,
}: {
  scenarioId: string;
  unitId: string;
  unitName: string;
  busy: boolean;
  onClose: () => void;
  onAdded: () => void | Promise<void>;
}) {
  const [action, setAction] = useState<Action>("add_beds");
  const [count, setCount] = useState("12");
  const [prop, setProp] = useState("status");
  const [value, setValue] = useState("diverting");
  const [startsIn, setStartsIn] = useState("0");
  const [lasts, setLasts] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setWorking(true);
    setError(null);
    const effectiveOffsetHours = Math.max(0, Number(startsIn) || 0);
    const durationHours = lasts.trim() === "" ? null : Math.max(1, Number(lasts) || 1);
    try {
      if (action === "close_unit") {
        await addScenarioOverride(scenarioId, {
          targetType: "instance",
          targetId: unitId,
          op: "delete",
          effectiveOffsetHours,
          durationHours,
          note: `close ${unitName}`,
        });
      } else if (action === "set_property") {
        await addScenarioOverride(scenarioId, {
          targetType: "instance",
          targetId: unitId,
          op: "set_property",
          payload: { property: prop, value: Number.isNaN(Number(value)) ? value : Number(value) },
          effectiveOffsetHours,
          durationHours,
        });
      } else {
        // A bed is two edits: bring it into existence, then put it in the unit.
        // The local key ties the second to the first, because the instance has
        // no id until the overlay resolves.
        const n = Math.min(Math.max(1, Number(count) || 1), MAX_BEDS);
        const stamp = Date.now().toString(36);
        for (let i = 0; i < n; i++) {
          const key = `bed_${stamp}_${i}`;
          await addScenarioOverride(scenarioId, {
            targetType: "instance",
            targetLocalKey: key,
            op: "create",
            payload: {
              objectType: "Bed",
              properties: { label: `Extra ${i + 1}`, status: "free" },
            },
            effectiveOffsetHours,
            durationHours,
          });
          await addScenarioOverride(scenarioId, {
            targetType: "link",
            targetLocalKey: key,
            op: "link",
            // `located_in` is declared Patient → OrgUnit. A bed belongs to a
            // unit through `located_in_bed`, and the twin counts both.
            payload: { linkType: "located_in_bed", toId: unitId },
            effectiveOffsetHours,
            durationHours,
          });
        }
      }
      await onAdded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-[10vh]"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-[420px] rounded-md border border-line bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="presentation"
      >
        <div className="border-b border-line-soft px-4 py-2.5">
          <p className="text-xs font-medium text-ink">New edit</p>
          <p className="mt-0.5 text-[10.5px] text-ink-faint">on {unitName}</p>
        </div>

        <div className="space-y-2.5 px-4 py-3">
          <div>
            <span className={LABEL}>What changes</span>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value as Action)}
              className={cn(FIELD, "mt-1")}
            >
              <option value="add_beds">Open extra beds</option>
              <option value="close_unit">Close this unit</option>
              <option value="set_property">Set a property</option>
            </select>
          </div>

          {action === "add_beds" ? (
            <div>
              <span className={LABEL}>How many</span>
              <input
                value={count}
                onChange={(e) => setCount(e.target.value)}
                inputMode="numeric"
                className={cn(FIELD, "mt-1 tabular-nums")}
              />
              <p className="mt-1 text-[10px] text-ink-faint">
                They arrive free, so occupancy falls by the share they add.
              </p>
            </div>
          ) : null}

          {action === "set_property" ? (
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <span className={LABEL}>Property</span>
                <input
                  value={prop}
                  onChange={(e) => setProp(e.target.value)}
                  className={cn(FIELD, "mt-1")}
                />
              </div>
              <div className="min-w-0 flex-1">
                <span className={LABEL}>Value</span>
                <input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className={cn(FIELD, "mt-1")}
                />
              </div>
            </div>
          ) : null}

          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <span className={LABEL}>Starts in (h)</span>
              <input
                value={startsIn}
                onChange={(e) => setStartsIn(e.target.value)}
                inputMode="numeric"
                className={cn(FIELD, "mt-1 tabular-nums")}
              />
            </div>
            <div className="min-w-0 flex-1">
              <span className={LABEL}>Lasts (h) — blank = forever</span>
              <input
                value={lasts}
                onChange={(e) => setLasts(e.target.value)}
                inputMode="numeric"
                placeholder="∞"
                className={cn(FIELD, "mt-1 tabular-nums")}
              />
            </div>
          </div>

          {error ? (
            <p className="rounded border border-danger/40 bg-danger-soft px-2 py-1.5 text-[10.5px] text-danger-ink">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-line-soft px-4 py-2.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-line px-3 py-1.5 text-[11px] text-ink-body"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={working || busy}
            onClick={() => void submit()}
            className="inline-flex items-center gap-1.5 rounded border border-brand-deep bg-brand px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-40"
          >
            {working ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
