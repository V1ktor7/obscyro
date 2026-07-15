"use client";

/**
 * Data Studio — Pipeline Builder-style canvas (the lab-interop-flow design):
 * toolbar with validation chips, dot-grid canvas with typed nodes (colored
 * icon block, live subtitle, status check, ports, orthogonal edges), a
 * searchable categorized add-node menu, and a preview table for the selected
 * node. Preview executes the flow read-only; Run also performs writes
 * (save to ontology, CSV export). Flows persist locally per environment.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  AlertTriangle,
  Box,
  Calculator,
  CheckCircle2,
  Database,
  Eye,
  FileDown,
  FileText,
  Filter,
  GitBranch,
  Languages,
  Loader2,
  Play,
  Ruler,
  ScanSearch,
  Search,
  Settings2,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/cn";
import {
  createEnvObject,
  decide,
  extractConcepts,
  extractContexts,
  translateCode,
} from "@/lib/platform-api";
import { numericColumns, parseCsvRows } from "../csv-parse";
import { pathD, type Geom } from "../studio-graph";
import { useStudio } from "../StudioShell";

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

type StudioNodeType =
  | "dataset"
  | "text"
  | "extractMap"
  | "crosswalk"
  | "ucum"
  | "filter"
  | "formula"
  | "saveOntology"
  | "exportCsv";

type Row = Record<string, unknown>;

interface StudioNode {
  id: string;
  type: StudioNodeType;
  name: string;
  x: number;
  y: number;
  config: Record<string, string>;
}

interface StudioEdge {
  id: string;
  source: string;
  target: string;
}

interface NodeResult {
  status: "ok" | "warn" | "error";
  rows?: Row[];
  text?: string;
  summary: string;
}

const NODE_W = 192;
const NODE_H = 52;
const CANVAS_W = 1600;
const CANVAS_H = 860;

const NODE_META: Record<
  StudioNodeType,
  {
    label: string;
    menuHint: string;
    category: string;
    icon: LucideIcon;
    block: string;
    writes?: boolean;
  }
> = {
  dataset: { label: "Dataset (CSV)", menuHint: "manual file import", category: "Inputs", icon: Database, block: "bg-[#e7f2fd] text-[#215db0]" },
  text: { label: "Text input", menuHint: "paste clinical text", category: "Inputs", icon: FileText, block: "bg-[#e7f2fd] text-[#215db0]" },
  extractMap: { label: "Extract + map to SNOMED", menuHint: "NLP concepts + contexts", category: "Mapping", icon: ScanSearch, block: "bg-[#f2ebfb] text-[#6b3fa0]" },
  crosswalk: { label: "Crosswalk (terminology)", menuHint: "SNOMED → ICD-10 · ICD-O · CTV3", category: "Mapping", icon: Languages, block: "bg-[#f2ebfb] text-[#6b3fa0]" },
  ucum: { label: "UCUM normalize", menuHint: "unit conversion", category: "Mapping", icon: Ruler, block: "bg-[#f2ebfb] text-[#6b3fa0]" },
  filter: { label: "Filter rows", menuHint: "column · operator · value", category: "Filter + clean", icon: Filter, block: "bg-[#e9f5f4] text-[#0f6b68]" },
  formula: { label: "Formula", menuHint: "derive column (JS expression)", category: "Filter + clean", icon: Calculator, block: "bg-[#e9f5f4] text-[#0f6b68]" },
  saveOntology: { label: "Save to ontology", menuHint: "records → instances", category: "Act + serve", icon: Box, block: "bg-[#f2ebfb] text-[#6b3fa0]", writes: true },
  exportCsv: { label: "Export CSV", menuHint: "download output", category: "Act + serve", icon: FileDown, block: "bg-[#e8f4ec] text-[#1c6e42]", writes: true },
};

const CATEGORIES = ["Inputs", "Mapping", "Filter + clean", "Act + serve"];

function defaultConfig(type: StudioNodeType): Record<string, string> {
  switch (type) {
    case "dataset":
      return { csvText: "", csvFileName: "" };
    case "text":
      return { text: "62yo with chest pain. Father had an MI. Rule out pulmonary embolism." };
    case "extractMap":
      return { language: "auto", acceptThreshold: "0.85" };
    case "crosswalk":
      return { codeColumn: "snomed_code", targetSystem: "icd10" };
    case "ucum":
      return { valueColumn: "value", unitColumn: "unit" };
    case "filter":
      return { column: "", op: ">", value: "" };
    case "formula":
      return { newColumn: "derived", expression: "Number(row.value) * 2" };
    case "saveOntology":
      return { objectType: "ClinicalFinding" };
    case "exportCsv":
      return { fileName: "export.csv" };
  }
}

let idSeq = 0;
function nextId(): string {
  idSeq += 1;
  return `n${Date.now().toString(36)}${idSeq}`;
}

function defaultFlow(): { name: string; nodes: StudioNode[]; edges: StudioEdge[] } {
  const a: StudioNode = { id: nextId(), type: "text", name: "ED note", x: 60, y: 80, config: defaultConfig("text") };
  const b: StudioNode = { id: nextId(), type: "extractMap", name: "Extract + map to SNOMED", x: 380, y: 80, config: defaultConfig("extractMap") };
  const c: StudioNode = { id: nextId(), type: "crosswalk", name: "Crosswalk → ICD-10", x: 700, y: 180, config: defaultConfig("crosswalk") };
  const d: StudioNode = { id: nextId(), type: "saveOntology", name: "Ontology · ClinicalFinding", x: 1020, y: 280, config: defaultConfig("saveOntology") };
  return {
    name: "lab-interop-flow",
    nodes: [a, b, c, d],
    edges: [
      { id: nextId(), source: a.id, target: b.id },
      { id: nextId(), source: b.id, target: c.id },
      { id: nextId(), source: c.id, target: d.id },
    ],
  };
}

const STORE_PREFIX = "obs_data_studio_v1:";

// UCUM-style unit normalizations (numerically safe, identity-factor pairs
// plus decimal moves; anything unknown passes through unchanged).
const UNIT_MAP: Record<string, { unit: string; factor: number }> = {
  "ng/ml": { unit: "µg/L", factor: 1 },
  "ug/ml": { unit: "mg/L", factor: 1 },
  "µg/ml": { unit: "mg/L", factor: 1 },
  "mg/ml": { unit: "g/L", factor: 1 },
  "g/dl": { unit: "g/L", factor: 10 },
  "mg/dl": { unit: "mg/L", factor: 10 },
};

function toCsv(rows: Row[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}

/** Static config problems per node (drives the toolbar validation chips). */
function nodeIssue(node: StudioNode, hasIncoming: boolean): string | null {
  switch (node.type) {
    case "dataset":
      return node.config.csvText.trim() ? null : "no CSV imported";
    case "text":
      return node.config.text.trim() ? null : "no text";
    case "filter":
      if (!node.config.column.trim()) return "no filter column";
      break;
    case "formula":
      if (!node.config.newColumn.trim() || !node.config.expression.trim()) {
        return "formula incomplete";
      }
      break;
    case "saveOntology":
      if (!node.config.objectType.trim()) return "no object type";
      break;
    default:
      break;
  }
  return hasIncoming ? null : "not connected";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DataStudioView({ onOpenLegacy }: { onOpenLegacy: () => void }) {
  const { hasKey, selectedEnv } = useStudio();
  const env = selectedEnv;

  const [name, setName] = useState("lab-interop-flow");
  const [nodes, setNodes] = useState<StudioNode[]>([]);
  const [edges, setEdges] = useState<StudioEdge[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [results, setResults] = useState<Map<string, NodeResult>>(new Map());
  const [running, setRunning] = useState<"preview" | "run" | null>(null);
  const [runStage, setRunStage] = useState<string | null>(null);
  const [menuSearch, setMenuSearch] = useState("");
  const [menuCat, setMenuCat] = useState("Mapping");
  const [error, setError] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  const loadedRef = useRef(false);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);

  // Load / persist per environment.
  useEffect(() => {
    loadedRef.current = false;
    try {
      const raw = env ? localStorage.getItem(`${STORE_PREFIX}${env}`) : null;
      if (raw) {
        const parsed = JSON.parse(raw) as { name: string; nodes: StudioNode[]; edges: StudioEdge[] };
        setName(parsed.name || "lab-interop-flow");
        setNodes(parsed.nodes ?? []);
        setEdges(parsed.edges ?? []);
      } else {
        const d = defaultFlow();
        setName(d.name);
        setNodes(d.nodes);
        setEdges(d.edges);
      }
    } catch {
      const d = defaultFlow();
      setName(d.name);
      setNodes(d.nodes);
      setEdges(d.edges);
    }
    setResults(new Map());
    setSelectedId(null);
    loadedRef.current = true;
  }, [env]);

  useEffect(() => {
    if (!env || !loadedRef.current) return;
    const handle = setTimeout(() => {
      try {
        localStorage.setItem(`${STORE_PREFIX}${env}`, JSON.stringify({ name, nodes, edges }));
      } catch {
        /* quota */
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [env, name, nodes, edges]);

  const selected = nodes.find((n) => n.id === selectedId) ?? null;
  const incoming = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of edges) m.set(e.target, e.source);
    return m;
  }, [edges]);

  const issues = useMemo(
    () =>
      nodes
        .map((n) => ({ node: n, issue: nodeIssue(n, incoming.has(n.id)) }))
        .filter((x): x is { node: StudioNode; issue: string } => x.issue !== null),
    [nodes, incoming],
  );

  // --- graph edits -----------------------------------------------------------

  function addNode(type: StudioNodeType) {
    const meta = NODE_META[type];
    const node: StudioNode = {
      id: nextId(),
      type,
      name: meta.label,
      x: 80 + (nodes.length % 5) * 60,
      y: 80 + (nodes.length % 6) * 70,
      config: defaultConfig(type),
    };
    setNodes((cur) => [...cur, node]);
    setSelectedId(node.id);
    setInspectorOpen(true);
  }

  function patchNode(id: string, patch: Partial<StudioNode>) {
    setNodes((cur) => cur.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }

  function patchConfig(id: string, key: string, value: string) {
    setNodes((cur) =>
      cur.map((n) => (n.id === id ? { ...n, config: { ...n.config, [key]: value } } : n)),
    );
  }

  function removeNode(id: string) {
    setNodes((cur) => cur.filter((n) => n.id !== id));
    setEdges((cur) => cur.filter((e) => e.source !== id && e.target !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function connect(source: string, target: string) {
    if (source === target) return;
    setEdges((cur) => [
      ...cur.filter((e) => e.target !== target),
      { id: nextId(), source, target },
    ]);
  }

  // --- canvas interactions ----------------------------------------------------

  function canvasPoint(e: ReactPointerEvent): { x: number; y: number } {
    const rect = canvasRef.current?.getBoundingClientRect();
    const el = canvasRef.current;
    if (!rect || !el) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left + el.scrollLeft, y: e.clientY - rect.top + el.scrollTop };
  }

  function onNodePointerDown(e: ReactPointerEvent, node: StudioNode) {
    e.stopPropagation();
    const p = canvasPoint(e);
    dragRef.current = { id: node.id, dx: p.x - node.x, dy: p.y - node.y };
    setSelectedId(node.id);
  }

  function onCanvasPointerMove(e: ReactPointerEvent) {
    const p = canvasPoint(e);
    if (dragRef.current) {
      const { id, dx, dy } = dragRef.current;
      patchNode(id, {
        x: Math.max(0, Math.min(CANVAS_W - NODE_W, p.x - dx)),
        y: Math.max(0, Math.min(CANVAS_H - NODE_H, p.y - dy)),
      });
    }
    if (connectFrom) setPointer(p);
  }

  function onCanvasPointerUp() {
    dragRef.current = null;
    setConnectFrom(null);
    setPointer(null);
  }

  // --- execution ---------------------------------------------------------------

  const topoOrder = useCallback((): StudioNode[] => {
    const indeg = new Map<string, number>(nodes.map((n) => [n.id, 0]));
    for (const e of edges) indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
    const queue = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0);
    const order: StudioNode[] = [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    while (queue.length > 0) {
      const n = queue.shift()!;
      order.push(n);
      for (const e of edges.filter((e) => e.source === n.id)) {
        const d = (indeg.get(e.target) ?? 0) - 1;
        indeg.set(e.target, d);
        if (d === 0) {
          const t = byId.get(e.target);
          if (t) queue.push(t);
        }
      }
    }
    return order;
  }, [nodes, edges]);

  async function execute(write: boolean) {
    if (running) return;
    setRunning(write ? "run" : "preview");
    setError(null);
    const out = new Map<string, NodeResult>();
    try {
      for (const node of topoOrder()) {
        setRunStage(node.name);
        const parent = incoming.get(node.id);
        const input = parent ? out.get(parent) : undefined;
        try {
          out.set(node.id, await executeNode(node, input, write, env));
        } catch (err) {
          out.set(node.id, { status: "error", summary: (err as Error).message });
        }
        setResults(new Map(out));
      }
    } finally {
      setRunning(null);
      setRunStage(null);
    }
  }

  // --- render -------------------------------------------------------------------

  if (!hasKey) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <p className="max-w-sm text-center text-sm text-gray-500">
          Sign in and create an API key to build flows in Data Studio.
        </p>
      </div>
    );
  }

  const menuItems = (Object.keys(NODE_META) as StudioNodeType[]).filter((t) => {
    const meta = NODE_META[t];
    const q = menuSearch.trim().toLowerCase();
    if (q) return `${meta.label} ${meta.menuHint}`.toLowerCase().includes(q);
    return meta.category === menuCat;
  });

  const selectedResult = selected ? results.get(selected.id) ?? null : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#f6f7f9]">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#d3d8de] bg-white px-4 py-2">
        <span className="flex h-6 w-6 items-center justify-center rounded bg-[#f2ebfb] text-[#6b3fa0]">
          <Box className="h-3.5 w-3.5" />
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-44 rounded border border-transparent bg-transparent px-1 py-0.5 text-[13px] font-semibold text-[#1c2127] hover:border-[#d3d8de] focus:border-[#2d72d2] focus:outline-none"
          aria-label="Flow name"
        />
        <span className="flex items-center gap-1 rounded border border-[#d3d8de] px-2 py-0.5 text-[11px] text-[#404854]">
          <GitBranch className="h-3 w-3 text-[#8f99a8]" />
          local draft
        </span>
        {issues.length === 0 ? (
          <span className="flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
            <CheckCircle2 className="h-3 w-3" />
            no errors
          </span>
        ) : (
          <button
            type="button"
            onClick={() => {
              setSelectedId(issues[0].node.id);
              setInspectorOpen(true);
            }}
            className="flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700"
          >
            <AlertTriangle className="h-3 w-3" />
            {issues.length} node{issues.length === 1 ? "" : "s"} need config
          </button>
        )}
        {runStage ? (
          <span className="text-[11px] text-[#8f99a8]">running · {runStage}…</span>
        ) : null}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onOpenLegacy}
          className="text-[11px] text-[#5f6b7c] hover:text-[#2d72d2] hover:underline"
        >
          legacy editor
        </button>
        <button
          type="button"
          disabled={running !== null}
          onClick={() => void execute(false)}
          className="flex items-center gap-1 rounded border border-[#d3d8de] bg-white px-2.5 py-1.5 text-xs text-[#404854] hover:border-[#2d72d2] disabled:opacity-50"
        >
          {running === "preview" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
          Preview
        </button>
        <button
          type="button"
          disabled={running !== null}
          onClick={() => void execute(true)}
          className="flex items-center gap-1 rounded bg-[#2d72d2] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#215db0] disabled:bg-[#c5cbd3]"
        >
          {running === "run" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          Run flow
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

      {/* Canvas */}
      <div
        ref={canvasRef}
        onPointerMove={onCanvasPointerMove}
        onPointerUp={onCanvasPointerUp}
        onPointerDown={() => setSelectedId(null)}
        className="relative min-h-0 flex-1 overflow-auto"
        style={{
          backgroundImage: "radial-gradient(#d3d8de 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
      >
        <div className="relative" style={{ width: CANVAS_W, height: CANVAS_H }}>
          <svg className="absolute inset-0" width={CANVAS_W} height={CANVAS_H}>
            {edges.map((e) => {
              const s = nodes.find((n) => n.id === e.source);
              const t = nodes.find((n) => n.id === e.target);
              if (!s || !t) return null;
              const g: Geom = {
                a: { x: s.x + NODE_W, y: s.y + NODE_H / 2 },
                b: { x: t.x, y: t.y + NODE_H / 2 },
                c1: { x: 0, y: 0 },
                c2: { x: 0, y: 0 },
              };
              return (
                <g key={e.id}>
                  <path d={pathD(g)} fill="none" stroke="#8f99a8" strokeWidth={1.4} />
                  <path
                    d={pathD(g)}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={12}
                    className="cursor-pointer"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setEdges((cur) => cur.filter((x) => x.id !== e.id));
                    }}
                  />
                </g>
              );
            })}
            {connectFrom && pointer
              ? (() => {
                  const s = nodes.find((n) => n.id === connectFrom);
                  if (!s) return null;
                  const g: Geom = {
                    a: { x: s.x + NODE_W, y: s.y + NODE_H / 2 },
                    b: pointer,
                    c1: { x: 0, y: 0 },
                    c2: { x: 0, y: 0 },
                  };
                  return (
                    <path d={pathD(g)} fill="none" stroke="#2d72d2" strokeWidth={1.4} strokeDasharray="4 3" />
                  );
                })()
              : null}
          </svg>

          {nodes.map((node) => {
            const meta = NODE_META[node.type];
            const Icon = meta.icon;
            const result = results.get(node.id);
            const issue = nodeIssue(node, incoming.has(node.id));
            const isSelected = node.id === selectedId;
            return (
              <div
                key={node.id}
                onPointerDown={(e) => onNodePointerDown(e, node)}
                onPointerUp={(e) => {
                  if (connectFrom && connectFrom !== node.id) {
                    e.stopPropagation();
                    connect(connectFrom, node.id);
                    setConnectFrom(null);
                    setPointer(null);
                  }
                }}
                className={cn(
                  "absolute flex cursor-grab select-none items-stretch rounded-md border bg-white shadow-sm",
                  isSelected ? "border-[#2d72d2] ring-1 ring-[#2d72d2]" : "border-[#c5cbd3]",
                  node.type === "saveOntology" ? "bg-[#f6f1fc]" : "",
                )}
                style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H }}
              >
                <span
                  className={cn(
                    "flex w-8 shrink-0 items-center justify-center rounded-l-[5px]",
                    meta.block,
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1 px-2 py-1.5">
                  <span className="block truncate text-[11.5px] font-medium leading-tight text-[#1c2127]">
                    {node.name}
                  </span>
                  <span
                    className={cn(
                      "block truncate text-[10px] leading-tight",
                      result?.status === "error"
                        ? "text-rose-600"
                        : issue
                          ? "text-amber-600"
                          : "text-[#8f99a8]",
                    )}
                  >
                    {result?.summary ?? issue ?? meta.menuHint}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1 pr-1.5">
                  {result?.status === "error" || issue ? (
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                  ) : result ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  ) : null}
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedId(node.id);
                      setInspectorOpen(true);
                    }}
                    className="rounded p-0.5 text-[#8f99a8] hover:text-[#2d72d2]"
                    aria-label={`Configure ${node.name}`}
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                  </button>
                </span>
                {/* ports */}
                <span
                  className="absolute -left-[5px] top-1/2 h-[9px] w-[9px] -translate-y-1/2 rounded-full border-2 border-[#8f99a8] bg-white"
                  aria-hidden="true"
                />
                <span
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setConnectFrom(node.id);
                  }}
                  className="absolute -right-[5px] top-1/2 h-[9px] w-[9px] -translate-y-1/2 cursor-crosshair rounded-full border-2 border-[#2d72d2] bg-white hover:bg-[#e7f2fd]"
                  aria-hidden="true"
                />
              </div>
            );
          })}
        </div>

        {/* Minimap */}
        <div className="pointer-events-none sticky bottom-2 left-full mr-2 h-[52px] w-[92px] -translate-x-full rounded border border-[#d3d8de] bg-white/90 p-1">
          <div className="relative h-full w-full">
            {nodes.map((n) => (
              <span
                key={n.id}
                className={cn("absolute h-[4px] w-[11px] rounded-[1px]", NODE_META[n.type].block)}
                style={{
                  left: (n.x / CANVAS_W) * 84,
                  top: (n.y / CANVAS_H) * 44,
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Bottom split: preview + add-node menu */}
      <div className="flex h-56 shrink-0 border-t border-[#d3d8de] bg-white">
        <div className="flex min-w-0 flex-1 flex-col border-r border-[#d3d8de]">
          <div className="flex items-center gap-2 border-b border-[#e5e8eb] px-3 py-1.5">
            <Eye className="h-3.5 w-3.5 text-[#2d72d2]" />
            <span className="text-xs font-semibold text-[#1c2127]">
              Preview{selected ? ` · ${selected.name}` : ""}
            </span>
            {selectedResult?.rows ? (
              <span className="rounded border border-[#d3d8de] px-1.5 py-0.5 text-[10px] text-[#8f99a8]">
                {Math.min(selectedResult.rows.length, 50)} of{" "}
                {selectedResult.rows.length.toLocaleString()} rows
              </span>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {!selected ? (
              <p className="p-3 text-[11px] text-[#8f99a8]">
                Select a node, then Preview to see its output here.
              </p>
            ) : !selectedResult ? (
              <p className="p-3 text-[11px] text-[#8f99a8]">
                Not run yet — Preview executes the flow without writing anywhere.
              </p>
            ) : selectedResult.rows && selectedResult.rows.length > 0 ? (
              <table className="w-full border-collapse text-left font-mono text-[10.5px]">
                <thead>
                  <tr>
                    {Object.keys(selectedResult.rows[0])
                      .slice(0, 8)
                      .map((h) => (
                        <th
                          key={h}
                          className="border-b border-[#d3d8de] px-2.5 py-1 font-sans text-[10px] font-medium uppercase tracking-wide text-[#8f99a8]"
                        >
                          {h}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {selectedResult.rows.slice(0, 50).map((r, i) => (
                    <tr key={i} className="text-[#404854]">
                      {Object.keys(selectedResult.rows![0])
                        .slice(0, 8)
                        .map((h) => (
                          <td key={h} className="max-w-[180px] truncate border-b border-[#eef1f4] px-2.5 py-1">
                            {r[h] === null || r[h] === undefined ? "—" : String(r[h])}
                          </td>
                        ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : selectedResult.text ? (
              <pre className="whitespace-pre-wrap p-3 font-mono text-[10.5px] text-[#404854]">
                {selectedResult.text.slice(0, 2000)}
              </pre>
            ) : (
              <p className={cn("p-3 text-[11px]", selectedResult.status === "error" ? "text-rose-600" : "text-[#8f99a8]")}>
                {selectedResult.summary}
              </p>
            )}
          </div>
        </div>

        <div className="flex w-[340px] shrink-0 flex-col">
          <div className="flex items-center gap-2 border-b border-[#e5e8eb] px-3 py-1.5">
            <Search className="h-3.5 w-3.5 text-[#8f99a8]" />
            <input
              value={menuSearch}
              onChange={(e) => setMenuSearch(e.target.value)}
              placeholder="Search transforms…"
              className="min-w-0 flex-1 bg-transparent text-xs text-[#1c2127] placeholder:text-[#8f99a8] focus:outline-none"
            />
            <span className="rounded border border-[#d3d8de] px-1.5 py-0.5 text-[10px] text-[#8f99a8]">
              add node
            </span>
          </div>
          <div className="flex min-h-0 flex-1">
            <div className="flex w-[104px] shrink-0 flex-col gap-0.5 border-r border-[#e5e8eb] p-1.5">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setMenuCat(c);
                    setMenuSearch("");
                  }}
                  className={cn(
                    "rounded px-2 py-1 text-left text-[11px]",
                    menuCat === c && !menuSearch
                      ? "bg-[#e7f2fd] font-medium text-[#215db0]"
                      : "text-[#5f6b7c] hover:bg-[#f6f7f9]",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1.5">
              {menuItems.map((t) => {
                const meta = NODE_META[t];
                const Icon = meta.icon;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => addNode(t)}
                    className="flex items-center gap-2 rounded px-2 py-1 text-left text-[11.5px] text-[#1c2127] hover:bg-[#f6f7f9]"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-[#2d72d2]" />
                    <span className="truncate">{meta.label}</span>
                    <span className="ml-auto shrink-0 truncate text-[10px] text-[#8f99a8]">
                      {meta.menuHint}
                    </span>
                  </button>
                );
              })}
              {menuItems.length === 0 ? (
                <p className="px-2 py-1 text-[11px] text-[#8f99a8]">No matching transforms.</p>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Inspector drawer */}
      {inspectorOpen && selected ? (
        <NodeInspector
          node={selected}
          onClose={() => setInspectorOpen(false)}
          onPatchConfig={(k, v) => patchConfig(selected.id, k, v)}
          onRename={(v) => patchNode(selected.id, { name: v })}
          onRemove={() => {
            removeNode(selected.id);
            setInspectorOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Node execution
// ---------------------------------------------------------------------------

async function executeNode(
  node: StudioNode,
  input: NodeResult | undefined,
  write: boolean,
  env: string | null,
): Promise<NodeResult> {
  const c = node.config;
  const needRows = (): Row[] => {
    if (!input?.rows || input.rows.length === 0) {
      throw new Error("This node needs records from an upstream node.");
    }
    return input.rows;
  };

  switch (node.type) {
    case "dataset": {
      const rows = parseCsvRows(c.csvText ?? "");
      if (rows.length === 0) throw new Error("Import a CSV file first (open the node settings).");
      return {
        status: "ok",
        rows,
        summary: `${rows.length.toLocaleString()} rows · ${Object.keys(rows[0]).length} cols`,
      };
    }

    case "text": {
      const text = (c.text ?? "").trim();
      if (!text) throw new Error("Paste some text first.");
      return { status: "ok", text, summary: `${text.length} chars` };
    }

    case "extractMap": {
      const text =
        input?.text ??
        (input?.rows ? input.rows.map((r) => Object.values(r).join(" ")).join("\n").slice(0, 4000) : "");
      if (!text.trim()) throw new Error("Connect a text or dataset node upstream.");
      const threshold = Number(c.acceptThreshold ?? 0.85);
      const { concepts } = await extractConcepts(text, c.language || "auto");
      if (concepts.length === 0) return { status: "warn", rows: [], summary: "no concepts found" };
      const { contexts } = await extractContexts(
        text,
        concepts.map((x) => ({ span: x.span, code: x.code })),
        c.language || "auto",
      );
      const ctxBySpan = new Map(contexts.map((x) => [x.span, x]));
      const rows: Row[] = concepts.map((concept) => {
        const ctx = ctxBySpan.get(concept.span);
        const assertion = ctx?.context.assertion?.value ?? "affirmed";
        const certainty = ctx?.context.certainty?.value ?? "confirmed";
        return {
          span: concept.span,
          snomed_code: concept.code ?? "",
          display: concept.candidates[0]?.display ?? concept.span,
          confidence: Number((concept.concept_confidence ?? 0).toFixed(3)),
          assertion,
          subject: ctx?.context.subject?.value ?? "patient",
          decision: decide(
            concept.status,
            "problem_list",
            ctx?.context_confidence ?? 0,
            assertion,
            certainty,
            threshold,
          ),
        };
      });
      return { status: "ok", rows, summary: `${rows.length} concepts mapped` };
    }

    case "crosswalk": {
      const rows = needRows();
      const col = (c.codeColumn || "snomed_code").trim();
      const target = (c.targetSystem || "icd10") as "icd10" | "icdo" | "ctv3";
      const codes = Array.from(
        new Set(rows.map((r) => String(r[col] ?? "").trim()).filter((x) => x !== "")),
      ).slice(0, 25);
      const mapped = new Map<string, string>();
      for (const code of codes) {
        try {
          const res = await translateCode(code, target);
          const first = res.translations[0] as { target?: string } | undefined;
          if (first?.target) mapped.set(code, first.target);
        } catch {
          /* unmappable code — leave blank */
        }
      }
      const outCol = `${target}_code`;
      const out = rows.map((r) => ({
        ...r,
        [outCol]: mapped.get(String(r[col] ?? "").trim()) ?? "",
      }));
      return {
        status: "ok",
        rows: out,
        summary: `${mapped.size} of ${codes.length} codes → ${target.toUpperCase()}`,
      };
    }

    case "ucum": {
      const rows = needRows();
      const vCol = (c.valueColumn || "value").trim();
      const uCol = (c.unitColumn || "unit").trim();
      let converted = 0;
      const out = rows.map((r) => {
        const unitRaw = String(r[uCol] ?? "").trim();
        const rule = UNIT_MAP[unitRaw.toLowerCase()];
        const value = Number(r[vCol]);
        if (rule && Number.isFinite(value)) {
          converted++;
          return { ...r, [`${vCol}_ucum`]: value * rule.factor, [`${uCol}_ucum`]: rule.unit };
        }
        return { ...r, [`${vCol}_ucum`]: r[vCol], [`${uCol}_ucum`]: unitRaw };
      });
      return { status: "ok", rows: out, summary: `${converted} values normalized` };
    }

    case "filter": {
      const rows = needRows();
      const col = c.column.trim();
      const val = c.value;
      const num = Number(val);
      const out = rows.filter((r) => {
        const cell = r[col];
        const cellNum = Number(cell);
        switch (c.op) {
          case "=":
            return String(cell) === val;
          case "!=":
            return String(cell) !== val;
          case ">":
            return Number.isFinite(cellNum) && Number.isFinite(num) && cellNum > num;
          case "<":
            return Number.isFinite(cellNum) && Number.isFinite(num) && cellNum < num;
          case "contains":
            return String(cell ?? "").toLowerCase().includes(val.toLowerCase());
          default:
            return true;
        }
      });
      return { status: "ok", rows: out, summary: `${out.length} of ${rows.length} rows kept` };
    }

    case "formula": {
      const rows = needRows();
      const newCol = c.newColumn.trim() || "derived";
      // Same trust model as the existing custom-code node: user-authored
      // expressions run client-side against their own data.
      const fn = new Function("row", `return (${c.expression});`) as (row: Row) => unknown;
      let errors = 0;
      const out = rows.map((r) => {
        try {
          return { ...r, [newCol]: fn(r) };
        } catch {
          errors++;
          return { ...r, [newCol]: null };
        }
      });
      return {
        status: errors > 0 ? "warn" : "ok",
        rows: out,
        summary: errors > 0 ? `derived ${newCol} · ${errors} row errors` : `derived ${newCol}`,
      };
    }

    case "saveOntology": {
      const rows = needRows();
      if (!env) throw new Error("Select an environment first.");
      const objectType = c.objectType.trim() || "ClinicalFinding";
      const capped = rows.slice(0, 200);
      if (!write) {
        return {
          status: "ok",
          rows: capped,
          summary: `would create ${capped.length} ${objectType} instance${capped.length === 1 ? "" : "s"} (preview)`,
        };
      }
      let created = 0;
      for (const r of capped) {
        const properties: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r)) {
          if (v !== null && v !== undefined && v !== "") properties[k] = v;
        }
        await createEnvObject(env, {
          type: objectType,
          properties,
          provenance: { source: "data-studio", flow: node.name },
        });
        created++;
      }
      return {
        status: "ok",
        rows: capped,
        summary: `${created} ${objectType} instance${created === 1 ? "" : "s"} created`,
      };
    }

    case "exportCsv": {
      const rows = needRows();
      if (!write) {
        return { status: "ok", rows, summary: `would export ${rows.length} rows (preview)` };
      }
      const csv = toCsv(rows);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = c.fileName.trim() || "export.csv";
      a.click();
      URL.revokeObjectURL(url);
      return { status: "ok", rows, summary: `exported ${rows.length} rows` };
    }
  }
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

const FIELD =
  "w-full rounded border border-[#d3d8de] bg-[#f6f7f9] px-2 py-1.5 text-xs text-[#1c2127] focus:border-[#2d72d2] focus:outline-none";
const LABEL = "mb-1 block text-[10px] font-medium uppercase tracking-wide text-[#8f99a8]";

function NodeInspector({
  node,
  onClose,
  onPatchConfig,
  onRename,
  onRemove,
}: {
  node: StudioNode;
  onClose: () => void;
  onPatchConfig: (key: string, value: string) => void;
  onRename: (name: string) => void;
  onRemove: () => void;
}) {
  const meta = NODE_META[node.type];
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  function readFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      onPatchConfig("csvText", String(reader.result ?? ""));
      onPatchConfig("csvFileName", file.name);
    };
    reader.readAsText(file);
  }

  const csvRows = node.type === "dataset" ? parseCsvRows(node.config.csvText ?? "") : [];

  return (
    <div className="fixed inset-y-0 right-0 z-30 flex w-80 flex-col border-l border-[#d3d8de] bg-white shadow-xl">
      <div className="flex items-center gap-2 border-b border-[#d3d8de] px-3 py-2">
        <span className={cn("flex h-6 w-6 items-center justify-center rounded", meta.block)}>
          <meta.icon className="h-3.5 w-3.5" />
        </span>
        <span className="text-xs font-semibold text-[#1c2127]">{meta.label}</span>
        {meta.writes ? (
          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
            writes on Run
          </span>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-[#8f99a8] hover:text-[#1c2127]"
          aria-label="Close inspector"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <label className="mb-3 block">
          <span className={LABEL}>Node name</span>
          <input value={node.name} onChange={(e) => onRename(e.target.value)} className={FIELD} />
        </label>

        {node.type === "dataset" ? (
          <>
            <span className={LABEL}>Import file (CSV / TSV)</span>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) readFile(f);
              }}
              onClick={() => fileRef.current?.click()}
              className={cn(
                "mb-2 flex cursor-pointer flex-col items-center gap-1 rounded-md border border-dashed px-3 py-5 text-center",
                dragOver ? "border-[#2d72d2] bg-[#e7f2fd]" : "border-[#c5cbd3] bg-[#f6f7f9]",
              )}
            >
              <span className="text-xs font-medium text-[#1c2127]">
                {node.config.csvFileName || "Drop a CSV here, or click to browse"}
              </span>
              <span className="text-[10px] text-[#8f99a8]">first row = column names</span>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.tsv,.txt,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) readFile(f);
                  e.target.value = "";
                }}
              />
            </div>
            {csvRows.length > 0 ? (
              <p className="mb-2 text-[11px] text-[#5f6b7c]">
                {csvRows.length.toLocaleString()} rows ·{" "}
                {Object.keys(csvRows[0]).length} columns ·{" "}
                {Object.keys(numericColumns(csvRows)).length} numeric
              </p>
            ) : null}
          </>
        ) : null}

        {node.type === "text" ? (
          <label className="block">
            <span className={LABEL}>Text</span>
            <textarea
              value={node.config.text}
              onChange={(e) => onPatchConfig("text", e.target.value)}
              rows={6}
              className={cn(FIELD, "resize-y")}
            />
          </label>
        ) : null}

        {node.type === "extractMap" ? (
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={LABEL}>Language</span>
              <select
                value={node.config.language}
                onChange={(e) => onPatchConfig("language", e.target.value)}
                className={FIELD}
              >
                <option value="auto">Auto</option>
                <option value="en">English</option>
                <option value="fr">French</option>
              </select>
            </label>
            <label className="block">
              <span className={LABEL}>Accept threshold</span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={node.config.acceptThreshold}
                onChange={(e) => onPatchConfig("acceptThreshold", e.target.value)}
                className={FIELD}
              />
            </label>
          </div>
        ) : null}

        {node.type === "crosswalk" ? (
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={LABEL}>Code column</span>
              <input
                value={node.config.codeColumn}
                onChange={(e) => onPatchConfig("codeColumn", e.target.value)}
                className={FIELD}
              />
            </label>
            <label className="block">
              <span className={LABEL}>Target system</span>
              <select
                value={node.config.targetSystem}
                onChange={(e) => onPatchConfig("targetSystem", e.target.value)}
                className={FIELD}
              >
                <option value="icd10">ICD-10</option>
                <option value="icdo">ICD-O</option>
                <option value="ctv3">CTV3</option>
              </select>
            </label>
          </div>
        ) : null}

        {node.type === "ucum" ? (
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={LABEL}>Value column</span>
              <input
                value={node.config.valueColumn}
                onChange={(e) => onPatchConfig("valueColumn", e.target.value)}
                className={FIELD}
              />
            </label>
            <label className="block">
              <span className={LABEL}>Unit column</span>
              <input
                value={node.config.unitColumn}
                onChange={(e) => onPatchConfig("unitColumn", e.target.value)}
                className={FIELD}
              />
            </label>
          </div>
        ) : null}

        {node.type === "filter" ? (
          <div className="grid grid-cols-3 gap-2">
            <label className="block col-span-1">
              <span className={LABEL}>Column</span>
              <input
                value={node.config.column}
                onChange={(e) => onPatchConfig("column", e.target.value)}
                className={FIELD}
              />
            </label>
            <label className="block">
              <span className={LABEL}>Op</span>
              <select
                value={node.config.op}
                onChange={(e) => onPatchConfig("op", e.target.value)}
                className={FIELD}
              >
                <option value="=">=</option>
                <option value="!=">≠</option>
                <option value=">">&gt;</option>
                <option value="<">&lt;</option>
                <option value="contains">contains</option>
              </select>
            </label>
            <label className="block">
              <span className={LABEL}>Value</span>
              <input
                value={node.config.value}
                onChange={(e) => onPatchConfig("value", e.target.value)}
                className={FIELD}
              />
            </label>
          </div>
        ) : null}

        {node.type === "formula" ? (
          <>
            <label className="mb-2 block">
              <span className={LABEL}>New column</span>
              <input
                value={node.config.newColumn}
                onChange={(e) => onPatchConfig("newColumn", e.target.value)}
                className={FIELD}
              />
            </label>
            <label className="block">
              <span className={LABEL}>Expression (row → value)</span>
              <textarea
                value={node.config.expression}
                onChange={(e) => onPatchConfig("expression", e.target.value)}
                rows={3}
                className={cn(FIELD, "resize-y font-mono text-[11px]")}
              />
            </label>
          </>
        ) : null}

        {node.type === "saveOntology" ? (
          <>
            <label className="block">
              <span className={LABEL}>Object type</span>
              <input
                value={node.config.objectType}
                onChange={(e) => onPatchConfig("objectType", e.target.value)}
                className={FIELD}
              />
            </label>
            <p className="mt-2 text-[10.5px] leading-relaxed text-[#8f99a8]">
              Run creates up to 200 instances per execution (Preview only counts). Run a Data
              Flux quality scan afterwards to gate what came in.
            </p>
          </>
        ) : null}

        {node.type === "exportCsv" ? (
          <label className="block">
            <span className={LABEL}>File name</span>
            <input
              value={node.config.fileName}
              onChange={(e) => onPatchConfig("fileName", e.target.value)}
              className={FIELD}
            />
          </label>
        ) : null}
      </div>
      <div className="border-t border-[#d3d8de] p-3">
        <button
          type="button"
          onClick={onRemove}
          className="flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700 hover:bg-rose-100"
        >
          <Trash2 className="h-3 w-3" />
          Delete node
        </button>
      </div>
    </div>
  );
}
