"use client";

/**
 * Sources and syncs — the connectivity surface.
 *
 * A source is a connection; a sync is the operation that moves its data into a
 * dataset. They are separate because one source can feed several datasets, and
 * because "how often, and from where do I resume" belongs to the operation.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  Copy,
  Loader2,
  Play,
  Plug,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";

import { cn } from "@/lib/cn";

import {
  createSource,
  createSync,
  listConnectors,
  listSources,
  listSyncRuns,
  listSyncs,
  runSync,
  testRestConnector,
  type Connector,
  type ConnectorKind,
  type RestConfig,
  type RestTestResult,
  type Source,
  type Sync,
  type SyncMode,
  type SyncRun,
} from "../connectivity-api";
import { listDatasets, type Dataset } from "../datasets-api";
import { useStudio } from "../StudioShell";

function ago(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

const STATUS_TONE: Record<string, string> = {
  active: "bg-[#e8f4ec] text-[#1c6e42]",
  paused: "bg-[#f6f7f9] text-[#5f6b7c]",
  error: "bg-[#fceaef] text-[#a82255]",
};

export default function SourcesView() {
  const { hasKey, selectedEnv } = useStudio();
  const searchParams = useSearchParams();
  const view = searchParams?.get("view") === "syncs" ? "syncs" : "sources";

  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [syncs, setSyncs] = useState<Sync[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [runs, setRuns] = useState<Record<string, SyncRun[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  const [newSource, setNewSource] = useState(false);
  const [newSync, setNewSync] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!hasKey || !selectedEnv) return;
    try {
      const [c, s, y, d] = await Promise.all([
        listConnectors().catch(() => ({ connectors: [] as Connector[] })),
        listSources(selectedEnv),
        listSyncs(selectedEnv),
        listDatasets(selectedEnv).catch(() => ({ datasets: [] as Dataset[] })),
      ]);
      setConnectors(c.connectors);
      setSources(s.sources);
      setSyncs(y.syncs);
      setDatasets(d.datasets);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [hasKey, selectedEnv]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openRuns(syncId: string) {
    if (expanded === syncId) {
      setExpanded(null);
      return;
    }
    setExpanded(syncId);
    try {
      const { runs: r } = await listSyncRuns(syncId, 10);
      setRuns((cur) => ({ ...cur, [syncId]: r }));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleRun(syncId: string) {
    setBusy(syncId);
    setError(null);
    try {
      const res = await runSync(syncId);
      if (res.error) setError(res.error);
      await load();
      if (expanded === syncId) {
        const { runs: r } = await listSyncRuns(syncId, 10);
        setRuns((cur) => ({ ...cur, [syncId]: r }));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!hasKey) return <p className="p-8 text-sm text-[#8f99a8]">Sign in to manage sources.</p>;
  if (!selectedEnv)
    return <p className="p-8 text-sm text-[#8f99a8]">Choose a project on Home first.</p>;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <header className="border-b border-[#d3d8de] bg-white px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#e7f2fd] text-[#215db0]">
            <Plug className="h-4 w-4" />
          </span>
          <h1 className="text-[15px] font-medium">{view === "sources" ? "Sources" : "Syncs"}</h1>
          <span className="rounded border border-[#d3d8de] px-2 py-0.5 text-[10.5px] text-[#5f6b7c]">
            {view === "sources" ? sources.length : syncs.length}
          </span>
          <span className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="rounded border border-[#d3d8de] p-1.5 text-[#5f6b7c] hover:border-[#2d72d2]"
              aria-label="Refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => (view === "sources" ? setNewSource(true) : setNewSync(true))}
              className="flex items-center gap-1.5 rounded border border-[#2d72d2] px-2.5 py-1.5 text-[11.5px] font-medium text-[#215db0] hover:bg-[#e7f2fd]"
            >
              <Plus className="h-3.5 w-3.5" />
              {view === "sources" ? "New source" : "New sync"}
            </button>
          </span>
        </div>
        <p className="mt-1 text-[11px] text-[#8f99a8]">
          {view === "sources"
            ? "A source is a connection. It moves nothing on its own — a sync does that."
            : "A sync moves data from a source into a dataset, on a schedule or as it arrives."}
        </p>
      </header>

      {error ? (
        <p className="mx-5 mt-3 flex items-start gap-2 rounded border border-[#f4c0d1] bg-[#fceaef] px-3 py-2 text-xs text-[#a82255]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      ) : null}

      <div className="px-5 py-3">
        {view === "sources" ? (
          sources.length === 0 ? (
            <Empty
              title="No sources yet"
              body="A source is where data comes from — a webhook another system posts to, a file you upload, or an endpoint polled on a schedule."
              action="New source"
              onAction={() => setNewSource(true)}
            />
          ) : (
            <div className="space-y-1.5">
              {sources.map((s) => (
                <div
                  key={s.id}
                  className="rounded-md border border-[#d3d8de] bg-white px-3 py-2.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{s.name}</span>
                    <span className="rounded bg-[#f6f7f9] px-1.5 py-0.5 text-[10px] font-medium text-[#5f6b7c]">
                      {s.connector}
                    </span>
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-medium",
                        STATUS_TONE[s.status] ?? STATUS_TONE.paused,
                      )}
                    >
                      {s.status}
                    </span>
                    <span className="text-[11px] text-[#8f99a8]">
                      {s.syncCount} sync{s.syncCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  {s.webhookUrl ? (
                    <div className="mt-2 flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate rounded bg-[#f6f7f9] px-2 py-1 text-[10.5px] text-[#1c2127]">
                        {s.webhookUrl}
                      </code>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(s.webhookUrl!);
                          setCopied(s.id);
                          setTimeout(() => setCopied(null), 1500);
                        }}
                        className="flex shrink-0 items-center gap-1 rounded border border-[#d3d8de] px-2 py-1 text-[10.5px] text-[#5f6b7c] hover:border-[#2d72d2]"
                      >
                        {copied === s.id ? (
                          <>
                            <Check className="h-3 w-3 text-[#1c6e42]" /> copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" /> copy
                          </>
                        )}
                      </button>
                    </div>
                  ) : null}
                  {s.syncCount === 0 ? (
                    <p className="mt-1.5 text-[11px] text-[#935610]">
                      Nothing is listening yet — add a sync to land its data in a dataset.
                    </p>
                  ) : null}
                  {s.lastError ? (
                    <p className="mt-1.5 text-[11px] text-[#a82255]">{s.lastError}</p>
                  ) : null}
                </div>
              ))}
            </div>
          )
        ) : syncs.length === 0 ? (
          <Empty
            title="No syncs yet"
            body="A sync connects a source to a dataset. Streaming syncs land data as it arrives; snapshot and incremental syncs run on an interval."
            action="New sync"
            onAction={() => setNewSync(true)}
          />
        ) : (
          <div className="space-y-1.5">
            {syncs.map((y) => {
              const src = sources.find((s) => s.id === y.sourceId);
              const ds = datasets.find((d) => d.id === y.datasetId);
              return (
                <div key={y.id} className="rounded-md border border-[#d3d8de] bg-white">
                  <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                    <span className="font-medium">{y.name}</span>
                    <span className="rounded bg-[#e7f2fd] px-1.5 py-0.5 text-[10px] font-medium text-[#215db0]">
                      {y.mode}
                    </span>
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-medium",
                        STATUS_TONE[y.status] ?? STATUS_TONE.paused,
                      )}
                    >
                      {y.status}
                    </span>
                    <span className="text-[11px] text-[#5f6b7c]">
                      {src?.name ?? "source"} → {ds?.name ?? "dataset"}
                    </span>
                    <span className="text-[11px] text-[#8f99a8]">{ago(y.lastRunAt)}</span>
                    <span className="ml-auto flex items-center gap-1.5">
                      {y.mode !== "stream" ? (
                        <button
                          type="button"
                          onClick={() => void handleRun(y.id)}
                          disabled={busy === y.id}
                          className="flex items-center gap-1 rounded border border-[#d3d8de] px-2 py-1 text-[10.5px] text-[#215db0] hover:border-[#2d72d2] disabled:opacity-50"
                        >
                          {busy === y.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Play className="h-3 w-3" />
                          )}
                          Run now
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void openRuns(y.id)}
                        className="rounded border border-[#d3d8de] px-2 py-1 text-[10.5px] text-[#5f6b7c] hover:border-[#2d72d2]"
                      >
                        {expanded === y.id ? "hide runs" : "runs"}
                      </button>
                    </span>
                  </div>
                  {y.lastError ? (
                    <p className="px-3 pb-2 text-[11px] text-[#a82255]">{y.lastError}</p>
                  ) : null}
                  {expanded === y.id ? (
                    <div className="border-t border-[#e5e8eb] px-3 py-2">
                      {(runs[y.id] ?? []).length === 0 ? (
                        <p className="text-[11px] text-[#8f99a8]">No runs recorded yet.</p>
                      ) : (
                        <table className="w-full text-left text-[11px]">
                          <thead className="text-[10px] uppercase tracking-wide text-[#8f99a8]">
                            <tr>
                              <th className="py-1 font-medium">When</th>
                              <th className="py-1 font-medium">Status</th>
                              <th className="py-1 font-medium">Read</th>
                              <th className="py-1 font-medium">Written</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(runs[y.id] ?? []).map((r) => (
                              <tr key={r.id} className="border-t border-[#e5e8eb]">
                                <td className="py-1 text-[10.5px] text-[#5f6b7c]">
                                  {ago(r.startedAt)}
                                </td>
                                <td className="py-1">
                                  <span
                                    className={cn(
                                      "rounded px-1.5 py-0.5 text-[10px] font-medium",
                                      r.status === "succeeded"
                                        ? STATUS_TONE.active
                                        : STATUS_TONE.error,
                                    )}
                                  >
                                    {r.status}
                                  </span>
                                </td>
                                <td className="py-1 text-[#5f6b7c]">{r.rowsRead}</td>
                                <td className="py-1 text-[#5f6b7c]">{r.rowsWritten}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {newSource ? (
        <NewSourceDialog
          connectors={connectors}
          onClose={() => setNewSource(false)}
          onCreate={async (name, connector, config) => {
            if (!selectedEnv) return;
            await createSource(selectedEnv, { name, connector, config });
            setNewSource(false);
            await load();
          }}
        />
      ) : null}

      {newSync ? (
        <NewSyncDialog
          sources={sources}
          datasets={datasets}
          onClose={() => setNewSync(false)}
          onCreate={async (body) => {
            if (!selectedEnv) return;
            await createSync(selectedEnv, body);
            setNewSync(false);
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

function Empty({
  title,
  body,
  action,
  onAction,
}: {
  title: string;
  body: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="rounded-md border border-dashed border-[#d3d8de] bg-[#f6f7f9] px-6 py-10 text-center">
      <p className="text-sm font-medium text-[#1c2127]">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-[#5f6b7c]">{body}</p>
      <button
        type="button"
        onClick={onAction}
        className="mt-3 inline-flex items-center gap-1.5 rounded border border-[#2d72d2] bg-white px-3 py-1.5 text-xs font-medium text-[#215db0] hover:bg-[#e7f2fd]"
      >
        <Plus className="h-3.5 w-3.5" />
        {action}
      </button>
    </div>
  );
}

function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-[10vh]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[80vh] w-[460px] flex-col overflow-hidden rounded-lg border border-[#d3d8de] bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[#d3d8de] px-4 py-2.5">
          <p className="text-sm font-medium">{title}</p>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4 text-[#8f99a8]" />
          </button>
        </div>
        <div className="overflow-y-auto px-4 py-3">{children}</div>
      </div>
    </div>
  );
}

const FIELD =
  "mt-1 w-full rounded border border-[#d3d8de] px-2.5 py-1.5 text-xs focus:border-[#2d72d2] focus:outline-none";
const MONO =
  "mt-1 w-full rounded border border-[#d3d8de] px-2.5 py-1.5 text-[11px] focus:border-[#2d72d2] focus:outline-none";
const LBL = "mt-3 block text-[11px] font-medium text-[#5f6b7c]";
const HINT = "mt-1 text-[10.5px] leading-snug text-[#8f99a8]";

/** Editor for a list of header or query-parameter pairs. */
function PairRows({
  pairs,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
}: {
  pairs: [string, string][];
  onChange: (next: [string, string][]) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
}) {
  return (
    <div className="mt-1 space-y-1">
      {pairs.map(([k, v], i) => (
        <div key={i} className="flex gap-1">
          <input
            value={k}
            onChange={(e) => {
              const next = [...pairs];
              next[i] = [e.target.value, v];
              onChange(next);
            }}
            placeholder={keyPlaceholder}
            className="w-2/5 rounded border border-[#d3d8de] px-2 py-1 text-[11px] focus:border-[#2d72d2] focus:outline-none"
          />
          <input
            value={v}
            onChange={(e) => {
              const next = [...pairs];
              next[i] = [k, e.target.value];
              onChange(next);
            }}
            placeholder={valuePlaceholder}
            className="min-w-0 flex-1 rounded border border-[#d3d8de] px-2 py-1 text-[11px] focus:border-[#2d72d2] focus:outline-none"
          />
          <button
            type="button"
            onClick={() => onChange(pairs.filter((_, j) => j !== i))}
            aria-label="Remove"
            className="px-1 text-[#8f99a8] hover:text-[#a82255]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...pairs, ["", ""]])}
        className="text-[11px] text-[#2d72d2] hover:underline"
      >
        + add
      </button>
    </div>
  );
}

function pairsToRecord(pairs: [string, string][]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [k, v] of pairs) if (k.trim()) out[k.trim()] = v;
  return Object.keys(out).length > 0 ? out : undefined;
}

function NewSourceDialog({
  connectors,
  onClose,
  onCreate,
}: {
  connectors: Connector[];
  onClose: () => void;
  onCreate: (
    name: string,
    connector: ConnectorKind,
    config: Record<string, unknown>,
  ) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ConnectorKind>("webhook");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // REST specifics
  const [method, setMethod] = useState<"GET" | "POST">("GET");
  const [query, setQuery] = useState<[string, string][]>([]);
  const [headers, setHeaders] = useState<[string, string][]>([]);
  const [authKind, setAuthKind] = useState<"none" | "bearer" | "header" | "query">("none");
  const [authName, setAuthName] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [recordPath, setRecordPath] = useState("");
  const [format, setFormat] = useState<"auto" | "json" | "csv">("auto");
  const [pagKind, setPagKind] = useState<"none" | "page" | "offset" | "cursor">("none");
  const [pagParam, setPagParam] = useState("page");
  const [pagSizeParam, setPagSizeParam] = useState("");
  const [pagSize, setPagSize] = useState(100);
  const [cursorPath, setCursorPath] = useState("");
  const [cursorParam, setCursorParam] = useState("");
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<RestTestResult | null>(null);

  const chosen = connectors.find((c) => c.kind === kind);
  const isRest = kind === "rest";

  function restConfig(): RestConfig {
    return {
      url: url.trim(),
      method,
      query: pairsToRecord(query),
      headers: pairsToRecord(headers),
      auth:
        authKind === "none"
          ? undefined
          : { kind: authKind, name: authName.trim() || undefined, token: authToken },
      recordPath: recordPath.trim() || undefined,
      format,
      pagination:
        pagKind === "none"
          ? { kind: "none" }
          : {
              kind: pagKind,
              param: pagKind === "cursor" ? undefined : pagParam.trim(),
              sizeParam: pagSizeParam.trim() || undefined,
              pageSize: pagSize,
              cursorPath: cursorPath.trim() || undefined,
              cursorParam: cursorParam.trim() || undefined,
            },
    };
  }

  return (
    <Dialog title="New source" onClose={onClose}>
      {err ? <p className="mb-2 text-xs text-[#a82255]">{err}</p> : null}

      <label className="block text-[11px] font-medium text-[#5f6b7c]">Connector</label>
      <div className="mt-1 space-y-1">
        {/* Deprecated connectors keep working for existing sources but are not
            offered again — two entries that both GET a URL is a worse catalogue. */}
        {connectors
          .filter((c) => !c.deprecated)
          .map((c) => (
          <button
            key={c.kind}
            type="button"
            onClick={() => c.implemented && setKind(c.kind)}
            disabled={!c.implemented}
            className={cn(
              "flex w-full items-start gap-2 rounded border px-2.5 py-2 text-left transition-colors",
              kind === c.kind
                ? "border-[#2d72d2] bg-[#e7f2fd]"
                : "border-[#d3d8de] hover:border-[#2d72d2]",
              !c.implemented && "cursor-not-allowed opacity-50",
            )}
          >
            {c.direction === "push" ? (
              <ArrowDownToLine className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#215db0]" />
            ) : (
              <ArrowUpFromLine className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#5f6b7c]" />
            )}
            <span className="min-w-0">
              <span className="text-xs font-medium">
                {c.label}
                {!c.implemented ? (
                  <span className="ml-1.5 text-[10px] font-normal text-[#8f99a8]">
                    not implemented yet
                  </span>
                ) : null}
              </span>
              <span className="block text-[10.5px] leading-snug text-[#5f6b7c]">
                {c.description}
              </span>
            </span>
          </button>
        ))}
      </div>

      <label className="mt-3 block text-[11px] font-medium text-[#5f6b7c]">Name</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="ADT feed"
        className="mt-1 w-full rounded border border-[#d3d8de] px-2.5 py-1.5 text-xs focus:border-[#2d72d2] focus:outline-none"
      />

      {chosen?.direction === "pull" ? (
        <>
          <label className={LBL}>URL</label>
          <div className="mt-1 flex gap-1">
            {isRest ? (
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as "GET" | "POST")}
                className="rounded border border-[#d3d8de] px-1.5 py-1.5 text-[11px] focus:border-[#2d72d2] focus:outline-none"
              >
                <option>GET</option>
                <option>POST</option>
              </select>
            ) : null}
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.org/api/records"
              className="min-w-0 flex-1 rounded border border-[#d3d8de] px-2.5 py-1.5 text-[11px] focus:border-[#2d72d2] focus:outline-none"
            />
          </div>

          {isRest ? (
            <>
              <label className={LBL}>Query parameters</label>
              <PairRows
                pairs={query}
                onChange={setQuery}
                keyPlaceholder="location"
                valuePlaceholder="45.5,-73.6"
              />

              <label className={LBL}>Headers</label>
              <PairRows
                pairs={headers}
                onChange={setHeaders}
                keyPlaceholder="Accept"
                valuePlaceholder="application/json"
              />

              <label className={LBL}>Authentication</label>
              <select
                value={authKind}
                onChange={(e) =>
                  setAuthKind(e.target.value as "none" | "bearer" | "header" | "query")
                }
                className={FIELD}
              >
                <option value="none">None</option>
                <option value="bearer">Bearer token</option>
                <option value="header">API key in a header</option>
                <option value="query">API key in a query parameter</option>
              </select>
              {authKind !== "none" ? (
                <div className="mt-1 flex gap-1">
                  {authKind !== "bearer" ? (
                    <input
                      value={authName}
                      onChange={(e) => setAuthName(e.target.value)}
                      placeholder={authKind === "header" ? "X-Api-Key" : "key"}
                      className="w-2/5 rounded border border-[#d3d8de] px-2 py-1 text-[11px] focus:border-[#2d72d2] focus:outline-none"
                    />
                  ) : null}
                  <input
                    value={authToken}
                    onChange={(e) => setAuthToken(e.target.value)}
                    type="password"
                    placeholder="token"
                    className="min-w-0 flex-1 rounded border border-[#d3d8de] px-2 py-1 text-[11px] focus:border-[#2d72d2] focus:outline-none"
                  />
                </div>
              ) : null}

              <label className={LBL}>Path to the records</label>
              <input
                value={recordPath}
                onChange={(e) => setRecordPath(e.target.value)}
                placeholder="results"
                className={MONO}
              />
              <p className={HINT}>
                Where the array lives in the response — <code>results</code>, or{" "}
                <code>data.items</code> for something nested. Leave blank to try the usual
                wrappers. Getting this wrong is the most common reason a source returns nothing.
              </p>

              <label className={LBL}>Response format</label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as "auto" | "json" | "csv")}
                className={FIELD}
              >
                <option value="auto">Detect from content type</option>
                <option value="json">JSON</option>
                <option value="csv">CSV / TSV</option>
              </select>

              <label className={LBL}>Pagination</label>
              <select
                value={pagKind}
                onChange={(e) =>
                  setPagKind(e.target.value as "none" | "page" | "offset" | "cursor")
                }
                className={FIELD}
              >
                <option value="none">Single request</option>
                <option value="page">Page number</option>
                <option value="offset">Row offset</option>
                <option value="cursor">Cursor / next-page token</option>
              </select>
              {pagKind === "page" || pagKind === "offset" ? (
                <div className="mt-1 flex gap-1">
                  <input
                    value={pagParam}
                    onChange={(e) => setPagParam(e.target.value)}
                    placeholder={pagKind === "page" ? "page" : "offset"}
                    className="w-1/3 rounded border border-[#d3d8de] px-2 py-1 text-[11px] focus:border-[#2d72d2] focus:outline-none"
                  />
                  <input
                    value={pagSizeParam}
                    onChange={(e) => setPagSizeParam(e.target.value)}
                    placeholder="per_page"
                    className="w-1/3 rounded border border-[#d3d8de] px-2 py-1 text-[11px] focus:border-[#2d72d2] focus:outline-none"
                  />
                  <input
                    value={pagSize}
                    onChange={(e) => setPagSize(Number(e.target.value) || 100)}
                    type="number"
                    className="w-1/4 rounded border border-[#d3d8de] px-2 py-1 text-[11px] focus:border-[#2d72d2] focus:outline-none"
                  />
                </div>
              ) : null}
              {pagKind === "cursor" ? (
                <div className="mt-1 flex gap-1">
                  <input
                    value={cursorPath}
                    onChange={(e) => setCursorPath(e.target.value)}
                    placeholder="next_page_token"
                    className="min-w-0 flex-1 rounded border border-[#d3d8de] px-2 py-1 text-[11px] focus:border-[#2d72d2] focus:outline-none"
                  />
                  <input
                    value={cursorParam}
                    onChange={(e) => setCursorParam(e.target.value)}
                    placeholder="pagetoken"
                    className="min-w-0 flex-1 rounded border border-[#d3d8de] px-2 py-1 text-[11px] focus:border-[#2d72d2] focus:outline-none"
                  />
                </div>
              ) : null}

              {/* Checking the shape before saving beats a failed sync run per guess. */}
              <div className="mt-3 rounded border border-[#d3d8de] bg-[#f6f7f9] p-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!url.trim() || testing}
                    onClick={async () => {
                      setTesting(true);
                      setTest(null);
                      try {
                        setTest(await testRestConnector(restConfig()));
                      } catch (e) {
                        setTest({
                          ok: false,
                          rowCount: 0,
                          pages: 0,
                          truncated: false,
                          columns: [],
                          sample: [],
                          error: (e as Error).message,
                        });
                      } finally {
                        setTesting(false);
                      }
                    }}
                    className="flex items-center gap-1.5 rounded border border-[#d3d8de] bg-white px-2.5 py-1 text-[11px] font-medium text-[#404854] disabled:opacity-50"
                  >
                    {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    Test connection
                  </button>
                  {test ? (
                    <span
                      className={cn(
                        "text-[11px]",
                        test.ok ? "text-[#1d9e75]" : "text-[#a82255]",
                      )}
                    >
                      {test.ok
                        ? `${test.rowCount} row${test.rowCount === 1 ? "" : "s"} · ${test.columns.length} columns`
                        : "no rows"}
                    </span>
                  ) : (
                    <span className="text-[10.5px] text-[#8f99a8]">
                      one capped request, nothing saved
                    </span>
                  )}
                </div>
                {test?.error ? (
                  <p className="mt-1.5 text-[10.5px] leading-snug text-[#a82255]">{test.error}</p>
                ) : null}
                {test?.ok ? (
                  <>
                    <p className="mt-1.5 text-[10px] leading-relaxed text-[#5f6b7c]">
                      {test.columns.slice(0, 12).join(" · ")}
                      {test.columns.length > 12 ? ` +${test.columns.length - 12}` : ""}
                    </p>
                    <pre className="mt-1 max-h-24 overflow-auto rounded bg-white p-1.5 font-mono text-[10px] leading-snug text-[#404854]">
                      {JSON.stringify(test.sample[0] ?? {}, null, 1)}
                    </pre>
                  </>
                ) : null}
              </div>
            </>
          ) : null}
        </>
      ) : (
        <p className="mt-3 text-[11px] leading-relaxed text-[#8f99a8]">
          A URL is generated on save. Anything POSTed to it lands in the datasets its syncs
          point at.
        </p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-[#d3d8de] px-3 py-1.5 text-xs text-[#5f6b7c]"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!name.trim() || busy || (chosen?.direction === "pull" && !url.trim())}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              await onCreate(
                name.trim(),
                kind,
                isRest
                  ? (restConfig() as unknown as Record<string, unknown>)
                  : url.trim()
                    ? { url: url.trim() }
                    : {},
              );
            } catch (e) {
              setErr((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          className="flex items-center gap-1.5 rounded border border-[#2d72d2] bg-[#e7f2fd] px-3 py-1.5 text-xs font-medium text-[#215db0] disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Create source
        </button>
      </div>
    </Dialog>
  );
}

function NewSyncDialog({
  sources,
  datasets,
  onClose,
  onCreate,
}: {
  sources: Source[];
  datasets: Dataset[];
  onClose: () => void;
  onCreate: (body: {
    name: string;
    sourceId: string;
    datasetId: string;
    mode: SyncMode;
    intervalSeconds?: number | null;
    incrementalColumn?: string | null;
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [mode, setMode] = useState<SyncMode>("stream");
  const [datasetId, setDatasetId] = useState("");
  const [interval, setInterval] = useState("300");
  const [incCol, setIncCol] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Mode and dataset kind must agree, so only offer datasets that can accept
  // this mode rather than letting the server reject it after the fact.
  const eligible = useMemo(
    () => datasets.filter((d) => (mode === "stream" ? d.kind === "stream" : d.kind === "table")),
    [datasets, mode],
  );

  useEffect(() => {
    setDatasetId((cur) => (eligible.some((d) => d.id === cur) ? cur : eligible[0]?.id ?? ""));
  }, [eligible]);

  return (
    <Dialog title="New sync" onClose={onClose}>
      {err ? <p className="mb-2 text-xs text-[#a82255]">{err}</p> : null}

      <label className="block text-[11px] font-medium text-[#5f6b7c]">Name</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="ADT stream"
        className="mt-1 w-full rounded border border-[#d3d8de] px-2.5 py-1.5 text-xs focus:border-[#2d72d2] focus:outline-none"
      />

      <label className="mt-3 block text-[11px] font-medium text-[#5f6b7c]">Source</label>
      <select
        value={sourceId}
        onChange={(e) => setSourceId(e.target.value)}
        className="mt-1 w-full rounded border border-[#d3d8de] px-2.5 py-1.5 text-xs focus:border-[#2d72d2] focus:outline-none"
      >
        {sources.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.connector})
          </option>
        ))}
      </select>

      <label className="mt-3 block text-[11px] font-medium text-[#5f6b7c]">Mode</label>
      <select
        value={mode}
        onChange={(e) => setMode(e.target.value as SyncMode)}
        className="mt-1 w-full rounded border border-[#d3d8de] px-2.5 py-1.5 text-xs focus:border-[#2d72d2] focus:outline-none"
      >
        <option value="stream">stream — land rows as they arrive</option>
        <option value="snapshot">snapshot — replace on every run</option>
        <option value="incremental">incremental — only rows past a watermark</option>
      </select>

      <label className="mt-3 block text-[11px] font-medium text-[#5f6b7c]">
        Dataset
        <span className="ml-1 font-normal text-[#8f99a8]">
          {mode === "stream" ? "(stream datasets only)" : "(table datasets only)"}
        </span>
      </label>
      {eligible.length === 0 ? (
        <p className="mt-1 rounded border border-[#f5c4b3] bg-[#fdf0e6] px-2.5 py-1.5 text-[11px] text-[#935610]">
          No {mode === "stream" ? "stream" : "table"} dataset exists yet. Create one under
          Projects &amp; datasets first.
        </p>
      ) : (
        <select
          value={datasetId}
          onChange={(e) => setDatasetId(e.target.value)}
          className="mt-1 w-full rounded border border-[#d3d8de] px-2.5 py-1.5 text-xs focus:border-[#2d72d2] focus:outline-none"
        >
          {eligible.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} ({d.kind})
            </option>
          ))}
        </select>
      )}

      {mode !== "stream" ? (
        <>
          <label className="mt-3 block text-[11px] font-medium text-[#5f6b7c]">
            Interval (seconds)
          </label>
          <input
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
            className="mt-1 w-full rounded border border-[#d3d8de] px-2.5 py-1.5 text-xs focus:border-[#2d72d2] focus:outline-none"
          />
        </>
      ) : null}

      {mode === "incremental" ? (
        <>
          <label className="mt-3 block text-[11px] font-medium text-[#5f6b7c]">
            Watermark column
          </label>
          <input
            value={incCol}
            onChange={(e) => setIncCol(e.target.value)}
            placeholder="updated_at"
            className="mt-1 w-full rounded border border-[#d3d8de] px-2.5 py-1.5 text-[11px] focus:border-[#2d72d2] focus:outline-none"
          />
          <p className="mt-1 text-[10.5px] leading-snug text-[#8f99a8]">
            Each run keeps only rows whose value is greater than the last seen, then advances
            the watermark.
          </p>
        </>
      ) : null}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-[#d3d8de] px-3 py-1.5 text-xs text-[#5f6b7c]"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!name.trim() || !sourceId || !datasetId || busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              await onCreate({
                name: name.trim(),
                sourceId,
                datasetId,
                mode,
                intervalSeconds: mode === "stream" ? null : Number(interval) || 300,
                incrementalColumn: mode === "incremental" ? incCol.trim() || null : null,
              });
            } catch (e) {
              setErr((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          className="flex items-center gap-1.5 rounded border border-[#2d72d2] bg-[#e7f2fd] px-3 py-1.5 text-xs font-medium text-[#215db0] disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Create sync
        </button>
      </div>
    </Dialog>
  );
}
