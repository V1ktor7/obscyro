"use client";

/**
 * Feed simulator — Model Lab tab. Streams run SERVER-SIDE: the API process
 * generates objects and POSTs them to channel webhooks continuously, even
 * with no browser open, and resumes after restarts. This tab is the remote
 * control: config edits save to the server, Start/Pause flips server state,
 * and the send log polls the server's recent sends.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Activity,
  Ambulance,
  Bolt,
  FileCode,
  Pause,
  Play,
  Plus,
  Terminal,
  Trash2,
  Unplug,
  Upload,
  Webhook,
  X,
} from "lucide-react";

import { cn } from "@/lib/cn";
import { listChannels, type DataChannel } from "../channels-api";
import { parseCsvRows } from "../csv-parse";
import {
  createFeedStream,
  defaultStreamConfig,
  deleteFeedStream,
  injectFeedEvent,
  listFeedSends,
  listFeedStreams,
  previewTemplate,
  TEMPLATE_LIBRARY,
  updateFeedStream,
  type FeedSend,
  type FeedStream,
  type FeedStreamConfig,
} from "../feed-sim";

const FIELD =
  "rounded border border-[#d3d8de] bg-[#f6f7f9] px-2 py-1.5 text-xs text-[#1c2127] focus:border-[#2d72d2] focus:outline-none";
const LABEL = "mb-1 block text-[10px] font-medium uppercase tracking-wide text-[#8f99a8]";

export default function FeedSimulatorTab({ env }: { env: string | null }) {
  const [streams, setStreams] = useState<FeedStream[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<FeedStreamConfig | null>(null);
  const [draftName, setDraftName] = useState("");
  const [sends, setSends] = useState<FeedSend[]>([]);
  const [channels, setChannels] = useState<DataChannel[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const selected = streams.find((s) => s.id === selectedId) ?? null;

  const load = useCallback(async () => {
    if (!env) {
      setStreams([]);
      setSelectedId(null);
      return;
    }
    try {
      const { streams: list } = await listFeedStreams(env);
      setStreams(list);
      setSelectedId((cur) => (cur && list.some((s) => s.id === cur) ? cur : list[0]?.id ?? null));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [env]);

  useEffect(() => {
    setError(null);
    void load();
    void (env
      ? listChannels(env)
          .then(({ channels: ch }) => setChannels(ch))
          .catch(() => setChannels([]))
      : setChannels([]));
    const handle = setInterval(() => void load(), 5_000);
    return () => clearInterval(handle);
  }, [env, load]);

  // Sync the editable draft when selection changes (not on poll refreshes).
  useEffect(() => {
    if (!selected) {
      setDraft(null);
      setDraftName("");
      return;
    }
    setDraft(JSON.parse(JSON.stringify(selected.config)) as FeedStreamConfig);
    setDraftName(selected.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Poll the send log for the selected stream.
  useEffect(() => {
    if (!env || !selectedId) {
      setSends([]);
      return;
    }
    let cancelled = false;
    const poll = () =>
      void listFeedSends(env, { streamId: selectedId, limit: 8 })
        .then(({ sends: s }) => {
          if (!cancelled) setSends(s);
        })
        .catch(() => undefined);
    poll();
    const handle = setInterval(poll, 4_000);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [env, selectedId]);

  const dirty = useMemo(
    () =>
      selected !== null &&
      draft !== null &&
      (JSON.stringify(draft) !== JSON.stringify(selected.config) || draftName !== selected.name),
    [selected, draft, draftName],
  );

  function patchDraft(p: Partial<FeedStreamConfig>) {
    setDraft((cur) => (cur ? { ...cur, ...p } : cur));
  }

  async function handleCreate() {
    if (!env || busy) return;
    setBusy(true);
    try {
      const config = defaultStreamConfig();
      if (channels[0]) config.channelSlug = channels[0].slug;
      const created = await createFeedStream(env, {
        name: `Stream ${streams.length + 1}`,
        config,
      });
      await load();
      setSelectedId(created.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    if (!env || !selected || !draft || busy) return;
    setBusy(true);
    try {
      await updateFeedStream(env, selected.id, { name: draftName.trim(), config: draft });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleToggle(stream: FeedStream) {
    if (!env || busy) return;
    setBusy(true);
    try {
      // Unsaved edits ride along when starting the selected stream.
      const body: { status: "running" | "paused"; config?: FeedStreamConfig; name?: string } = {
        status: stream.status === "running" ? "paused" : "running",
      };
      if (stream.id === selectedId && dirty && draft) {
        body.config = draft;
        body.name = draftName.trim();
      }
      await updateFeedStream(env, stream.id, body);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!env || !selected || busy) return;
    if (!window.confirm(`Delete stream "${selected.name}"?`)) return;
    setBusy(true);
    try {
      await deleteFeedStream(env, selected.id);
      setSelectedId(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleInject(kind: "surge" | "stall") {
    if (!env || !selected || busy) return;
    try {
      await injectFeedEvent(env, selected.id, {
        kind,
        minutes: kind === "surge" ? 30 : 15,
        factor: 4,
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function importDataset(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCsvRows(String(reader.result ?? ""));
      if (rows.length === 0) return;
      setDraft((cur) =>
        cur
          ? {
              ...cur,
              templateMode: "dataset",
              datasets: [...cur.datasets, { name: file.name, rows: rows.slice(0, 2000) }],
            }
          : cur,
      );
    };
    reader.readAsText(file);
  }

  if (!env) {
    return <p className="text-sm text-[#5f6b7c]">Select an environment first.</p>;
  }

  const now = Date.now();
  const surgeActive = selected?.surgeUntil && new Date(selected.surgeUntil).getTime() > now;
  const stallActive = selected?.stallUntil && new Date(selected.stallUntil).getTime() > now;
  const previewRow = draft?.templateMode === "dataset" ? draft.datasets[0]?.rows[0] : undefined;
  const datasetRowCount = draft?.datasets.reduce((n, d) => n + d.rows.length, 0) ?? 0;
  const totals = streams.reduce(
    (acc, s) => ({
      sent: acc.sent + s.sentCount,
      failed: acc.failed + s.failedCount,
      running: acc.running + (s.status === "running" ? 1 : 0),
    }),
    { sent: 0, failed: 0, running: 0 },
  );

  return (
    <div className="flex min-h-0 flex-col gap-2">
      {error ? (
        <div className="flex items-center gap-2 rounded border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] text-rose-700">
          <span className="min-w-0 flex-1 truncate">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : null}
      <div className="flex min-h-0 gap-3">
        {/* Streams rail */}
        <aside className="flex w-52 shrink-0 flex-col gap-0.5 rounded-md border border-[#d3d8de] bg-white p-2">
          <p className="px-1 pb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[#8f99a8]">
            Streams · {streams.length}
          </p>
          {streams.map((s) => {
            const active = s.id === selectedId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedId(s.id)}
                className={cn(
                  "rounded px-2 py-1.5 text-left",
                  active ? "bg-[#e7f2fd]" : "hover:bg-[#f6f7f9]",
                )}
              >
                <span className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      s.status === "running" ? "bg-emerald-500" : "bg-gray-300",
                    )}
                  />
                  <span
                    className={cn(
                      "truncate text-xs",
                      active ? "font-medium text-[#215db0]" : "text-[#1c2127]",
                    )}
                  >
                    {s.name}
                  </span>
                </span>
                <span className="ml-3 block truncate text-[10px] text-[#8f99a8]">
                  {s.status === "running" ? `${s.config.ratePerSec}/s · ` : "paused · "}
                  {s.sentCount.toLocaleString()} sent
                  {s.lastError ? ` · ${s.lastError}` : ""}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => void handleCreate()}
            className="mt-1 flex items-center gap-1.5 rounded border border-dashed border-[#c5cbd3] px-2 py-1.5 text-[11px] text-[#5f6b7c] hover:border-[#2d72d2] hover:text-[#2d72d2]"
          >
            <Plus className="h-3 w-3" />
            new stream
          </button>
          <p className="mt-auto px-1 pt-2 text-[10px] leading-relaxed text-[#8f99a8]">
            {totals.running} running · {totals.sent.toLocaleString()} sent · {totals.failed} failed
            — streams run on the server, even with this page closed
          </p>
        </aside>

        {/* Stream editor */}
        {!selected || !draft ? (
          <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-[#c5cbd3] bg-white p-8">
            <p className="text-sm text-[#5f6b7c]">Create a stream to start feeding the network.</p>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {/* Header */}
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                className="w-44 rounded border border-transparent bg-transparent px-1 py-0.5 text-[13px] font-semibold text-[#1c2127] hover:border-[#d3d8de] focus:border-[#2d72d2] focus:outline-none"
                aria-label="Stream name"
              />
              {surgeActive ? (
                <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">
                  surge active
                </span>
              ) : null}
              {stallActive ? (
                <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                  stalled
                </span>
              ) : null}
              <span className="flex-1" />
              {dirty ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleSave()}
                  className="rounded bg-[#2d72d2] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#215db0] disabled:bg-[#c5cbd3]"
                >
                  Save changes
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void handleInject("surge")}
                className="flex items-center gap-1 rounded border border-rose-200 px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-50"
              >
                <Ambulance className="h-3 w-3" />
                Surge ×4 · 30 min
              </button>
              <button
                type="button"
                onClick={() => void handleInject("stall")}
                className="flex items-center gap-1 rounded border border-amber-200 px-2 py-1 text-[11px] text-amber-700 hover:bg-amber-50"
              >
                <Unplug className="h-3 w-3" />
                Stall · 15 min
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleToggle(selected)}
                className={cn(
                  "flex items-center gap-1 rounded px-3 py-1.5 text-xs font-medium",
                  selected.status === "running"
                    ? "border border-[#d3d8de] bg-white text-[#404854]"
                    : "bg-[#2d72d2] text-white hover:bg-[#215db0] disabled:bg-[#c5cbd3]",
                )}
              >
                {selected.status === "running" ? (
                  <Pause className="h-3 w-3" />
                ) : (
                  <Play className="h-3 w-3" />
                )}
                {selected.status === "running" ? "Pause" : "Start"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleDelete()}
                className="rounded border border-[#d3d8de] p-1.5 text-[#8f99a8] hover:border-rose-300 hover:text-rose-600"
                aria-label="Delete stream"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Target */}
            <div className="rounded-md border border-[#d3d8de] bg-white p-3">
              <div className="mb-2 flex items-center gap-2">
                <Webhook className="h-4 w-4 text-[#2d72d2]" />
                <span className="text-[13px] font-semibold text-[#1c2127]">Target</span>
                {selected.lastError ? (
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                    {selected.lastError}
                  </span>
                ) : null}
                <span className="ml-auto flex gap-1">
                  {(
                    [
                      ["channel", "Channel"],
                      ["url", "Paste URL"],
                    ] as const
                  ).map(([m, label]) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => patchDraft({ targetMode: m })}
                      className={cn(
                        "rounded px-2 py-0.5 text-[11px]",
                        draft.targetMode === m
                          ? "bg-[#e7f2fd] font-medium text-[#215db0]"
                          : "border border-[#d3d8de] text-[#8f99a8]",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </span>
              </div>
              {draft.targetMode === "channel" ? (
                <select
                  value={draft.channelSlug}
                  onChange={(e) => patchDraft({ channelSlug: e.target.value })}
                  className={cn(FIELD, "w-full")}
                >
                  <option value="">choose a channel…</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.slug} disabled={!c.webhookUrl}>
                      {c.name}
                      {c.webhookUrl ? "" : " (no webhook — generate one in Ontology Parser)"}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={draft.url}
                  onChange={(e) => patchDraft({ url: e.target.value })}
                  placeholder="https://api.obscyro.com/v1/webhooks/…"
                  className={cn(FIELD, "w-full font-mono text-[11px]")}
                />
              )}
            </div>

            {/* Object source */}
            <div className="rounded-md border border-[#d3d8de] bg-white p-3">
              <div className="mb-2 flex items-center gap-2">
                <FileCode className="h-4 w-4 text-[#6b3fa0]" />
                <span className="text-[13px] font-semibold text-[#1c2127]">Object source</span>
                <span className="ml-auto flex gap-1">
                  {(
                    [
                      ["template", "Template"],
                      ["dataset", "Dataset"],
                    ] as const
                  ).map(([m, label]) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => patchDraft({ templateMode: m })}
                      className={cn(
                        "rounded px-2 py-0.5 text-[11px]",
                        draft.templateMode === m
                          ? "bg-[#e7f2fd] font-medium text-[#215db0]"
                          : "border border-[#d3d8de] text-[#8f99a8]",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </span>
              </div>

              {draft.templateMode === "template" ? (
                <>
                  <div className="mb-2 flex items-center gap-2">
                    <select
                      value={draft.templateKind}
                      onChange={(e) =>
                        patchDraft({
                          templateKind: e.target.value,
                          template: TEMPLATE_LIBRARY[e.target.value]?.template ?? draft.template,
                        })
                      }
                      className={FIELD}
                    >
                      {Object.entries(TEMPLATE_LIBRARY).map(([k, t]) => (
                        <option key={k} value={k}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <span className="text-[10.5px] text-[#8f99a8]">
                      variables: patient.mrn · lab.code/value/unit · site · now · seq …
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                    <textarea
                      value={draft.template}
                      onChange={(e) => patchDraft({ template: e.target.value })}
                      rows={7}
                      className={cn(FIELD, "w-full resize-y font-mono text-[11px]")}
                    />
                    <div>
                      <span className={LABEL}>Preview (sample values)</span>
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-[#d3d8de] bg-[#f6f7f9] p-2 font-mono text-[10.5px] text-[#5f6b7c]">
                        {previewTemplate(draft.template, previewRow)}
                      </pre>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div
                    onClick={() => fileRef.current?.click()}
                    className="mb-2 flex cursor-pointer flex-col items-center gap-1 rounded-md border border-dashed border-[#c5cbd3] bg-[#f6f7f9] px-3 py-4 text-center hover:border-[#2d72d2]"
                  >
                    <Upload className="h-4 w-4 text-[#8f99a8]" />
                    <span className="text-xs font-medium text-[#1c2127]">
                      Import a dataset (CSV / TSV) — add as many as you need
                    </span>
                    <span className="text-[10px] text-[#8f99a8]">
                      rows are sent in order as JSON objects · 2,000 rows max per stream
                    </span>
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".csv,.tsv,.txt,text/csv"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) importDataset(f);
                        e.target.value = "";
                      }}
                    />
                  </div>
                  {draft.datasets.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      {draft.datasets.map((d, i) => (
                        <div
                          key={`${d.name}-${i}`}
                          className="flex items-center gap-2 rounded border border-[#e5e8eb] px-2 py-1 text-[11px] text-[#404854]"
                        >
                          <span className="truncate font-medium">{d.name}</span>
                          <span className="text-[#8f99a8]">
                            {d.rows.length.toLocaleString()} rows
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              patchDraft({ datasets: draft.datasets.filter((_, j) => j !== i) })
                            }
                            className="ml-auto text-[#8f99a8] hover:text-rose-600"
                            aria-label={`Remove ${d.name}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                      <div className="flex items-center gap-3 text-[10.5px] text-[#8f99a8]">
                        <span>
                          {datasetRowCount.toLocaleString()} rows total · server position #
                          {selected.datasetIndex + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => patchDraft({ datasetLoop: !draft.datasetLoop })}
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px]",
                            draft.datasetLoop
                              ? "bg-[#e7f2fd] font-medium text-[#215db0]"
                              : "border border-[#d3d8de]",
                          )}
                        >
                          {draft.datasetLoop ? "loop: on" : "loop: off"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>

            {/* Rate + realism */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="rounded-md border border-[#d3d8de] bg-white p-3">
                <div className="mb-2 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-[#2d72d2]" />
                  <span className="text-[13px] font-semibold text-[#1c2127]">Rate and rhythm</span>
                </div>
                <Knob
                  label="Objects/sec"
                  min={0.1}
                  max={20}
                  step={0.1}
                  value={draft.ratePerSec}
                  display={draft.ratePerSec.toFixed(1)}
                  onChange={(v) => patchDraft({ ratePerSec: v })}
                />
                <div className="mb-2 flex items-center gap-2 text-[11.5px]">
                  <span className="w-28 text-[#5f6b7c]">Day/night curve</span>
                  <button
                    type="button"
                    onClick={() => patchDraft({ diurnal: !draft.diurnal })}
                    className={cn(
                      "rounded px-2 py-0.5 text-[10.5px]",
                      draft.diurnal
                        ? "bg-[#e7f2fd] font-medium text-[#215db0]"
                        : "border border-[#d3d8de] text-[#8f99a8]",
                    )}
                  >
                    {draft.diurnal ? "on · peak 10h–18h" : "off · flat"}
                  </button>
                </div>
                <Knob
                  label="Weekend dip"
                  min={0}
                  max={80}
                  step={5}
                  value={draft.weekendDipPct}
                  display={`−${draft.weekendDipPct}%`}
                  onChange={(v) => patchDraft({ weekendDipPct: v })}
                />
                <Knob
                  label="Stop after"
                  min={0}
                  max={100000}
                  step={500}
                  value={draft.maxCount}
                  display={draft.maxCount === 0 ? "∞" : draft.maxCount.toLocaleString()}
                  onChange={(v) => patchDraft({ maxCount: v })}
                />
              </div>
              <div className="rounded-md border border-[#d3d8de] bg-white p-3">
                <div className="mb-2 flex items-center gap-2">
                  <Bolt className="h-4 w-4 text-amber-600" />
                  <span className="text-[13px] font-semibold text-[#1c2127]">Realism</span>
                </div>
                <Knob
                  label="Abnormal values"
                  min={0}
                  max={50}
                  step={1}
                  value={draft.abnormalPct}
                  display={`${draft.abnormalPct}%`}
                  onChange={(v) => patchDraft({ abnormalPct: v })}
                />
                <Knob
                  label="Malformed payloads"
                  min={0}
                  max={20}
                  step={1}
                  value={draft.malformedPct}
                  display={`${draft.malformedPct}%`}
                  onChange={(v) => patchDraft({ malformedPct: v })}
                />
                <Knob
                  label="Duplicates"
                  min={0}
                  max={20}
                  step={1}
                  value={draft.duplicatePct}
                  display={`${draft.duplicatePct}%`}
                  onChange={(v) => patchDraft({ duplicatePct: v })}
                />
                <Knob
                  label="Patient pool"
                  min={10}
                  max={2000}
                  step={10}
                  value={draft.poolSize}
                  display={`${draft.poolSize} MRNs`}
                  onChange={(v) => patchDraft({ poolSize: v })}
                />
              </div>
            </div>

            {/* Send log */}
            <div className="rounded-md border border-[#d3d8de] bg-white p-3">
              <div className="mb-1 flex items-center gap-2">
                <Terminal className="h-3.5 w-3.5 text-[#8f99a8]" />
                <span className="text-xs font-semibold text-[#1c2127]">Send log</span>
                <span className="ml-auto text-[10.5px] text-[#8f99a8]">
                  {selected.sentCount.toLocaleString()} sent · {selected.failedCount} failed
                  {selected.lastSentAt
                    ? ` · last ${new Date(selected.lastSentAt).toLocaleTimeString()}`
                    : ""}
                </span>
              </div>
              {sends.length > 0 ? (
                sends.map((s) => (
                  <p key={s.id} className="m-0 font-mono text-[10.5px] leading-relaxed text-[#5f6b7c]">
                    {new Date(s.createdAt).toLocaleTimeString()} ·{" "}
                    {summarizePayload(s.payload)}
                    {s.statusCode !== null ? (
                      <span className={s.statusCode < 300 ? " text-emerald-600" : " text-rose-600"}>
                        {" "}
                        · {s.statusCode}
                      </span>
                    ) : (
                      <span className="text-rose-600"> · network error</span>
                    )}
                    {s.note ? <span className="text-amber-600"> · {s.note}</span> : null}
                  </p>
                ))
              ) : (
                <p className="m-0 text-[11px] text-[#8f99a8]">
                  Nothing sent yet — set a target and press Start. The stream keeps running after
                  you close this page.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function summarizePayload(payload: unknown): string {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const p = payload as Record<string, unknown>;
    const parts = [
      p.test && `${String(p.test)} ${String(p.value ?? "")}${String(p.unit ?? "")}`,
      p.item && String(p.item),
      p.event && String(p.event),
      p.mrn && `mrn ${String(p.mrn)}`,
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(" · ");
    return JSON.stringify(payload).slice(0, 70);
  }
  return String(payload).slice(0, 70);
}

function Knob({
  label,
  min,
  max,
  step,
  value,
  display,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mb-2 flex items-center gap-2 text-[11.5px]">
      <span className="w-28 shrink-0 text-[#5f6b7c]">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1"
      />
      <span className="w-16 shrink-0 text-right font-medium text-[#1c2127]">{display}</span>
    </div>
  );
}
