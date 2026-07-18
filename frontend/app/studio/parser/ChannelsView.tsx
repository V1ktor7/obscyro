"use client";

/**
 * Data channels — the default Ontology Parser experience.
 *
 * A channel is a saved linear pipeline (intake → transform → extract →
 * validate → save) edited as a vertical step list: no canvas, no wiring.
 * Test runs execute the enabled steps in order against the live /v1 API
 * (see channels-api.ts) and are recorded server-side for the stats strip.
 * The old node canvas remains available via the "Graph editor" link.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  CircleDashed,
  Copy,
  Database,
  Loader2,
  Pause,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Wand2,
  Webhook,
  X,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/cn";
import { listIngestSources, type IngestSource } from "@/lib/platform-api";
import {
  createChannel,
  deleteChannel,
  executeChannel,
  listChannelRuns,
  listChannels,
  newStep,
  provisionChannelWebhook,
  stepSummary,
  updateChannel,
  STEP_LABELS,
  type ChannelRun,
  type ChannelRunOutcome,
  type ChannelStep,
  type ChannelStepType,
  type ChannelStatus,
  type DataChannel,
} from "../channels-api";
import { useStudio } from "../StudioShell";

const STEP_VISUALS: Record<
  ChannelStepType,
  { Icon: LucideIcon; bg: string; text: string }
> = {
  intake: { Icon: Webhook, bg: "bg-[#e7f2fd]", text: "text-[#215db0]" },
  transform: { Icon: Wand2, bg: "bg-[#f2ebfb]", text: "text-[#6b3fa0]" },
  extract: { Icon: Search, bg: "bg-[#e7f2fd]", text: "text-[#215db0]" },
  validate: { Icon: ShieldCheck, bg: "bg-[#fdf0e6]", text: "text-[#935610]" },
  save: { Icon: Database, bg: "bg-[#e8f4ec]", text: "text-[#1c6e42]" },
};

const STATUS_META: Record<ChannelStatus, { label: string; dot: string; chip: string }> = {
  live: { label: "Live", dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700" },
  paused: { label: "Paused", dot: "bg-amber-400", chip: "bg-amber-50 text-amber-700" },
  draft: { label: "Draft", dot: "bg-gray-300", chip: "bg-[#f6f7f9] text-[#5f6b7c]" },
};

const SAMPLE_NOTE =
  "Patiente de 67 ans admise pour douleur thoracique. ATCD: diabète type 2, HTA. " +
  "Pas d'allergie connue. ECG: sus-décalage ST. Troponines élevées — IDM antérieur probable. " +
  "Mise sous aspirine.";

// Only these step types can appear more than zero times; extract/save/intake
// are singletons in the catalog once present.
const SINGLETON_TYPES: ChannelStepType[] = ["intake", "extract", "save"];

export default function ChannelsView({ onOpenGraph }: { onOpenGraph: () => void }) {
  const { hasKey, selectedEnv } = useStudio();
  const env = selectedEnv;

  const [channels, setChannels] = useState<DataChannel[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [draftSteps, setDraftSteps] = useState<ChannelStep[]>([]);
  const [runs, setRuns] = useState<ChannelRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newName, setNewName] = useState("");
  const [showNewForm, setShowNewForm] = useState(false);

  const [testOpen, setTestOpen] = useState(false);
  const [testText, setTestText] = useState("");
  const [runStage, setRunStage] = useState<ChannelStepType | "done" | null>(null);
  const [outcome, setOutcome] = useState<ChannelRunOutcome | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const runningRef = useRef(false);

  const [sources, setSources] = useState<IngestSource[]>([]);
  const [provisioning, setProvisioning] = useState(false);

  const selected = useMemo(
    () => channels.find((c) => c.slug === selectedSlug) ?? null,
    [channels, selectedSlug],
  );

  const dirty = useMemo(
    () => selected !== null && JSON.stringify(draftSteps) !== JSON.stringify(selected.steps),
    [selected, draftSteps],
  );

  const loadChannels = useCallback(async () => {
    if (!env) {
      setChannels([]);
      setSelectedSlug(null);
      return;
    }
    try {
      const { channels: list } = await listChannels(env);
      setChannels(list);
      setSelectedSlug((cur) => (cur && list.some((c) => c.slug === cur) ? cur : list[0]?.slug ?? null));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [env]);

  useEffect(() => {
    setError(null);
    void loadChannels();
  }, [loadChannels]);

  useEffect(() => {
    if (!hasKey) return;
    listIngestSources()
      .then(({ sources: list }) => setSources(list))
      .catch(() => setSources([]));
  }, [hasKey, env]);

  useEffect(() => {
    setDraftSteps(selected ? selected.steps.map((s) => ({ ...s, config: { ...s.config } })) : []);
    setOutcome(null);
    setRunError(null);
    setRunStage(null);
    if (!env || !selected) {
      setRuns([]);
      return;
    }
    listChannelRuns(env, selected.slug, 5)
      .then(({ runs: r }) => setRuns(r))
      .catch(() => setRuns([]));
  }, [env, selected]);

  const refreshAfterRun = useCallback(async () => {
    if (!env || !selectedSlug) return;
    await loadChannels();
    const { runs: r } = await listChannelRuns(env, selectedSlug, 5).catch(() => ({ runs: [] }));
    setRuns(r);
  }, [env, selectedSlug, loadChannels]);

  async function handleCreate() {
    if (!env || !newName.trim() || busy) return;
    setBusy(true);
    try {
      const created = await createChannel(env, { name: newName.trim() });
      setNewName("");
      setShowNewForm(false);
      await loadChannels();
      setSelectedSlug(created.slug);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveSteps() {
    if (!env || !selected || busy) return;
    setBusy(true);
    try {
      const updated = await updateChannel(env, selected.slug, { steps: draftSteps });
      setChannels((cur) => cur.map((c) => (c.id === updated.id ? updated : c)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleStatusToggle() {
    if (!env || !selected || busy) return;
    const next: ChannelStatus = selected.status === "live" ? "paused" : "live";
    setBusy(true);
    try {
      const updated = await updateChannel(env, selected.slug, { status: next });
      setChannels((cur) => cur.map((c) => (c.id === updated.id ? updated : c)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!env || !selected || busy) return;
    if (!window.confirm(`Delete channel "${selected.name}" and its run history?`)) return;
    setBusy(true);
    try {
      await deleteChannel(env, selected.slug);
      setSelectedSlug(null);
      await loadChannels();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleProvisionWebhook() {
    if (!env || !selected || provisioning) return;
    setProvisioning(true);
    try {
      await provisionChannelWebhook(env, selected.slug);
      await loadChannels();
      const { sources: list } = await listIngestSources().catch(() => ({ sources: [] }));
      setSources(list);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProvisioning(false);
    }
  }

  async function handleBindSource(sourceId: string | null) {
    if (!env || !selected || busy) return;
    setBusy(true);
    try {
      const updated = await updateChannel(env, selected.slug, { sourceId });
      setChannels((cur) => cur.map((c) => (c.id === updated.id ? updated : c)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleTestRun() {
    if (!env || !selected || runningRef.current) return;
    const text = testText.trim();
    if (!text) {
      setRunError("Paste some text to run the channel on.");
      return;
    }
    if (dirty) {
      setRunError("Save your step changes first — the run uses the saved channel.");
      return;
    }
    runningRef.current = true;
    setRunError(null);
    setOutcome(null);
    setRunStage("intake");
    try {
      const result = await executeChannel(env, selected, text, setRunStage);
      setOutcome(result);
    } catch (err) {
      setRunError((err as Error).message);
      setRunStage(null);
    } finally {
      runningRef.current = false;
      void refreshAfterRun();
    }
  }

  // --- step list edits ------------------------------------------------------

  function patchStep(id: string, patch: Partial<ChannelStep>) {
    setDraftSteps((cur) => cur.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function patchStepConfig(id: string, key: string, value: unknown) {
    setDraftSteps((cur) =>
      cur.map((s) => (s.id === id ? { ...s, config: { ...s.config, [key]: value } } : s)),
    );
  }

  function moveStep(index: number, delta: -1 | 1) {
    setDraftSteps((cur) => {
      const next = [...cur];
      const target = index + delta;
      if (target < 0 || target >= next.length) return cur;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function removeStep(id: string) {
    setDraftSteps((cur) => cur.filter((s) => s.id !== id));
  }

  function insertStep(index: number, type: ChannelStepType) {
    setDraftSteps((cur) => {
      const next = [...cur];
      next.splice(index, 0, newStep(type));
      return next;
    });
  }

  const presentSingletons = new Set(
    draftSteps.filter((s) => SINGLETON_TYPES.includes(s.type)).map((s) => s.type),
  );
  const insertableTypes = (["intake", "transform", "extract", "validate", "save"] as const).filter(
    (t) => !SINGLETON_TYPES.includes(t) || !presentSingletons.has(t),
  );

  if (!hasKey) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <p className="max-w-sm text-center text-sm text-gray-500">
          Sign in and create an API key to build data channels.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#f6f7f9]">
      {/* Top bar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-[#d3d8de] bg-white px-4 py-2">
        <span className="flex h-6 w-6 items-center justify-center rounded bg-[#e7f2fd] text-[#2d72d2]">
          <Webhook className="h-3.5 w-3.5" />
        </span>
        <span className="text-[13px] font-semibold text-[#1c2127]">Data channels</span>
        <span className="hidden rounded border border-[#d3d8de] px-2 py-0.5 text-[11px] text-[#404854] sm:inline">
          {env ?? "no environment"}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onOpenGraph}
          className="text-[11px] text-[#5f6b7c] hover:text-[#2d72d2] hover:underline"
        >
          Advanced: graph editor
        </button>
        <button
          type="button"
          disabled={!env}
          onClick={() => setShowNewForm((v) => !v)}
          className="flex items-center gap-1 rounded bg-[#2d72d2] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#215db0] disabled:bg-[#c5cbd3]"
        >
          <Plus className="h-3.5 w-3.5" />
          New channel
        </button>
      </div>

      {error ? (
        <div className="flex items-center gap-2 border-b border-rose-200 bg-rose-50 px-4 py-1.5 text-[11px] text-rose-700">
          <span className="min-w-0 flex-1 truncate">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {/* Channel list rail */}
        <aside className="flex w-52 shrink-0 flex-col overflow-y-auto border-r border-[#d3d8de] bg-white">
          <div className="px-3 pb-1 pt-2.5 text-[10px] font-medium uppercase tracking-[0.12em] text-[#8f99a8]">
            Channels · {channels.length}
          </div>
          {showNewForm ? (
            <div className="mx-2 mb-1 flex flex-col gap-1.5 rounded border border-[#d3d8de] p-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCreate();
                }}
                placeholder="e.g. ED admission notes"
                autoFocus
                className="w-full rounded border border-[#d3d8de] bg-[#f6f7f9] px-2 py-1 text-xs text-[#1c2127] focus:border-[#2d72d2] focus:outline-none"
              />
              <button
                type="button"
                disabled={!newName.trim() || busy}
                onClick={() => void handleCreate()}
                className="rounded bg-[#2d72d2] px-2 py-1 text-[11px] font-medium text-white hover:bg-[#215db0] disabled:bg-[#c5cbd3]"
              >
                Create channel
              </button>
            </div>
          ) : null}
          <div className="flex flex-col gap-0.5 px-2 pb-2">
            {channels.length === 0 ? (
              <p className="px-2 py-1 text-[11px] text-[#8f99a8]">
                {env ? "No channels yet — create one." : "Select an environment."}
              </p>
            ) : (
              channels.map((c) => {
                const meta = STATUS_META[c.status];
                const active = c.slug === selectedSlug;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedSlug(c.slug)}
                    className={cn(
                      "rounded px-2 py-1.5 text-left transition-colors",
                      active ? "bg-[#e7f2fd]" : "hover:bg-[#f6f7f9]",
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", meta.dot)} />
                      <span
                        className={cn(
                          "truncate text-xs",
                          active ? "font-medium text-[#215db0]" : "text-[#1c2127]",
                        )}
                      >
                        {c.name}
                      </span>
                    </span>
                    <span className="ml-3 block text-[10px] text-[#8f99a8]">
                      {c.status === "draft"
                        ? "draft"
                        : `${meta.label.toLowerCase()} · ${c.stats.runsToday} run${c.stats.runsToday === 1 ? "" : "s"} today`}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Channel detail */}
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="max-w-sm text-center text-sm text-[#5f6b7c]">
                {env
                  ? "Create a channel to define a reusable parse pipeline."
                  : "Select or create an environment first."}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 p-4">
              {/* Header */}
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[15px] font-semibold text-[#1c2127]">{selected.name}</h2>
                <span
                  className={cn(
                    "flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium",
                    STATUS_META[selected.status].chip,
                  )}
                >
                  <span
                    className={cn("h-1.5 w-1.5 rounded-full", STATUS_META[selected.status].dot)}
                  />
                  {STATUS_META[selected.status].label}
                </span>
                <span className="flex-1" />
                {dirty ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleSaveSteps()}
                    className="rounded bg-[#2d72d2] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#215db0] disabled:bg-[#c5cbd3]"
                  >
                    Save changes
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setTestOpen(true)}
                  className="flex items-center gap-1 rounded border border-[#d3d8de] bg-white px-2.5 py-1.5 text-xs text-[#404854] hover:border-[#2d72d2]"
                >
                  <Play className="h-3 w-3" />
                  Test run
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleStatusToggle()}
                  className="flex items-center gap-1 rounded border border-[#d3d8de] bg-white px-2.5 py-1.5 text-xs text-[#404854] hover:border-[#2d72d2]"
                >
                  {selected.status === "live" ? (
                    <>
                      <Pause className="h-3 w-3" />
                      Pause
                    </>
                  ) : (
                    <>
                      <Play className="h-3 w-3" />
                      Go live
                    </>
                  )}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleDelete()}
                  className="rounded border border-[#d3d8de] bg-white p-1.5 text-[#8f99a8] hover:border-rose-300 hover:text-rose-600"
                  aria-label="Delete channel"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatCard label="Runs today" value={selected.stats.runsToday.toLocaleString()} />
                <StatCard
                  label="Avg latency"
                  value={
                    selected.stats.avgDurationMs === null
                      ? "—"
                      : `${(selected.stats.avgDurationMs / 1000).toFixed(1)}s`
                  }
                />
                <StatCard label="Saved today" value={selected.stats.savedToday.toLocaleString()} />
                <StatCard
                  label="Flagged today"
                  value={selected.stats.flaggedToday.toLocaleString()}
                  warn={selected.stats.flaggedToday > 0}
                />
              </div>

              {/* Step editor */}
              <div className="flex flex-col">
                {draftSteps.map((step, i) => (
                  <div key={step.id}>
                    {i > 0 ? (
                      <StepInserter
                        types={insertableTypes}
                        onInsert={(t) => insertStep(i, t)}
                      />
                    ) : null}
                    <StepCard
                      step={step}
                      index={i}
                      total={draftSteps.length}
                      onToggle={() => patchStep(step.id, { enabled: !step.enabled })}
                      onMove={(d) => moveStep(i, d)}
                      onRemove={
                        step.type === "extract" ? undefined : () => removeStep(step.id)
                      }
                      onConfig={(key, value) => patchStepConfig(step.id, key, value)}
                      intake={
                        step.type === "intake"
                          ? {
                              webhookUrl: selected.webhookUrl,
                              sourceId: selected.sourceId,
                              sources,
                              provisioning,
                              onProvision: () => void handleProvisionWebhook(),
                              onBindSource: (id) => void handleBindSource(id),
                            }
                          : undefined
                      }
                    />
                  </div>
                ))}
                <StepInserter
                  types={insertableTypes}
                  onInsert={(t) => insertStep(draftSteps.length, t)}
                />
              </div>

              {/* Recent runs */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[#d3d8de] pt-2 text-[11px] text-[#8f99a8]">
                {runs.length === 0 ? (
                  <span>No runs yet — try a test run.</span>
                ) : (
                  runs.map((r) => (
                    <span key={r.id} className="flex items-center gap-1">
                      {r.status === "failed" ? (
                        <X className="h-3 w-3 text-rose-500" />
                      ) : r.status === "flagged" ? (
                        <AlertTriangle className="h-3 w-3 text-amber-500" />
                      ) : (
                        <Check className="h-3 w-3 text-emerald-600" />
                      )}
                      {new Date(r.createdAt).toLocaleTimeString()} · {r.conceptCount} concepts ·{" "}
                      {r.savedCount} saved
                      {r.flaggedCount > 0 ? ` · ${r.flaggedCount} flagged` : ""}
                    </span>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Test run drawer */}
        {testOpen && selected ? (
          <aside className="flex w-[26rem] shrink-0 flex-col border-l border-[#d3d8de] bg-white">
            <div className="flex items-center justify-between border-b border-[#d3d8de] px-3 py-2">
              <span className="text-xs font-semibold text-[#1c2127]">
                Test run · {selected.name}
              </span>
              <button
                type="button"
                onClick={() => setTestOpen(false)}
                className="text-[#8f99a8] hover:text-[#1c2127]"
                aria-label="Close test run panel"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
              <textarea
                value={testText}
                onChange={(e) => setTestText(e.target.value)}
                rows={6}
                placeholder="Paste clinical text or a JSON payload…"
                className="w-full resize-y rounded border border-[#d3d8de] bg-[#f6f7f9] px-2.5 py-2 text-xs text-[#1c2127] focus:border-[#2d72d2] focus:outline-none"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTestText(SAMPLE_NOTE)}
                  className="text-[11px] text-[#5f6b7c] hover:text-[#2d72d2] hover:underline"
                >
                  use sample note
                </button>
                <span className="flex-1" />
                <button
                  type="button"
                  disabled={runStage !== null && runStage !== "done" && !runError}
                  onClick={() => void handleTestRun()}
                  className="flex items-center gap-1 rounded bg-[#2d72d2] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#215db0] disabled:bg-[#c5cbd3]"
                >
                  {runStage !== null && runStage !== "done" && !runError ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                  Run
                </button>
              </div>

              {runError ? (
                <p className="rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-700">
                  {runError}
                </p>
              ) : null}

              {runStage !== null ? (
                <StageProgress
                  steps={selected.steps.filter((s) => s.enabled)}
                  stage={runStage}
                  timings={outcome?.timings ?? {}}
                />
              ) : null}

              {outcome ? (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#5f6b7c]">
                    <span>
                      {outcome.rows.length} concepts · {outcome.acceptedCount} accepted ·{" "}
                      {outcome.flaggedCount} flagged · {(outcome.durationMs / 1000).toFixed(1)}s
                    </span>
                    {outcome.persisted ? (
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700">
                        {outcome.persisted.objectIds.length} saved to{" "}
                        {outcome.persisted.objectType}
                      </span>
                    ) : null}
                  </div>
                  <div className="overflow-hidden rounded border border-[#d3d8de]">
                    <table className="w-full border-collapse text-left text-[11px]">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-wide text-[#8f99a8]">
                          <th className="border-b border-[#d3d8de] px-2 py-1.5 font-medium">
                            Term
                          </th>
                          <th className="border-b border-[#d3d8de] px-2 py-1.5 font-medium">
                            SNOMED
                          </th>
                          <th className="border-b border-[#d3d8de] px-2 py-1.5 font-medium">
                            Conf.
                          </th>
                          <th className="border-b border-[#d3d8de] px-2 py-1.5 font-medium">
                            Context
                          </th>
                          <th className="border-b border-[#d3d8de] px-2 py-1.5 font-medium">
                            Decision
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {outcome.rows.map((r, i) => (
                          <tr key={`${r.span}-${i}`} className="text-[#404854]">
                            <td className="border-b border-[#e5e8eb] px-2 py-1.5 font-medium text-[#1c2127]">
                              {r.span}
                            </td>
                            <td className="border-b border-[#e5e8eb] px-2 py-1.5 font-mono text-[10px]">
                              {r.code ?? "—"}
                            </td>
                            <td className="border-b border-[#e5e8eb] px-2 py-1.5">
                              <div className="h-1 w-12 overflow-hidden rounded bg-[#eef1f4]">
                                <div
                                  className={cn(
                                    "h-full",
                                    r.confidence >= 0.8
                                      ? "bg-emerald-500"
                                      : r.confidence >= 0.6
                                        ? "bg-amber-400"
                                        : "bg-rose-400",
                                  )}
                                  style={{ width: `${Math.round(r.confidence * 100)}%` }}
                                />
                              </div>
                            </td>
                            <td className="border-b border-[#e5e8eb] px-2 py-1.5">
                              <span
                                className={cn(
                                  "rounded px-1 py-0.5 text-[10px] font-medium",
                                  r.assertion === "negated"
                                    ? "bg-rose-50 text-rose-700"
                                    : r.assertion === "affirmed"
                                      ? "bg-emerald-50 text-emerald-700"
                                      : "bg-[#eef1f4] text-[#5f6b7c]",
                                )}
                              >
                                {r.assertion}
                              </span>
                            </td>
                            <td className="border-b border-[#e5e8eb] px-2 py-1.5">
                              <span
                                className={cn(
                                  "rounded px-1 py-0.5 text-[10px] font-medium",
                                  r.decision === "accept"
                                    ? "bg-emerald-50 text-emerald-700"
                                    : r.decision === "duplicate"
                                      ? "bg-[#eef1f4] text-[#5f6b7c]"
                                      : "bg-amber-50 text-amber-700",
                                )}
                              >
                                {r.decision}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {outcome.rows.length === 0 ? (
                          <tr>
                            <td className="px-2 py-1.5 text-[#8f99a8]" colSpan={5}>
                              No concepts found in this input.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function StatCard({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-md bg-white px-3 py-2 shadow-[inset_0_0_0_1px_#e5e8eb]">
      <p
        className={cn(
          "text-[10px] font-medium uppercase tracking-wide",
          warn ? "text-amber-600" : "text-[#8f99a8]",
        )}
      >
        {label}
      </p>
      <p className={cn("text-base font-semibold", warn ? "text-amber-600" : "text-[#1c2127]")}>
        {value}
      </p>
    </div>
  );
}

function StepInserter({
  types,
  onInsert,
}: {
  types: readonly ChannelStepType[];
  onInsert: (type: ChannelStepType) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-1.5 py-0.5 pl-4">
      <span className="h-3 w-px bg-[#c5cbd3]" />
      {open ? (
        <span className="flex items-center gap-1">
          {types.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                onInsert(t);
                setOpen(false);
              }}
              className="rounded border border-[#d3d8de] bg-white px-1.5 py-0.5 text-[10px] text-[#404854] hover:border-[#2d72d2] hover:text-[#2d72d2]"
            >
              {STEP_LABELS[t]}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-[#8f99a8]"
            aria-label="Cancel add step"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1 text-[10px] text-[#8f99a8] hover:text-[#2d72d2]"
        >
          <Plus className="h-3 w-3" />
          add step
        </button>
      )}
    </div>
  );
}

interface IntakeContext {
  webhookUrl: string | null;
  sourceId: string | null;
  sources: IngestSource[];
  provisioning: boolean;
  onProvision: () => void;
  onBindSource: (sourceId: string | null) => void;
}

function StepCard({
  step,
  index,
  total,
  onToggle,
  onMove,
  onRemove,
  onConfig,
  intake,
}: {
  step: ChannelStep;
  index: number;
  total: number;
  onToggle: () => void;
  onMove: (delta: -1 | 1) => void;
  onRemove?: () => void;
  onConfig: (key: string, value: unknown) => void;
  intake?: IntakeContext;
}) {
  const [expanded, setExpanded] = useState(false);
  const { Icon, bg, text } = STEP_VISUALS[step.type];
  return (
    <div
      className={cn(
        "rounded-md border bg-white",
        step.enabled ? "border-[#d3d8de]" : "border-dashed border-[#c5cbd3] opacity-70",
      )}
    >
      <div className="flex items-center gap-2.5 px-3 py-2">
        <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded", bg, text)}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-xs font-medium text-[#1c2127]">{STEP_LABELS[step.type]}</span>
            <button
              type="button"
              onClick={onToggle}
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-medium",
                step.enabled
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-[#eef1f4] text-[#8f99a8]",
              )}
            >
              {step.enabled ? "on" : "off"}
            </button>
          </span>
          <span className="block truncate font-mono text-[10px] text-[#8f99a8]">
            {stepSummary(step)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[#8f99a8]">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            className="rounded p-0.5 hover:text-[#2d72d2] disabled:opacity-30"
            aria-label="Move step up"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            className="rounded p-0.5 hover:text-[#2d72d2] disabled:opacity-30"
            aria-label="Move step down"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {onRemove ? (
            <button
              type="button"
              onClick={onRemove}
              className="rounded p-0.5 hover:text-rose-600"
              aria-label="Remove step"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className={cn("rounded p-0.5", expanded ? "text-[#2d72d2]" : "hover:text-[#2d72d2]")}
            aria-label="Step settings"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
      {expanded ? (
        <div className="border-t border-[#e5e8eb] px-3 py-2.5">
          <StepConfigForm step={step} onConfig={onConfig} intake={intake} />
        </div>
      ) : null}
    </div>
  );
}

const FIELD =
  "w-full rounded border border-[#d3d8de] bg-[#f6f7f9] px-2 py-1 text-xs text-[#1c2127] focus:border-[#2d72d2] focus:outline-none";
const LABEL = "mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-[#8f99a8]";

function StepConfigForm({
  step,
  onConfig,
  intake,
}: {
  step: ChannelStep;
  onConfig: (key: string, value: unknown) => void;
  intake?: IntakeContext;
}) {
  const c = step.config;
  switch (step.type) {
    case "intake": {
      const mode = (c.mode as string) || "paste";
      return (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={LABEL}>Mode</span>
              <select
                value={mode}
                onChange={(e) => onConfig("mode", e.target.value)}
                className={FIELD}
              >
                <option value="paste">Paste / manual</option>
                <option value="webhook">Webhook</option>
                <option value="source">Ingest source</option>
              </select>
            </label>
            {mode === "source" && intake ? (
              <label className="block">
                <span className={LABEL}>Ingest source</span>
                <select
                  value={intake.sourceId ?? ""}
                  onChange={(e) => {
                    const id = e.target.value || null;
                    intake.onBindSource(id);
                    onConfig("ref", id ?? "");
                  }}
                  className={FIELD}
                >
                  <option value="">choose a source…</option>
                  {intake.sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.type})
                    </option>
                  ))}
                </select>
              </label>
            ) : mode === "paste" ? (
              <label className="block">
                <span className={LABEL}>Reference (optional)</span>
                <input
                  value={(c.ref as string) || ""}
                  onChange={(e) => onConfig("ref", e.target.value)}
                  placeholder="note or note_text"
                  className={FIELD}
                />
              </label>
            ) : null}
          </div>
          {mode === "webhook" && intake ? (
            intake.webhookUrl ? (
              <div className="flex flex-col gap-1">
                <span className={LABEL}>Webhook URL (POST payloads here)</span>
                <WebhookUrlRow url={intake.webhookUrl} />
                <p className="text-[10px] text-[#8f99a8]">
                  Payloads run this channel server-side while it is live. Send{" "}
                  <span className="font-mono">{'{ "text": "…" }'}</span> or set a JSON field
                  path in the transform step.
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={intake.provisioning}
                  onClick={intake.onProvision}
                  className="flex items-center gap-1 rounded bg-[#2d72d2] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#215db0] disabled:bg-[#c5cbd3]"
                >
                  {intake.provisioning ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Webhook className="h-3 w-3" />
                  )}
                  Generate webhook URL
                </button>
                <span className="text-[10px] text-[#8f99a8]">
                  Creates a dedicated inbound webhook for this channel.
                </span>
              </div>
            )
          ) : null}
          {mode === "source" && intake?.sourceId ? (
            <p className="text-[10px] text-[#8f99a8]">
              New events on this source run the channel server-side while it is live.
            </p>
          ) : null}
        </div>
      );
    }
    case "transform":
      return (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className={LABEL}>Language</span>
            <select
              value={(c.language as string) || "auto"}
              onChange={(e) => onConfig("language", e.target.value)}
              className={FIELD}
            >
              <option value="auto">Auto-detect</option>
              <option value="en">English</option>
              <option value="fr">French</option>
            </select>
          </label>
          <label className="block">
            <span className={LABEL}>JSON field path (optional)</span>
            <input
              value={(c.fieldPath as string) || ""}
              onChange={(e) => onConfig("fieldPath", e.target.value)}
              placeholder="note_text or payload.note"
              className={FIELD}
            />
          </label>
        </div>
      );
    case "extract":
      return (
        <div className="grid grid-cols-3 gap-2">
          <label className="block">
            <span className={LABEL}>Accept threshold</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={Number(c.acceptThreshold ?? 0.85)}
              onChange={(e) => onConfig("acceptThreshold", Number(e.target.value))}
              className={FIELD}
            />
          </label>
          <label className="block">
            <span className={LABEL}>Translate codes</span>
            <select
              value={c.translate ? "yes" : "no"}
              onChange={(e) => onConfig("translate", e.target.value === "yes")}
              className={FIELD}
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </label>
          <label className="block">
            <span className={LABEL}>Target system</span>
            <select
              value={(c.targetSystem as string) || "icd10"}
              onChange={(e) => onConfig("targetSystem", e.target.value)}
              className={FIELD}
            >
              <option value="icd10">ICD-10</option>
              <option value="icdo">ICD-O</option>
              <option value="ctv3">CTV3</option>
            </select>
          </label>
        </div>
      );
    case "validate":
      return (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className={LABEL}>Min confidence (else flag)</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={Number(c.minConfidence ?? 0.6)}
              onChange={(e) => onConfig("minConfidence", Number(e.target.value))}
              className={FIELD}
            />
          </label>
          <label className="block">
            <span className={LABEL}>Duplicates</span>
            <select
              value={c.skipDuplicates ? "skip" : "keep"}
              onChange={(e) => onConfig("skipDuplicates", e.target.value === "skip")}
              className={FIELD}
            >
              <option value="skip">Skip duplicates</option>
              <option value="keep">Keep duplicates</option>
            </select>
          </label>
        </div>
      );
    case "save":
      return (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className={LABEL}>Object type</span>
            <input
              value={(c.objectType as string) || ""}
              onChange={(e) => onConfig("objectType", e.target.value)}
              placeholder="ClinicalFinding"
              className={FIELD}
            />
          </label>
          <label className="block">
            <span className={LABEL}>Patient identifier (JSON path)</span>
            <input
              value={(c.patientIdentifierSource as string) || ""}
              onChange={(e) => onConfig("patientIdentifierSource", e.target.value)}
              placeholder="mrn or patient.id"
              className={FIELD}
            />
          </label>
        </div>
      );
  }
}

function WebhookUrlRow({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-1.5">
      <input readOnly value={url} className={cn(FIELD, "font-mono text-[10px]")} />
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="shrink-0 rounded border border-[#d3d8de] bg-white px-2 text-[#5f6b7c] hover:border-[#2d72d2] hover:text-[#2d72d2]"
        aria-label="Copy webhook URL"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

const STAGE_ORDER: ChannelStepType[] = ["intake", "transform", "extract", "validate", "save"];

function StageProgress({
  steps,
  stage,
  timings,
}: {
  steps: ChannelStep[];
  stage: ChannelStepType | "done";
  timings: Record<string, number>;
}) {
  const present = STAGE_ORDER.filter((t) => steps.some((s) => s.type === t));
  const stageIdx = stage === "done" ? present.length : present.indexOf(stage);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {present.map((t, i) => {
        const done = stage === "done" || i < stageIdx;
        const running = i === stageIdx && stage !== "done";
        const ms = timings[t];
        return (
          <span
            key={t}
            className={cn(
              "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]",
              done
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : running
                  ? "border-[#2d72d2] bg-[#e7f2fd] text-[#215db0]"
                  : "border-[#d3d8de] text-[#8f99a8]",
            )}
          >
            {done ? (
              <Check className="h-2.5 w-2.5" />
            ) : running ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            ) : (
              <CircleDashed className="h-2.5 w-2.5" />
            )}
            {STEP_LABELS[t]}
            {done && ms !== undefined ? ` · ${ms}ms` : ""}
          </span>
        );
      })}
    </div>
  );
}
