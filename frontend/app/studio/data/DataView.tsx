"use client";

/**
 * Project workspace — the file-tree view of the data spine. Projects hold
 * datasets; a dataset is a `table` (versioned) or a `stream` (append-only with
 * retention). Selecting one shows its schema, a row preview, and the
 * references that would break if it were deleted.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

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
  listProjects,
  loadRows,
  type Dataset,
  type Project,
  type ReferenceEdge,
} from "../datasets-api";
import { useStudio } from "../StudioShell";

/** Load in chunks so a large CSV doesn't exceed the request body cap. */
const LOAD_CHUNK = 5000;

export default function DataView() {
  const { hasKey, selectedEnv } = useStudio();

  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<string | null>(null);
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

  const loadProjects = useCallback(async () => {
    if (!hasKey || !selectedEnv) {
      setProjects([]);
      return;
    }
    try {
      const { projects: p } = await listProjects(selectedEnv);
      setProjects(p);
      setActiveProject((cur) => (cur && p.some((x) => x.id === cur) ? cur : p[0]?.id ?? null));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [hasKey, selectedEnv]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const loadDatasets = useCallback(async () => {
    if (!selectedEnv || !activeProject) {
      setDatasets([]);
      return;
    }
    try {
      const { datasets: d } = await listDatasets(selectedEnv, activeProject);
      setDatasets(d);
      setSelected((cur) => (cur && d.some((x) => x.id === cur) ? cur : d[0]?.id ?? null));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [selectedEnv, activeProject]);

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
    if (!selectedEnv || !activeProject) return;
    const name = window.prompt("Stream dataset name (e.g. ADT raw)");
    if (!name?.trim()) return;
    setBusy("stream");
    try {
      await createDataset(selectedEnv, activeProject, { name: name.trim(), kind: "stream" });
      await loadDatasets();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /** CSV upload -> a table dataset carrying one immutable version. */
  async function handleUpload(file: File) {
    if (!selectedEnv || !activeProject) return;
    setBusy("upload");
    setError(null);
    try {
      const rows = parseCsvRows(await file.text());
      if (rows.length === 0) throw new Error("No rows found in that file.");
      const name = file.name.replace(/\.[^.]+$/, "");
      const ds = await createDataset(selectedEnv, activeProject, {
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
    return <p className="p-8 text-sm text-[#8f99a8]">Sign in to browse projects.</p>;
  }
  if (!selectedEnv) {
    return <p className="p-8 text-sm text-[#8f99a8]">Select an environment first.</p>;
  }

  const project = projects.find((p) => p.id === activeProject) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Project tabs */}
      <div className="flex shrink-0 items-end gap-1 border-b border-[#d3d8de] bg-[#f6f7f9] px-3 pt-1.5">
        {projects.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setActiveProject(p.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-t-md border px-3 py-1.5 text-[11.5px]",
              p.id === activeProject
                ? "border-[#d3d8de] border-b-white bg-white font-medium text-[#1c2127]"
                : "border-transparent text-[#5f6b7c] hover:text-[#1c2127]",
            )}
          >
            {p.name}
            <span className="text-[10px] text-[#8f99a8]">{p.datasetCount}</span>
          </button>
        ))}
        <span className="ml-auto self-center pb-1 pr-1 text-[10.5px] text-[#8f99a8]">
          projects are created on{" "}
          <Link href="/studio/home" className="text-[#215db0] hover:underline">
            Home
          </Link>
        </span>
      </div>

      {error ? (
        <p className="mx-3 mt-2 rounded border border-[#f4c0d1] bg-[#fceaef] px-3 py-2 text-xs text-[#a82255]">
          {error}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {/* Resource tree */}
        <aside className="w-[190px] shrink-0 overflow-y-auto border-r border-[#d3d8de] bg-white p-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-[11.5px] text-[#1c2127] hover:bg-[#f6f7f9]"
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <Database className="h-3.5 w-3.5 text-[#5f6b7c]" />
            Datasets
            <span className="ml-auto text-[10px] text-[#8f99a8]">{datasets.length}</span>
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
                      ? "bg-[#e7f2fd] font-medium text-[#215db0]"
                      : "text-[#1c2127] hover:bg-[#f6f7f9]",
                  )}
                >
                  {d.kind === "stream" ? (
                    <Radio className="h-3.5 w-3.5 shrink-0 text-[#1c6e42]" />
                  ) : (
                    <TableIcon className="h-3.5 w-3.5 shrink-0 text-[#5f6b7c]" />
                  )}
                  <span className="truncate">{d.name}</span>
                </button>
              ))
            : null}

          {datasets.length === 0 ? (
            <p className="px-2 py-3 text-[11px] leading-relaxed text-[#8f99a8]">
              No datasets yet. Upload a CSV to create your first one.
            </p>
          ) : null}

          <div className="mt-2 border-t border-[#e5e8eb] pt-2">
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
              disabled={busy !== null || !activeProject}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-[11.5px] text-[#215db0] hover:bg-[#f6f7f9] disabled:opacity-50"
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
              disabled={busy !== null || !activeProject}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-[11.5px] text-[#215db0] hover:bg-[#f6f7f9] disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              New stream
            </button>
          </div>
        </aside>

        {/* Detail */}
        <main className="min-w-0 flex-1 overflow-y-auto p-4">
          {!detail ? (
            <div className="rounded-md border border-dashed border-[#d3d8de] bg-[#f6f7f9] px-6 py-12 text-center">
              <p className="text-sm font-medium text-[#1c2127]">
                {project ? `${project.name} has no datasets yet` : "No project selected"}
              </p>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-[#5f6b7c]">
                Upload a CSV to create a versioned table, or add a stream for a live feed.
                Datasets sit between a source and the ontology, so what arrives can be
                previewed and replayed.
              </p>
              {/* The primary actions belong where the user is already looking. */}
              <div className="mt-3.5 flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy !== null || !activeProject}
                  className="inline-flex items-center gap-1.5 rounded border border-[#2d72d2] bg-white px-3 py-1.5 text-xs font-medium text-[#215db0] hover:bg-[#e7f2fd] disabled:opacity-50"
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
                  disabled={busy !== null || !activeProject}
                  className="inline-flex items-center gap-1.5 rounded border border-[#d3d8de] bg-white px-3 py-1.5 text-xs text-[#1c2127] hover:border-[#2d72d2] disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New stream
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#e7f2fd] text-[#215db0]">
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
                      ? "bg-[#e8f4ec] text-[#1c6e42]"
                      : "bg-[#f6f7f9] text-[#5f6b7c]",
                  )}
                >
                  {detail.dataset.kind}
                </span>
                <span className="text-[11px] text-[#8f99a8]">
                  {detail.dataset.rowCount.toLocaleString()} rows
                  {detail.dataset.kind === "stream"
                    ? ` · ${detail.dataset.retentionDays}d retention`
                    : ""}
                </span>
              </div>

              {detail.references.downstream.length > 0 ? (
                <p className="mt-2 flex items-start gap-2 rounded border border-[#f5c4b3] bg-[#fdf0e6] px-3 py-2 text-xs text-[#935610]">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Deleting this would break {detail.references.downstream.length} resource
                  {detail.references.downstream.length === 1 ? "" : "s"}:{" "}
                  {detail.references.downstream.map((r) => `${r.type} ${r.id}`).join(", ")}
                </p>
              ) : null}

              <p className="mt-3.5 text-[10px] font-medium uppercase tracking-wide text-[#8f99a8]">
                Schema
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {detail.dataset.columnSchema.map((c) => (
                  <span
                    key={c.name}
                    className="rounded border border-[#d3d8de] px-1.5 py-0.5 text-[10.5px] text-[#1c2127]"
                  >
                    {c.name}
                    <span className="ml-1 text-[#8f99a8]">{c.type}</span>
                  </span>
                ))}
                {detail.dataset.columnSchema.length === 0 ? (
                  <span className="text-[11px] text-[#8f99a8]">
                    Inferred once the first rows arrive.
                  </span>
                ) : null}
              </div>

              <p className="mt-3.5 text-[10px] font-medium uppercase tracking-wide text-[#8f99a8]">
                Preview
              </p>
              {detail.preview.length === 0 ? (
                <p className="mt-1 text-[11px] text-[#8f99a8]">No rows yet.</p>
              ) : (
                <div className="mt-1 overflow-x-auto rounded-md border border-[#d3d8de]">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-[#f6f7f9] text-[10px] uppercase tracking-wide text-[#8f99a8]">
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
                        <tr key={i} className="border-t border-[#e5e8eb]">
                          {Object.keys(detail.preview[0])
                            .slice(0, 8)
                            .map((k) => (
                              <td
                                key={k}
                                className="max-w-[200px] truncate whitespace-nowrap px-2.5 py-1 text-[#5f6b7c]"
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
