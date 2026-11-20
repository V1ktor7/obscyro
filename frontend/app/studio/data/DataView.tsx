"use client";

/**
 * Project workspace — the file-tree view of the data spine. Projects hold
 * datasets; a dataset is a `table` (versioned) or a `stream` (append-only with
 * retention). Selecting one shows its schema, a row preview, and the
 * references that would break if it were deleted.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Database,
  Loader2,
  Plus,
  Radio,
  Table as TableIcon,
  Upload,
} from "lucide-react";

import { cn } from "@/lib/cn";

import { parseCsvRows } from "../csv-parse";
import {
  createDataset,
  getDataset,
  listDatasets,
  loadRows,
  type Dataset,
  type ReferenceEdge,
} from "../datasets-api";
import { useStudio } from "../StudioShell";

/** Load in chunks so a large CSV doesn't exceed the request body cap. */
const LOAD_CHUNK = 5000;

export default function DataView() {
  const { hasKey, selectedEnv } = useStudio();

  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    dataset: Dataset;
    preview: Record<string, unknown>[];
    references: { upstream: ReferenceEdge[]; downstream: ReferenceEdge[] };
  } | null>(null);

  const [expanded, setExpanded] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadDatasets = useCallback(async () => {
    if (!selectedEnv) {
      setDatasets([]);
      return;
    }
    try {
      const { datasets: d } = await listDatasets(selectedEnv);
      setDatasets(d);
      setSelected((cur) => (cur && d.some((x) => x.id === cur) ? cur : d[0]?.id ?? null));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [selectedEnv]);

  useEffect(() => {
    void loadDatasets();
  }, [loadDatasets]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    getDataset(selected, 25)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  async function handleNewStream() {
    if (!selectedEnv) return;
    const name = window.prompt("Stream dataset name (e.g. ADT raw)");
    if (!name?.trim()) return;
    setBusy("stream");
    try {
      await createDataset(selectedEnv, { name: name.trim(), kind: "stream" });
      await loadDatasets();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /** CSV upload -> a table dataset carrying one immutable version. */
  async function handleUpload(file: File) {
    if (!selectedEnv) return;
    setBusy("upload");
    setError(null);
    try {
      const rows = parseCsvRows(await file.text());
      if (rows.length === 0) throw new Error("No rows found in that file.");
      const name = file.name.replace(/\.[^.]+$/, "");
      const ds = await createDataset(selectedEnv, {
        name,
        kind: "table",
        description: `Uploaded from ${file.name}`,
      });
      for (let i = 0; i < rows.length; i += LOAD_CHUNK) {
        await loadRows(ds.id, rows.slice(i, i + LOAD_CHUNK), `upload ${file.name}`);
      }
      await loadDatasets();
      setSelected(ds.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (!hasKey) {
    return <p className="p-8 text-sm text-ink-faint">Sign in to browse projects.</p>;
  }
  if (!selectedEnv) {
    return <p className="p-8 text-sm text-ink-faint">Select an environment first.</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error ? (
        <p className="mx-3 mt-2 rounded border border-danger-line bg-danger-soft px-3 py-2 text-xs text-danger-ink">
          {error}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {/* Resource tree */}
        <aside className="w-[190px] shrink-0 overflow-y-auto border-r border-line bg-surface p-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-[11.5px] text-ink hover:bg-surface-hover"
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <Database className="h-3.5 w-3.5 text-ink-muted" />
            Datasets
            <span className="ml-auto text-[10px] text-ink-faint">{datasets.length}</span>
          </button>

          {expanded
            ? datasets.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setSelected(d.id)}
                  className={cn(
                    "ml-3 flex w-[calc(100%-0.75rem)] items-center gap-1.5 rounded px-2 py-1 text-left text-[11.5px]",
                    d.id === selected
                      ? "bg-brand-soft font-medium text-brand-deep"
                      : "text-ink hover:bg-surface-hover",
                  )}
                >
                  {d.kind === "stream" ? (
                    <Radio className="h-3.5 w-3.5 shrink-0 text-ok-ink" />
                  ) : (
                    <TableIcon className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
                  )}
                  <span className="truncate">{d.name}</span>
                </button>
              ))
            : null}

          {datasets.length === 0 ? (
            <p className="px-2 py-3 text-[11px] leading-relaxed text-ink-faint">
              No datasets yet. Upload a CSV to create your first one.
            </p>
          ) : null}

          <div className="mt-2 border-t border-line-soft pt-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUpload(f);
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy !== null}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-[11.5px] text-brand-deep hover:bg-surface-hover disabled:opacity-50"
            >
              {busy === "upload" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              Upload CSV
            </button>
            <button
              type="button"
              onClick={() => void handleNewStream()}
              disabled={busy !== null}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-[11.5px] text-brand-deep hover:bg-surface-hover disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              New stream
            </button>
          </div>
        </aside>

        {/* Detail */}
        <main className="min-w-0 flex-1 overflow-y-auto p-4">
          {!detail ? (
            <div className="rounded-md border border-dashed border-line bg-canvas px-6 py-12 text-center">
              <p className="text-sm font-medium text-ink">
                {`${selectedEnv} has no datasets yet`}
              </p>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-ink-muted">
                Upload a CSV to create a versioned table, or add a stream for a live feed.
                Datasets sit between a source and the ontology, so what arrives can be
                previewed and replayed.
              </p>
              {/* The primary actions belong where the user is already looking. */}
              <div className="mt-3.5 flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded border border-brand bg-surface px-3 py-1.5 text-xs font-medium text-brand-deep hover:bg-brand-soft disabled:opacity-50"
                >
                  {busy === "upload" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  Upload CSV
                </button>
                <button
                  type="button"
                  onClick={() => void handleNewStream()}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded border border-line bg-surface px-3 py-1.5 text-xs text-ink hover:border-brand disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New stream
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-soft text-brand-deep">
                  {detail.dataset.kind === "stream" ? (
                    <Radio className="h-4 w-4" />
                  ) : (
                    <TableIcon className="h-4 w-4" />
                  )}
                </span>
                <h1 className="text-[15px] font-medium">{detail.dataset.name}</h1>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-medium",
                    detail.dataset.kind === "stream"
                      ? "bg-ok-soft text-ok-ink"
                      : "bg-canvas text-ink-muted",
                  )}
                >
                  {detail.dataset.kind}
                </span>
                <span className="text-[11px] text-ink-faint">
                  {detail.dataset.rowCount.toLocaleString()} rows
                  {detail.dataset.kind === "stream"
                    ? ` · ${detail.dataset.retentionDays}d retention`
                    : ""}
                </span>
              </div>

              {detail.references.downstream.length > 0 ? (
                <p className="mt-2 flex items-start gap-2 rounded border border-warn-line bg-warn-soft px-3 py-2 text-xs text-warn-ink">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Deleting this would break {detail.references.downstream.length} resource
                  {detail.references.downstream.length === 1 ? "" : "s"}:{" "}
                  {detail.references.downstream.map((r) => `${r.type} ${r.id}`).join(", ")}
                </p>
              ) : null}

              <p className="mt-3.5 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
                Schema
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {detail.dataset.columnSchema.map((c) => (
                  <span
                    key={c.name}
                    className="rounded border border-line px-1.5 py-0.5 text-[10.5px] text-ink"
                  >
                    {c.name}
                    <span className="ml-1 text-ink-faint">{c.type}</span>
                  </span>
                ))}
                {detail.dataset.columnSchema.length === 0 ? (
                  <span className="text-[11px] text-ink-faint">
                    Inferred once the first rows arrive.
                  </span>
                ) : null}
              </div>

              <p className="mt-3.5 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
                Preview
              </p>
              {detail.preview.length === 0 ? (
                <p className="mt-1 text-[11px] text-ink-faint">No rows yet.</p>
              ) : (
                <div className="mt-1 overflow-x-auto rounded-md border border-line">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-canvas text-[10px] uppercase tracking-wide text-ink-faint">
                      <tr>
                        {Object.keys(detail.preview[0]).slice(0, 8).map((k) => (
                          <th key={k} className="whitespace-nowrap px-2.5 py-1.5 font-medium">
                            {k}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {detail.preview.slice(0, 15).map((row, i) => (
                        <tr key={i} className="border-t border-line-soft">
                          {Object.keys(detail.preview[0])
                            .slice(0, 8)
                            .map((k) => (
                              <td
                                key={k}
                                className="max-w-[200px] truncate whitespace-nowrap px-2.5 py-1 text-ink-muted"
                              >
                                {String(row[k] ?? "")}
                              </td>
                            ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
