"use client";

/**
 * Obscyro Studio — low-code, node-based editor for the clinical semantic layer.
 * Wired to live /v1 APIs when an API key is present (see platform-api.ts).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ApiError, clearSession, clearStoredKey, getStoredKey } from "@/lib/auth";
import { cn } from "@/lib/cn";
import {
  createIngestSource,
  ingestPayload,
  listIngestEvents,
  runPipeline,
  type PipelineResult,
} from "@/lib/platform-api";
import StudioOntologyPanel from "./StudioOntologyPanel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NodeType =
  | "input"
  | "rest"
  | "webhook"
  | "concept"
  | "context"
  | "decision"
  | "terminology"
  | "output"
  | "custom";

type Destination = "research" | "problem_list";

type NodeConfig = {
  sampleText?: string;
  payloadJson?: string;
  sourceId?: string;
  webhookUrl?: string;
  ingestEventId?: string;
  resolveMin?: number;
  marginMin?: number;
  triggers?: string[];
  destination?: Destination;
  acceptThreshold?: number;
  targetSystem?: "icd10" | "icdo" | "ctv3";
};

type FlowNode = {
  id: string;
  type: NodeType;
  title: string;
  x: number;
  y: number;
  config: NodeConfig;
  code: string;
};

type Edge = { id: string; source: string; target: string };

type InspectorMode = "lowcode" | "code";

type DemoResult = PipelineResult;

const NODE_W = 216;
const NODE_H = 96;

const DEMO_RESULTS: DemoResult[] = [
  {
    span: "chest pain",
    code: "29857009",
    display: "Chest pain",
    assertion: "affirmed",
    subject: "patient",
    certainty: "confirmed",
    decision: "accept",
  },
  {
    span: "father had an MI",
    code: "22298006",
    display: "Myocardial infarction",
    assertion: "affirmed",
    subject: "family",
    certainty: "confirmed",
    decision: "flag",
  },
  {
    span: "rule out pulmonary embolism",
    code: "59282003",
    display: "Pulmonary embolism",
    assertion: "uncertain",
    subject: "patient",
    certainty: "differential",
    decision: "escalate",
  },
];

const DEFAULT_TRIGGERS = ["no", "denies", "rule out", "father", "history of"];

// ---------------------------------------------------------------------------
// Code templates (the "Code" half of the low-code / code duality)
// ---------------------------------------------------------------------------

function defaultCode(type: NodeType): string {
  switch (type) {
    case "input":
      return `function run() {\n  return { text: input.text, language: "auto" };\n}`;
    case "rest":
      return `function run(input) {\n  // POST /v1/ingest or paste JSON payload\n  return input.payload;\n}`;
    case "webhook":
      return `function run(input) {\n  // Poll GET /v1/ingest/events?sourceId=...\n  return input.latestEvent;\n}`;
    case "concept":
      return `function run(input) {\n  // NER spans -> embed -> pgvector cosine + margin.\n  return extractConcepts(input.text, {\n    resolveMin: 0.72,\n    marginMin: 0.15,\n  });\n}`;
    case "context":
      return `function run(input) {\n  // Rule-based ConText: assertion, subject, temporality, certainty.\n  return applyContextRules(input, {\n    triggers: ["denies", "rule out", "father"],\n  });\n}`;
    case "decision":
      return `function run(input) {\n  // Route per destination using status + context confidence.\n  if (input.status === "unresolved") return "escalate";\n  if (input.contextConfidence < 0.85) return "flag";\n  return "accept";\n}`;
    case "terminology":
      return `function run(input) {\n  // Cross-map SNOMED -> ICD-10 / ICD-O / CTV3.\n  return translate(input.code, { to: "icd10" });\n}`;
    case "output":
      return `function run(input) {\n  // Emit the enriched, coded result.\n  return enrich(input);\n}`;
    case "custom":
    default:
      return `function run(input) {\n  /* custom rules */\n  return enrich(input);\n}`;
  }
}

function nodeDefaults(type: NodeType): {
  title: string;
  config: NodeConfig;
} {
  switch (type) {
    case "input":
      return {
        title: "Clinical text input",
        config: {
          sampleText:
            "62yo with chest pain. Father had an MI. Rule out pulmonary embolism.",
        },
      };
    case "rest":
      return {
        title: "REST intake",
        config: {
          payloadJson: JSON.stringify(
            { text: "62yo with chest pain. Father had an MI." },
            null,
            2,
          ),
        },
      };
    case "webhook":
      return {
        title: "Webhook intake",
        config: { sourceId: "", webhookUrl: "" },
      };
    case "concept":
      return {
        title: "Concept extraction (cosine + margin)",
        config: { resolveMin: 0.72, marginMin: 0.15 },
      };
    case "context":
      return {
        title: "Context extraction (rules + trigger)",
        config: { triggers: [...DEFAULT_TRIGGERS] },
      };
    case "decision":
      return {
        title: "Decision (per destination)",
        config: { destination: "problem_list", acceptThreshold: 0.85 },
      };
    case "terminology":
      return {
        title: "Terminology lookup",
        config: { targetSystem: "icd10" },
      };
    case "output":
      return { title: "Output: enriched code", config: {} };
    case "custom":
    default:
      return { title: "Custom code node", config: {} };
  }
}

let idCounter = 100;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

// ---------------------------------------------------------------------------
// Default flow
// ---------------------------------------------------------------------------

function buildDefaultNodes(): FlowNode[] {
  const types: NodeType[] = [
    "input",
    "concept",
    "context",
    "decision",
    "output",
  ];
  return types.map((type, i) => {
    const d = nodeDefaults(type);
    return {
      id: `n-${i + 1}`,
      type,
      title: d.title,
      x: 40 + i * 264,
      y: 140,
      config: d.config,
      code: defaultCode(type),
    };
  });
}

const DEFAULT_EDGES: Edge[] = [
  { id: "e1", source: "n-1", target: "n-2" },
  { id: "e2", source: "n-2", target: "n-3" },
  { id: "e3", source: "n-3", target: "n-4" },
  { id: "e4", source: "n-4", target: "n-5" },
];

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

type Geom = {
  a: { x: number; y: number };
  b: { x: number; y: number };
  c1: { x: number; y: number };
  c2: { x: number; y: number };
};

function geom(s: FlowNode, t: FlowNode): Geom {
  const a = { x: s.x + NODE_W, y: s.y + NODE_H / 2 };
  const b = { x: t.x, y: t.y + NODE_H / 2 };
  const dx = Math.max(50, (b.x - a.x) / 2);
  return { a, b, c1: { x: a.x + dx, y: a.y }, c2: { x: b.x - dx, y: b.y } };
}

function pathD(g: Geom): string {
  return `M ${g.a.x},${g.a.y} C ${g.c1.x},${g.c1.y} ${g.c2.x},${g.c2.y} ${g.b.x},${g.b.y}`;
}

function bezierPoint(g: Geom, t: number): { x: number; y: number } {
  const u = 1 - t;
  const x =
    u * u * u * g.a.x +
    3 * u * u * t * g.c1.x +
    3 * u * t * t * g.c2.x +
    t * t * t * g.b.x;
  const y =
    u * u * u * g.a.y +
    3 * u * u * t * g.c1.y +
    3 * u * t * t * g.c2.y +
    t * t * t * g.b.y;
  return { x, y };
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// ---------------------------------------------------------------------------
// Inline SVG icons (monochrome)
// ---------------------------------------------------------------------------

function NodeIcon({ type }: { type: NodeType }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (type) {
    case "input":
      return (
        <svg {...common}>
          <path d="M4 7h16M4 12h10M4 17h7" />
        </svg>
      );
    case "rest":
      return (
        <svg {...common}>
          <path d="M4 6h16v12H4z" />
          <path d="M8 10h8M8 14h5" />
        </svg>
      );
    case "webhook":
      return (
        <svg {...common}>
          <path d="M12 2v6M12 16v6M4.93 4.93l4.24 4.24M14.83 14.83l4.24 4.24M2 12h6M16 12h6" />
        </svg>
      );
    case "concept":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      );
    case "context":
      return (
        <svg {...common}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      );
    case "decision":
      return (
        <svg {...common}>
          <path d="M12 3 21 12 12 21 3 12z" />
        </svg>
      );
    case "terminology":
      return (
        <svg {...common}>
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      );
    case "output":
      return (
        <svg {...common}>
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      );
    case "custom":
    default:
      return (
        <svg {...common}>
          <path d="m8 18-6-6 6-6M16 6l6 6-6 6" />
        </svg>
      );
  }
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-600">
      <span className="text-gray-400">{label}</span>
      <span className="font-medium text-gray-700">{value}</span>
    </span>
  );
}

function DecisionBadge({ decision }: { decision: DemoResult["decision"] }) {
  // Monochrome severity: outline = accept, gray = flag, black = escalate.
  const styles: Record<DemoResult["decision"], string> = {
    accept: "border border-gray-900 bg-white text-gray-900",
    flag: "bg-gray-200 text-gray-800",
    escalate: "bg-gray-900 text-white",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        styles[decision],
      )}
    >
      {decision}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Region A — static architecture stack
// ---------------------------------------------------------------------------

function LayerBlock({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-1 items-center justify-center rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-center text-[11px] font-medium text-gray-600",
        className,
      )}
    >
      {label}
    </div>
  );
}

function ArchitectureStack() {
  return (
    <div className="border-b border-gray-200 bg-white px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gray-400">
          Architecture
        </span>
        <span className="text-[10px] text-gray-400">reference · read-only</span>
      </div>
      <div className="mx-auto flex max-w-3xl flex-col gap-1.5">
        <div className="flex gap-1.5">
          <LayerBlock label="Prebuilt extractors" className="bg-gray-100" />
          <LayerBlock label="Custom rules" className="bg-gray-100" />
        </div>
        <LayerBlock label="Ontology Layer — SNOMED · ICD · context model" />
        <div className="flex gap-1.5">
          <LayerBlock label="Concept Services" />
          <LayerBlock label="Context Services" />
          <LayerBlock label="Decision Services" />
        </div>
        <LayerBlock label="Security & Governance — auditable, runs in your environment" />
        <LayerBlock label="Data Intake — FHIR · HL7 · free text" className="bg-gray-100" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Left palette
// ---------------------------------------------------------------------------

const PALETTE: { type: NodeType; label: string }[] = [
  { type: "input", label: "Input" },
  { type: "rest", label: "REST intake" },
  { type: "webhook", label: "Webhook intake" },
  { type: "concept", label: "Concept" },
  { type: "context", label: "Context" },
  { type: "decision", label: "Decision" },
  { type: "terminology", label: "Terminology lookup" },
  { type: "output", label: "Output" },
  { type: "custom", label: "Custom code node" },
];

function Palette({ onAdd }: { onAdd: (type: NodeType) => void }) {
  return (
    <aside className="w-48 shrink-0 border-r border-gray-200 bg-white p-3">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-gray-400">
        Nodes
      </div>
      <div className="flex flex-col gap-1.5">
        {PALETTE.map((item) => (
          <button
            key={item.type}
            type="button"
            draggable
            onClick={() => onAdd(item.type)}
            onDragStart={(e) => {
              e.dataTransfer.setData("application/x-node-type", item.type);
              e.dataTransfer.effectAllowed = "copy";
            }}
            className="flex cursor-grab items-center gap-2 rounded-md border border-gray-200 bg-white px-2.5 py-2 text-left text-xs text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50 active:cursor-grabbing"
          >
            <span className="text-gray-500">
              <NodeIcon type={item.type} />
            </span>
            {item.label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-gray-400">
        Click or drag a node onto the canvas.
      </p>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function StudioEditor() {
  const router = useRouter();

  const [nodes, setNodes] = useState<FlowNode[]>(() => buildDefaultNodes());
  const [edges] = useState<Edge[]>(DEFAULT_EDGES);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>("lowcode");

  const [running, setRunning] = useState(false);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [token, setToken] = useState<{ x: number; y: number } | null>(null);
  const [results, setResults] = useState<DemoResult[] | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const isLive = Boolean(getStoredKey() && process.env.NEXT_PUBLIC_API_URL);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<
    | {
        kind: "node" | "pan";
        id?: string;
        startX: number;
        startY: number;
        origX: number;
        origY: number;
      }
    | null
  >(null);
  const movedRef = useRef(false);

  const nodeById = useMemo(() => {
    const m = new Map<string, FlowNode>();
    nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [nodes]);

  const selectedNode = selectedId ? nodeById.get(selectedId) ?? null : null;

  // -- Drag / pan -----------------------------------------------------------

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) movedRef.current = true;
      if (d.kind === "pan") {
        setPan({ x: d.origX + dx, y: d.origY + dy });
      } else if (d.kind === "node" && d.id) {
        setNodes((prev) =>
          prev.map((n) =>
            n.id === d.id ? { ...n, x: d.origX + dx, y: d.origY + dy } : n,
          ),
        );
      }
    }
    function onUp() {
      dragRef.current = null;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  function startNodeDrag(e: React.PointerEvent, node: FlowNode) {
    e.stopPropagation();
    movedRef.current = false;
    setSelectedId(node.id);
    dragRef.current = {
      kind: "node",
      id: node.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: node.x,
      origY: node.y,
    };
  }

  function startPan(e: React.PointerEvent) {
    movedRef.current = false;
    setSelectedId(null);
    dragRef.current = {
      kind: "pan",
      startX: e.clientX,
      startY: e.clientY,
      origX: pan.x,
      origY: pan.y,
    };
  }

  // -- Add node (click + drop) ----------------------------------------------

  const addNode = useCallback(
    (type: NodeType, at?: { x: number; y: number }) => {
      const d = nodeDefaults(type);
      const pos = at ?? {
        x: -pan.x + 360 + Math.random() * 40,
        y: -pan.y + 300 + Math.random() * 40,
      };
      const node: FlowNode = {
        id: nextId(type),
        type,
        title: d.title,
        x: pos.x,
        y: pos.y,
        config: d.config,
        code: defaultCode(type),
      };
      setNodes((prev) => [...prev, node]);
      setSelectedId(node.id);
    },
    [pan.x, pan.y],
  );

  function onCanvasDrop(e: React.DragEvent) {
    e.preventDefault();
    const type = e.dataTransfer.getData("application/x-node-type") as NodeType;
    if (!type) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    addNode(type, {
      x: e.clientX - rect.left - pan.x - NODE_W / 2,
      y: e.clientY - rect.top - pan.y - NODE_H / 2,
    });
  }

  // -- Update helpers -------------------------------------------------------

  function updateConfig(id: string, partial: NodeConfig) {
    setNodes((prev) =>
      prev.map((n) =>
        n.id === id ? { ...n, config: { ...n.config, ...partial } } : n,
      ),
    );
  }

  function updateCode(id: string, code: string) {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, code } : n)));
  }

  // -- Run simulation -------------------------------------------------------

  const orderedIds = useMemo(() => {
    const incoming = new Set(edges.map((e) => e.target));
    const start = nodes.find((n) => !incoming.has(n.id)) ?? nodes[0];
    if (!start) return [] as string[];
    const order: string[] = [];
    const visited = new Set<string>();
    let current: string | undefined = start.id;
    while (current && !visited.has(current)) {
      order.push(current);
      visited.add(current);
      const next = edges.find((e) => e.source === current);
      current = next?.target;
    }
    return order;
  }, [edges, nodes]);

  function animateToken(g: Geom, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const startT = performance.now();
      function frame(now: number) {
        const t = Math.min(1, (now - startT) / ms);
        setToken(bezierPoint(g, t));
        if (t < 1) {
          requestAnimationFrame(frame);
        } else {
          resolve();
        }
      }
      requestAnimationFrame(frame);
    });
  }

  async function resolveInputText(): Promise<string> {
    const start = nodes.find((n) => !edges.some((e) => e.target === n.id)) ?? nodes[0];
    if (!start) return "";

    if (start.type === "input") {
      return start.config.sampleText ?? "";
    }
    if (start.type === "rest") {
      try {
        const parsed = JSON.parse(start.config.payloadJson ?? "{}") as Record<string, unknown>;
        if (typeof parsed.text === "string") return parsed.text;
        if (typeof parsed.clinical_text === "string") return parsed.clinical_text;
        return JSON.stringify(parsed);
      } catch {
        return start.config.payloadJson ?? "";
      }
    }
    if (start.type === "webhook" && start.config.sourceId) {
      const { events } = await listIngestEvents(start.config.sourceId);
      const latest = events[0];
      if (!latest) return "";
      const p = latest.payload as Record<string, unknown>;
      if (typeof p.text === "string") return p.text;
      return JSON.stringify(p);
    }
    return start.config.sampleText ?? "";
  }

  async function run() {
    if (running) return;
    setRunning(true);
    setResults(null);
    setRunError(null);
    setSelectedId(null);
    setToken(null);

    const order = orderedIds;
    for (let i = 0; i < order.length; i++) {
      setActiveNodeId(order[i]);
      await sleep(420);
      if (i < order.length - 1) {
        const s = nodeById.get(order[i]);
        const t = nodeById.get(order[i + 1]);
        if (s && t) {
          await animateToken(geom(s, t), 620);
        }
      }
    }
    setToken(null);
    setActiveNodeId(null);

    const decisionNode = nodes.find((n) => n.type === "decision");
    const terminologyNode = nodes.find((n) => n.type === "terminology");
    const destination = decisionNode?.config.destination ?? "problem_list";
    const acceptThreshold = decisionNode?.config.acceptThreshold ?? 0.85;
    const targetSystem = terminologyNode?.config.targetSystem ?? "icd10";

    try {
      if (!getStoredKey()) {
        setResults(DEMO_RESULTS);
        setRunError("No API key — showing demo data. Sign in and create a key.");
        setRunning(false);
        return;
      }
      const text = await resolveInputText();
      if (!text.trim()) {
        setRunError("No input text. Configure the input / REST / webhook node.");
        setRunning(false);
        return;
      }
      const live = await runPipeline({ text, destination, acceptThreshold, targetSystem });
      setResults(
        live.map((r) => ({
          ...r,
          code: r.code ?? "",
        })),
      );
    } catch (err) {
      if (err instanceof ApiError) {
        setRunError(`${err.code}: ${err.message}`);
      } else {
        setRunError((err as Error).message);
      }
      setResults(DEMO_RESULTS);
    }
    setRunning(false);
  }

  function reset() {
    setNodes(buildDefaultNodes());
    setPan({ x: 0, y: 0 });
    setSelectedId(null);
    setResults(null);
    setToken(null);
    setActiveNodeId(null);
  }

  function signOut() {
    clearSession();
    clearStoredKey();
    router.replace("/");
  }

  // -----------------------------------------------------------------------

  return (
    <div className="flex h-screen flex-col bg-white text-gray-900">
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-gray-200 px-4">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-sm font-semibold lowercase tracking-tight">
            obscyro
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gray-400">
            studio
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[10px] text-gray-500 sm:inline-flex">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                isLive ? "bg-emerald-500" : "bg-gray-400",
              )}
            />
            {isLive ? "Live — connected to API" : "Demo — sign in for live API"}
          </span>
          {runError ? (
            <span className="hidden max-w-xs truncate text-[10px] text-rose-600 sm:inline">
              {runError}
            </span>
          ) : null}
          <button
            type="button"
            onClick={reset}
            className="rounded-md border border-gray-200 px-3 py-1.5 text-xs text-gray-600 transition-colors hover:border-gray-400 hover:text-gray-900"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={run}
            disabled={running}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors",
              running
                ? "bg-gray-300 text-gray-500"
                : "bg-gray-900 text-white hover:bg-gray-700",
            )}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden
            >
              <path d="M8 5v14l11-7z" />
            </svg>
            {running ? "Running…" : "Run"}
          </button>
          <button
            type="button"
            onClick={signOut}
            className="rounded-md px-2.5 py-1.5 text-xs text-gray-500 transition-colors hover:text-gray-900"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Region A — architecture stack */}
      <ArchitectureStack />

      {/* Region B — palette · canvas · inspector */}
      <div className="flex min-h-0 flex-1">
        <Palette onAdd={(type) => addNode(type)} />

        {/* Canvas */}
        <div
          ref={canvasRef}
          className="relative min-w-0 flex-1 overflow-hidden bg-white"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(0,0,0,0.06) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
            backgroundPosition: `${pan.x}px ${pan.y}px`,
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onCanvasDrop}
        >
          {/* World layer (translated by pan). Pointerdown on empty space pans. */}
          <div
            className="absolute left-0 top-0 h-[3000px] w-[5000px] cursor-grab active:cursor-grabbing"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
            onPointerDown={startPan}
          >
            {/* Edges */}
            <svg
              className="pointer-events-none absolute left-0 top-0"
              width={5000}
              height={3000}
            >
              {edges.map((e) => {
                const s = nodeById.get(e.source);
                const t = nodeById.get(e.target);
                if (!s || !t) return null;
                const g = geom(s, t);
                const active =
                  running &&
                  activeNodeId !== null &&
                  (activeNodeId === e.source || activeNodeId === e.target);
                return (
                  <path
                    key={e.id}
                    d={pathD(g)}
                    fill="none"
                    stroke={active ? "#111827" : "#9ca3af"}
                    strokeWidth={active ? 2 : 1.5}
                  />
                );
              })}

              {/* Travelling token */}
              {token ? (
                <g>
                  <circle cx={token.x} cy={token.y} r={9} fill="rgba(17,24,39,0.15)" />
                  <circle cx={token.x} cy={token.y} r={5} fill="#111827" />
                </g>
              ) : null}
            </svg>

            {/* Nodes */}
            {nodes.map((node) => {
              const isSelected = node.id === selectedId;
              const isActive = node.id === activeNodeId;
              const showResults =
                node.type === "output" && results && results.length > 0;
              return (
                <div
                  key={node.id}
                  className={cn(
                    "absolute select-none rounded-lg border bg-white shadow-sm transition-shadow",
                    isActive
                      ? "border-gray-900 ring-2 ring-gray-900/20"
                      : isSelected
                        ? "border-gray-700"
                        : "border-gray-300 hover:border-gray-400",
                  )}
                  style={{
                    left: node.x,
                    top: node.y,
                    width: NODE_W,
                    minHeight: NODE_H,
                  }}
                  onPointerDown={(e) => startNodeDrag(e, node)}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!movedRef.current) setSelectedId(node.id);
                  }}
                >
                  {/* Input port */}
                  <span
                    className="absolute -left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border border-gray-400 bg-white"
                    aria-hidden
                  />
                  {/* Output port */}
                  <span
                    className="absolute -right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border border-gray-400 bg-white"
                    aria-hidden
                  />

                  <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
                    <span className="text-gray-500">
                      <NodeIcon type={node.type} />
                    </span>
                    <span className="truncate text-xs font-medium text-gray-800">
                      {node.title}
                    </span>
                  </div>
                  <div className="px-3 py-2 text-[11px] text-gray-500">
                    {showResults ? (
                      <div className="flex flex-col gap-2">
                        {results!.map((r, i) => (
                          <div
                            key={i}
                            className="rounded-md border border-gray-200 bg-gray-50 p-2"
                          >
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <code className="font-mono text-[11px] text-gray-900">
                                {r.code}
                              </code>
                              <DecisionBadge decision={r.decision} />
                            </div>
                            <div className="mb-1 truncate text-[10px] text-gray-500">
                              {r.display}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              <Chip label="assert" value={r.assertion} />
                              <Chip label="subj" value={r.subject} />
                              <Chip label="cert" value={r.certainty} />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="font-mono text-[10px] uppercase tracking-wide text-gray-400">
                        {node.type}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Inspector */}
        {selectedNode ? (
          <Inspector
            key={selectedNode.id}
            node={selectedNode}
            mode={inspectorMode}
            onModeChange={setInspectorMode}
            onClose={() => setSelectedId(null)}
            onConfig={(partial) => updateConfig(selectedNode.id, partial)}
            onCode={(code) => updateCode(selectedNode.id, code)}
            results={results}
          />
        ) : null}
      </div>

      <StudioOntologyPanel results={results} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

function Inspector({
  node,
  mode,
  onModeChange,
  onClose,
  onConfig,
  onCode,
  results,
}: {
  node: FlowNode;
  mode: InspectorMode;
  onModeChange: (m: InspectorMode) => void;
  onClose: () => void;
  onConfig: (partial: NodeConfig) => void;
  onCode: (code: string) => void;
  results: DemoResult[] | null;
}) {
  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-gray-500">
            <NodeIcon type={node.type} />
          </span>
          <span className="text-sm font-medium text-gray-800">{node.title}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Low-code / Code toggle — the core duality */}
      <div className="flex gap-1 border-b border-gray-200 px-4 py-2">
        {(["lowcode", "code"] as InspectorMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onModeChange(m)}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              mode === m
                ? "bg-gray-900 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200",
            )}
          >
            {m === "lowcode" ? "Low-code" : "Code"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {mode === "lowcode" ? (
          <LowCodeForm node={node} onConfig={onConfig} results={results} />
        ) : (
          <div className="flex h-full flex-col">
            <p className="mb-2 text-[11px] text-gray-400">
              Editable pseudo-JS. In a real deployment this compiles to the same
              behavior as the form.
            </p>
            <textarea
              value={node.code}
              onChange={(e) => onCode(e.target.value)}
              spellCheck={false}
              className="h-72 w-full flex-1 resize-none rounded-md border border-gray-200 bg-gray-50 p-3 font-mono text-[12px] leading-relaxed text-gray-800 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
            />
          </div>
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Low-code form (per node type)
// ---------------------------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-4 block">
      <span className="mb-1.5 block text-xs font-medium text-gray-700">
        {label}
      </span>
      {children}
    </label>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={`${label} · ${value.toFixed(2)}`}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-gray-900"
      />
    </Field>
  );
}

function LowCodeForm({
  node,
  onConfig,
  results,
}: {
  node: FlowNode;
  onConfig: (partial: NodeConfig) => void;
  results: DemoResult[] | null;
}) {
  const [newTrigger, setNewTrigger] = useState("");
  const [ingestBusy, setIngestBusy] = useState(false);
  const [ingestMsg, setIngestMsg] = useState<string | null>(null);

  switch (node.type) {
    case "input":
      return (
        <Field label="Sample clinical text">
          <textarea
            value={node.config.sampleText ?? ""}
            onChange={(e) => onConfig({ sampleText: e.target.value })}
            rows={5}
            className="w-full resize-none rounded-md border border-gray-200 bg-gray-50 p-2.5 text-xs text-gray-800 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
          />
        </Field>
      );

    case "rest":
      return (
        <>
          <Field label="JSON payload (include text or clinical_text)">
            <textarea
              value={node.config.payloadJson ?? ""}
              onChange={(e) => onConfig({ payloadJson: e.target.value })}
              rows={8}
              className="w-full resize-none rounded-md border border-gray-200 bg-gray-50 p-2.5 font-mono text-xs text-gray-800 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
            />
          </Field>
          <button
            type="button"
            disabled={ingestBusy}
            onClick={async () => {
              setIngestBusy(true);
              setIngestMsg(null);
              try {
                const payload = JSON.parse(node.config.payloadJson ?? "{}");
                const res = await createIngestSource("REST source", "rest");
                const { eventId } = await ingestPayload(payload, res.source.id);
                onConfig({ sourceId: res.source.id, ingestEventId: eventId });
                setIngestMsg(`Ingested event ${eventId}`);
              } catch (err) {
                setIngestMsg((err as Error).message);
              } finally {
                setIngestBusy(false);
              }
            }}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-xs hover:bg-gray-50"
          >
            POST to /v1/ingest
          </button>
          {ingestMsg ? <p className="mt-2 text-[10px] text-gray-500">{ingestMsg}</p> : null}
        </>
      );

    case "webhook":
      return (
        <>
          <Field label="Webhook URL">
            <input
              readOnly
              value={node.config.webhookUrl ?? "Create a webhook source below"}
              className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 font-mono text-[10px] text-gray-700"
            />
          </Field>
          <button
            type="button"
            disabled={ingestBusy}
            onClick={async () => {
              setIngestBusy(true);
              try {
                const res = await createIngestSource("Webhook source", "webhook");
                onConfig({
                  sourceId: res.source.id,
                  webhookUrl: res.source.webhookUrl ?? "",
                });
                setIngestMsg("Webhook URL ready — POST payloads to this URL.");
              } catch (err) {
                setIngestMsg((err as Error).message);
              } finally {
                setIngestBusy(false);
              }
            }}
            className="w-full rounded-md bg-gray-900 px-3 py-2 text-xs text-white hover:bg-gray-700"
          >
            Create webhook source
          </button>
          <button
            type="button"
            className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-xs"
            onClick={async () => {
              if (!node.config.sourceId) return;
              const { events } = await listIngestEvents(node.config.sourceId);
              if (events[0]) {
                onConfig({ ingestEventId: events[0].id });
                setIngestMsg(`Latest event: ${events[0].id}`);
              } else {
                setIngestMsg("No events yet.");
              }
            }}
          >
            Poll latest event
          </button>
          {ingestMsg ? <p className="mt-2 text-[10px] text-gray-500">{ingestMsg}</p> : null}
        </>
      );

    case "concept":
      return (
        <>
          <Slider
            label="Resolve min (cosine)"
            value={node.config.resolveMin ?? 0.72}
            min={0.5}
            max={0.95}
            step={0.01}
            onChange={(v) => onConfig({ resolveMin: v })}
          />
          <Slider
            label="Margin min"
            value={node.config.marginMin ?? 0.15}
            min={0}
            max={0.4}
            step={0.01}
            onChange={(v) => onConfig({ marginMin: v })}
          />
          <p className="text-[11px] leading-relaxed text-gray-400">
            Spans above the cosine threshold with sufficient margin resolve to a
            single SNOMED code; otherwise they flag for review.
          </p>
        </>
      );

    case "context": {
      const triggers = node.config.triggers ?? [];
      return (
        <Field label="Trigger words">
          <div className="mb-2 flex gap-1.5">
            <input
              value={newTrigger}
              onChange={(e) => setNewTrigger(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTrigger.trim()) {
                  e.preventDefault();
                  onConfig({ triggers: [...triggers, newTrigger.trim()] });
                  setNewTrigger("");
                }
              }}
              placeholder="Add trigger…"
              className="min-w-0 flex-1 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-800 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
            />
            <button
              type="button"
              onClick={() => {
                if (newTrigger.trim()) {
                  onConfig({ triggers: [...triggers, newTrigger.trim()] });
                  setNewTrigger("");
                }
              }}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
            >
              Add
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {triggers.map((trig, i) => (
              <span
                key={`${trig}-${i}`}
                className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] text-gray-700"
              >
                {trig}
                <button
                  type="button"
                  onClick={() =>
                    onConfig({
                      triggers: triggers.filter((_, idx) => idx !== i),
                    })
                  }
                  aria-label={`Remove ${trig}`}
                  className="text-gray-400 hover:text-gray-900"
                >
                  ×
                </button>
              </span>
            ))}
            {triggers.length === 0 ? (
              <span className="text-[11px] text-gray-400">No triggers yet.</span>
            ) : null}
          </div>
        </Field>
      );
    }

    case "decision":
      return (
        <>
          <Field label="Destination">
            <select
              value={node.config.destination ?? "problem_list"}
              onChange={(e) =>
                onConfig({ destination: e.target.value as Destination })
              }
              className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
            >
              <option value="research">research</option>
              <option value="problem_list">problem_list</option>
            </select>
          </Field>
          <Slider
            label="Accept threshold (context confidence)"
            value={node.config.acceptThreshold ?? 0.85}
            min={0.5}
            max={0.99}
            step={0.01}
            onChange={(v) => onConfig({ acceptThreshold: v })}
          />
          <p className="text-[11px] leading-relaxed text-gray-400">
            Below the threshold a concept is flagged; unresolved or uncertain
            assertions escalate.
          </p>
        </>
      );

    case "terminology":
      return (
        <Field label="Target terminology">
          <select
            value={node.config.targetSystem ?? "icd10"}
            onChange={(e) =>
              onConfig({
                targetSystem: e.target.value as NodeConfig["targetSystem"],
              })
            }
            className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
          >
            <option value="icd10">ICD-10</option>
            <option value="icdo">ICD-O</option>
            <option value="ctv3">CTV3</option>
          </select>
        </Field>
      );

    case "output":
      return (
        <div>
          <span className="mb-2 block text-xs font-medium text-gray-700">
            Enriched result
          </span>
          {results && results.length > 0 ? (
            <div className="flex flex-col gap-2">
              {results.map((r, i) => (
                <div
                  key={i}
                  className="rounded-md border border-gray-200 bg-gray-50 p-2.5"
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <code className="font-mono text-xs text-gray-900">
                      {r.code}
                    </code>
                    <DecisionBadge decision={r.decision} />
                  </div>
                  <div className="mb-1.5 text-[11px] text-gray-500">
                    {r.display} · &ldquo;{r.span}&rdquo;
                  </div>
                  {r.translation ? (
                    <div className="mb-1.5 font-mono text-[10px] text-gray-600">
                      → {r.translation}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-1">
                    <Chip label="assert" value={r.assertion} />
                    <Chip label="subj" value={r.subject} />
                    <Chip label="cert" value={r.certainty} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-gray-400">
              Press Run to populate the enriched output.
            </p>
          )}
        </div>
      );

    case "custom":
    default:
      return (
        <p className="text-[11px] leading-relaxed text-gray-400">
          This node has no form fields. Switch to the Code tab to define its
          behavior.
        </p>
      );
  }
}
