"use client";

import {
  Box,
  Columns3,
  Database,
  FileText,
  FunctionSquare,
  Filter as FilterIcon,
  Loader2,
  Merge,
  Play,
  Plus,
  Save,
  ShieldCheck,
  Stethoscope,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/cn";

import { listDatasets, type Dataset } from "../datasets-api";
import {
  createPipeline,
  getPipeline,
  listNodeTypes,
  listPipelines,
  previewPipeline,
  runPipeline,
  savePipeline,
  type LinkRule,
  type NodeKind,
  type NodeMeta,
  type Pipeline,
  type PipelineEdge,
  type PipelineNode,
  type RunResult,
} from "../pipelines-api";
import { useStudio } from "../StudioShell";

// ---------------------------------------------------------------------------
// Pipeline Builder.
//
// The canvas is the point: a linear list of steps cannot express a join or a
// second output, and it cannot show you where rows were lost. Every node here
// reports rows in, rows out and rows dropped, because a step that quietly
// discards half the data looks identical to one that had less to begin with.
// ---------------------------------------------------------------------------

const NODE_W = 168;
const NODE_H = 62;

const ICON: Record<NodeKind, typeof Database> = {
  dataset_input: Database,
  cast: Wand2,
  filter: FilterIcon,
  select: Columns3,
  derive: FunctionSquare,
  join: Merge,
  text_field: FileText,
  extract_snomed: Stethoscope,
  validate_confidence: ShieldCheck,
  object_output: Box,
  dataset_output: Database,
};

const TONE: Record<string, { bg: string; fg: string }> = {
  Input: { bg: "bg-[#e8f6f0]", fg: "text-[#12684c]" },
  Clean: { bg: "bg-[#f0edf7]", fg: "text-[#5b4a86]" },
  Shape: { bg: "bg-[#f0edf7]", fg: "text-[#5b4a86]" },
  Combine: { bg: "bg-[#f0edf7]", fg: "text-[#5b4a86]" },
  Clinical: { bg: "bg-[#fdeef4]", fg: "text-[#a82255]" },
  Output: { bg: "bg-[#e7f2fd]", fg: "text-[#215db0]" },
};

function uid(): string {
  return `n${Math.random().toString(36).slice(2, 9)}`;
}

/** Columns visible at a node, taken from the last preview. */
function columnsOf(rows: Record<string, unknown>[] | undefined): string[] {
  if (!rows || rows.length === 0) return [];
  const set = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) set.add(k);
  return Array.from(set);
}

