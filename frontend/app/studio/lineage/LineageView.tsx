"use client";

/**
 * Lineage — the project's data chain as one graph.
 *
 * Nodes are laid out in columns by role (source → dataset → object type),
 * because the chain always flows that way and a force layout would only
 * obscure it. Edges come from resource_reference: an edge is drawn because
 * something recorded it, never because it was inferred.
 *
 * Authoring happens on the same canvas: add a node, then connect two nodes to
 * create the sync or the ontology binding that the edge represents.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  AlertTriangle,
  Cable,
  Cuboid,
  Database,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Table as TableIcon,
  Webhook,
  X,
} from "lucide-react";

import { cn } from "@/lib/cn";
import { listEnvTypes, type EnvObjectType } from "@/lib/platform-api";

import {
  createDatasource,
  createSource,
  createSync,
  getGraph,
  listDatasources,
  materialize,
  type ColumnMapRule,
  type Datasource,
  type GraphEdge,
  type GraphNode,
} from "../connectivity-api";
import { createDataset, getDataset, listDatasets, type Dataset } from "../datasets-api";
import { useStudio } from "../StudioShell";

const COL_X = { source: 40, dataset: 330, object_type: 620 } as const;
const NODE_W = 210;
const NODE_H = 60;
const ROW_GAP = 26;
const TOP = 24;

interface Placed extends GraphNode {
  x: number;
  y: number;
}

const NODE_ICON = {
  source: Webhook,
  dataset: TableIcon,
  object_type: Cuboid,
} as const;

const STATUS_RING = {
  ok: "border-[#9fe1cb]",
  warn: "border-[#f5c4b3]",
  idle: "border-[#d3d8de]",
} as const;

/** Orthogonal connector — the same routing the pipeline canvas uses. */
function elbow(ax: number, ay: number, bx: number, by: number): string {
  const midX = (ax + bx) / 2;
  const r = Math.min(8, Math.abs(bx - ax) / 2, Math.abs(by - ay) / 2 || 8);
  if (Math.abs(by - ay) < 1) return `M ${ax},${ay} H ${bx}`;
  const dir = by > ay ? 1 : -1;
  return (
    `M ${ax},${ay} H ${midX - r} ` +
    `Q ${midX},${ay} ${midX},${ay + dir * r} ` +
    `V ${by - dir * r} ` +
    `Q ${midX},${by} ${midX + r},${by} ` +
    `H ${bx}`
  );
}

