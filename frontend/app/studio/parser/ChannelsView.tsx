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
  ArrowRightLeft,
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
  Inbox,
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
import {
  listEnvTypes,
  listIngestSources,
  type IngestSource,
} from "@/lib/platform-api";
import {
  createChannel,
  deleteChannel,
  executeChannel,
  getPlatformHealth,
  listChannelRuns,
  listChannels,
  newStep,
  listReviewItems,
  provisionChannelWebhook,
  resolveReviewItem,
  stepSummary,
  updateChannel,
  STEP_LABELS,
  type ChannelRun,
  type ChannelRunOutcome,
  type ChannelStep,
  type ChannelStepType,
  type ChannelStatus,
  type DataChannel,
  type ReviewItem,
  type StepIoEntry,
} from "../channels-api";
import { useStudio } from "../StudioShell";

const STEP_VISUALS: Record<
  ChannelStepType,
  { Icon: LucideIcon; bg: string; text: string }
> = {
  intake: { Icon: Webhook, bg: "bg-brand-soft", text: "text-brand-deep" },
  transform: { Icon: Wand2, bg: "bg-scenario-soft", text: "text-scenario" },
  map: { Icon: ArrowRightLeft, bg: "bg-ok-soft", text: "text-ok-ink" },
  extract: { Icon: Search, bg: "bg-brand-soft", text: "text-brand-deep" },
  validate: { Icon: ShieldCheck, bg: "bg-warn-soft", text: "text-warn-ink" },
  save: { Icon: Database, bg: "bg-ok-soft", text: "text-ok-ink" },
};

const STATUS_META: Record<ChannelStatus, { label: string; dot: string; chip: string }> = {
  live: { label: "Live", dot: "bg-ok", chip: "bg-ok-soft text-ok-ink" },
  paused: { label: "Paused", dot: "bg-warn", chip: "bg-warn-soft text-warn-ink" },
  draft: { label: "Draft", dot: "bg-ink-ghost", chip: "bg-canvas text-ink-muted" },
};

const SAMPLE_NOTE =
  "Patiente de 67 ans admise pour douleur thoracique. ATCD: diabète type 2, HTA. " +
  "Pas d'allergie connue. ECG: sus-décalage ST. Troponines élevées — IDM antérieur probable. " +
  "Mise sous aspirine.";

// Only these step types can appear more than zero times; extract/save/intake
// are singletons in the catalog once present.
const SINGLETON_TYPES: ChannelStepType[] = ["intake", "map", "extract", "save"];

