"use client";

/**
 * Obscyro Studio — low-code, node-based editor for the clinical semantic layer.
 * Wired to live /v1 APIs when an API key is present (see platform-api.ts).
 *
 * Nodes are connectable (drag output -> input). The graph executes with
 * branching and merging: a node can fan out to several nodes, several nodes
 * can merge into one, and any single node can be run/tested in isolation.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Play } from "lucide-react";

import { ApiError, clearSession, clearStoredKey, getStoredKey } from "@/lib/auth";
import { cn } from "@/lib/cn";
import {
  createIngestSource,
  decide,
  extractAndPersist,
  extractConcepts,
  extractContexts,
  getHealth,
  ingestPayload,
  listEnvironments,
  listIngestEvents,
  runSourceFetch,
  translateCode,
  type ConceptOut,
  type ContextOut,
  type EnvironmentSummary,
  type HealthStatus,
  type PipelineResult,
} from "@/lib/platform-api";
import {
  ACCENT_HEX,
  EDGE_HEX,
  NODE_H,
  NODE_W,
  bezierPoint,
  geom,
  pathD,
  pointGeom,
  type Geom,
} from "./studio-graph";
import {
  defaultSourceRequest,
  harvestText,
  type SourceRequest,
} from "./source-schema";
import SourceNodeForm from "./SourceNodeForm";
import StudioOntologyMode from "./StudioOntologyMode";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NodeType =
  | "input"
  | "rest"
  | "source"
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
  lastEventPayload?: unknown;
  lastEventText?: string;
  resolveMin?: number;
  marginMin?: number;
  triggers?: string[];
  destination?: Destination;
  acceptThreshold?: number;
  targetSystem?: "icd10" | "icdo" | "ctv3";
  sourceRequest?: SourceRequest;
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

/** The data bag that flows between nodes along edges. */
type NodeOutput = {
  text?: string;
  concepts?: ConceptOut[];
  contexts?: ContextOut[];
  results?: PipelineResult[];
  payload?: unknown;
};

// Subtle, role-based accents. Bodies stay white; only the icon, a thin left
// bar, and the port border pick up color, so the canvas stays minimalist.
const NODE_ACCENTS: Record<
  NodeType,
  { text: string; bar: string; border: string; hex: string }
> = {
  input: { text: "text-sky-600", bar: "bg-sky-400", border: "border-sky-400", hex: "#0284c7" },
  rest: { text: "text-sky-600", bar: "bg-sky-400", border: "border-sky-400", hex: "#0284c7" },
  source: { text: "text-sky-600", bar: "bg-sky-400", border: "border-sky-400", hex: "#0284c7" },
  webhook: { text: "text-sky-600", bar: "bg-sky-400", border: "border-sky-400", hex: "#0284c7" },
  concept: { text: "text-violet-600", bar: "bg-violet-400", border: "border-violet-400", hex: "#7c3aed" },
  context: { text: "text-violet-600", bar: "bg-violet-400", border: "border-violet-400", hex: "#7c3aed" },
  decision: { text: "text-amber-600", bar: "bg-amber-400", border: "border-amber-400", hex: "#d97706" },
  terminology: { text: "text-teal-600", bar: "bg-teal-400", border: "border-teal-400", hex: "#0d9488" },
  output: { text: "text-emerald-600", bar: "bg-emerald-400", border: "border-emerald-400", hex: "#059669" },
  custom: { text: "text-slate-500", bar: "bg-slate-400", border: "border-slate-400", hex: "#64748b" },
};

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
    case "source":
      return `function run() {\n  // Server-side HTTP request (POST /v1/source/fetch).\n  // Configure method, URL, auth, query, body, pagination in the panel.\n  const res = fetchSource(this.config.sourceRequest);\n  return { text: harvest(res.body), payload: res.body };\n}`;
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
    case "source":
      return {
        title: "Source (HTTP request)",
        config: { sourceRequest: defaultSourceRequest() },
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
      y: 160,
      config: d.config,
      code: defaultCode(type),
    };
  });
}