export default function LineageView() {
  const { hasKey, selectedEnv } = useStudio();

  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [types, setTypes] = useState<EnvObjectType[]>([]);
  const [datasources, setDatasources] = useState<Datasource[]>([]);

  const [selected, setSelected] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [pending, setPending] = useState<{ from: GraphNode; to: GraphNode } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!hasKey || !selectedEnv) return;
    try {
      const [g, d, t, b] = await Promise.all([
        getGraph(selectedEnv),
        listDatasets(selectedEnv).catch(() => ({ datasets: [] as Dataset[] })),
        listEnvTypes(selectedEnv).catch(() => ({ types: [] as EnvObjectType[], linkTypes: [] })),
        listDatasources(selectedEnv).catch(() => ({ datasources: [] as Datasource[] })),
      ]);
      setNodes(g.nodes);
      setEdges(g.edges);
      setDatasets(d.datasets);
      setTypes(t.types);
      setDatasources(b.datasources);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [hasKey, selectedEnv]);

  useEffect(() => {
    void load();
  }, [load]);

  // Column layout by role, so the chain reads left to right.
  const placed = useMemo<Placed[]>(() => {
    const byCol: Record<string, GraphNode[]> = { source: [], dataset: [], object_type: [] };
    for (const n of nodes) byCol[n.type]?.push(n);
    const out: Placed[] = [];
    for (const [type, list] of Object.entries(byCol)) {
      list.forEach((n, i) => {
        out.push({
          ...n,
          x: COL_X[type as keyof typeof COL_X],
          y: TOP + i * (NODE_H + ROW_GAP),
        });
      });
    }
    return out;
  }, [nodes]);

  const posOf = useCallback(
    (id: string) => placed.find((p) => p.id === id) ?? null,
    [placed],
  );

  const height = Math.max(
    260,
    TOP + Math.max(1, ...Object.values({ s: 0 })) +
      Math.max(
        ...["source", "dataset", "object_type"].map(
          (t) => placed.filter((p) => p.type === t).length * (NODE_H + ROW_GAP),
        ),
        NODE_H,
      ) +
      TOP,
  );

  /** Clicking a second node while connecting proposes the edge. */
  function handleNodeClick(n: GraphNode) {
    if (!connectFrom) {
      setSelected(n.id);
      return;
    }
    if (connectFrom === n.id) {
      setConnectFrom(null);
      return;
    }
    const from = nodes.find((x) => x.id === connectFrom);
    if (!from) return;
    const ok =
      (from.type === "source" && n.type === "dataset") ||
      (from.type === "dataset" && n.type === "object_type");
    if (!ok) {
      setError(
        "Data flows source → dataset → object type. That connection is not part of the chain.",
      );
      setConnectFrom(null);
      return;
    }
    setPending({ from, to: n });
    setConnectFrom(null);
  }

  async function handleAddSource() {
    if (!selectedEnv) return;
    const name = window.prompt("Source name (webhook)");
    if (!name?.trim()) return;
    setBusy("add");
    try {
      await createSource(selectedEnv, { name: name.trim(), connector: "webhook" });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleAddDataset(kind: "stream" | "table") {
    if (!selectedEnv) return;
    const name = window.prompt(`${kind === "stream" ? "Stream" : "Table"} dataset name`);
    if (!name?.trim()) return;
    setBusy("add");
    try {
      await createDataset(selectedEnv, { name: name.trim(), kind });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleMaterialize(ds: Datasource) {
    setBusy(ds.id);
    setNote(null);
    try {
      const r = await materialize(ds.id);
      setNote(
        `${r.written} written, ${r.skipped} skipped${
          r.issues[0] ? ` — ${r.issues[0].reason}` : ""
        }`,
      );
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!hasKey) return <p className="p-8 text-sm text-[#8f99a8]">Sign in to view lineage.</p>;
  if (!selectedEnv)
    return <p className="p-8 text-sm text-[#8f99a8]">Choose a project on Home first.</p>;

  const sel = selected ? nodes.find((n) => n.id === selected) ?? null : null;
  const selBinding =
    sel?.type === "object_type"
      ? datasources.find((d) => d.objectTypeId === sel.id) ?? null
      : sel?.type === "dataset"
        ? datasources.find((d) => d.datasetId === sel.id) ?? null
        : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#d3d8de] bg-white px-4 py-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#e7f2fd] text-[#215db0]">
          <Cable className="h-4 w-4" />
        </span>
        <h1 className="text-[15px] font-medium">Lineage</h1>
        <span className="rounded border border-[#d3d8de] px-2 py-0.5 text-[10.5px] text-[#5f6b7c]">
          {nodes.length} nodes · {edges.length} edges
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void handleAddSource()}
            disabled={busy !== null}
            className="flex items-center gap-1 rounded border border-[#d3d8de] px-2 py-1.5 text-[11px] text-[#1c2127] hover:border-[#2d72d2] disabled:opacity-50"
          >
            <Plus className="h-3 w-3" /> Source
          </button>
          <button
            type="button"
            onClick={() => void handleAddDataset("stream")}
            disabled={busy !== null}
            className="flex items-center gap-1 rounded border border-[#d3d8de] px-2 py-1.5 text-[11px] text-[#1c2127] hover:border-[#2d72d2] disabled:opacity-50"
          >
            <Plus className="h-3 w-3" /> Stream
          </button>
          <button
            type="button"
            onClick={() => void handleAddDataset("table")}
            disabled={busy !== null}
            className="flex items-center gap-1 rounded border border-[#d3d8de] px-2 py-1.5 text-[11px] text-[#1c2127] hover:border-[#2d72d2] disabled:opacity-50"
          >
            <Plus className="h-3 w-3" /> Table
          </button>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded border border-[#d3d8de] p-1.5 text-[#5f6b7c] hover:border-[#2d72d2]"
            aria-label="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </span>
      </header>

      {connectFrom ? (
        <p className="flex items-center gap-2 border-b border-[#b5d4f4] bg-[#e7f2fd] px-4 py-1.5 text-[11.5px] text-[#215db0]">
          Click the node to connect to — source → dataset creates a sync, dataset → object type
          creates the ontology binding.
          <button
            type="button"
            onClick={() => setConnectFrom(null)}
            className="ml-auto underline"
          >
            cancel
          </button>
        </p>
      ) : null}

      {error ? (
        <p className="flex items-start gap-2 border-b border-[#f4c0d1] bg-[#fceaef] px-4 py-1.5 text-[11.5px] text-[#a82255]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-auto">
            <X className="h-3.5 w-3.5" />
          </button>
        </p>
      ) : null}
      {note ? (
        <p className="border-b border-[#9fe1cb] bg-[#e8f4ec] px-4 py-1.5 text-[11.5px] text-[#1c6e42]">
          {note}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div
          className="min-w-0 flex-1 overflow-auto p-2"
          style={{
            backgroundImage: "radial-gradient(circle, rgba(0,0,0,0.05) 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }}
        >
          {nodes.length === 0 ? (
            <div className="m-4 rounded-md border border-dashed border-[#d3d8de] bg-[#f6f7f9] px-6 py-12 text-center">
              <p className="text-sm font-medium text-[#1c2127]">Nothing connected yet</p>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-[#5f6b7c]">
                Add a source, add a dataset, then connect them. The chain you build here is the
                lineage — nothing is inferred.
              </p>
            </div>
          ) : (
            <div className="relative" style={{ width: 880, height }}>
              <svg className="pointer-events-none absolute inset-0" width={880} height={height}>
                {edges.map((e, i) => {
                  const a = posOf(e.from);
                  const b = posOf(e.to);
                  if (!a || !b) return null;
                  return (
                    <g key={i}>
                      <path
                        d={elbow(a.x + NODE_W, a.y + NODE_H / 2, b.x, b.y + NODE_H / 2)}
                        fill="none"
                        stroke="#2d72d2"
                        strokeWidth={1.5}
                      />
                      <circle cx={b.x} cy={b.y + NODE_H / 2} r={3} fill="#2d72d2" />
                    </g>
                  );
                })}
              </svg>

              {placed.map((n) => {
                const Icon = NODE_ICON[n.type];
                const isSel = selected === n.id;
                const isFrom = connectFrom === n.id;
                return (
                  <div
                    key={n.id}
                    className={cn(
                      "absolute rounded-lg border-2 bg-white px-2.5 py-2 shadow-sm transition-colors",
                      isSel || isFrom ? "border-[#2d72d2]" : STATUS_RING[n.status],
                    )}
                    style={{ left: n.x, top: n.y, width: NODE_W, height: NODE_H }}
                  >
                    <button
                      type="button"
                      onClick={() => handleNodeClick(n)}
                      className="flex h-full w-full flex-col justify-center text-left"
                    >
                      <span className="flex items-center gap-1.5">
                        <Icon className="h-3.5 w-3.5 shrink-0 text-[#215db0]" />
                        <span className="truncate text-[12px] font-medium">{n.name}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-[#8f99a8]">
                        {n.subtitle}
                        {n.count !== null ? <>· {n.count.toLocaleString()} rows</> : null}
                        {n.status === "warn" ? (
                          <span className="text-[#935610]">· not wired</span>
                        ) : null}
                      </span>
                    </button>
                    {n.type !== "object_type" ? (
                      <button
                        type="button"
                        onClick={() => setConnectFrom(n.id)}
                        title="Connect from here"
                        aria-label={`Connect from ${n.name}`}
                        className="absolute -right-2.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full border border-[#d3d8de] bg-white text-[#5f6b7c] hover:border-[#2d72d2] hover:text-[#215db0]"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <aside className="w-[230px] shrink-0 overflow-y-auto border-l border-[#d3d8de] bg-[#f6f7f9] p-3">
          {!sel ? (
            <p className="text-[11.5px] leading-relaxed text-[#8f99a8]">
              Select a node to inspect it. Use the <b className="font-medium">+</b> on a node&apos;s
              edge to connect it to the next stage.
            </p>
          ) : (
            <>
              <p className="text-[10px] font-medium uppercase tracking-[0.05em] text-[#8f99a8]">
                {sel.type.replace("_", " ")}
              </p>
              <p className="mb-2 text-[13px] font-medium">{sel.name}</p>
              <Field label="kind" value={sel.subtitle} />
              {sel.count !== null ? (
                <Field label="rows" value={sel.count.toLocaleString()} />
              ) : null}
              <Field
                label="upstream"
                value={String(edges.filter((e) => e.to === sel.id).length)}
              />
              <Field
                label="downstream"
                value={String(edges.filter((e) => e.from === sel.id).length)}
              />

              {selBinding ? (
                <div className="mt-3 rounded border border-[#d3d8de] bg-white p-2">
                  <p className="text-[10px] font-medium uppercase tracking-[0.05em] text-[#8f99a8]">
                    Ontology binding
                  </p>
                  <p className="mt-1 text-[11px] text-[#1c2127]">
                    {selBinding.datasetName} → {selBinding.objectTypeName}
                  </p>
                  <p className="mt-0.5 text-[10.5px] text-[#8f99a8]">
                    key: {selBinding.identityProperties.join(", ")}
                  </p>
                  {!selBinding.writeback ? (
                    <p className="mt-1 text-[10.5px] leading-snug text-[#935610]">
                      Stream-backed: instances cannot be hand-edited, the next run would
                      overwrite them.
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void handleMaterialize(selBinding)}
                    disabled={busy === selBinding.id}
                    className="mt-2 flex w-full items-center justify-center gap-1.5 rounded border border-[#2d72d2] bg-[#e7f2fd] px-2 py-1 text-[11px] font-medium text-[#215db0] disabled:opacity-50"
                  >
                    {busy === selBinding.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                    Materialize
                  </button>
                  {selBinding.lastSyncedAt ? (
                    <p className="mt-1 text-[10px] text-[#8f99a8]">
                      last run {new Date(selBinding.lastSyncedAt).toLocaleString("en-CA")}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </aside>
      </div>

      {pending ? (
        <ConnectDialog
          env={selectedEnv}
          from={pending.from}
          to={pending.to}
          datasets={datasets}
          types={types}
          onClose={() => setPending(null)}
          onDone={async () => {
            setPending(null);
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-[#e5e8eb] py-1 text-[11px] last:border-0">
      <span className="text-[#8f99a8]">{label}</span>
      <span className="text-[#1c2127]">{value}</span>
    </div>
  );
}

/**
 * The edge editor. source → dataset creates a sync; dataset → object type
 * creates the ontology binding, which needs a key and a column mapping.
 */
function ConnectDialog({
  env,
  from,
  to,
  datasets,
  types,
  onClose,
  onDone,
}: {
  env: string;
  from: GraphNode;
  to: GraphNode;
  datasets: Dataset[];
  types: EnvObjectType[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const isSync = from.type === "source" && to.type === "dataset";
  const dataset = datasets.find((d) => d.id === (isSync ? to.id : from.id)) ?? null;
  const objectType = types.find((t) => t.name === to.name) ?? null;

  const [name, setName] = useState(`${from.name} → ${to.name}`);
  const [identity, setIdentity] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapRule[]>([]);
  const [columns, setColumns] = useState<string[]>(
    dataset?.columnSchema.map((c) => c.name) ?? [],
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // A stream's schema is learned from arrivals; fetch a preview so the mapper
  // has real column names rather than an empty list.
  useEffect(() => {
    if (isSync || !dataset || columns.length > 0) return;
    getDataset(dataset.id, 1)
      .then((d) => {
        const keys = d.preview[0] ? Object.keys(d.preview[0]) : [];
        setColumns(d.dataset.columnSchema.map((c) => c.name).concat(keys).filter((v, i, a) => a.indexOf(v) === i));
      })
      .catch(() => undefined);
  }, [isSync, dataset, columns.length]);

  const props = objectType?.propertySchema.map((p) => p.key) ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-[8vh]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isSync ? "New sync" : "Ontology binding"}
        className="max-h-[80vh] w-[460px] overflow-y-auto rounded-lg border border-[#d3d8de] bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#d3d8de] px-4 py-2.5">
          <p className="text-sm font-medium">
            {isSync ? "Connect source to dataset" : "Bind dataset to object type"}
          </p>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4 text-[#8f99a8]" />
          </button>
        </div>

        <div className="px-4 py-3">
          {err ? <p className="mb-2 text-xs text-[#a82255]">{err}</p> : null}

          <p className="mb-3 flex items-center gap-1.5 rounded bg-[#f6f7f9] px-2 py-1.5 text-[11px] text-[#5f6b7c]">
            <Database className="h-3.5 w-3.5" />
            {from.name} <span className="text-[#8f99a8]">→</span> {to.name}
          </p>

          {isSync ? (
            <>
              <label className="block text-[11px] font-medium text-[#5f6b7c]">Sync name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded border border-[#d3d8de] px-2.5 py-1.5 text-xs focus:border-[#2d72d2] focus:outline-none"
              />
              <p className="mt-2 text-[11px] leading-relaxed text-[#8f99a8]">
                A {dataset?.kind === "stream" ? "streaming" : "snapshot"} sync will be created,
                matching the dataset kind.
              </p>
            </>
          ) : (
            <>
              <label className="block text-[11px] font-medium text-[#5f6b7c]">
                Key properties
                <span className="ml-1 font-normal text-[#8f99a8]">
                  identifies an object; without one every run duplicates
                </span>
              </label>
              <div className="mt-1 flex flex-wrap gap-1">
                {props.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() =>
                      setIdentity((cur) =>
                        cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p],
                      )
                    }
                    className={cn(
                      "rounded border px-2 py-0.5 text-[11px]",
                      identity.includes(p)
                        ? "border-[#2d72d2] bg-[#e7f2fd] text-[#215db0]"
                        : "border-[#d3d8de] text-[#1c2127]",
                    )}
                  >
                    {p}
                  </button>
                ))}
                {props.length === 0 ? (
                  <p className="text-[11px] text-[#935610]">
                    This object type has no properties yet.
                  </p>
                ) : null}
              </div>

              <p className="mt-3 text-[11px] font-medium text-[#5f6b7c]">Column mapping</p>
              {columns.length === 0 ? (
                <p className="mt-1 text-[11px] text-[#935610]">
                  No columns yet — load rows into the dataset first so its schema is known.
                </p>
              ) : (
                <div className="mt-1 space-y-1">
                  {columns.map((c) => {
                    const rule = mapping.find((m) => m.from === c);
                    return (
                      <div key={c} className="flex items-center gap-1.5">
                        <code className="w-[42%] truncate rounded bg-[#f6f7f9] px-1.5 py-1 text-[10.5px]">
                          {c}
                        </code>
                        <span className="text-[#8f99a8]">→</span>
                        <select
                          value={rule?.to ?? ""}
                          onChange={(e) => {
                            const to2 = e.target.value;
                            setMapping((cur) => {
                              const rest = cur.filter((m) => m.from !== c);
                              return to2 ? [...rest, { from: c, to: to2 }] : rest;
                            });
                          }}
                          className="min-w-0 flex-1 rounded border border-[#d3d8de] px-1.5 py-1 text-[11px] focus:border-[#2d72d2] focus:outline-none"
                        >
                          <option value="">— skip —</option>
                          {props.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
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
              disabled={busy || (!isSync && (identity.length === 0 || mapping.length === 0))}
              onClick={async () => {
                setBusy(true);
                setErr(null);
                try {
                  if (isSync) {
                    await createSync(env, {
                      name: name.trim() || `${from.name} sync`,
                      sourceId: from.id,
                      datasetId: to.id,
                      mode: dataset?.kind === "stream" ? "stream" : "snapshot",
                      intervalSeconds: dataset?.kind === "stream" ? null : 300,
                    });
                  } else {
                    await createDatasource(env, {
                      objectTypeName: to.name,
                      datasetId: from.id,
                      identityProperties: identity,
                      columnMapping: mapping,
                    });
                  }
                  await onDone();
                } catch (e) {
                  setErr((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
              className="flex items-center gap-1.5 rounded border border-[#2d72d2] bg-[#e7f2fd] px-3 py-1.5 text-xs font-medium text-[#215db0] disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {isSync ? "Create sync" : "Create binding"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