export default function ChannelsView({ onOpenGraph }: { onOpenGraph: () => void }) {
  const { hasKey, selectedEnv } = useStudio();
  const env = selectedEnv;

  const [channels, setChannels] = useState<DataChannel[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [draftSteps, setDraftSteps] = useState<ChannelStep[]>([]);
  const [runs, setRuns] = useState<ChannelRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nlpDown, setNlpDown] = useState(false);
  const [nlpNoticeDismissed, setNlpNoticeDismissed] = useState(false);

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

  const [envTypes, setEnvTypes] = useState<string[]>([]);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [reviewPending, setReviewPending] = useState(0);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

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
    if (!env) {
      setEnvTypes([]);
      return;
    }
    listEnvTypes(env)
      .then(({ types }) => setEnvTypes(types.map((t) => t.name).sort()))
      .catch(() => setEnvTypes([]));
  }, [env]);

  const loadReview = useCallback(async () => {
    if (!env) {
      setReviewItems([]);
      setReviewPending(0);
      return;
    }
    try {
      const { items, pendingCount } = await listReviewItems(env, { status: "pending", limit: 25 });
      setReviewItems(items);
      setReviewPending(pendingCount);
    } catch {
      /* review queue is best-effort UI */
    }
  }, [env]);

  useEffect(() => {
    void loadReview();
  }, [loadReview]);

  async function handleResolveReview(id: string, action: "confirm" | "reject") {
    if (!env || resolvingId) return;
    setResolvingId(id);
    try {
      await resolveReviewItem(env, id, action);
      setReviewItems((cur) => cur.filter((i) => i.id !== id));
      setReviewPending((n) => Math.max(0, n - 1));
      if (action === "confirm") await loadChannels();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setResolvingId(null);
    }
  }

  // Surface extraction-service outages: poll the readiness probe so users see
  // why runs queue/fail instead of a silent empty Manager.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const health = await getPlatformHealth();
      if (cancelled || !health) return;
      const down = health.nlp.configured && !health.nlp.ok;
      setNlpDown((prev) => {
        if (down && !prev) setNlpNoticeDismissed(false);
        return down;
      });
    };
    void check();
    const timer = setInterval(() => void check(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

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
    await loadReview();
  }, [env, selectedSlug, loadChannels, loadReview]);

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
      <div className="flex flex-1 items-center justify-center bg-surface">
        <p className="max-w-sm text-center text-sm text-ink-muted">
          Sign in and create an API key to build data channels.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas">
      {/* Top bar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-4 py-2">
        <span className="flex h-6 w-6 items-center justify-center rounded bg-brand-soft text-brand">
          <Webhook className="h-3.5 w-3.5" />
        </span>
        <span className="text-[13px] font-semibold text-ink">Data channels</span>
        <span className="hidden rounded border border-line px-2 py-0.5 text-[11px] text-ink-body sm:inline">
          {env ?? "no environment"}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onOpenGraph}
          className="text-[11px] text-ink-muted hover:text-brand hover:underline"
        >
          Advanced: graph editor
        </button>
        <button
          type="button"
          disabled={!env}
          onClick={() => setShowNewForm((v) => !v)}
          className="flex items-center gap-1 rounded bg-brand px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-deep disabled:bg-ink-ghost"
        >
          <Plus className="h-3.5 w-3.5" />
          New channel
        </button>
      </div>

      {error ? (
        <div className="flex items-center gap-2 border-b border-danger-line bg-danger-soft px-4 py-1.5 text-[11px] text-danger-ink">
          <span className="min-w-0 flex-1 truncate">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : null}

      {nlpDown && !nlpNoticeDismissed ? (
        <div className="flex items-center gap-2 border-b border-warn-line bg-warn-soft px-4 py-1.5 text-[11px] text-warn-ink">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            Extraction service unreachable — incoming data is queued and will retry automatically.
          </span>
          <button
            type="button"
            onClick={() => setNlpNoticeDismissed(true)}
            aria-label="Dismiss extraction service notice"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {/* Channel list rail */}
        <aside className="flex w-52 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface">
          <div className="px-3 pb-1 pt-2.5 text-[10px] font-medium uppercase tracking-[0.12em] text-ink-faint">
            Channels · {channels.length}
          </div>
          {showNewForm ? (
            <div className="mx-2 mb-1 flex flex-col gap-1.5 rounded border border-line p-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCreate();
                }}
                placeholder="e.g. ED admission notes"
                autoFocus
                className="w-full rounded border border-line bg-canvas px-2 py-1 text-xs text-ink focus:border-brand focus:outline-none"
              />
              <button
                type="button"
                disabled={!newName.trim() || busy}
                onClick={() => void handleCreate()}
                className="rounded bg-brand px-2 py-1 text-[11px] font-medium text-white hover:bg-brand-deep disabled:bg-ink-ghost"
              >
                Create channel
              </button>
            </div>
          ) : null}
          <div className="flex flex-col gap-0.5 px-2 pb-2">
            {channels.length === 0 ? (
              <p className="px-2 py-1 text-[11px] text-ink-faint">
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
                      active ? "bg-brand-soft" : "hover:bg-surface-hover",
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", meta.dot)} />
                      <span
                        className={cn(
                          "truncate text-xs",
                          active ? "font-medium text-brand-deep" : "text-ink",
                        )}
                      >
                        {c.name}
                      </span>
                    </span>
                    <span className="ml-3 block text-[10px] text-ink-faint">
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
              <p className="max-w-sm text-center text-sm text-ink-muted">
                {env
                  ? "Create a channel to define a reusable parse pipeline."
                  : "Select or create an environment first."}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 p-4">
              {/* Header */}
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[15px] font-semibold text-ink">{selected.name}</h2>
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
                    className="rounded bg-brand px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-deep disabled:bg-ink-ghost"
                  >
                    Save changes
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setTestOpen(true)}
                  className="flex items-center gap-1 rounded border border-line bg-surface px-2.5 py-1.5 text-xs text-ink-body hover:border-brand"
                >
                  <Play className="h-3 w-3" />
                  Test run
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleStatusToggle()}
                  className="flex items-center gap-1 rounded border border-line bg-surface px-2.5 py-1.5 text-xs text-ink-body hover:border-brand"
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
                  className="rounded border border-line bg-surface p-1.5 text-ink-faint hover:border-danger-line hover:text-danger"
                  aria-label="Delete channel"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatCard
                  label={
                    selected.stats.queuedJobs > 0
                      ? `Runs today · ${selected.stats.queuedJobs.toLocaleString()} queued`
                      : "Runs today"
                  }
                  value={selected.stats.runsToday.toLocaleString()}
                />
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
                      envTypes={envTypes}
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

              {/* Recent runs: click one to inspect each step input/output */}
              <div className="flex flex-col gap-1 border-t border-line pt-2 text-[11px] text-ink-faint">
                {runs.length === 0 ? (
                  <span>No runs yet — try a test run.</span>
                ) : (
                  runs.map((r) => (
                    <div key={r.id}>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedRunId((cur) => (cur === r.id ? null : r.id))
                        }
                        className={cn(
                          "flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-surface-hover",
                          expandedRunId === r.id && "bg-canvas",
                        )}
                        title={r.error ?? undefined}
                      >
                        {r.status === "failed" ? (
                          <X className="h-3 w-3 shrink-0 text-danger" />
                        ) : r.status === "flagged" ? (
                          <AlertTriangle className="h-3 w-3 shrink-0 text-warn" />
                        ) : (
                          <Check className="h-3 w-3 shrink-0 text-ok-ink" />
                        )}
                        <span className="truncate">
                          {new Date(r.createdAt).toLocaleTimeString()} · {r.conceptCount} concepts ·{" "}
                          {r.savedCount} saved
                          {r.flaggedCount > 0 ? ` · ${r.flaggedCount} flagged` : ""}
                          {r.status === "failed" && r.error ? ` · ${r.error}` : ""}
                        </span>
                        <ChevronDown
                          className={cn(
                            "ml-auto h-3 w-3 shrink-0 transition-transform",
                            expandedRunId === r.id && "rotate-180",
                          )}
                        />
                      </button>
                      {expandedRunId === r.id ? (
                        r.stepIo.length > 0 ? (
                          <StepIoList entries={r.stepIo} />
                        ) : (
                          <p className="px-1 py-1 text-[10px] text-ink-faint">
                            No step snapshots for this run (recorded before step
                            capture existed).
                          </p>
                        )
                      ) : null}
                    </div>
                  ))
                )}
              </div>

              {/* Review queue: flagged extractions awaiting a human decision */}
              {reviewItems.length > 0 ? (
                <div className="rounded-md border border-warn-line bg-surface">
                  <div className="flex items-center gap-2 border-b border-warn-line bg-warn-soft/60 px-3 py-2">
                    <Inbox className="h-3.5 w-3.5 text-warn-ink" />
                    <span className="text-xs font-semibold text-ink">
                      Review queue
                    </span>
                    <span className="rounded bg-warn-soft px-1.5 py-0.5 text-[10px] font-semibold text-warn-ink">
                      {reviewPending} pending
                    </span>
                    <span className="ml-auto text-[10px] text-ink-faint">
                      flagged extractions are kept here, not discarded
                    </span>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {reviewItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-2 border-b border-line-faint px-3 py-1.5 last:border-b-0"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-xs font-medium text-ink">
                              {item.span}
                            </span>
                            {item.code ? (
                              <span className="shrink-0 rounded bg-brand-soft px-1 py-0.5 text-[9px] text-brand-deep">
                                {item.code}
                              </span>
                            ) : null}
                            <span
                              className={cn(
                                "shrink-0 rounded px-1 py-0.5 text-[9px] font-medium",
                                item.decision === "escalate"
                                  ? "bg-danger-soft text-danger-ink"
                                  : "bg-warn-soft text-warn-ink",
                              )}
                            >
                              {item.decision}
                            </span>
                          </span>
                          <span className="block truncate text-[10px] text-ink-faint">
                            {item.display ?? item.span}
                            {item.confidence !== null
                              ? ` · ${(item.confidence * 100).toFixed(0)}%`
                              : ""}{" "}
                            · {item.channelName} · {new Date(item.createdAt).toLocaleString()}
                          </span>
                        </span>
                        <button
                          type="button"
                          disabled={resolvingId !== null}
                          onClick={() => void handleResolveReview(item.id, "confirm")}
                          className="shrink-0 rounded border border-ok-line bg-ok-soft px-2 py-1 text-[10px] font-medium text-ok-ink hover:bg-ok-soft disabled:opacity-50"
                        >
                          {resolvingId === item.id ? "…" : "Confirm & save"}
                        </button>
                        <button
                          type="button"
                          disabled={resolvingId !== null}
                          onClick={() => void handleResolveReview(item.id, "reject")}
                          className="shrink-0 rounded border border-line px-2 py-1 text-[10px] font-medium text-ink-muted hover:bg-surface-hover disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Test run drawer */}
        {testOpen && selected ? (
          <aside className="flex w-[26rem] shrink-0 flex-col border-l border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <span className="text-xs font-semibold text-ink">
                Test run · {selected.name}
              </span>
              <button
                type="button"
                onClick={() => setTestOpen(false)}
                className="text-ink-faint hover:text-ink"
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
                className="w-full resize-y rounded border border-line bg-canvas px-2.5 py-2 text-xs text-ink focus:border-brand focus:outline-none"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTestText(SAMPLE_NOTE)}
                  className="text-[11px] text-ink-muted hover:text-brand hover:underline"
                >
                  use sample note
                </button>
                <span className="flex-1" />
                <button
                  type="button"
                  disabled={runStage !== null && runStage !== "done" && !runError}
                  onClick={() => void handleTestRun()}
                  className="flex items-center gap-1 rounded bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-deep disabled:bg-ink-ghost"
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
                <p className="rounded border border-danger-line bg-danger-soft px-2 py-1.5 text-[11px] text-danger-ink">
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

              {outcome && outcome.stepIo.length > 0 ? (
                <StepIoList entries={outcome.stepIo} />
              ) : null}

              {outcome ? (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
                    <span>
                      {outcome.rows.length} concepts · {outcome.acceptedCount} accepted ·{" "}
                      {outcome.flaggedCount} flagged · {(outcome.durationMs / 1000).toFixed(1)}s
                    </span>
                    {outcome.persisted ? (
                      <span className="rounded bg-ok-soft px-1.5 py-0.5 font-medium text-ok-ink">
                        {outcome.persisted.objectIds.length} saved to{" "}
                        {outcome.persisted.objectType}
                      </span>
                    ) : null}
                  </div>
                  <div className="overflow-hidden rounded border border-line">
                    <table className="w-full border-collapse text-left text-[11px]">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-wide text-ink-faint">
                          <th className="border-b border-line px-2 py-1.5 font-medium">
                            Term
                          </th>
                          <th className="border-b border-line px-2 py-1.5 font-medium">
                            SNOMED
                          </th>
                          <th className="border-b border-line px-2 py-1.5 font-medium">
                            Conf.
                          </th>
                          <th className="border-b border-line px-2 py-1.5 font-medium">
                            Context
                          </th>
                          <th className="border-b border-line px-2 py-1.5 font-medium">
                            Decision
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {outcome.rows.map((r, i) => (
                          <tr key={`${r.span}-${i}`} className="text-ink-body">
                            <td className="border-b border-line-soft px-2 py-1.5 font-medium text-ink">
                              {r.span}
                            </td>
                            <td className="border-b border-line-soft px-2 py-1.5 text-[10px]">
                              {r.code ?? "—"}
                            </td>
                            <td className="border-b border-line-soft px-2 py-1.5">
                              <div className="h-1 w-12 overflow-hidden rounded bg-canvas-raised">
                                <div
                                  className={cn(
                                    "h-full",
                                    r.confidence >= 0.8
                                      ? "bg-ok"
                                      : r.confidence >= 0.6
                                        ? "bg-warn"
                                        : "bg-danger",
                                  )}
                                  style={{ width: `${Math.round(r.confidence * 100)}%` }}
                                />
                              </div>
                            </td>
                            <td className="border-b border-line-soft px-2 py-1.5">
                              <span
                                className={cn(
                                  "rounded px-1 py-0.5 text-[10px] font-medium",
                                  r.assertion === "negated"
                                    ? "bg-danger-soft text-danger-ink"
                                    : r.assertion === "affirmed"
                                      ? "bg-ok-soft text-ok-ink"
                                      : "bg-canvas-raised text-ink-muted",
                                )}
                              >
                                {r.assertion}
                              </span>
                            </td>
                            <td className="border-b border-line-soft px-2 py-1.5">
                              <span
                                className={cn(
                                  "rounded px-1 py-0.5 text-[10px] font-medium",
                                  r.decision === "accept"
                                    ? "bg-ok-soft text-ok-ink"
                                    : r.decision === "duplicate"
                                      ? "bg-canvas-raised text-ink-muted"
                                      : "bg-warn-soft text-warn-ink",
                                )}
                              >
                                {r.decision}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {outcome.rows.length === 0 ? (
                          <tr>
                            <td className="px-2 py-1.5 text-ink-faint" colSpan={5}>
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
    <div className="rounded-md bg-surface px-3 py-2 shadow-[inset_0_0_0_1px_#333333]">
      <p
        className={cn(
          "text-[10px] font-medium uppercase tracking-wide",
          warn ? "text-warn-ink" : "text-ink-faint",
        )}
      >
        {label}
      </p>
      <p className={cn("text-base font-semibold", warn ? "text-warn-ink" : "text-ink")}>
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
      <span className="h-3 w-px bg-ink-ghost" />
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
              className="rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] text-ink-body hover:border-brand hover:text-brand"
            >
              {STEP_LABELS[t]}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-ink-faint"
            aria-label="Cancel add step"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1 text-[10px] text-ink-faint hover:text-brand"
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

/** Per-step input/output snapshots for a run — the debugging view. */
function StepIoList({ entries }: { entries: StepIoEntry[] }) {
  return (
    <div className="mb-1 flex flex-col gap-1 rounded border border-line-soft bg-canvas-raised p-2">
      {entries.map((e, i) => {
        const visuals = STEP_VISUALS[e.type as ChannelStepType];
        const Icon = visuals?.Icon;
        return (
          <div key={`${e.stepId}-${i}`} className="flex flex-col gap-0.5">
            <span className="flex items-center gap-1.5">
              {Icon ? (
                <span
                  className={cn(
                    "flex h-4 w-4 items-center justify-center rounded",
                    visuals.bg,
                    visuals.text,
                  )}
                >
                  <Icon className="h-2.5 w-2.5" />
                </span>
              ) : null}
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                {e.type}
              </span>
              {e.note ? <span className="text-[10px] text-ink-faint">{e.note}</span> : null}
            </span>
            <div className="grid grid-cols-2 gap-1">
              <div className="min-w-0">
                <span className="block text-[9px] uppercase tracking-wide text-ink-faint">in</span>
                <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded bg-surface p-1 font-mono text-[9.5px] leading-snug text-ink-body ring-1 ring-line-soft">
                  {e.input || "—"}
                </pre>
              </div>
              <div className="min-w-0">
                <span className="block text-[9px] uppercase tracking-wide text-ink-faint">out</span>
                <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded bg-surface p-1 font-mono text-[9.5px] leading-snug text-ink-body ring-1 ring-line-soft">
                  {e.output || "—"}
                </pre>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StepCard({
  step,
  index,
  total,
  onToggle,
  onMove,
  onRemove,
  onConfig,
  envTypes,
  intake,
}: {
  step: ChannelStep;
  index: number;
  total: number;
  onToggle: () => void;
  onMove: (delta: -1 | 1) => void;
  onRemove?: () => void;
  onConfig: (key: string, value: unknown) => void;
  envTypes?: string[];
  intake?: IntakeContext;
}) {
  const [expanded, setExpanded] = useState(false);
  const { Icon, bg, text } = STEP_VISUALS[step.type];
  return (
    <div
      className={cn(
        "rounded-md border bg-surface",
        step.enabled ? "border-line" : "border-dashed border-line-strong opacity-70",
      )}
    >
      <div className="flex items-center gap-2.5 px-3 py-2">
        <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded", bg, text)}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-xs font-medium text-ink">{STEP_LABELS[step.type]}</span>
            <button
              type="button"
              onClick={onToggle}
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-medium",
                step.enabled
                  ? "bg-ok-soft text-ok-ink"
                  : "bg-canvas-raised text-ink-faint",
              )}
            >
              {step.enabled ? "on" : "off"}
            </button>
          </span>
          <span className="block truncate text-[10px] text-ink-faint">
            {stepSummary(step)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-ink-faint">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            className="rounded p-0.5 hover:text-brand disabled:opacity-30"
            aria-label="Move step up"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            className="rounded p-0.5 hover:text-brand disabled:opacity-30"
            aria-label="Move step down"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {onRemove ? (
            <button
              type="button"
              onClick={onRemove}
              className="rounded p-0.5 hover:text-danger"
              aria-label="Remove step"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className={cn("rounded p-0.5", expanded ? "text-brand" : "hover:text-brand")}
            aria-label="Step settings"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
      {expanded ? (
        <div className="border-t border-line-soft px-3 py-2.5">
          <StepConfigForm step={step} onConfig={onConfig} envTypes={envTypes} intake={intake} />
        </div>
      ) : null}
    </div>
  );
}

const FIELD =
  "w-full rounded border border-line bg-canvas px-2 py-1 text-xs text-ink focus:border-brand focus:outline-none";
const LABEL = "mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-ink-faint";

function StepConfigForm({
  step,
  onConfig,
  envTypes,
  intake,
}: {
  step: ChannelStep;
  onConfig: (key: string, value: unknown) => void;
  envTypes?: string[];
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
                <p className="text-[10px] text-ink-faint">
                  Payloads run this channel server-side while it is live. Send{" "}
                  <span className="rounded bg-canvas-raised px-1 ring-1 ring-line-soft">
                    {'{ "text": "…" }'}
                  </span>{" "}
                  or set a JSON field
                  path in the transform step.
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={intake.provisioning}
                  onClick={intake.onProvision}
                  className="flex items-center gap-1 rounded bg-brand px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-deep disabled:bg-ink-ghost"
                >
                  {intake.provisioning ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Webhook className="h-3 w-3" />
                  )}
                  Generate webhook URL
                </button>
                <span className="text-[10px] text-ink-faint">
                  Creates a dedicated inbound webhook for this channel.
                </span>
              </div>
            )
          ) : null}
          {mode === "source" && intake?.sourceId ? (
            <p className="text-[10px] text-ink-faint">
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
    case "map": {
      const rules = (Array.isArray(c.mappings) ? c.mappings : []) as {
        from: string;
        to: string;
      }[];
      const setRules = (next: { from: string; to: string }[]) => onConfig("mappings", next);
      const types = envTypes ?? [];
      return (
        <div className="flex flex-col gap-2">
          <label className="block">
            <span className={LABEL}>Target object type (from the ontology)</span>
            {types.length > 0 ? (
              <select
                value={(c.objectType as string) || ""}
                onChange={(e) => onConfig("objectType", e.target.value)}
                className={FIELD}
              >
                <option value="">Select a type…</option>
                {types.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={(c.objectType as string) || ""}
                onChange={(e) => onConfig("objectType", e.target.value)}
                placeholder="LabResult"
                className={FIELD}
              />
            )}
          </label>
          <div className="flex flex-col gap-1.5">
            <span className={LABEL}>Key mappings — payload key → property</span>
            {rules.map((rule, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input
                  value={rule.from}
                  onChange={(e) =>
                    setRules(rules.map((r, j) => (j === i ? { ...r, from: e.target.value } : r)))
                  }
                  placeholder="payload key (e.g. mrn or lab.value)"
                  className={FIELD}
                />
                <ArrowRightLeft className="h-3 w-3 shrink-0 text-ink-faint" />
                <input
                  value={rule.to}
                  onChange={(e) =>
                    setRules(rules.map((r, j) => (j === i ? { ...r, to: e.target.value } : r)))
                  }
                  placeholder="property (e.g. identifier)"
                  className={FIELD}
                />
                <button
                  type="button"
                  onClick={() => setRules(rules.filter((_, j) => j !== i))}
                  className="shrink-0 rounded p-0.5 text-ink-faint hover:text-danger"
                  aria-label="Remove mapping"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setRules([...rules, { from: "", to: "" }])}
              className="self-start text-[11px] text-brand hover:underline"
            >
              + add mapping
            </button>
          </div>
          <p className="text-[10px] leading-relaxed text-ink-faint">
            Structured JSON payloads are mapped key-by-key onto the selected object
            type and saved directly — the NLP extract/validate steps are skipped.
            Arrays map each object (max 100 per payload).
          </p>
        </div>
      );
    }
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
        className="shrink-0 rounded border border-line bg-surface px-2 text-ink-muted hover:border-brand hover:text-brand"
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
                ? "border-ok-line bg-ok-soft text-ok-ink"
                : running
                  ? "border-brand bg-brand-soft text-brand-deep"
                  : "border-line text-ink-faint",
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