function buildDefaultEdges(): Edge[] {
  return [
    { id: "e1", source: "n-1", target: "n-2" },
    { id: "e2", source: "n-2", target: "n-3" },
    { id: "e3", source: "n-3", target: "n-4" },
    { id: "e4", source: "n-4", target: "n-5" },
  ];
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// ---------------------------------------------------------------------------
// Graph helpers (topology, cycles, merge)
// ---------------------------------------------------------------------------

function topoOrder(ns: FlowNode[], es: Edge[]): string[] {
  const ids = ns.map((n) => n.id);
  const idset = new Set(ids);
  const indeg = new Map<string, number>(ids.map((i) => [i, 0]));
  const adj = new Map<string, string[]>(ids.map((i) => [i, []]));
  for (const e of es) {
    if (!idset.has(e.source) || !idset.has(e.target)) continue;
    adj.get(e.source)!.push(e.target);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }
  const queue = ids.filter((i) => (indeg.get(i) ?? 0) === 0);
  const order: string[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    order.push(n);
    for (const m of adj.get(n) ?? []) {
      indeg.set(m, (indeg.get(m) ?? 0) - 1);
      if ((indeg.get(m) ?? 0) === 0) queue.push(m);
    }
  }
  // Append any nodes left out by a cycle so they still run (in node order).
  for (const i of ids) if (!order.includes(i)) order.push(i);
  return order;
}

/** Would adding source -> target create a cycle? (target already reaches source) */
function wouldCycle(es: Edge[], source: string, target: string): boolean {
  const adj = new Map<string, string[]>();
  for (const e of es) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }
  const stack = [target];
  const seen = new Set<string>();
  while (stack.length) {
    const n = stack.pop()!;
    if (n === source) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const m of adj.get(n) ?? []) stack.push(m);
  }
  return false;
}

function mergeOutputs(outputs: NodeOutput[]): NodeOutput {
  const merged: NodeOutput = {};
  for (const o of outputs) {
    if (o.text && !merged.text) merged.text = o.text;
    if (o.concepts?.length)
      merged.concepts = [...(merged.concepts ?? []), ...o.concepts];
    if (o.contexts?.length)
      merged.contexts = [...(merged.contexts ?? []), ...o.contexts];
    if (o.results?.length)
      merged.results = [...(merged.results ?? []), ...o.results];
    if (o.payload != null && merged.payload == null) merged.payload = o.payload;
  }
  return merged;
}

function resultsFromConcepts(concepts: ConceptOut[]): PipelineResult[] {
  return concepts.map((c) => ({
    span: c.span,
    code: c.code,
    display: c.candidates[0]?.display ?? c.span,
    assertion: "affirmed",
    subject: "patient",
    certainty: "confirmed",
    decision: "flag" as const,
  }));
}

/** Per-node transform. Throws on missing upstream data; caller catches. */
async function executeNode(
  node: FlowNode,
  input: NodeOutput,
): Promise<NodeOutput> {
  switch (node.type) {
    case "input":
      return { text: node.config.sampleText ?? "" };

    case "rest": {
      try {
        const parsed = JSON.parse(node.config.payloadJson ?? "{}") as Record<
          string,
          unknown
        >;
        const text =
          typeof parsed.text === "string"
            ? parsed.text
            : typeof parsed.clinical_text === "string"
              ? parsed.clinical_text
              : JSON.stringify(parsed);
        return { text, payload: parsed };
      } catch {
        return {
          text: node.config.payloadJson ?? "",
          payload: node.config.payloadJson,
        };
      }
    }

    case "source": {
      const request = node.config.sourceRequest ?? defaultSourceRequest();
      if (!request.url.trim()) {
        throw new Error("Configure a URL on the Source node first.");
      }
      const res = await runSourceFetch(request);
      return { text: res.text || harvestText(res.body, request.response.format), payload: res.body };
    }

    case "webhook": {
      if (node.config.lastEventText) {
        return {
          text: node.config.lastEventText,
          payload: node.config.lastEventPayload,
        };
      }
      if (node.config.sourceId) {
        const { events } = await listIngestEvents(node.config.sourceId);
        const latest = events[0];
        if (latest) {
          const p = latest.payload as Record<string, unknown>;
          const text =
            typeof p.text === "string" ? p.text : JSON.stringify(p);
          return { text, payload: p };
        }
      }
      throw new Error("No webhook events received yet.");
    }

    case "concept": {
      const text = input.text ?? "";
      if (!text.trim()) throw new Error("No input text reached this node.");
      const { concepts } = await extractConcepts(text, "auto");
      return { text, concepts };
    }

    case "context": {
      const text = input.text ?? "";
      const concepts = input.concepts ?? [];
      if (!concepts.length) throw new Error("No concepts reached this node.");
      const { contexts } = await extractContexts(
        text,
        concepts.map((c) => ({ span: c.span, code: c.code })),
        "auto",
      );
      return { text, concepts, contexts };
    }

    case "decision": {
      const concepts = input.concepts ?? [];
      const contexts = input.contexts ?? [];
      if (!concepts.length) throw new Error("No concepts reached this node.");
      const destination = node.config.destination ?? "problem_list";
      const threshold = node.config.acceptThreshold ?? 0.85;
      const ctxBySpan = new Map(contexts.map((c) => [c.span, c]));
      const results: PipelineResult[] = concepts.map((concept) => {
        const ctx = ctxBySpan.get(concept.span);
        const assertion = ctx?.context.assertion?.value ?? "affirmed";
        const subject = ctx?.context.subject?.value ?? "patient";
        const certainty = ctx?.context.certainty?.value ?? "confirmed";
        const contextConfidence = ctx?.context_confidence ?? 0;
        const display = concept.candidates[0]?.display ?? concept.span;
        const decision = decide(
          concept.status,
          destination,
          contextConfidence,
          assertion,
          certainty,
          threshold,
        );
        return {
          span: concept.span,
          code: concept.code,
          display,
          assertion,
          subject,
          certainty,
          decision,
          readable_note: ctx?.readable_note,
        };
      });
      return { concepts, contexts, results };
    }

    case "terminology": {
      const target = node.config.targetSystem ?? "icd10";
      const base =
        input.results ?? resultsFromConcepts(input.concepts ?? []);
      if (!base.length) throw new Error("No coded results reached this node.");
      const out: PipelineResult[] = [];
      for (const r of base) {
        let translation: string | null = null;
        if (r.code) {
          try {
            const mapped = await translateCode(r.code, target);
            translation =
              (mapped.translations[0] as { target?: string } | undefined)
                ?.target ?? null;
          } catch {
            translation = null;
          }
        }
        out.push({ ...r, translation });
      }
      return { ...input, results: out };
    }

    case "output":
      return { ...input };

    case "custom":
    default:
      return { ...input };
  }
}