export default function PipelinesView() {
  const { selectedEnv } = useStudio();
  const [catalogue, setCatalogue] = useState<NodeMeta[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [current, setCurrent] = useState<Pipeline | null>(null);
  const [nodes, setNodes] = useState<PipelineNode[]>([]);
  const [edges, setEdges] = useState<PipelineEdge[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [run, setRun] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<{ from: string } | null>(null);

  const load = useCallback(async () => {
    if (!selectedEnv) return;
    try {
      const [cat, ps, ds] = await Promise.all([
        listNodeTypes(),
        listPipelines(selectedEnv),
        listDatasets(selectedEnv).catch(() => ({ datasets: [] as Dataset[] })),
      ]);
      setCatalogue(cat.nodes);
      setPipelines(ps.pipelines);
      setDatasets(ds.datasets);
      if (!current && ps.pipelines[0]) open(ps.pipelines[0]);
    } catch (e) {
      setError((e as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEnv]);

  useEffect(() => {
    void load();
  }, [load]);

  function open(p: Pipeline) {
    setCurrent(p);
    setNodes(p.nodes);
    setEdges(p.edges);
    setSel(null);
    setRun(null);
    setDirty(false);
  }

  async function handleSave() {
    if (!current) return;
    setBusy("save");
    setError(null);
    try {
      const saved = await savePipeline(current.id, { nodes, edges });
      setCurrent(saved);
      setDirty(false);
      setPipelines((ps) => ps.map((p) => (p.id === saved.id ? saved : p)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handlePreview() {
    if (!current) return;
    setBusy("preview");
    setError(null);
    try {
      if (dirty) {
        const saved = await savePipeline(current.id, { nodes, edges });
        setCurrent(saved);
        setDirty(false);
      }
      setRun(await previewPipeline(current.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleRun() {
    if (!current) return;
    setBusy("run");
    setError(null);
    try {
      if (dirty) await savePipeline(current.id, { nodes, edges });
      setDirty(false);
      const r = await runPipeline(current.id);
      setRun(r);
      if (r.error) setError(r.error);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function addNode(meta: NodeMeta) {
    const n: PipelineNode = {
      id: uid(),
      kind: meta.kind,
      name: meta.label,
      x: 40 + ((nodes.length * 30) % 260),
      y: 40 + nodes.length * 26,
      config: {},
    };
    setNodes((cur) => [...cur, n]);
    setSel(n.id);
    setDirty(true);
  }

  function patchNode(id: string, patch: Partial<PipelineNode>) {
    setNodes((cur) => cur.map((n) => (n.id === id ? { ...n, ...patch } : n)));
    setDirty(true);
  }

  function patchConfig(id: string, patch: Record<string, unknown>) {
    setNodes((cur) =>
      cur.map((n) => (n.id === id ? { ...n, config: { ...n.config, ...patch } } : n)),
    );
    setDirty(true);
  }

  function removeNode(id: string) {
    setNodes((cur) => cur.filter((n) => n.id !== id));
    setEdges((cur) => cur.filter((e) => e.from !== id && e.to !== id));
    if (sel === id) setSel(null);
    setDirty(true);
  }

  function connect(to: string, toPort?: "left" | "right") {
    if (!connecting || connecting.from === to) {
      setConnecting(null);
      return;
    }
    setEdges((cur) => {
      const without = cur.filter(
        (e) => !(e.to === to && (e.toPort ?? "left") === (toPort ?? "left")),
      );
      return [...without, { from: connecting.from, to, toPort }];
    });
    setConnecting(null);
    setDirty(true);
  }

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  /** Columns available to a node = the columns its upstream produced. */
  const upstreamColumns = useCallback(
    (nodeId: string): string[] => {
      if (!run) return [];
      const ins = edges.filter((e) => e.to === nodeId);
      const cols = new Set<string>();
      for (const e of ins) for (const c of columnsOf(run.samples[e.from])) cols.add(c);
      return Array.from(cols);
    },
    [run, edges],
  );

  const selected = sel ? byId.get(sel) : null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#d3d8de] bg-white px-4 py-2">
        <select
          value={current?.id ?? ""}
          onChange={(e) => {
            const p = pipelines.find((x) => x.id === e.target.value);
            if (p) void getPipeline(p.id).then(open).catch(() => open(p));
          }}
          className="rounded border border-[#d3d8de] px-2 py-1 text-xs focus:border-[#2d72d2] focus:outline-none"
        >
          {pipelines.length === 0 ? <option value="">no pipelines yet</option> : null}
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={async () => {
            if (!selectedEnv) return;
            const name = window.prompt("Pipeline name");
            if (!name?.trim()) return;
            try {
              const p = await createPipeline(selectedEnv, { name: name.trim() });
              setPipelines((cur) => [...cur, p]);
              open(p);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
          className="flex items-center gap-1 rounded border border-[#d3d8de] px-2 py-1 text-xs text-[#404854]"
        >
          <Plus className="h-3 w-3" /> New
        </button>

        {dirty ? (
          <span className="rounded bg-[#fdf6ec] px-1.5 py-0.5 text-[10px] font-medium text-[#8a5a12]">
            unsaved
          </span>
        ) : null}

        {/* Live is what makes the twin move: the pipeline re-runs as rows land
            on its stream input, instead of waiting for someone to press Run. */}
        {current ? (
          <button
            type="button"
            disabled={busy !== null}
            title={
              current.status === "live"
                ? "Re-running as rows arrive. Click to pause."
                : "Run automatically when rows land on the input stream."
            }
            onClick={async () => {
              const next = current.status === "live" ? "paused" : "live";
              setBusy("status");
              setError(null);
              try {
                const saved = await savePipeline(current.id, {
                  nodes,
                  edges,
                  status: next,
                });
                setCurrent(saved);
                setDirty(false);
                setPipelines((ps) => ps.map((p) => (p.id === saved.id ? saved : p)));
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(null);
              }
            }}
            className={cn(
              "flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] font-medium",
              current.status === "live"
                ? "border-[#1d9e75] bg-[#e8f6f0] text-[#12684c]"
                : "border-[#d3d8de] text-[#5f6b7c]",
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                current.status === "live" ? "animate-pulse bg-[#1d9e75]" : "bg-[#c5cbd3]",
              )}
            />
            {current.status === "live" ? "Live" : "Go live"}
          </button>
        ) : null}
        {error ? (
          <span className="max-w-[42ch] truncate text-[11px] text-[#a82255]" title={error}>
            {error}
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-[#8f99a8]">
            {nodes.length} nodes · {edges.length} edges
          </span>
          <button
            type="button"
            disabled={!current || busy !== null}
            onClick={() => void handlePreview()}
            className="flex items-center gap-1.5 rounded border border-[#d3d8de] px-2.5 py-1 text-xs font-medium text-[#404854] disabled:opacity-50"
          >
            {busy === "preview" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            Preview
          </button>
          <button
            type="button"
            disabled={!current || busy !== null || !dirty}
            onClick={() => void handleSave()}
            className="flex items-center gap-1.5 rounded border border-[#d3d8de] px-2.5 py-1 text-xs font-medium text-[#404854] disabled:opacity-50"
          >
            {busy === "save" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Save className="h-3 w-3" />
            )}
            Save
          </button>
          <button
            type="button"
            disabled={!current || busy !== null}
            onClick={() => void handleRun()}
            className="flex items-center gap-1.5 rounded border border-[#215db0] bg-[#2d72d2] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            {busy === "run" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Run
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Palette catalogue={catalogue} onAdd={addNode} />

        <Canvas

          nodes={nodes}
          edges={edges}
          sel={sel}
          run={run}
          connecting={connecting}
          onSelect={setSel}
          onMove={(id, x, y) => patchNode(id, { x, y })}
          onStartConnect={(id) => setConnecting({ from: id })}
          onConnect={connect}
          onCancelConnect={() => setConnecting(null)}
        />

        <Inspector
          node={selected}
          nodes={nodes}
          datasets={datasets}
          run={run}
          columns={selected ? upstreamColumns(selected.id) : []}
          onName={(name) => selected && patchNode(selected.id, { name })}
          onConfig={(patch) => selected && patchConfig(selected.id, patch)}
          onDelete={() => selected && removeNode(selected.id)}
        />
      </div>
    </div>
  );
}

// --- palette ----------------------------------------------------------------

function Palette({
  catalogue,
  onAdd,
}: {
  catalogue: NodeMeta[];
  onAdd: (m: NodeMeta) => void;
}) {
  const groups = useMemo(() => {
    const order = ["Input", "Clean", "Shape", "Combine", "Clinical", "Output"];
    return order
      .map((g) => ({ g, items: catalogue.filter((c) => c.category === g) }))
      .filter((x) => x.items.length > 0);
  }, [catalogue]);

  return (
    <aside className="w-[184px] shrink-0 overflow-y-auto border-r border-[#d3d8de] bg-white">
      {groups.map(({ g, items }) => (
        <div key={g} className="py-1.5">
          <p className="px-3 pb-1 text-[10px] font-medium uppercase tracking-wide text-[#8f99a8]">
            {g}
          </p>
          {items.map((m) => {
            const Icon = ICON[m.kind];
            const tone = TONE[m.category] ?? TONE.Shape!;
            return (
              <button
                key={m.kind}
                type="button"
                onClick={() => onAdd(m)}
                title={m.description}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[#f6f7f9]"
              >
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded",
                    tone.bg,
                    tone.fg,
                  )}
                >
                  <Icon className="h-3 w-3" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[11.5px] font-medium text-[#1c2127]">
                    {m.label}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ))}
      <p className="border-t border-[#e5e8eb] px-3 py-2 text-[10.5px] leading-snug text-[#8f99a8]">
        Click to add. Use the dot on a node&apos;s right edge to connect it to the next one.
      </p>
    </aside>
  );
}

// --- canvas -----------------------------------------------------------------

const Canvas = function Canvas({
  nodes,
  edges,
  sel,
  run,
  connecting,
  onSelect,
  onMove,
  onStartConnect,
  onConnect,
  onCancelConnect,
}: {
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  sel: string | null;
  run: RunResult | null;
  connecting: { from: string } | null;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onStartConnect: (id: string) => void;
  onConnect: (to: string, port?: "left" | "right") => void;
  onCancelConnect: () => void;
}) {
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  function beginDrag(e: React.MouseEvent, n: PipelineNode) {
    e.preventDefault();
    const sx = e.clientX - n.x;
    const sy = e.clientY - n.y;
    function move(ev: MouseEvent) {
      onMove(n.id, Math.max(0, ev.clientX - sx), Math.max(0, ev.clientY - sy));
    }
    function up() {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    }
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  return (
    <div
      className="relative min-w-0 flex-1 overflow-auto bg-[#f6f7f9]"
      style={{
        backgroundImage: "radial-gradient(#dfe3e8 1px, transparent 1px)",
        backgroundSize: "16px 16px",
      }}
      onClick={() => connecting && onCancelConnect()}
      role="presentation"
    >
      <svg className="pointer-events-none absolute inset-0 h-full w-full">
        <defs>
          <marker
            id="pipe-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="#8a94a0" />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const a = byId.get(e.from);
          const b = byId.get(e.to);
          if (!a || !b) return null;
          const x1 = a.x + NODE_W;
          const y1 = a.y + NODE_H / 2;
          const x2 = b.x;
          const y2 = b.y + NODE_H / 2 + (e.toPort === "right" ? 10 : e.toPort === "left" ? -10 : 0);
          const mx = (x1 + x2) / 2;
          return (
            <path
              key={i}
              d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2 - 8},${y2}`}
              fill="none"
              stroke="#8a94a0"
              strokeWidth={1.6}
              markerEnd="url(#pipe-arrow)"
            />
          );
        })}
      </svg>

      {nodes.map((n) => {
        const Icon = ICON[n.kind];
        const stat = run?.nodeStats[n.id];
        const isJoin = n.kind === "join";
        const isInput = n.kind === "dataset_input";
        const isOutput = n.kind === "object_output" || n.kind === "dataset_output";
        return (
          <div
            key={n.id}
            className={cn(
              "absolute rounded-md border bg-white shadow-sm",
              sel === n.id ? "border-[#2d72d2] ring-2 ring-[#e7f2fd]" : "border-[#d3d8de]",
              connecting?.from === n.id && "ring-2 ring-[#2d72d2]",
            )}
            style={{ left: n.x, top: n.y, width: NODE_W }}
            onMouseDown={(e) => {
              onSelect(n.id);
              beginDrag(e, n);
            }}
            onClick={(e) => e.stopPropagation()}
            role="presentation"
          >
            <div className="flex items-center gap-1.5 border-b border-[#e5e8eb] px-2 py-1.5">
              <Icon className="h-3 w-3 shrink-0 text-[#5f6b7c]" />
              <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-[#1c2127]">
                {n.name}
              </span>
            </div>
            <div className="flex items-center justify-between px-2 py-1 text-[10px] text-[#8f99a8]">
              {stat ? (
                <>
                  <span>{stat.out.toLocaleString()} rows</span>
                  {stat.dropped > 0 ? (
                    <span className="font-medium text-[#d9822b]">−{stat.dropped}</span>
                  ) : null}
                </>
              ) : (
                <span>not previewed</span>
              )}
            </div>

            {/* input ports */}
            {!isInput ? (
              isJoin ? (
                <>
                  <Port
                    side="in"
                    offset={-10}
                    label="L"
                    active={connecting !== null}
                    onClick={() => onConnect(n.id, "left")}
                  />
                  <Port
                    side="in"
                    offset={10}
                    label="R"
                    active={connecting !== null}
                    onClick={() => onConnect(n.id, "right")}
                  />
                </>
              ) : (
                <Port side="in" active={connecting !== null} onClick={() => onConnect(n.id)} />
              )
            ) : null}

            {/* output port */}
            {!isOutput ? (
              <Port
                side="out"
                active={false}
                onClick={() => onStartConnect(n.id)}
              />
            ) : null}
          </div>
        );
      })}

      {nodes.length === 0 ? (
        <p className="absolute left-1/2 top-24 -translate-x-1/2 text-xs text-[#8f99a8]">
          Add an input from the palette to start.
        </p>
      ) : null}
    </div>
  );
};

function Port({
  side,
  offset = 0,
  label,
  active,
  onClick,
}: {
  side: "in" | "out";
  offset?: number;
  label?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={side === "in" ? "Connect into this node" : "Start a connection"}
      className={cn(
        "absolute flex h-3.5 w-3.5 items-center justify-center rounded-full border bg-white text-[7px] font-bold",
        side === "in" ? "-left-[7px]" : "-right-[7px]",
        active && side === "in"
          ? "border-[#2d72d2] bg-[#e7f2fd] text-[#215db0]"
          : "border-[#8f99a8] text-[#8f99a8] hover:border-[#2d72d2] hover:bg-[#e7f2fd]",
      )}
      style={{ top: `calc(50% + ${offset}px)`, transform: "translateY(-50%)" }}
    >
      {label ?? ""}
    </button>
  );
}

// --- inspector --------------------------------------------------------------

const F =
  "mt-1 w-full rounded border border-[#d3d8de] px-2 py-1 text-[11.5px] focus:border-[#2d72d2] focus:outline-none";
const L = "mt-2.5 block text-[10px] font-medium uppercase tracking-wide text-[#8f99a8]";

function Inspector({
  node,
  nodes,
  datasets,
  run,
  columns,
  onName,
  onConfig,
  onDelete,
}: {
  node: PipelineNode | null | undefined;
  nodes: PipelineNode[];
  datasets: Dataset[];
  run: RunResult | null;
  columns: string[];
  onName: (v: string) => void;
  onConfig: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  if (!node) {
    return (
      <aside className="w-[300px] shrink-0 border-l border-[#d3d8de] bg-white p-4">
        <p className="text-[11.5px] leading-relaxed text-[#8f99a8]">
          Select a node to configure it. After a preview, each node shows what went in and what
          came out — that is how you find where rows were lost.
        </p>
      </aside>
    );
  }

  const cfg = node.config;
  const stat = run?.nodeStats[node.id];
  const sample = run?.samples[node.id]?.[0];
  const inputSample = run
    ? Object.entries(run.samples).find(([id]) => id !== node.id && columns.length > 0)?.[1]?.[0]
    : undefined;

  const colSelect = (value: string, onChange: (v: string) => void, placeholder = "column") => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={F}>
      <option value="">{columns.length === 0 ? "preview first" : placeholder}</option>
      {columns.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );

  return (
    <aside className="w-[300px] shrink-0 overflow-y-auto border-l border-[#d3d8de] bg-white">
      <div className="flex items-center justify-between border-b border-[#d3d8de] px-3 py-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-[#8f99a8]">
          {node.kind.replace("_", " ")}
        </span>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete node"
          className="text-[#8f99a8] hover:text-[#a82255]"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="px-3 pb-3">
        <label className={L}>Name</label>
        <input value={node.name} onChange={(e) => onName(e.target.value)} className={F} />

        {node.kind === "dataset_input" ? (
          <>
            <label className={L}>Dataset</label>
            <select
              value={String(cfg.datasetId ?? "")}
              onChange={(e) => onConfig({ datasetId: e.target.value })}
              className={F}
            >
              <option value="">choose…</option>
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.kind})
                </option>
              ))}
            </select>
          </>
        ) : null}

        {node.kind === "filter" ? (
          <>
            <label className={L}>Column</label>
            {colSelect(String(cfg.column ?? ""), (v) => onConfig({ column: v }))}
            <label className={L}>Condition</label>
            <select
              value={String(cfg.op ?? "eq")}
              onChange={(e) => onConfig({ op: e.target.value })}
              className={F}
            >
              <option value="eq">equals</option>
              <option value="ne">does not equal</option>
              <option value="gt">greater than</option>
              <option value="gte">greater or equal</option>
              <option value="lt">less than</option>
              <option value="lte">less or equal</option>
              <option value="contains">contains</option>
              <option value="not_null">is not blank</option>
              <option value="is_null">is blank</option>
            </select>
            {cfg.op !== "is_null" && cfg.op !== "not_null" ? (
              <input
                value={String(cfg.value ?? "")}
                onChange={(e) => onConfig({ value: e.target.value })}
                placeholder="value"
                className={F}
              />
            ) : null}
          </>
        ) : null}

        {node.kind === "select" ? (
          <>
            <label className={L}>Keep these columns</label>
            <div className="mt-1 max-h-40 space-y-0.5 overflow-y-auto rounded border border-[#e5e8eb] p-1.5">
              {columns.length === 0 ? (
                <p className="text-[10.5px] text-[#8f99a8]">Preview to see the columns.</p>
              ) : (
                columns.map((c) => {
                  const keep = (cfg.keep as string[] | undefined) ?? [];
                  const on = keep.length === 0 || keep.includes(c);
                  return (
                    <label key={c} className="flex items-center gap-1.5 text-[11px]">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => {
                          const base = keep.length === 0 ? columns : keep;
                          onConfig({
                            keep: on ? base.filter((x) => x !== c) : [...base, c],
                          });
                        }}
                        className="h-3 w-3 accent-[#2d72d2]"
                      />
                      <span className="truncate">{c}</span>
                    </label>
                  );
                })
              )}
            </div>
          </>
        ) : null}

        {node.kind === "derive" ? (
          <>
            <label className={L}>New column name</label>
            <input
              value={String(cfg.as ?? "")}
              onChange={(e) => onConfig({ as: e.target.value })}
              placeholder="key"
              className={F}
            />
            <label className={L}>How</label>
            <select
              value={String(cfg.op ?? "concat")}
              onChange={(e) => onConfig({ op: e.target.value })}
              className={F}
            >
              <option value="concat">join columns together</option>
              <option value="arithmetic">arithmetic</option>
              <option value="coalesce">first non-blank</option>
              <option value="date_part">part of a date</option>
              <option value="conditional">if / else</option>
              <option value="constant">a fixed value</option>
            </select>
            {cfg.op !== "constant" ? (
              <>
                <label className={L}>From columns</label>
                <div className="mt-1 max-h-28 space-y-0.5 overflow-y-auto rounded border border-[#e5e8eb] p-1.5">
                  {columns.length === 0 ? (
                    <p className="text-[10.5px] text-[#8f99a8]">Preview to see the columns.</p>
                  ) : (
                    columns.map((c) => {
                      const list = (cfg.columns as string[] | undefined) ?? [];
                      return (
                        <label key={c} className="flex items-center gap-1.5 text-[11px]">
                          <input
                            type="checkbox"
                            checked={list.includes(c)}
                            onChange={() =>
                              onConfig({
                                columns: list.includes(c)
                                  ? list.filter((x) => x !== c)
                                  : [...list, c],
                              })
                            }
                            className="h-3 w-3 accent-[#2d72d2]"
                          />
                          <span className="truncate">{c}</span>
                        </label>
                      );
                    })
                  )}
                </div>
              </>
            ) : null}
            {cfg.op === "concat" ? (
              <>
                <label className={L}>Separator</label>
                <input
                  value={String(cfg.separator ?? "")}
                  onChange={(e) => onConfig({ separator: e.target.value })}
                  placeholder="|"
                  className={F}
                />
              </>
            ) : null}
            {cfg.op === "arithmetic" ? (
              <>
                <label className={L}>Operation</label>
                <select
                  value={String(cfg.arith ?? "add")}
                  onChange={(e) => onConfig({ arith: e.target.value })}
                  className={F}
                >
                  <option value="add">add</option>
                  <option value="subtract">subtract</option>
                  <option value="multiply">multiply</option>
                  <option value="divide">divide</option>
                </select>
                <input
                  value={String(cfg.value ?? "")}
                  onChange={(e) => onConfig({ value: Number(e.target.value) })}
                  placeholder="or a constant"
                  className={F}
                />
              </>
            ) : null}
            {cfg.op === "date_part" ? (
              <>
                <label className={L}>Part</label>
                <select
                  value={String(cfg.part ?? "date")}
                  onChange={(e) => onConfig({ part: e.target.value })}
                  className={F}
                >
                  <option value="date">date</option>
                  <option value="year">year</option>
                  <option value="month">month</option>
                  <option value="day">day</option>
                  <option value="hour">hour</option>
                </select>
              </>
            ) : null}
            {cfg.op === "constant" ? (
              <input
                value={String(cfg.value ?? "")}
                onChange={(e) => onConfig({ value: e.target.value })}
                placeholder="value"
                className={F}
              />
            ) : null}
          </>
        ) : null}

        {node.kind === "cast" ? (
          <>
            <label className={L}>Convert columns</label>
            <div className="mt-1 space-y-1">
              {((cfg.casts as { column: string; to: string }[] | undefined) ?? []).map((c, i) => (
                <div key={i} className="flex gap-1">
                  <select
                    value={c.column}
                    onChange={(e) => {
                      const list = [...((cfg.casts as { column: string; to: string }[]) ?? [])];
                      list[i] = { ...c, column: e.target.value };
                      onConfig({ casts: list });
                    }}
                    className="min-w-0 flex-1 rounded border border-[#d3d8de] px-1.5 py-1 text-[11px]"
                  >
                    <option value="">column</option>
                    {columns.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </select>
                  <select
                    value={c.to}
                    onChange={(e) => {
                      const list = [...((cfg.casts as { column: string; to: string }[]) ?? [])];
                      list[i] = { ...c, to: e.target.value };
                      onConfig({ casts: list });
                    }}
                    className="rounded border border-[#d3d8de] px-1.5 py-1 text-[11px]"
                  >
                    <option value="string">text</option>
                    <option value="number">number</option>
                    <option value="boolean">true/false</option>
                    <option value="date">date</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      const list = ((cfg.casts as { column: string; to: string }[]) ?? []).filter(
                        (_, j) => j !== i,
                      );
                      onConfig({ casts: list });
                    }}
                    aria-label="Remove"
                    className="text-[#8f99a8] hover:text-[#a82255]"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  onConfig({
                    casts: [
                      ...((cfg.casts as { column: string; to: string }[]) ?? []),
                      { column: "", to: "number" },
                    ],
                  })
                }
                className="text-[11px] text-[#2d72d2] hover:underline"
              >
                + add
              </button>
            </div>
            <label className={L}>When a value will not convert</label>
            <select
              value={String(cfg.onError ?? "null")}
              onChange={(e) => onConfig({ onError: e.target.value })}
              className={F}
            >
              <option value="null">blank the field, keep the row</option>
              <option value="drop_row">drop the whole row</option>
            </select>
          </>
        ) : null}

        {node.kind === "join" ? (
          <>
            <label className={L}>Left key</label>
            <input
              value={String(cfg.leftKey ?? "")}
              onChange={(e) => onConfig({ leftKey: e.target.value })}
              placeholder="id"
              className={F}
            />
            <label className={L}>Right key</label>
            <input
              value={String(cfg.rightKey ?? "")}
              onChange={(e) => onConfig({ rightKey: e.target.value })}
              placeholder="id"
              className={F}
            />
            <label className={L}>Kind</label>
            <select
              value={String(cfg.kind ?? "inner")}
              onChange={(e) => onConfig({ kind: e.target.value })}
              className={F}
            >
              <option value="inner">inner — drop unmatched</option>
              <option value="left">left — keep unmatched</option>
            </select>
            <label className={L}>Prefix right columns</label>
            <input
              value={String(cfg.rightPrefix ?? "")}
              onChange={(e) => onConfig({ rightPrefix: e.target.value })}
              placeholder="r_"
              className={F}
            />
            <p className="mt-1 text-[10.5px] leading-snug text-[#8f99a8]">
              Without a prefix, columns that exist on both sides get{" "}
              <code className="text-[10px]">_right</code> appended rather than overwriting the left
              value.
            </p>
          </>
        ) : null}

        {node.kind === "text_field" ? (
          <>
            <label className={L}>Column holding the text</label>
            {colSelect(String(cfg.column ?? ""), (v) => onConfig({ column: v }))}
            <label className={L}>Path inside it (optional)</label>
            <input
              value={String(cfg.fieldPath ?? "")}
              onChange={(e) => onConfig({ fieldPath: e.target.value })}
              placeholder="note.body"
              className={F}
            />
            <p className="mt-1 text-[10.5px] leading-snug text-[#8f99a8]">
              Only needed when the column holds JSON rather than plain text.
            </p>
            <label className={L}>Write the text as</label>
            <input
              value={String(cfg.as ?? "")}
              onChange={(e) => onConfig({ as: e.target.value })}
              placeholder="text"
              className={F}
            />
          </>
        ) : null}

        {node.kind === "extract_snomed" ? (
          <>
            <label className={L}>Text column</label>
            {colSelect(String(cfg.textColumn ?? ""), (v) => onConfig({ textColumn: v }))}
            <label className={L}>Language</label>
            <select
              value={String(cfg.language ?? "auto")}
              onChange={(e) => onConfig({ language: e.target.value })}
              className={F}
            >
              <option value="auto">detect</option>
              <option value="fr">French</option>
              <option value="en">English</option>
            </select>
            <label className={L}>Accept threshold</label>
            <input
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={Number(cfg.acceptThreshold ?? 0.85)}
              onChange={(e) => onConfig({ acceptThreshold: Number(e.target.value) })}
              className={F}
            />
            <label className="mt-2 flex items-center gap-1.5 text-[11px]">
              <input
                type="checkbox"
                checked={cfg.withContexts !== false}
                onChange={(e) => onConfig({ withContexts: e.target.checked })}
                className="h-3 w-3 accent-[#2d72d2]"
              />
              Capture assertion, subject and certainty
            </label>
            <p className="mt-2 rounded bg-[#e7f2fd] px-2 py-1.5 text-[10.5px] leading-snug text-[#215db0]">
              This node fans out — one note becomes one row per concept found. Rows going up here
              is expected. A note that yields nothing is counted as dropped rather than vanishing.
            </p>
          </>
        ) : null}

        {node.kind === "validate_confidence" ? (
          <>
            <label className={L}>Minimum confidence</label>
            <input
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={Number(cfg.minConfidence ?? 0.6)}
              onChange={(e) => onConfig({ minConfidence: Number(e.target.value) })}
              className={F}
            />
            <label className={L}>Below that</label>
            <select
              value={String(cfg.onLow ?? "flag")}
              onChange={(e) => onConfig({ onLow: e.target.value })}
              className={F}
            >
              <option value="flag">mark it and keep going</option>
              <option value="review">send to the review queue</option>
              <option value="drop">discard it</option>
            </select>
            {cfg.onLow === "drop" ? (
              <p className="mt-1 rounded bg-[#fdf6ec] px-2 py-1.5 text-[10.5px] leading-snug text-[#8a5a12]">
                A discarded clinical finding is gone with no record. Review keeps it recoverable.
              </p>
            ) : null}
            <label className={L}>Treat as duplicate when these match</label>
            <div className="mt-1 max-h-32 space-y-0.5 overflow-y-auto rounded border border-[#e5e8eb] p-1.5">
              {columns.length === 0 ? (
                <p className="text-[10.5px] text-[#8f99a8]">Preview to see the columns.</p>
              ) : (
                columns.map((c) => {
                  const list = (cfg.dedupeOn as string[] | undefined) ?? [];
                  return (
                    <label key={c} className="flex items-center gap-1.5 text-[11px]">
                      <input
                        type="checkbox"
                        checked={list.includes(c)}
                        onChange={() =>
                          onConfig({
                            dedupeOn: list.includes(c)
                              ? list.filter((x) => x !== c)
                              : [...list, c],
                          })
                        }
                        className="h-3 w-3 accent-[#2d72d2]"
                      />
                      <span className="truncate">{c}</span>
                    </label>
                  );
                })
              )}
            </div>
          </>
        ) : null}

        {node.kind === "dataset_output" ? (
          <>
            <label className={L}>Write to dataset</label>
            <select
              value={String(cfg.datasetId ?? "")}
              onChange={(e) => onConfig({ datasetId: e.target.value })}
              className={F}
            >
              <option value="">choose…</option>
              {datasets
                .filter((d) => d.kind === "table")
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </select>
          </>
        ) : null}

        {node.kind === "object_output" ? (
          <>
            <label className={L}>Object type</label>
            <input
              value={String(cfg.objectTypeName ?? "")}
              onChange={(e) => onConfig({ objectTypeName: e.target.value })}
              placeholder="VariantWeeklyShare"
              className={F}
            />
            <label className={L}>Identity — the key rows upsert on</label>
            <div className="mt-1 max-h-32 space-y-0.5 overflow-y-auto rounded border border-[#e5e8eb] p-1.5">
              {columns.length === 0 ? (
                <p className="text-[10.5px] text-[#8f99a8]">Preview to see the columns.</p>
              ) : (
                columns.map((c) => {
                  const ident = (cfg.identityProperties as string[] | undefined) ?? [];
                  return (
                    <label key={c} className="flex items-center gap-1.5 text-[11px]">
                      <input
                        type="checkbox"
                        checked={ident.includes(c)}
                        onChange={() =>
                          onConfig({
                            identityProperties: ident.includes(c)
                              ? ident.filter((x) => x !== c)
                              : [...ident, c],
                          })
                        }
                        className="h-3 w-3 accent-[#2d72d2]"
                      />
                      <span className="truncate">{c}</span>
                    </label>
                  );
                })
              )}
            </div>
            <p className="mt-1 rounded bg-[#fdf6ec] px-2 py-1.5 text-[10.5px] leading-snug text-[#8a5a12]">
              The key has to be unique per row. Pick too few columns and every run overwrites the
              same instance — 294 rows quietly become 6.
            </p>
            <label className={L}>Column → property</label>
            <div className="mt-1 space-y-1">
              {((cfg.columnMapping as { from: string; to: string }[] | undefined) ?? []).map(
                (m, i) => (
                  <div key={i} className="flex gap-1">
                    <select
                      value={m.from}
                      onChange={(e) => {
                        const list = [
                          ...((cfg.columnMapping as { from: string; to: string }[]) ?? []),
                        ];
                        list[i] = { ...m, from: e.target.value };
                        onConfig({ columnMapping: list });
                      }}
                      className="min-w-0 flex-1 rounded border border-[#d3d8de] px-1.5 py-1 text-[11px]"
                    >
                      <option value="">column</option>
                      {columns.map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                    </select>
                    <input
                      value={m.to}
                      onChange={(e) => {
                        const list = [
                          ...((cfg.columnMapping as { from: string; to: string }[]) ?? []),
                        ];
                        list[i] = { ...m, to: e.target.value };
                        onConfig({ columnMapping: list });
                      }}
                      placeholder="property"
                      className="min-w-0 flex-1 rounded border border-[#d3d8de] px-1.5 py-1 text-[11px]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const list = (
                          (cfg.columnMapping as { from: string; to: string }[]) ?? []
                        ).filter((_, j) => j !== i);
                        onConfig({ columnMapping: list });
                      }}
                      aria-label="Remove"
                      className="text-[#8f99a8] hover:text-[#a82255]"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ),
              )}
              <button
                type="button"
                onClick={() =>
                  onConfig({
                    columnMapping: [
                      ...((cfg.columnMapping as { from: string; to: string }[]) ?? []),
                      { from: "", to: "" },
                    ],
                  })
                }
                className="text-[11px] text-[#2d72d2] hover:underline"
              >
                + add
              </button>
            </div>

            {/* Links are what the twin counts. A property holding "6 Ouest"
                is a string; a link to the OrgUnit of that name is an edge. */}
            <label className={L}>Links to other objects</label>
            <div className="mt-1 space-y-2">
              {((cfg.linkRules as LinkRule[] | undefined) ?? []).map((r, i) => {
                const patch = (next: Partial<LinkRule>) => {
                  const list = [...((cfg.linkRules as LinkRule[]) ?? [])];
                  list[i] = { ...r, ...next };
                  onConfig({ linkRules: list });
                };
                return (
                  <div key={i} className="rounded border border-[#e5e8eb] bg-[#f8f9fa] p-1.5">
                    <div className="flex items-center gap-1">
                      <select
                        value={r.fromColumn ?? ""}
                        onChange={(e) => patch({ fromColumn: e.target.value })}
                        className="min-w-0 flex-1 rounded border border-[#d3d8de] px-1.5 py-1 text-[11px]"
                      >
                        <option value="">column</option>
                        {columns.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() =>
                          onConfig({
                            linkRules: ((cfg.linkRules as LinkRule[]) ?? []).filter(
                              (_, j) => j !== i,
                            ),
                          })
                        }
                        aria-label="Remove link rule"
                        className="text-[#8f99a8] hover:text-[#a82255]"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="mt-1 flex items-center gap-1">
                      <span className="text-[10px] text-[#8f99a8]">matches</span>
                      <input
                        value={r.targetType ?? ""}
                        onChange={(e) => patch({ targetType: e.target.value })}
                        placeholder="OrgUnit"
                        className="min-w-0 flex-1 rounded border border-[#d3d8de] px-1.5 py-1 text-[11px]"
                      />
                      <span className="text-[10px] text-[#8f99a8]">.</span>
                      <input
                        value={r.targetProperty ?? ""}
                        onChange={(e) => patch({ targetProperty: e.target.value })}
                        placeholder="name"
                        className="min-w-0 flex-1 rounded border border-[#d3d8de] px-1.5 py-1 text-[11px]"
                      />
                    </div>
                    <div className="mt-1 flex items-center gap-1">
                      <select
                        value={r.direction ?? "out"}
                        onChange={(e) =>
                          patch({ direction: e.target.value as "out" | "in" })
                        }
                        className="rounded border border-[#d3d8de] px-1.5 py-1 text-[11px]"
                      >
                        <option value="out">this →</option>
                        <option value="in">← this</option>
                      </select>
                      <input
                        value={r.linkType ?? ""}
                        onChange={(e) => patch({ linkType: e.target.value })}
                        placeholder="located_in"
                        className="min-w-0 flex-1 rounded border border-[#d3d8de] px-1.5 py-1 text-[11px]"
                      />
                    </div>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() =>
                  onConfig({
                    linkRules: [
                      ...((cfg.linkRules as LinkRule[]) ?? []),
                      {
                        fromColumn: "",
                        targetType: "OrgUnit",
                        targetProperty: "name",
                        linkType: "located_in",
                        direction: "out",
                      },
                    ],
                  })
                }
                className="text-[11px] text-[#2d72d2] hover:underline"
              >
                + add link
              </button>
            </div>
            <p className="mt-1 text-[10.5px] leading-snug text-[#8f99a8]">
              The twin counts a patient toward a unit only when they are linked to it. A column
              holding the unit name is not enough on its own.
            </p>
          </>
        ) : null}
      </div>

      {stat ? (
        <div className="border-t border-[#e5e8eb] px-3 py-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-[#8f99a8]">
            This run
          </p>
          <div className="mt-1 grid grid-cols-3 gap-1.5 text-center">
            <div className="rounded bg-[#f8f9fa] py-1">
              <p className="text-[10px] text-[#8f99a8]">in</p>
              <p className="text-xs font-semibold">{stat.in.toLocaleString()}</p>
            </div>
            <div className="rounded bg-[#f8f9fa] py-1">
              <p className="text-[10px] text-[#8f99a8]">out</p>
              <p className="text-xs font-semibold">{stat.out.toLocaleString()}</p>
            </div>
            <div className="rounded bg-[#f8f9fa] py-1">
              <p className="text-[10px] text-[#8f99a8]">dropped</p>
              <p
                className={cn(
                  "text-xs font-semibold",
                  stat.dropped > 0 ? "text-[#d9822b]" : "text-[#1c2127]",
                )}
              >
                {stat.dropped.toLocaleString()}
              </p>
            </div>
          </div>

          {stat.linked !== undefined || stat.unresolved !== undefined ? (
            <div className="mt-1.5 grid grid-cols-2 gap-1.5 text-center">
              <div className="rounded bg-[#f8f9fa] py-1">
                <p className="text-[10px] text-[#8f99a8]">links made</p>
                <p className="text-xs font-semibold">{(stat.linked ?? 0).toLocaleString()}</p>
              </div>
              <div className="rounded bg-[#f8f9fa] py-1">
                <p className="text-[10px] text-[#8f99a8]">no match</p>
                <p
                  className={cn(
                    "text-xs font-semibold",
                    (stat.unresolved ?? 0) > 0 ? "text-[#d9822b]" : "text-[#1c2127]",
                  )}
                >
                  {(stat.unresolved ?? 0).toLocaleString()}
                </p>
              </div>
            </div>
          ) : null}
          {(stat.unresolved ?? 0) > 0 ? (
            <p className="mt-1.5 rounded bg-[#fdf6ec] px-2 py-1.5 text-[10.5px] leading-snug text-[#8a5a12]">
              {stat.unresolved} row{stat.unresolved === 1 ? "" : "s"} named a target that does not
              exist in the ontology. The instances were written; they are just not attached, so the
              twin will not count them.
            </p>
          ) : null}
        </div>
      ) : null}

      {sample ? (
        <div className="border-t border-[#e5e8eb] px-3 py-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-[#8f99a8]">
            Output — first row
          </p>
          <pre className="mt-1 max-h-48 overflow-auto rounded bg-[#f8f9fa] p-1.5 font-mono text-[10px] leading-snug text-[#404854]">
            {JSON.stringify(sample, null, 1)}
          </pre>
          {inputSample && node.kind !== "dataset_input" ? (
            <>
              <p className="mt-2 text-[10px] font-medium uppercase tracking-wide text-[#8f99a8]">
                Input — first row
              </p>
              <pre className="mt-1 max-h-32 overflow-auto rounded bg-[#f8f9fa] p-1.5 font-mono text-[10px] leading-snug text-[#8f99a8]">
                {JSON.stringify(inputSample, null, 1)}
              </pre>
            </>
          ) : null}
        </div>
      ) : null}

      {nodes.length > 0 && !run ? (
        <p className="border-t border-[#e5e8eb] px-3 py-2 text-[10.5px] leading-snug text-[#8f99a8]">
          Run a preview to populate the column pickers — they list what the upstream node actually
          produced, not what you hope it did.
        </p>
      ) : null}
    </aside>
  );
}