// ---------------------------------------------------------------------------
// Inline SVG icons (monochrome glyphs; color comes from the parent class)
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
    case "source":
      return (
        <svg {...common}>
          <path d="M12 13v8M8 17l4 4 4-4" />
          <path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25" />
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
  // Restrained severity color: accept = emerald, flag = amber, escalate = rose.
  const styles: Record<DemoResult["decision"], string> = {
    accept: "border border-emerald-300 bg-emerald-50 text-emerald-700",
    flag: "border border-amber-300 bg-amber-50 text-amber-700",
    escalate: "border border-rose-300 bg-rose-50 text-rose-700",
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
// Left palette
// ---------------------------------------------------------------------------

const PALETTE: { type: NodeType; label: string }[] = [
  { type: "input", label: "Input" },
  { type: "source", label: "Source" },
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
            <span className={NODE_ACCENTS[item.type].text}>
              <NodeIcon type={item.type} />
            </span>
            {item.label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-gray-400">
        Click or drag a node onto the canvas. Drag from a node&apos;s right dot
        to another node&apos;s left dot to connect them.
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
  const [edges, setEdges] = useState<Edge[]>(() => buildDefaultEdges());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>("lowcode");

  const [running, setRunning] = useState(false);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [token, setToken] = useState<{ x: number; y: number } | null>(null);
  const [results, setResults] = useState<DemoResult[] | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [nodeOutputs, setNodeOutputs] = useState<Map<string, NodeOutput>>(
    new Map(),
  );
  const [nodeErrors, setNodeErrors] = useState<Map<string, string>>(new Map());
  const [pendingEdge, setPendingEdge] = useState<{
    source: string;
    cursor: { x: number; y: number };
  } | null>(null);

  const [mode, setMode] = useState<"pipeline" | "ontology">("pipeline");
  const [health, setHealth] = useState<HealthStatus | "checking">("checking");
  const [environments, setEnvironments] = useState<EnvironmentSummary[]>([]);
  const [selectedEnv, setSelectedEnv] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [savingToOntology, setSavingToOntology] = useState(false);

  // Real readiness probe (never hardcoded): poll /v1/health.
  useEffect(() => {
    let cancelled = false;
    async function probe() {
      const status = await getHealth();
      if (!cancelled) setHealth(status);
    }
    void probe();
    const handle = setInterval(probe, 15000);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, []);

  // Load owner-scoped environments when a key is present.
  const refreshEnvironments = useCallback(async () => {
    if (!getStoredKey()) {
      setEnvironments([]);
      return;
    }
    try {
      const { environments: envs } = await listEnvironments();
      setEnvironments(envs);
      setSelectedEnv((cur) => cur ?? envs[0]?.slug ?? null);
    } catch {
      setEnvironments([]);
    }
  }, []);

  useEffect(() => {
    void refreshEnvironments();
  }, [refreshEnvironments]);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef(pan);
  panRef.current = pan;
  const connectingRef = useRef<{ source: string } | null>(null);
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

  // -- Drag / pan / connect -------------------------------------------------

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (connectingRef.current) {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect) {
          const x = e.clientX - rect.left - panRef.current.x;
          const y = e.clientY - rect.top - panRef.current.y;
          setPendingEdge((pe) => (pe ? { ...pe, cursor: { x, y } } : pe));
        }
        return;
      }
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
      if (connectingRef.current) {
        connectingRef.current = null;
        setPendingEdge(null);
      }
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
    setSelectedEdgeId(null);
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
    setSelectedEdgeId(null);
    dragRef.current = {
      kind: "pan",
      startX: e.clientX,
      startY: e.clientY,
      origX: pan.x,
      origY: pan.y,
    };
  }

  function startConnect(e: React.PointerEvent, node: FlowNode) {
    e.stopPropagation();
    connectingRef.current = { source: node.id };
    setPendingEdge({
      source: node.id,
      cursor: { x: node.x + NODE_W, y: node.y + NODE_H / 2 },
    });
  }

  function endConnect(e: React.PointerEvent, node: FlowNode) {
    const c = connectingRef.current;
    if (!c) return;
    e.stopPropagation();
    const source = c.source;
    const target = node.id;
    if (source !== target) {
      setEdges((prev) => {
        if (prev.some((ed) => ed.source === source && ed.target === target))
          return prev;
        if (wouldCycle(prev, source, target)) return prev;
        return [...prev, { id: nextId("e"), source, target }];
      });
    }
    connectingRef.current = null;
    setPendingEdge(null);
  }

  function deleteEdge(id: string) {
    setEdges((prev) => prev.filter((e) => e.id !== id));
    setSelectedEdgeId((cur) => (cur === id ? null : cur));
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
      setSelectedEdgeId(null);
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

  // -- Execution ------------------------------------------------------------

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

  function deriveResults(
    order: string[],
    outputs: Map<string, NodeOutput>,
  ): DemoResult[] | null {
    const outputNodes = nodes.filter((n) => n.type === "output");
    const collected: PipelineResult[] = [];
    for (const o of outputNodes) {
      const out = outputs.get(o.id);
      if (out?.results?.length) collected.push(...out.results);
    }
    if (collected.length) {
      return collected.map((r) => ({ ...r, code: r.code ?? "" }));
    }
    // Fallback: last node in topo order that produced results.
    for (const id of [...order].reverse()) {
      const out = outputs.get(id);
      if (out?.results?.length) {
        return out.results.map((r) => ({ ...r, code: r.code ?? "" }));
      }
    }
    return null;
  }

  async function runGraph() {
    if (running) return;
    setSelectedEdgeId(null);
    if (!getStoredKey()) {
      setResults(DEMO_RESULTS);
      setRunError("No API key — showing demo data. Sign in and create a key.");
      return;
    }
    setRunning(true);
    setRunError(null);
    setResults(null);
    setSelectedId(null);
    setToken(null);

    const order = topoOrder(nodes, edges);
    const outputs = new Map<string, NodeOutput>();
    const errors = new Map<string, string>();

    for (const id of order) {
      const node = nodeById.get(id);
      if (!node) continue;
      setActiveNodeId(id);
      const incoming = edges.filter((e) => e.target === id);
      const merged = mergeOutputs(
        incoming.map((e) => outputs.get(e.source) ?? {}),
      );
      try {
        outputs.set(id, await executeNode(node, merged));
      } catch (err) {
        errors.set(
          id,
          err instanceof ApiError
            ? `${err.code}: ${err.message}`
            : (err as Error).message,
        );
        outputs.set(id, {});
      }
      await sleep(160);
      for (const e of edges.filter((e) => e.source === id)) {
        const s = nodeById.get(e.source);
        const t = nodeById.get(e.target);
        if (s && t) await animateToken(geom(s, t), 420);
      }
    }

    setActiveNodeId(null);
    setToken(null);
    setNodeOutputs(outputs);
    setNodeErrors(errors);
    setResults(deriveResults(order, outputs));
    if (errors.size) setRunError(errors.values().next().value ?? null);
    setRunning(false);
  }

  async function runNode(id: string) {
    if (running) return;
    setSelectedEdgeId(null);
    if (!getStoredKey()) {
      setRunError("No API key. Sign in and create a key.");
      return;
    }
    setRunning(true);
    setRunError(null);

    // Minimal upstream closure that feeds this node.
    const needed = new Set<string>();
    const visit = (n: string) => {
      if (needed.has(n)) return;
      needed.add(n);
      for (const e of edges.filter((e) => e.target === n)) visit(e.source);
    };
    visit(id);

    const order = topoOrder(
      nodes.filter((n) => needed.has(n.id)),
      edges.filter((e) => needed.has(e.source) && needed.has(e.target)),
    );

    const outputs = new Map(nodeOutputs);
    const errors = new Map(nodeErrors);

    for (const nid of order) {
      const node = nodeById.get(nid);
      if (!node) continue;
      setActiveNodeId(nid);
      const incoming = edges.filter(
        (e) => e.target === nid && needed.has(e.source),
      );
      const merged = mergeOutputs(
        incoming.map((e) => outputs.get(e.source) ?? {}),
      );
      try {
        outputs.set(nid, await executeNode(node, merged));
        errors.delete(nid);
      } catch (err) {
        errors.set(
          nid,
          err instanceof ApiError
            ? `${err.code}: ${err.message}`
            : (err as Error).message,
        );
        outputs.set(nid, {});
      }
      await sleep(140);
    }

    setActiveNodeId(null);
    setNodeOutputs(outputs);
    setNodeErrors(errors);

    const out = outputs.get(id);
    if (out?.results?.length) {
      setResults(out.results.map((r) => ({ ...r, code: r.code ?? "" })));
    }
    const err = errors.get(id);
    setRunError(err ?? null);
    setRunning(false);
  }

  /** Re-run the full pipeline server-side and persist findings into the env. */
  async function saveOutputToOntology() {
    if (savingToOntology) return;
    setSaveMsg(null);
    if (!getStoredKey()) {
      setSaveMsg("Sign in and create a key to save to an ontology.");
      return;
    }
    if (!selectedEnv) {
      setSaveMsg("Select an environment in the top bar first.");
      return;
    }
    // Prefer text that actually flowed through the graph; fall back to the
    // input/REST node config so the button works before a run.
    const flowed = Array.from(nodeOutputs.values()).find((o) => o.text)?.text;
    const fromInput =
      nodes.find((n) => n.type === "input")?.config.sampleText ??
      nodes.find((n) => n.type === "rest")?.config.payloadJson;
    const text = (flowed ?? fromInput ?? "").trim();
    if (text.length < 2) {
      setSaveMsg("No input text to extract. Add an Input node with text.");
      return;
    }
    setSavingToOntology(true);
    try {
      const res = await extractAndPersist({
        text,
        destination: "problem_list",
        persist: { environment: selectedEnv },
      });
      const n = res.persisted?.objectIds.length ?? 0;
      const links = res.persisted?.linkIds.length ?? 0;
      setSaveMsg(
        `Saved ${n} finding${n === 1 ? "" : "s"}${links ? ` + ${links} link${links === 1 ? "" : "s"}` : ""} to ${selectedEnv}.`,
      );
    } catch (err) {
      setSaveMsg(
        err instanceof ApiError ? `${err.code}: ${err.message}` : (err as Error).message,
      );
    } finally {
      setSavingToOntology(false);
    }
  }

  function reset() {
    setNodes(buildDefaultNodes());
    setEdges(buildDefaultEdges());
    setPan({ x: 0, y: 0 });
    setSelectedId(null);
    setSelectedEdgeId(null);
    setResults(null);
    setToken(null);
    setActiveNodeId(null);
    setNodeOutputs(new Map());
    setNodeErrors(new Map());
    setRunError(null);
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

        {/* Mode toggle + environment switcher */}
        <div className="flex items-center gap-3">
          <div className="flex rounded-md border border-gray-200 p-0.5">
            {(["pipeline", "ontology"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "rounded px-3 py-1 text-xs font-medium capitalize transition-colors",
                  mode === m
                    ? "bg-gray-900 text-white"
                    : "text-gray-500 hover:text-gray-900",
                )}
              >
                {m}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5">
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-gray-400">
              env
            </span>
            <select
              value={selectedEnv ?? ""}
              onChange={(e) => setSelectedEnv(e.target.value || null)}
              disabled={environments.length === 0}
              className="max-w-[160px] rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 focus:border-gray-400 focus:outline-none disabled:text-gray-400"
            >
              {environments.length === 0 ? (
                <option value="">no environments</option>
              ) : (
                environments.map((env) => (
                  <option key={env.id} value={env.slug}>
                    {env.name}
                  </option>
                ))
              )}
            </select>
          </label>
        </div>

        <div className="flex items-center gap-3">
          <HealthPill health={health} />
          {runError ? (
            <span className="hidden max-w-xs truncate text-[10px] text-rose-600 sm:inline">
              {runError}
            </span>
          ) : null}
          {mode === "pipeline" ? (
            <>
              <button
                type="button"
                onClick={reset}
                className="rounded-md border border-gray-200 px-3 py-1.5 text-xs text-gray-600 transition-colors hover:border-gray-400 hover:text-gray-900"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={runGraph}
                disabled={running}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors",
                  running
                    ? "bg-indigo-300 text-white"
                    : "bg-indigo-600 text-white hover:bg-indigo-500",
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
            </>
          ) : null}
          <button
            type="button"
            onClick={signOut}
            className="rounded-md px-2.5 py-1.5 text-xs text-gray-500 transition-colors hover:text-gray-900"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Region B — palette · canvas · inspector (pipeline) or ontology mode */}
      <div className="flex min-h-0 flex-1">
        {mode === "ontology" ? (
          <StudioOntologyMode
            env={selectedEnv}
            hasKey={Boolean(getStoredKey())}
            onEnvironmentsChanged={refreshEnvironments}
          />
        ) : (
          <>
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
                const selected = e.id === selectedEdgeId;
                const mid = bezierPoint(g, 0.5);
                return (
                  <g key={e.id}>
                    <path
                      d={pathD(g)}
                      fill="none"
                      stroke={
                        active ? ACCENT_HEX : selected ? "#475569" : EDGE_HEX
                      }
                      strokeWidth={active || selected ? 2.5 : 1.5}
                    />
                    {/* Wide invisible hit area for selecting / deleting. */}
                    <path
                      d={pathD(g)}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={14}
                      style={{ pointerEvents: "stroke", cursor: "pointer" }}
                      onPointerDown={(ev) => {
                        ev.stopPropagation();
                        setSelectedEdgeId(e.id);
                        setSelectedId(null);
                      }}
                    />
                    {selected ? (
                      <g
                        style={{ pointerEvents: "all", cursor: "pointer" }}
                        onPointerDown={(ev) => {
                          ev.stopPropagation();
                          deleteEdge(e.id);
                        }}
                      >
                        <circle
                          cx={mid.x}
                          cy={mid.y}
                          r={9}
                          fill="#fff"
                          stroke="#475569"
                          strokeWidth={1.5}
                        />
                        <path
                          d={`M ${mid.x - 3.5},${mid.y - 3.5} L ${mid.x + 3.5},${mid.y + 3.5} M ${mid.x + 3.5},${mid.y - 3.5} L ${mid.x - 3.5},${mid.y + 3.5}`}
                          stroke="#475569"
                          strokeWidth={1.5}
                          strokeLinecap="round"
                        />
                      </g>
                    ) : null}
                  </g>
                );
              })}

              {/* Pending (in-progress) connection ghost */}
              {pendingEdge
                ? (() => {
                    const s = nodeById.get(pendingEdge.source);
                    if (!s) return null;
                    const g = pointGeom(
                      { x: s.x + NODE_W, y: s.y + NODE_H / 2 },
                      pendingEdge.cursor,
                    );
                    return (
                      <path
                        d={pathD(g)}
                        fill="none"
                        stroke={ACCENT_HEX}
                        strokeWidth={2}
                        strokeDasharray="5 4"
                      />
                    );
                  })()
                : null}

              {/* Travelling token */}
              {token ? (
                <g>
                  <circle
                    cx={token.x}
                    cy={token.y}
                    r={9}
                    fill="rgba(79,70,229,0.18)"
                  />
                  <circle cx={token.x} cy={token.y} r={5} fill={ACCENT_HEX} />
                </g>
              ) : null}
            </svg>

            {/* Nodes */}
            {nodes.map((node) => {
              const isSelected = node.id === selectedId;
              const isActive = node.id === activeNodeId;
              const hasError = nodeErrors.has(node.id);
              const accent = NODE_ACCENTS[node.type];
              const showResults =
                node.type === "output" && results && results.length > 0;
              const webhookPayload =
                node.type === "webhook" && node.config.lastEventPayload != null;
              return (
                <div
                  key={node.id}
                  className={cn(
                    "absolute select-none overflow-hidden rounded-lg border bg-white shadow-sm transition-shadow",
                    isActive
                      ? "border-indigo-500 ring-2 ring-indigo-500/20"
                      : hasError
                        ? "border-rose-400 ring-2 ring-rose-400/20"
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
                    if (!movedRef.current) {
                      setSelectedId(node.id);
                      setSelectedEdgeId(null);
                    }
                  }}
                >
                  {/* Accent bar */}
                  <span
                    className={cn(
                      "absolute left-0 top-0 h-full w-1",
                      accent.bar,
                    )}
                    aria-hidden
                  />

                  {/* Input port (drop target) */}
                  <span
                    onPointerUp={(e) => endConnect(e, node)}
                    title="Input"
                    className={cn(
                      "absolute -left-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 bg-white transition-transform hover:scale-125",
                      accent.border,
                    )}
                  />
                  {/* Output port (drag to connect) */}
                  <span
                    onPointerDown={(e) => startConnect(e, node)}
                    title="Drag to connect"
                    className={cn(
                      "absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 cursor-crosshair rounded-full border-2 bg-white transition-transform hover:scale-125",
                      accent.border,
                    )}
                  />

                  <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 pl-4">
                    <span className={accent.text}>
                      <NodeIcon type={node.type} />
                    </span>
                    <span className="truncate text-xs font-medium text-gray-800">
                      {node.title}
                    </span>
                  </div>
                  <div className="px-3 py-2 pl-4 text-[11px] text-gray-500">
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
                    ) : webhookPayload ? (
                      <div>
                        <span className="mb-1 block font-mono text-[9px] uppercase tracking-wide text-sky-600">
                          Received
                        </span>
                        <pre className="max-h-24 overflow-auto rounded border border-gray-200 bg-gray-50 p-1.5 font-mono text-[9px] leading-snug text-gray-700">
                          {JSON.stringify(node.config.lastEventPayload, null, 2)}
                        </pre>
                      </div>
                    ) : hasError ? (
                      <span className="text-[10px] text-rose-600">
                        {nodeErrors.get(node.id)}
                      </span>
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
                running={running}
                output={nodeOutputs.get(selectedNode.id) ?? null}
                error={nodeErrors.get(selectedNode.id) ?? null}
                onModeChange={setInspectorMode}
                onClose={() => setSelectedId(null)}
                onConfig={(partial) => updateConfig(selectedNode.id, partial)}
                onCode={(code) => updateCode(selectedNode.id, code)}
                onRunNode={() => runNode(selectedNode.id)}
                results={results}
                ontologyEnv={selectedEnv}
                onSaveToOntology={saveOutputToOntology}
                savingToOntology={savingToOntology}
                saveMessage={saveMsg}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function HealthPill({ health }: { health: HealthStatus | "checking" }) {
  const map: Record<
    HealthStatus | "checking",
    { dot: string; label: string }
  > = {
    checking: { dot: "bg-gray-300", label: "Checking API…" },
    ok: { dot: "bg-emerald-500", label: "Live — connected to API" },
    degraded: { dot: "bg-amber-500", label: "Degraded — database issue" },
    offline: { dot: "bg-gray-400", label: "Offline — API unreachable" },
  };
  const { dot, label } = map[health];
  return (
    <span className="hidden items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[10px] text-gray-500 sm:inline-flex">
      <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

function Inspector({
  node,
  mode,
  running,
  output,
  error,
  onModeChange,
  onClose,
  onConfig,
  onCode,
  onRunNode,
  results,
  ontologyEnv,
  onSaveToOntology,
  savingToOntology,
  saveMessage,
}: {
  node: FlowNode;
  mode: InspectorMode;
  running: boolean;
  output: NodeOutput | null;
  error: string | null;
  onModeChange: (m: InspectorMode) => void;
  onClose: () => void;
  onConfig: (partial: NodeConfig) => void;
  onCode: (code: string) => void;
  onRunNode: () => void;
  results: DemoResult[] | null;
  ontologyEnv: string | null;
  onSaveToOntology: () => void;
  savingToOntology: boolean;
  saveMessage: string | null;
}) {
  const accent = NODE_ACCENTS[node.type];
  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={accent.text}>
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

      {/* Run-this-node (per-node test) */}
      <div className="border-b border-gray-200 px-4 py-2">
        <button
          type="button"
          onClick={onRunNode}
          disabled={running}
          className={cn(
            "inline-flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            running
              ? "bg-gray-200 text-gray-400"
              : "bg-indigo-600 text-white hover:bg-indigo-500",
          )}
        >
          <Play className="h-3 w-3" />
          {running ? "Running…" : "Run this node"}
        </button>
        <p className="mt-1.5 text-[10px] leading-relaxed text-gray-400">
          Runs this node and everything it depends on upstream.
        </p>
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
          <LowCodeForm
            node={node}
            onConfig={onConfig}
            results={results}
            ontologyEnv={ontologyEnv}
            onSaveToOntology={onSaveToOntology}
            savingToOntology={savingToOntology}
            saveMessage={saveMessage}
          />
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

        {/* Node output preview (per-node test result) */}
        {error ? (
          <div className="mt-4 rounded-md border border-rose-300 bg-rose-50 p-2.5 text-[11px] text-rose-700">
            {error}
          </div>
        ) : output ? (
          <NodeOutputPreview output={output} />
        ) : null}
      </div>
    </aside>
  );
}

function NodeOutputPreview({ output }: { output: NodeOutput }) {
  const lines: string[] = [];
  if (output.text) lines.push(`text: ${output.text.slice(0, 120)}`);
  if (output.concepts?.length) lines.push(`concepts: ${output.concepts.length}`);
  if (output.contexts?.length) lines.push(`contexts: ${output.contexts.length}`);
  if (output.results?.length) lines.push(`results: ${output.results.length}`);
  if (output.payload != null) lines.push("payload: present");
  if (!lines.length) return null;
  return (
    <div className="mt-4">
      <span className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.18em] text-gray-400">
        Node output
      </span>
      <pre className="max-h-40 overflow-auto rounded-md border border-gray-200 bg-gray-50 p-2.5 font-mono text-[10px] leading-relaxed text-gray-700">
        {lines.join("\n")}
      </pre>
    </div>
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
        className="w-full accent-indigo-600"
      />
    </Field>
  );
}

function LowCodeForm({
  node,
  onConfig,
  results,
  ontologyEnv,
  onSaveToOntology,
  savingToOntology,
  saveMessage,
}: {
  node: FlowNode;
  onConfig: (partial: NodeConfig) => void;
  results: DemoResult[] | null;
  ontologyEnv: string | null;
  onSaveToOntology: () => void;
  savingToOntology: boolean;
  saveMessage: string | null;
}) {
  const [newTrigger, setNewTrigger] = useState("");
  const [ingestBusy, setIngestBusy] = useState(false);
  const [ingestMsg, setIngestMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Auto-poll webhook events while this webhook node is selected.
  const sourceId = node.config.sourceId;
  const knownEventId = node.config.ingestEventId;
  useEffect(() => {
    if (node.type !== "webhook" || !sourceId) return;
    let cancelled = false;
    async function poll() {
      try {
        const { events } = await listIngestEvents(sourceId);
        const latest = events[0];
        if (!cancelled && latest && latest.id !== knownEventId) {
          const p = latest.payload as Record<string, unknown>;
          const text =
            typeof p.text === "string" ? p.text : JSON.stringify(p);
          onConfig({
            ingestEventId: latest.id,
            lastEventPayload: latest.payload,
            lastEventText: text,
          });
        }
      } catch {
        /* ignore transient poll errors */
      }
    }
    void poll();
    const handle = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.type, sourceId, knownEventId]);

  async function copyWebhook() {
    if (!node.config.webhookUrl) return;
    try {
      await navigator.clipboard.writeText(node.config.webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  }

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

    case "source":
      return (
        <SourceNodeForm
          request={node.config.sourceRequest ?? defaultSourceRequest()}
          onChange={(sourceRequest) => onConfig({ sourceRequest })}
        />
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
            <div className="flex gap-1.5">
              <input
                readOnly
                value={node.config.webhookUrl ?? "Create a webhook source below"}
                className="min-w-0 flex-1 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 font-mono text-[10px] text-gray-700"
              />
              <button
                type="button"
                onClick={copyWebhook}
                disabled={!node.config.webhookUrl}
                aria-label="Copy webhook URL"
                className="inline-flex items-center justify-center rounded-md border border-gray-300 px-2 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </Field>
          {!node.config.webhookUrl ? (
            <button
              type="button"
              disabled={ingestBusy}
              onClick={async () => {
                setIngestBusy(true);
                setIngestMsg(null);
                try {
                  const res = await createIngestSource("Webhook source", "webhook");
                  onConfig({
                    sourceId: res.source.id,
                    webhookUrl: res.source.webhookUrl ?? "",
                  });
                  setIngestMsg("Webhook ready — POST payloads to this URL.");
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
          ) : (
            <p className="text-[10px] leading-relaxed text-gray-500">
              Listening for events… POST JSON (with a{" "}
              <code className="font-mono">text</code> field) to the URL above
              and it appears here automatically.
            </p>
          )}
          {node.config.lastEventPayload != null ? (
            <div className="mt-3">
              <span className="mb-1 block font-mono text-[9px] uppercase tracking-wide text-sky-600">
                Latest received payload
              </span>
              <pre className="max-h-40 overflow-auto rounded-md border border-gray-200 bg-gray-50 p-2 font-mono text-[10px] leading-snug text-gray-700">
                {JSON.stringify(node.config.lastEventPayload, null, 2)}
              </pre>
            </div>
          ) : null}
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

          {/* Save the full pipeline output into the selected ontology env. */}
          <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50/50 p-2.5">
            <button
              type="button"
              onClick={onSaveToOntology}
              disabled={savingToOntology || !ontologyEnv}
              className={cn(
                "w-full rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                savingToOntology || !ontologyEnv
                  ? "bg-emerald-200 text-white"
                  : "bg-emerald-600 text-white hover:bg-emerald-500",
              )}
            >
              {savingToOntology
                ? "Saving…"
                : ontologyEnv
                  ? `Save pipeline output to "${ontologyEnv}"`
                  : "Select an environment first"}
            </button>
            <p className="mt-1.5 text-[10px] leading-relaxed text-gray-500">
              Runs the full extract pipeline server-side and persists accepted
              findings (with provenance + Patient links) into the chosen
              ontology environment.
            </p>
            {saveMessage ? (
              <p className="mt-1.5 text-[10px] text-gray-600">{saveMessage}</p>
            ) : null}
          </div>

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
