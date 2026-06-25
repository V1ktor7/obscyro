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
import { Play } from "lucide-react";

import { ApiError, getStoredKey } from "@/lib/auth";
import { cn } from "@/lib/cn";
import {
  createEnvObject,
  createIngestSource,
  decide,
  extractConcepts,
  extractContexts,
  ingestPayload,
  listEnvObjects,
  listEnvTypes,
  listIngestEvents,
  persistGraphResults,
  pipelineResultsToCombined,
  runSourceFetch,
  sha256Hex,
  translateCode,
  type ConceptOut,
  type ContextOut,
  type EnvObjectType,
  type EnvironmentSummary,
  type EnvironmentType,
  type PipelineResult,
} from "@/lib/platform-api";
import { useStudio } from "./StudioShell";
import NodeDataPanel from "./NodeDataPanel";
import SchemaMappingPanel from "./SchemaMappingPanel";
import {
  getUpstreamInput,
  mergeNodeOutputs,
  readPath,
  type NodeDataBag,
} from "./studio-data";
import {
  formatSaveOntologyGlance,
  glanceFromPersisted,
  resolvePatientIdentifierFromSource,
  type PersistGlance,
} from "./save-ontology-node";
import CanvasControls from "./CanvasControls";
import {
  canvasToScreen,
  fitToContent,
  hitTestInputPort,
  inputPortCenter,
  pointerInContainer,
  screenToCanvas,
  zoomAtPoint,
  type CanvasTransform,
} from "./studio-canvas";
import { detectFormat, FORMAT_BRANCHES, type FormatBranch } from "./format-detect";
import FormatDetectNodeForm from "./FormatDetectNodeForm";
import {
  clearStudioGraph,
  loadStudioGraph,
  saveStudioGraph,
  type PersistedNode,
  type StudioVariant,
} from "./studio-persist";
import {
  detectWorkflows,
  removeNodes,
  rectsIntersect,
  topoOrder,
  validateConnection,
  workflowBounds,
  type ConnectRejectReason,
} from "./studio-graph-ops";
import {
  ACCENT_HEX,
  EDGE_HEX,
  INPUT_PORT_ID,
  NODE_H,
  NODE_W,
  bezierPoint,
  geom,
  outputPortY,
  pathD,
  pointGeom,
  routerNodeHeight,
  type Geom,
} from "./studio-graph";
import WorkflowRunChip, {
  type WorkflowRunState,
} from "./WorkflowRunChip";
import {
  defaultSourceRequest,
  harvestText,
  type SourceRequest,
} from "./source-schema";
import SourceNodeForm from "./SourceNodeForm";
import WebhookNodeForm from "./WebhookNodeForm";
import type { SanitizedWebhookConfig, WebhookMethod } from "./webhook-schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NodeType =
  | "input"
  | "rest"
  | "source"
  | "webhook"
  | "formatDetect"
  | "transform"
  | "mapping"
  | "validation"
  | "concept"
  | "context"
  | "decision"
  | "saveOntology"
  | "ontologySource"
  | "terminology"
  | "output"
  | "custom";

type Destination = "research" | "problem_list";

function envTypeBadge(type: EnvironmentType): string {
  if (type === "reference") return "ref";
  if (type === "operations") return "ops";
  return "entity";
}

function formatEnvLabel(env: EnvironmentSummary, showOrg: boolean): string {
  const prefix = showOrg ? `${env.organizationName} · ` : "";
  return `${prefix}${env.name} (${envTypeBadge(env.type)})`;
}

type NodeConfig = {
  sampleText?: string;
  payloadJson?: string;
  sourceId?: string;
  webhookUrl?: string;
  webhookMethod?: WebhookMethod;
  webhookConfig?: SanitizedWebhookConfig;
  ingestEventId?: string;
  lastEventPayload?: unknown;
  lastEventText?: string;
  lastEventContentType?: string;
  trustContentType?: boolean;
  lastDetectedFormat?: FormatBranch;
  resolveMin?: number;
  marginMin?: number;
  triggers?: string[];
  destination?: Destination;
  acceptThreshold?: number;
  ontologyEnv?: string;
  objectType?: string;
  patientIdentifierSource?: string;
  ontologyWhere?: string;
  ontologyLimit?: number;
  targetSystem?: "icd10" | "icdo" | "ctv3";
  sourceRequest?: SourceRequest;
  recordsPath?: string;
  transformTrim?: boolean;
  transformDropEmpty?: boolean;
  fieldMap?: { property: string; source: string }[];
  strictValidation?: boolean;
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

type Edge = {
  id: string;
  source: string;
  target: string;
  sourcePort?: string;
  targetPort?: string;
};

/** Data bag flowing between nodes along edges. */
type NodeOutput = {
  text?: string;
  concepts?: ConceptOut[];
  contexts?: ContextOut[];
  results?: PipelineResult[];
  payload?: unknown;
  contentType?: string;
  headers?: Record<string, string>;
  activeBranch?: FormatBranch;
  detectedFormat?: FormatBranch;
  persistGlance?: PersistGlance;
  records?: Record<string, unknown>[];
  instances?: { type: string; properties: Record<string, unknown> }[];
  validationReport?: { valid: number; invalid: number; errors: string[] };
};

type InspectorMode = "lowcode" | "code";

type DemoResult = PipelineResult;

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
  formatDetect: { text: "text-amber-600", bar: "bg-amber-400", border: "border-amber-400", hex: "#d97706" },
  transform: { text: "text-cyan-600", bar: "bg-cyan-400", border: "border-cyan-400", hex: "#0891b2" },
  mapping: { text: "text-indigo-600", bar: "bg-indigo-400", border: "border-indigo-400", hex: "#4f46e5" },
  validation: { text: "text-amber-600", bar: "bg-amber-400", border: "border-amber-400", hex: "#d97706" },
  concept: { text: "text-violet-600", bar: "bg-violet-400", border: "border-violet-400", hex: "#7c3aed" },
  context: { text: "text-violet-600", bar: "bg-violet-400", border: "border-violet-400", hex: "#7c3aed" },
  decision: { text: "text-amber-600", bar: "bg-amber-400", border: "border-amber-400", hex: "#d97706" },
  saveOntology: { text: "text-slate-600", bar: "bg-slate-500", border: "border-slate-500", hex: "#475569" },
  ontologySource: { text: "text-slate-600", bar: "bg-slate-500", border: "border-slate-500", hex: "#475569" },
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
    case "formatDetect":
      return `function run(input) {\n  // Route unchanged payload to fhir | hl7 | json | text | unknown.\n  return detectFormat(input.payload ?? input.text, input.meta);\n}`;
    case "transform":
      return `function run(input) {\n  // Cleaning / normalization (dbt / Spark / OpenRefine stage).\n  const rows = toRecords(input.payload, config.recordsPath);\n  return { records: rows.map(clean) };\n}`;
    case "mapping":
      return `function run(input) {\n  // Map source fields to an ontology object-type's properties.\n  return {\n    instances: input.records.map((r) => ({\n      type: config.objectType,\n      properties: applyFieldMap(r, config.fieldMap),\n    })),\n  };\n}`;
    case "validation":
      return `function run(input) {\n  // Validate instances against the Manager-defined schema (SHACL-like).\n  return validateAgainstSchema(input.instances, {\n    strict: config.strictValidation,\n  });\n}`;
    case "concept":
      return `function run(input) {\n  // NER spans -> embed -> pgvector cosine + margin.\n  return extractConcepts(input.text, {\n    resolveMin: 0.72,\n    marginMin: 0.15,\n  });\n}`;
    case "context":
      return `function run(input) {\n  // Rule-based ConText: assertion, subject, temporality, certainty.\n  return applyContextRules(input, {\n    triggers: ["denies", "rule out", "father"],\n  });\n}`;
    case "decision":
      return `function run(input) {\n  // Route per destination using status + context confidence.\n  if (input.status === "unresolved") return "escalate";\n  if (input.contextConfidence < 0.85) return "flag";\n  return "accept";\n}`;
    case "saveOntology":
      return `function run(input) {\n  // Persist decision results into the ontology environment.\n  return persistGraphResults(input.results, {\n    environment: config.ontologyEnv,\n    objectType: config.objectType,\n    patientIdentifier: config.patientIdentifierSource,\n  });\n}`;
    case "ontologySource":
      return `function run() {\n  // Fetch instances from the ontology to feed the workflow.\n  return listEnvObjects(config.ontologyEnv, {\n    type: config.objectType,\n    where: config.ontologyWhere,\n    limit: config.ontologyLimit ?? 50,\n  });\n}`;
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
    case "formatDetect":
      return {
        title: "Format detection",
        config: { trustContentType: true },
      };
    case "transform":
      return {
        title: "Transform (clean / normalize)",
        config: { recordsPath: "", transformTrim: true, transformDropEmpty: true },
      };
    case "mapping":
      return {
        title: "Mapping to ontology",
        config: { objectType: "", fieldMap: [{ property: "", source: "" }] },
      };
    case "validation":
      return {
        title: "Validation (schema checks)",
        config: { strictValidation: false },
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
    case "saveOntology":
      return {
        title: "Save to ontology",
        config: {
          objectType: "ClinicalFinding",
          patientIdentifierSource: "",
        },
      };
    case "ontologySource":
      return {
        title: "Ontology source",
        config: { ontologyLimit: 50 },
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

function defaultNodeTypes(variant: StudioVariant): NodeType[] {
  if (variant === "workspace") {
    return ["ontologySource", "custom", "output"];
  }
  return ["source", "transform", "mapping", "validation", "saveOntology", "output"];
}

function buildDefaultNodes(variant: StudioVariant): FlowNode[] {
  const types = defaultNodeTypes(variant);
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

function buildDefaultEdges(variant: StudioVariant): Edge[] {
  const count = defaultNodeTypes(variant).length;
  const edges: Edge[] = [];
  for (let i = 1; i < count; i += 1) {
    edges.push({
      id: `e${i}`,
      source: `n-${i}`,
      target: `n-${i + 1}`,
      targetPort: INPUT_PORT_ID,
    });
  }
  return edges;
}

function initGraphState(variant: StudioVariant): {
  nodes: FlowNode[];
  edges: Edge[];
  pan: { x: number; y: number };
  zoom: number;
} {
  const saved = loadStudioGraph(variant);
  if (saved) {
    return {
      nodes: saved.nodes as FlowNode[],
      edges: saved.edges,
      pan: saved.pan,
      zoom: saved.zoom,
    };
  }
  return {
    nodes: buildDefaultNodes(variant),
    edges: buildDefaultEdges(variant),
    pan: { x: 0, y: 0 },
    zoom: 1,
  };
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// ---------------------------------------------------------------------------
// Graph helpers (merge, edge geom)
// ---------------------------------------------------------------------------

function mergeOutputs(outputs: NodeOutput[]): NodeOutput {
  return mergeNodeOutputs(outputs) as NodeOutput;
}

function nodeCardHeight(node: FlowNode): number {
  if (node.type === "formatDetect") {
    return routerNodeHeight(FORMAT_BRANCHES.length);
  }
  return NODE_H;
}

function edgeGeom(e: Edge, s: FlowNode, t: FlowNode): Geom {
  const sh = nodeCardHeight(s);
  const th = nodeCardHeight(t);
  let sourceY = s.y + sh / 2;
  if (s.type === "formatDetect" && e.sourcePort) {
    const idx = FORMAT_BRANCHES.indexOf(e.sourcePort as FormatBranch);
    if (idx >= 0) {
      sourceY = outputPortY(s.y, idx, FORMAT_BRANCHES.length, sh);
    }
  }
  return geom(s, t, { sourceY, sourceHeight: sh, targetHeight: th });
}

function filterIncomingEdges(
  incoming: Edge[],
  outputs: Map<string, NodeOutput>,
  nodes: Map<string, FlowNode>,
): Edge[] {
  return incoming.filter((e) => {
    const src = nodes.get(e.source);
    const out = outputs.get(e.source);
    if (src?.type === "formatDetect" && out?.activeBranch) {
      return (e.sourcePort ?? "unknown") === out.activeBranch;
    }
    return true;
  });
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

/** Coerce an ingestion payload into a flat array of records. */
function toRecords(input: NodeOutput, recordsPath?: string): Record<string, unknown>[] {
  if (input.records?.length) return input.records;
  let raw: unknown = input.payload;
  if (raw == null && input.text) {
    try {
      raw = JSON.parse(input.text);
    } catch {
      return [];
    }
  }
  if (recordsPath?.trim() && raw && typeof raw === "object" && !Array.isArray(raw)) {
    raw = readPath(raw as Record<string, unknown>, recordsPath.trim());
  }
  if (Array.isArray(raw)) {
    return raw.filter(
      (r): r is Record<string, unknown> => r != null && typeof r === "object",
    );
  }
  if (raw && typeof raw === "object") {
    return [raw as Record<string, unknown>];
  }
  return [];
}

/** Lightweight type check used by the validation node. */
function matchesPropertyType(value: unknown, type: string): boolean {
  switch (type) {
    case "number":
      return typeof value === "number" || (typeof value === "string" && !Number.isNaN(Number(value)));
    case "boolean":
      return typeof value === "boolean" || value === "true" || value === "false";
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "string":
    default:
      return true;
  }
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
        return { text, payload: parsed, contentType: "application/json" };
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
      return {
        text: res.text || harvestText(res.body, request.response.format),
        payload: res.body,
        contentType: res.contentType,
        headers: res.headers,
      };
    }

    case "webhook": {
      if (node.config.lastEventText) {
        return {
          text: node.config.lastEventText,
          payload: node.config.lastEventPayload,
          contentType: node.config.lastEventContentType,
        };
      }
      if (node.config.sourceId) {
        const { events } = await listIngestEvents(node.config.sourceId);
        const latest = events[0];
        if (latest) {
          const p = latest.payload as Record<string, unknown>;
          const text =
            typeof p.text === "string" ? p.text : JSON.stringify(p);
          return {
            text,
            payload: p,
            contentType: latest.contentType,
          };
        }
      }
      throw new Error("No webhook events received yet.");
    }

    case "formatDetect": {
      const trust = node.config.trustContentType ?? true;
      const raw = input.payload ?? input.text;
      const branch = detectFormat(
        raw,
        { contentType: input.contentType, headers: input.headers },
        { trustContentType: trust },
      );
      return { ...input, activeBranch: branch, detectedFormat: branch };
    }

    case "transform": {
      const records = toRecords(input, node.config.recordsPath);
      if (!records.length) {
        throw new Error(
          "No records found. Connect an ingestion node (or set a records path).",
        );
      }
      const trim = node.config.transformTrim ?? true;
      const dropEmpty = node.config.transformDropEmpty ?? true;
      const cleaned = records.map((rec) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(rec)) {
          let value = v;
          if (trim && typeof value === "string") value = value.trim();
          if (dropEmpty && (value === "" || value === null || value === undefined)) {
            continue;
          }
          out[k] = value;
        }
        return out;
      });
      return { ...input, records: cleaned };
    }

    case "mapping": {
      const records = input.records ?? toRecords(input, node.config.recordsPath);
      if (!records.length) {
        throw new Error("No records to map. Connect a Transform (or ingestion) node.");
      }
      const objectType = node.config.objectType?.trim();
      if (!objectType) {
        throw new Error("Pick a target object type on the Mapping node.");
      }
      const fieldMap = (node.config.fieldMap ?? []).filter(
        (m) => m.property.trim() && m.source.trim(),
      );
      const instances = records.map((rec) => {
        const properties: Record<string, unknown> = {};
        if (fieldMap.length) {
          for (const m of fieldMap) {
            properties[m.property.trim()] = readPath(rec, m.source.trim());
          }
        } else {
          // No explicit mapping: pass the record through as-is.
          Object.assign(properties, rec);
        }
        return { type: objectType, properties };
      });
      return { ...input, instances };
    }

    case "validation": {
      const instances = input.instances ?? [];
      if (!instances.length) {
        throw new Error("No mapped instances reached this node. Connect Mapping upstream.");
      }
      const env = node.config.ontologyEnv?.trim();
      const schemaByType = new Map<string, { key: string; type: string }[]>();
      if (env) {
        try {
          const { types } = await listEnvTypes(env);
          for (const t of types) {
            schemaByType.set(
              t.name,
              (t.propertySchema as { key: string; type: string }[]) ?? [],
            );
          }
        } catch {
          /* schema unavailable — fall back to presence checks only */
        }
      }
      const errors: string[] = [];
      const valid: typeof instances = [];
      instances.forEach((inst, i) => {
        const schema = schemaByType.get(inst.type);
        const problems: string[] = [];
        if (schema) {
          for (const prop of schema) {
            const value = inst.properties[prop.key];
            if (value === undefined || value === null || value === "") continue;
            if (!matchesPropertyType(value, prop.type)) {
              problems.push(`${prop.key} expected ${prop.type}`);
            }
          }
        }
        if (Object.keys(inst.properties).length === 0) {
          problems.push("no properties");
        }
        if (problems.length) {
          errors.push(`row ${i + 1}: ${problems.join(", ")}`);
        } else {
          valid.push(inst);
        }
      });
      const report = { valid: valid.length, invalid: errors.length, errors };
      if (node.config.strictValidation && errors.length) {
        throw new Error(`Validation failed (${errors.length}): ${errors.slice(0, 3).join("; ")}`);
      }
      return { ...input, instances: valid, validationReport: report };
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

    case "saveOntology": {
      // Generic ETL path: persist mapped instances (Parser pipeline).
      if (input.instances?.length) {
        const env = node.config.ontologyEnv?.trim();
        if (!env) {
          throw new Error("Select an ontology environment first.");
        }
        let saved = 0;
        for (const inst of input.instances) {
          await createEnvObject(env, {
            type: inst.type,
            properties: inst.properties,
            provenance: { source: "parser" },
          });
          saved += 1;
        }
        return {
          ...input,
          persistGlance: { kind: "saved-instances", count: saved },
        };
      }

      // Clinical path: persist decision results (workspace NLP pipeline).
      const results = input.results ?? [];
      if (!results.length) {
        throw new Error("No decision results reached this node. Connect Decision upstream.");
      }
      const env = node.config.ontologyEnv?.trim();
      if (!env) {
        throw new Error("Select an ontology environment first.");
      }
      const concepts = input.concepts ?? [];
      const contexts = input.contexts ?? [];
      const combined = pipelineResultsToCombined(results, contexts, concepts);
      const patientId = resolvePatientIdentifierFromSource(
        node.config.patientIdentifierSource,
        input.payload,
      );
      const inputHash = await sha256Hex(
        JSON.stringify({ results: combined, env, patientId }),
      );
      const { persisted } = await persistGraphResults({
        inputHash,
        results: combined,
        persist: {
          environment: env,
          objectType: node.config.objectType ?? "ClinicalFinding",
          ...(patientId ? { patient: { identifier: patientId } } : {}),
        },
      });
      return {
        ...input,
        results,
        persistGlance: glanceFromPersisted(persisted),
      };
    }

    case "ontologySource": {
      const env = node.config.ontologyEnv?.trim();
      if (!env) {
        throw new Error("Select an ontology environment first.");
      }
      const { objects } = await listEnvObjects(env, {
        type: node.config.objectType || undefined,
        where: node.config.ontologyWhere?.trim() || undefined,
        limit: node.config.ontologyLimit ?? 50,
      });
      const results: PipelineResult[] = objects.map((o) => {
        const p = o.properties;
        const str = (k: string) =>
          typeof p[k] === "string" ? (p[k] as string) : undefined;
        return {
          span: str("span") ?? str("label") ?? o.typeName,
          code: str("snomed_code") ?? str("code") ?? "",
          display: str("display") ?? str("label") ?? o.typeName,
          assertion: str("assertion") ?? "affirmed",
          subject: str("subject") ?? "patient",
          certainty: str("certainty") ?? "confirmed",
          decision: "flag" as const,
        };
      });
      return { ...input, payload: objects, results };
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
    case "formatDetect":
      return (
        <svg {...common}>
          <path d="M12 3 21 12 12 21 3 12z" />
        </svg>
      );
    case "transform":
      return (
        <svg {...common}>
          <path d="M3 7h13l-3-3M21 17H8l3 3" />
        </svg>
      );
    case "mapping":
      return (
        <svg {...common}>
          <path d="M4 6h6M4 12h6M4 18h6M20 6h-6M20 12h-6M20 18h-6" />
          <path d="M10 6l4 6-4 6" />
        </svg>
      );
    case "validation":
      return (
        <svg {...common}>
          <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
          <path d="m9 11 2 2 4-4" />
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
    case "saveOntology":
      return (
        <svg {...common}>
          <ellipse cx="12" cy="5" rx="8" ry="3" />
          <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
          <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
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

const PALETTE: { type: NodeType; label: string; variants: StudioVariant[] }[] = [
  { type: "input", label: "Input", variants: ["parser", "workspace"] },
  { type: "source", label: "Source", variants: ["parser", "workspace"] },
  { type: "webhook", label: "Webhook intake", variants: ["parser", "workspace"] },
  { type: "transform", label: "Transform", variants: ["parser"] },
  { type: "mapping", label: "Mapping to ontology", variants: ["parser"] },
  { type: "validation", label: "Validation", variants: ["parser"] },
  { type: "saveOntology", label: "Save to ontology", variants: ["parser", "workspace"] },
  { type: "ontologySource", label: "Ontology source", variants: ["workspace"] },
  { type: "formatDetect", label: "Format detection", variants: ["workspace"] },
  { type: "concept", label: "Concept", variants: ["workspace"] },
  { type: "context", label: "Context", variants: ["workspace"] },
  { type: "decision", label: "Decision", variants: ["workspace"] },
  { type: "terminology", label: "Terminology lookup", variants: ["workspace"] },
  { type: "output", label: "Output", variants: ["parser", "workspace"] },
  { type: "custom", label: "Custom code node", variants: ["parser", "workspace"] },
];

function Palette({
  onAdd,
  variant,
}: {
  onAdd: (type: NodeType) => void;
  variant: StudioVariant;
}) {
  const items = PALETTE.filter((item) => item.variants.includes(variant));
  return (
    <aside className="w-48 shrink-0 border-r border-gray-200 bg-white p-3">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-gray-400">
        Nodes
      </div>
      <div className="flex flex-col gap-1.5">
        {items.map((item) => (
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

export default function StudioEditor({ variant }: { variant: StudioVariant }) {
  const { environments, selectedEnv, setSelectedEnv, envTypes } =
    useStudio();
  const initial = useMemo(() => initGraphState(variant), [variant]);

  const [nodes, setNodes] = useState<FlowNode[]>(() => initial.nodes);
  const [edges, setEdges] = useState<Edge[]>(() => initial.edges);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [pan, setPan] = useState(initial.pan);
  const [zoom, setZoom] = useState(initial.zoom);
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>("lowcode");

  const [running, setRunning] = useState(false);
  const [continuousRun, setContinuousRun] = useState(false);
  const [continuousIntervalMs, setContinuousIntervalMs] = useState(10_000);
  const [nextRunInSec, setNextRunInSec] = useState<number | null>(null);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [token, setToken] = useState<{ x: number; y: number } | null>(null);
  const [results, setResults] = useState<DemoResult[] | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [nodeOutputs, setNodeOutputs] = useState<Map<string, NodeOutput>>(
    new Map(),
  );
  const [nodeErrors, setNodeErrors] = useState<Map<string, string>>(new Map());
  const [workflowStates, setWorkflowStates] = useState<
    Record<string, WorkflowRunState>
  >({});
  const [pendingEdge, setPendingEdge] = useState<{
    source: string;
    sourcePort?: string;
    cursor: { x: number; y: number };
    previewValid: boolean;
  } | null>(null);
  const [connectHover, setConnectHover] = useState<{
    nodeId: string;
    valid: boolean;
  } | null>(null);
  const [connectReject, setConnectReject] = useState<{
    nodeId: string;
    reason: ConnectRejectReason;
  } | null>(null);
  const [marquee, setMarquee] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const [envObjectTypes, setEnvObjectTypes] = useState<string[]>(["ClinicalFinding"]);

  useEffect(() => {
    const names = envTypes.map((t) => t.name);
    setEnvObjectTypes(names.length > 0 ? names : ["ClinicalFinding"]);
  }, [envTypes]);

  const showMultipleOrgs = useMemo(
    () => new Set(environments.map((e) => e.organizationId)).size > 1,
    [environments],
  );

  const entityEnvironments = useMemo(
    () => environments.filter((e) => e.type === "entity"),
    [environments],
  );

  useEffect(() => {
    if (!selectedEnv) return;
    const envAware: NodeType[] = ["saveOntology", "validation", "mapping"];
    setNodes((prev) =>
      prev.map((n) =>
        envAware.includes(n.type) && !n.config.ontologyEnv
          ? { ...n, config: { ...n.config, ontologyEnv: selectedEnv } }
          : n,
      ),
    );
  }, [selectedEnv]);

  const handleEnvChange = useCallback(
    (slug: string) => {
      setSelectedEnv(slug || null);
      const selected = Array.from(selectedIds)[0];
      if (selected) {
        setNodes((prev) =>
          prev.map((n) =>
            n.id === selected && n.type === "saveOntology"
              ? { ...n, config: { ...n.config, ontologyEnv: slug || undefined } }
              : n,
          ),
        );
      }
    },
    [selectedIds, setSelectedEnv],
  );

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef(pan);
  panRef.current = pan;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const spaceHeldRef = useRef(false);
  const connectingRef = useRef<{ source: string; sourcePort?: string } | null>(
    null,
  );
  const dragRef = useRef<
    | {
        kind: "node" | "pan" | "marquee";
        id?: string;
        startX: number;
        startY: number;
        origX: number;
        origY: number;
        marqueeStart?: { x: number; y: number };
      }
    | null
  >(null);
  const movedRef = useRef(false);
  const continuousRunRef = useRef(false);
  continuousRunRef.current = continuousRun;
  const scheduleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runGraphRef = useRef<(() => Promise<void>) | null>(null);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const rejectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getTransform = useCallback(
    (): CanvasTransform => ({ pan: panRef.current, zoom: zoomRef.current }),
    [],
  );

  const pointerToCanvas = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const screen = pointerInContainer(clientX, clientY, rect);
      return screenToCanvas(screen.x, screen.y, getTransform());
    },
    [getTransform],
  );

  const nodeById = useMemo(() => {
    const m = new Map<string, FlowNode>();
    nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [nodes]);

  const selectedId = useMemo(() => {
    if (selectedIds.size !== 1) return null;
    return Array.from(selectedIds)[0];
  }, [selectedIds]);

  const selectedNode = selectedId ? nodeById.get(selectedId) ?? null : null;

  const workflows = useMemo(
    () => detectWorkflows(nodes, edges),
    [nodes, edges],
  );

  const nodeHeightById = useCallback(
    (id: string) => {
      const n = nodeById.get(id);
      return n ? nodeCardHeight(n) : NODE_H;
    },
    [nodeById],
  );

  function clearSelection() {
    setSelectedIds(new Set());
    setSelectedEdgeId(null);
  }

  function selectNode(id: string, additive: boolean) {
    setSelectedEdgeId(null);
    if (additive) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else {
      setSelectedIds(new Set([id]));
    }
  }

  function flashConnectReject(nodeId: string, reason: ConnectRejectReason) {
    if (rejectTimerRef.current) clearTimeout(rejectTimerRef.current);
    setConnectReject({ nodeId, reason });
    rejectTimerRef.current = setTimeout(() => {
      setConnectReject(null);
      rejectTimerRef.current = null;
    }, 400);
  }

  // Autosave graph topology
  useEffect(() => {
    const t = setTimeout(() => {
      saveStudioGraph(variant, {
        nodes: nodes as PersistedNode[],
        edges,
        pan,
        zoom,
      });
    }, 500);
    return () => clearTimeout(t);
  }, [nodes, edges, pan, zoom, variant]);

  function deleteEdge(id: string) {
    setEdges((prev) => prev.filter((e) => e.id !== id));
    setSelectedEdgeId((cur) => (cur === id ? null : cur));
  }

  const deleteSelection = useCallback(() => {
    if (selectedEdgeId) {
      setEdges((prev) => prev.filter((e) => e.id !== selectedEdgeId));
      setSelectedEdgeId(null);
      return;
    }
    if (selectedIds.size > 0) {
      const ids = Array.from(selectedIds);
      setNodes((prev) => removeNodes(ids, prev, edges).nodes);
      setEdges((prev) => removeNodes(ids, nodes, prev).edges);
      setSelectedIds(new Set());
      setSelectedEdgeId(null);
    }
  }, [edges, nodes, selectedEdgeId, selectedIds]);

  const findConnectHover = useCallback(
    (
      screenX: number,
      screenY: number,
    ): { nodeId: string; valid: boolean } | null => {
      const c = connectingRef.current;
      if (!c) return null;
      const t = getTransform();
      for (const node of nodes) {
        if (node.id === c.source) continue;
        const h = nodeCardHeight(node);
        const port = inputPortCenter(node.x, node.y, h);
        const portScreen = canvasToScreen(port.x, port.y, t);
        if (hitTestInputPort(screenX, screenY, portScreen.x, portScreen.y)) {
          const reason = validateConnection(
            edges,
            c.source,
            node.id,
            c.sourcePort,
            INPUT_PORT_ID,
          );
          return { nodeId: node.id, valid: reason === null };
        }
      }
      return null;
    },
    [edges, getTransform, nodes],
  );

  // Space key for pan-over-nodes + delete selection
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (
        e.code === "Space" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target instanceof HTMLSelectElement)
      ) {
        spaceHeldRef.current = true;
        e.preventDefault();
      }
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        deleteSelection();
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === "Space") spaceHeldRef.current = false;
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [deleteSelection]);

  // -- Drag / pan / connect -------------------------------------------------

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const screen = pointerInContainer(e.clientX, e.clientY, rect);

      if (connectingRef.current) {
        const canvas = screenToCanvas(screen.x, screen.y, getTransform());
        const hover = findConnectHover(screen.x, screen.y);
        setConnectHover(hover);
        setPendingEdge((pe) =>
          pe
            ? {
                ...pe,
                cursor: canvas,
                previewValid: hover?.valid ?? false,
              }
            : pe,
        );
        return;
      }

      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) movedRef.current = true;

      if (d.kind === "pan") {
        setPan({ x: d.origX + dx, y: d.origY + dy });
      } else if (d.kind === "marquee" && d.marqueeStart) {
        const cur = pointerToCanvas(e.clientX, e.clientY);
        if (cur) {
          setMarquee({
            x1: d.marqueeStart.x,
            y1: d.marqueeStart.y,
            x2: cur.x,
            y2: cur.y,
          });
        }
      } else if (d.kind === "node" && d.id) {
        const z = zoomRef.current;
        setNodes((prev) =>
          prev.map((n) =>
            n.id === d.id
              ? { ...n, x: d.origX + dx / z, y: d.origY + dy / z }
              : n,
          ),
        );
      }
    }

    function onUp(e: PointerEvent) {
      const d = dragRef.current;
      if (d?.kind === "marquee" && d.marqueeStart) {
        const cur = pointerToCanvas(e.clientX, e.clientY);
        if (cur) {
          const x = Math.min(d.marqueeStart.x, cur.x);
          const y = Math.min(d.marqueeStart.y, cur.y);
          const w = Math.abs(cur.x - d.marqueeStart.x);
          const h = Math.abs(cur.y - d.marqueeStart.y);
          if (w > 4 || h > 4) {
            const hits = new Set<string>();
            for (const node of nodes) {
              const nh = nodeCardHeight(node);
              if (
                rectsIntersect(
                  { x, y, w, h },
                  { x: node.x, y: node.y, w: NODE_W, h: nh },
                )
              ) {
                hits.add(node.id);
              }
            }
            if (hits.size) {
              setSelectedIds(hits);
              setSelectedEdgeId(null);
            }
          }
        }
        setMarquee(null);
      }

      dragRef.current = null;
      if (connectingRef.current) {
        connectingRef.current = null;
        setPendingEdge(null);
        setConnectHover(null);
      }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [edges, findConnectHover, getTransform, nodes, pointerToCanvas]);

  function startNodeDrag(e: React.PointerEvent, node: FlowNode) {
    e.stopPropagation();
    if (spaceHeldRef.current) {
      startPan(e);
      return;
    }
    movedRef.current = false;
    if (!e.shiftKey) selectNode(node.id, false);
    else selectNode(node.id, true);
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
    if (e.button !== 0) return;
    movedRef.current = false;
    const canvas = pointerToCanvas(e.clientX, e.clientY);
    if (!canvas) return;

    if (e.shiftKey) {
      clearSelection();
      dragRef.current = {
        kind: "marquee",
        startX: e.clientX,
        startY: e.clientY,
        origX: 0,
        origY: 0,
        marqueeStart: canvas,
      };
      setMarquee({ x1: canvas.x, y1: canvas.y, x2: canvas.x, y2: canvas.y });
      return;
    }

    if (!e.shiftKey) clearSelection();
    dragRef.current = {
      kind: "pan",
      startX: e.clientX,
      startY: e.clientY,
      origX: pan.x,
      origY: pan.y,
    };
  }

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const screen = pointerInContainer(e.clientX, e.clientY, rect);
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const next = zoomAtPoint(getTransform(), screen.x, screen.y, factor);
    setZoom(next.zoom);
    setPan(next.pan);
  }

  function startConnect(
    e: React.PointerEvent,
    node: FlowNode,
    sourcePort?: string,
  ) {
    e.stopPropagation();
    const h = nodeCardHeight(node);
    let sourceY = node.y + h / 2;
    if (node.type === "formatDetect" && sourcePort) {
      const idx = FORMAT_BRANCHES.indexOf(sourcePort as FormatBranch);
      if (idx >= 0) {
        sourceY = outputPortY(node.y, idx, FORMAT_BRANCHES.length, h);
      }
    }
    connectingRef.current = { source: node.id, sourcePort };
    setPendingEdge({
      source: node.id,
      sourcePort,
      cursor: { x: node.x + NODE_W, y: sourceY },
      previewValid: false,
    });
    setConnectHover(null);
  }

  function endConnect(e: React.PointerEvent, node: FlowNode) {
    const c = connectingRef.current;
    if (!c) return;
    e.stopPropagation();
    const source = c.source;
    const target = node.id;
    const sourcePort = c.sourcePort;
    const reason = validateConnection(
      edges,
      source,
      target,
      sourcePort,
      INPUT_PORT_ID,
    );
    if (reason) {
      flashConnectReject(target, reason);
    } else {
      setEdges((prev) => [
        ...prev,
        {
          id: nextId("e"),
          source,
          target,
          targetPort: INPUT_PORT_ID,
          ...(sourcePort ? { sourcePort } : {}),
        },
      ]);
    }
    connectingRef.current = null;
    setPendingEdge(null);
    setConnectHover(null);
  }

  // -- Add node (click + drop) ----------------------------------------------

  const addNode = useCallback(
    (type: NodeType, at?: { x: number; y: number }) => {
      const d = nodeDefaults(type);
      const pos = at ?? {
        x: (-pan.x + 360 + Math.random() * 40) / zoom,
        y: (-pan.y + 300 + Math.random() * 40) / zoom,
      };
      const config =
        type === "saveOntology" && selectedEnv
          ? { ...d.config, ontologyEnv: selectedEnv }
          : d.config;
      const node: FlowNode = {
        id: nextId(type),
        type,
        title: d.title,
        x: pos.x,
        y: pos.y,
        config,
        code: defaultCode(type),
      };
      setNodes((prev) => [...prev, node]);
      setSelectedIds(new Set([node.id]));
      setSelectedEdgeId(null);
    },
    [pan.x, pan.y, zoom, selectedEnv],
  );

  function onCanvasDrop(e: React.DragEvent) {
    e.preventDefault();
    const type = e.dataTransfer.getData("application/x-node-type") as NodeType;
    if (!type) return;
    const canvas = pointerToCanvas(e.clientX, e.clientY);
    if (!canvas) return;
    addNode(type, {
      x: canvas.x - NODE_W / 2,
      y: canvas.y - NODE_H / 2,
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

  async function executeGraphSubset(opts: {
    subsetNodeIds: Set<string>;
    subsetEdges: Edge[];
    initialOutputs?: Map<string, NodeOutput>;
    initialErrors?: Map<string, string>;
    animateEdges?: boolean;
    onWorkflowDone?: (hadErrors: boolean) => void;
  }): Promise<{
    outputs: Map<string, NodeOutput>;
    errors: Map<string, string>;
    order: string[];
  }> {
    const subsetNodes = nodes.filter((n) => opts.subsetNodeIds.has(n.id));
    const order = topoOrder(
      subsetNodes.map((n) => n.id),
      opts.subsetEdges,
    );
    const outputs = new Map(opts.initialOutputs ?? []);
    const errors = new Map(opts.initialErrors ?? []);
    const formatDetectUpdates = new Map<string, FormatBranch>();

    for (const id of order) {
      const node = nodeById.get(id);
      if (!node || !opts.subsetNodeIds.has(id)) continue;
      setActiveNodeId(id);
      const incoming = opts.subsetEdges.filter((e) => e.target === id);
      const filtered = filterIncomingEdges(incoming, outputs, nodeById);
      const merged = mergeOutputs(
        filtered.map((e) => outputs.get(e.source) ?? {}),
      );
      try {
        const out = await executeNode(node, merged);
        outputs.set(id, out);
        errors.delete(id);
        if (node.type === "formatDetect" && out.detectedFormat) {
          formatDetectUpdates.set(id, out.detectedFormat);
        }
      } catch (err) {
        errors.set(
          id,
          err instanceof ApiError
            ? `${err.code}: ${err.message}`
            : (err as Error).message,
        );
        outputs.set(id, {});
      }
      await sleep(opts.animateEdges ? 160 : 140);
      if (opts.animateEdges) {
        const srcOut = outputs.get(id);
        for (const e of opts.subsetEdges.filter((e) => e.source === id)) {
          const s = nodeById.get(e.source);
          const t = nodeById.get(e.target);
          if (!s || !t) continue;
          if (s.type === "formatDetect" && srcOut?.activeBranch) {
            if ((e.sourcePort ?? "unknown") !== srcOut.activeBranch) continue;
          }
          await animateToken(edgeGeom(e, s, t), 420);
        }
      }
    }

    if (formatDetectUpdates.size) {
      setNodes((prev) =>
        prev.map((n) => {
          const fmt = formatDetectUpdates.get(n.id);
          if (!fmt) return n;
          return {
            ...n,
            config: { ...n.config, lastDetectedFormat: fmt },
          };
        }),
      );
    }

    opts.onWorkflowDone?.(order.some((nid) => errors.has(nid)));
    return { outputs, errors, order };
  }

  function clearContinuousSchedule() {
    if (scheduleTimerRef.current) {
      clearTimeout(scheduleTimerRef.current);
      scheduleTimerRef.current = null;
    }
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setNextRunInSec(null);
  }

  function scheduleContinuousRun() {
    clearContinuousSchedule();
    if (!continuousRunRef.current) return;
    const sec = Math.ceil(continuousIntervalMs / 1000);
    setNextRunInSec(sec);
    let remaining = sec;
    countdownTimerRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        setNextRunInSec(null);
      } else {
        setNextRunInSec(remaining);
      }
    }, 1000);
    scheduleTimerRef.current = setTimeout(() => {
      clearContinuousSchedule();
      void runGraphRef.current?.();
    }, continuousIntervalMs);
  }

  async function runGraph() {
    if (running) return;
    setSelectedEdgeId(null);
    if (!getStoredKey()) {
      setResults(DEMO_RESULTS);
      setRunError("No API key — showing demo data. Sign in and create a key.");
      if (continuousRunRef.current) setContinuousRun(false);
      return;
    }
    setRunning(true);
    setRunError(null);
    setResults(null);
    clearSelection();
    setToken(null);
    clearContinuousSchedule();

    const allIds = new Set(nodes.map((n) => n.id));
    const wfRunning: Record<string, WorkflowRunState> = {};
    for (const wf of workflows) wfRunning[wf.id] = "running";
    setWorkflowStates((prev) => ({ ...prev, ...wfRunning }));

    const { outputs, errors, order } = await executeGraphSubset({
      subsetNodeIds: allIds,
      subsetEdges: edges,
      animateEdges: true,
    });

    const wfFinal: Record<string, WorkflowRunState> = {};
    for (const wf of workflows) {
      const hadErr = wf.nodeIds.some((nid) => errors.has(nid));
      wfFinal[wf.id] = hadErr ? "error" : "done";
    }
    setWorkflowStates((prev) => ({ ...prev, ...wfFinal }));

    setActiveNodeId(null);
    setToken(null);
    setNodeOutputs(outputs);
    setNodeErrors(errors);
    setResults(deriveResults(order, outputs));
    if (errors.size) setRunError(errors.values().next().value ?? null);
    setRunning(false);

    if (continuousRunRef.current) {
      scheduleContinuousRun();
    }
  }

  runGraphRef.current = runGraph;

  // Start continuous run when toggled on; clean up when off.
  useEffect(() => {
    if (!continuousRun) {
      clearContinuousSchedule();
      return;
    }
    if (!getStoredKey()) {
      setContinuousRun(false);
      return;
    }
    void runGraphRef.current?.();
    return () => clearContinuousSchedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continuousRun]);

  // Graph-level webhook poll while continuous run is active.
  useEffect(() => {
    if (!continuousRun || !getStoredKey()) return;

    let cancelled = false;
    async function poll() {
      const webhookNodes = nodesRef.current.filter(
        (n) => n.type === "webhook" && n.config.sourceId,
      );
      if (!webhookNodes.length) return;

      let hadNew = false;
      for (const node of webhookNodes) {
        const sourceId = node.config.sourceId!;
        const knownEventId = node.config.ingestEventId;
        try {
          const { events } = await listIngestEvents(sourceId);
          const latest = events[0];
          if (latest && latest.id !== knownEventId) {
            hadNew = true;
            const p = latest.payload as Record<string, unknown>;
            const text =
              typeof p.text === "string" ? p.text : JSON.stringify(p);
            setNodes((prev) =>
              prev.map((n) =>
                n.id === node.id
                  ? {
                      ...n,
                      config: {
                        ...n.config,
                        ingestEventId: latest.id,
                        lastEventPayload: latest.payload,
                        lastEventText: text,
                        lastEventContentType: latest.contentType,
                      },
                    }
                  : n,
              ),
            );
          }
        } catch {
          /* ignore transient poll errors */
        }
      }
      if (!cancelled && hadNew) {
        clearContinuousSchedule();
        void runGraphRef.current?.();
      }
    }
    void poll();
    const handle = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [continuousRun]);

  async function runWorkflow(workflowId: string) {
    if (running) return;
    const wf = workflows.find((w) => w.id === workflowId);
    if (!wf) return;
    if (!getStoredKey()) {
      setRunError("No API key. Sign in and create a key.");
      return;
    }
    setRunning(true);
    setRunError(null);
    setWorkflowStates((prev) => ({ ...prev, [workflowId]: "running" }));

    const subsetIds = new Set(wf.nodeIds);
    const subsetEdges = edges.filter((e) => wf.edgeIds.includes(e.id));

    const { outputs, errors } = await executeGraphSubset({
      subsetNodeIds: subsetIds,
      subsetEdges,
      initialOutputs: nodeOutputs,
      initialErrors: nodeErrors,
      animateEdges: false,
      onWorkflowDone: (hadErrors) => {
        setWorkflowStates((prev) => ({
          ...prev,
          [workflowId]: hadErrors ? "error" : "done",
        }));
      },
    });

    setActiveNodeId(null);
    setNodeOutputs(outputs);
    setNodeErrors(errors);
    const hadErr = wf.nodeIds.some((nid) => errors.has(nid));
    if (hadErr) setRunError(errors.get(wf.nodeIds.find((nid) => errors.has(nid))!) ?? null);
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

    const needed = new Set<string>();
    const visit = (n: string) => {
      if (needed.has(n)) return;
      needed.add(n);
      for (const e of edges.filter((e) => e.target === n)) visit(e.source);
    };
    visit(id);

    const subsetEdges = edges.filter(
      (e) => needed.has(e.source) && needed.has(e.target),
    );

    const { outputs, errors } = await executeGraphSubset({
      subsetNodeIds: needed,
      subsetEdges,
      initialOutputs: nodeOutputs,
      initialErrors: nodeErrors,
      animateEdges: false,
    });

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

  function reset() {
    clearContinuousSchedule();
    setContinuousRun(false);
    clearStudioGraph(variant);
    setNodes(buildDefaultNodes(variant));
    setEdges(buildDefaultEdges(variant));
    setPan({ x: 0, y: 0 });
    setZoom(1);
    clearSelection();
    setResults(null);
    setToken(null);
    setActiveNodeId(null);
    setNodeOutputs(new Map());
    setNodeErrors(new Map());
    setWorkflowStates({});
    setRunError(null);
  }

  // -----------------------------------------------------------------------

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white text-gray-900">
      {/* Editor toolbar — Reset / Run for the current graph */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-gray-200 px-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gray-400">
          {variant === "parser" ? "Ontology Parser" : "Studio Obscyro"}
        </span>
        <div className="flex items-center gap-3">
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
          {continuousRun ? (
            <span className="hidden text-[10px] text-indigo-600 sm:inline">
              {running
                ? "Continuous · running…"
                : nextRunInSec != null
                  ? `Continuous · next in ${nextRunInSec}s`
                  : "Continuous · waiting…"}
            </span>
          ) : null}
          <select
            value={continuousIntervalMs}
            onChange={(e) => setContinuousIntervalMs(Number(e.target.value))}
            disabled={continuousRun}
            title="Continuous run interval"
            className="hidden rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[10px] text-gray-600 sm:block disabled:text-gray-300"
          >
            <option value={5000}>5s</option>
            <option value={10000}>10s</option>
            <option value={30000}>30s</option>
          </select>
          <button
            type="button"
            onClick={() => setContinuousRun((v) => !v)}
            disabled={!getStoredKey()}
            title={continuousRun ? "Stop continuous run" : "Run workflow on a loop"}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:text-gray-300",
              continuousRun
                ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                : "border-gray-200 text-gray-600 hover:border-gray-400 hover:text-gray-900",
            )}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden
            >
              <path d="M17 1l4 4-4 4" />
              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <path d="M7 23l-4-4 4-4" />
              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
            Continuous
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
        </div>
      </div>

      {/* Region B — palette · canvas · inspector */}
      <div className="flex min-h-0 flex-1">
        <Palette onAdd={(type) => addNode(type)} variant={variant} />

        {/* Canvas */}
        <div
          ref={canvasRef}
          className="relative min-w-0 flex-1 overflow-hidden bg-white"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(0,0,0,0.06) 1px, transparent 1px)",
            backgroundSize: `${22 * zoom}px ${22 * zoom}px`,
            backgroundPosition: `${pan.x}px ${pan.y}px`,
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onCanvasDrop}
          onWheel={handleWheel}
        >
          <CanvasControls
            zoom={zoom}
            onZoomIn={() => {
              const rect = canvasRef.current?.getBoundingClientRect();
              if (!rect) return;
              const next = zoomAtPoint(
                getTransform(),
                rect.width / 2,
                rect.height / 2,
                1.15,
              );
              setZoom(next.zoom);
              setPan(next.pan);
            }}
            onZoomOut={() => {
              const rect = canvasRef.current?.getBoundingClientRect();
              if (!rect) return;
              const next = zoomAtPoint(
                getTransform(),
                rect.width / 2,
                rect.height / 2,
                1 / 1.15,
              );
              setZoom(next.zoom);
              setPan(next.pan);
            }}
            onResetZoom={() => {
              const rect = canvasRef.current?.getBoundingClientRect();
              if (!rect) return;
              const next = zoomAtPoint(
                getTransform(),
                rect.width / 2,
                rect.height / 2,
                1 / zoom,
              );
              setZoom(next.zoom);
              setPan(next.pan);
            }}
            onFit={() => {
              const rect = canvasRef.current?.getBoundingClientRect();
              if (!rect) return;
              const fitted = fitToContent(
                nodes.map((n) => ({
                  id: n.id,
                  x: n.x,
                  y: n.y,
                  height: nodeCardHeight(n),
                })),
                rect.width,
                rect.height,
              );
              setZoom(fitted.zoom);
              setPan(fitted.pan);
            }}
          />
          {/* World layer (translated + scaled). Pointerdown on empty space pans. */}
          <div
            className="absolute left-0 top-0 h-[3000px] w-[5000px] cursor-grab active:cursor-grabbing"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "0 0",
            }}
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
                const g = edgeGeom(e, s, t);
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
                        clearSelection();
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
                    const h = nodeCardHeight(s);
                    let sourceY = s.y + h / 2;
                    if (s.type === "formatDetect" && pendingEdge.sourcePort) {
                      const idx = FORMAT_BRANCHES.indexOf(
                        pendingEdge.sourcePort as FormatBranch,
                      );
                      if (idx >= 0) {
                        sourceY = outputPortY(
                          s.y,
                          idx,
                          FORMAT_BRANCHES.length,
                          h,
                        );
                      }
                    }
                    const g = pointGeom(
                      { x: s.x + NODE_W, y: sourceY },
                      pendingEdge.cursor,
                    );
                    return (
                      <path
                        d={pathD(g)}
                        fill="none"
                        stroke={
                          pendingEdge.previewValid ? ACCENT_HEX : "#f43f5e"
                        }
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

            {/* Workflow run chips */}
            {workflows.map((wf, idx) => {
              const bounds = workflowBounds(wf.nodeIds, nodes, nodeHeightById);
              if (!bounds) return null;
              return (
                <WorkflowRunChip
                  key={wf.id}
                  index={idx}
                  x={bounds.minX}
                  y={bounds.minY - 30}
                  state={workflowStates[wf.id] ?? "idle"}
                  running={running}
                  onRun={() => runWorkflow(wf.id)}
                />
              );
            })}

            {/* Marquee selection */}
            {marquee ? (
              <div
                className="pointer-events-none absolute border border-indigo-400 bg-indigo-500/10"
                style={{
                  left: Math.min(marquee.x1, marquee.x2),
                  top: Math.min(marquee.y1, marquee.y2),
                  width: Math.abs(marquee.x2 - marquee.x1),
                  height: Math.abs(marquee.y2 - marquee.y1),
                }}
              />
            ) : null}

            {/* Nodes */}
            {nodes.map((node) => {
              const isSelected = selectedIds.has(node.id);
              const isActive = node.id === activeNodeId;
              const hasError = nodeErrors.has(node.id);
              const accent = NODE_ACCENTS[node.type];
              const showResults =
                node.type === "output" && results && results.length > 0;
              const saveGlance = nodeOutputs.get(node.id)?.persistGlance;
              const nodeOut = nodeOutputs.get(node.id);
              const webhookPayload =
                node.type === "webhook" && node.config.lastEventPayload != null;
              const formatDetected = node.config.lastDetectedFormat;
              const cardH = nodeCardHeight(node);
              const isRouter = node.type === "formatDetect";
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
                    minHeight: cardH,
                  }}
                  onPointerDown={(e) => {
                    if (spaceHeldRef.current) {
                      startPan(e);
                      return;
                    }
                    startNodeDrag(e, node);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!movedRef.current) {
                      selectNode(node.id, e.shiftKey);
                    }
                  }}
                  onMouseEnter={() => setHoveredNodeId(node.id)}
                  onMouseLeave={() =>
                    setHoveredNodeId((cur) => (cur === node.id ? null : cur))
                  }
                >
                  {(isSelected || hoveredNodeId === node.id) && (
                    <button
                      type="button"
                      title="Delete node"
                      onClick={(e) => {
                        e.stopPropagation();
                        const result = removeNodes([node.id], nodes, edges);
                        setNodes(result.nodes);
                        setEdges(result.edges);
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          next.delete(node.id);
                          return next;
                        });
                      }}
                      className="absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded bg-white text-[10px] text-gray-500 shadow-sm ring-1 ring-gray-200 hover:bg-rose-50 hover:text-rose-600"
                    >
                      ×
                    </button>
                  )}
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
                      connectReject?.nodeId === node.id
                        ? "animate-pulse border-rose-400 ring-2 ring-rose-300"
                        : connectHover?.nodeId === node.id
                          ? connectHover.valid
                            ? "border-indigo-500 ring-2 ring-indigo-300"
                            : "border-rose-400 ring-2 ring-rose-300"
                          : accent.border,
                    )}
                  />
                  {isRouter ? (
                    FORMAT_BRANCHES.map((branch, idx) => {
                      const portY = outputPortY(
                        node.y,
                        idx,
                        FORMAT_BRANCHES.length,
                        cardH,
                      );
                      const relY =
                        ((portY - node.y) / cardH) * 100;
                      return (
                        <span
                          key={branch}
                          onPointerDown={(e) => startConnect(e, node, branch)}
                          title={`Output: ${branch}`}
                          className={cn(
                            "absolute -right-2 h-3.5 w-3.5 -translate-y-1/2 cursor-crosshair rounded-full border-2 bg-white transition-transform hover:scale-125",
                            accent.border,
                          )}
                          style={{ top: `${relY}%` }}
                        />
                      );
                    })
                  ) : (
                    <span
                      onPointerDown={(e) => startConnect(e, node)}
                      title="Drag to connect"
                      className={cn(
                        "absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 cursor-crosshair rounded-full border-2 bg-white transition-transform hover:scale-125",
                        accent.border,
                      )}
                    />
                  )}

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
                    ) : formatDetected ? (
                      <div>
                        <span className="mb-1 block font-mono text-[9px] uppercase tracking-wide text-amber-600">
                          Detected
                        </span>
                        <span className="inline-flex items-center rounded border border-amber-300 bg-amber-50 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-amber-800">
                          {formatDetected}
                        </span>
                      </div>
                    ) : node.type === "saveOntology" && saveGlance ? (
                      <span
                        className={cn(
                          "text-[10px] leading-snug",
                          saveGlance.kind === "error"
                            ? "text-rose-600"
                            : "text-slate-600",
                        )}
                      >
                        {formatSaveOntologyGlance(saveGlance)}
                      </span>
                    ) : isRouter ? (
                      <ul className="space-y-0.5">
                        {FORMAT_BRANCHES.map((branch) => (
                          <li
                            key={branch}
                            className="flex items-center justify-between font-mono text-[9px] uppercase tracking-wide text-gray-400"
                          >
                            <span>{branch}</span>
                            <span className="text-gray-300">→</span>
                          </li>
                        ))}
                      </ul>
                    ) : hasError ? (
                      <span className="text-[10px] text-rose-600">
                        {nodeErrors.get(node.id)}
                      </span>
                    ) : node.type === "transform" && nodeOut?.records?.length ? (
                      <span className="font-mono text-[10px] text-cyan-700">
                        {nodeOut.records.length} record{nodeOut.records.length === 1 ? "" : "s"}
                      </span>
                    ) : node.type === "mapping" && nodeOut?.instances?.length ? (
                      <span className="font-mono text-[10px] text-indigo-700">
                        {nodeOut.instances.length} → {node.config.objectType || "type"}
                      </span>
                    ) : node.type === "validation" && nodeOut?.validationReport ? (
                      <span className="font-mono text-[10px] text-amber-700">
                        {nodeOut.validationReport.valid} valid
                        {nodeOut.validationReport.invalid > 0
                          ? ` · ${nodeOut.validationReport.invalid} invalid`
                          : ""}
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
                edges={edges}
                nodeOutputs={nodeOutputs}
                allNodes={nodes}
                envTypes={envTypes}
                onModeChange={setInspectorMode}
                onClose={() => clearSelection()}
                onConfig={(partial) => updateConfig(selectedNode.id, partial)}
                onCode={(code) => updateCode(selectedNode.id, code)}
                onRunNode={() => runNode(selectedNode.id)}
                results={results}
                environments={environments}
                entityEnvironments={entityEnvironments}
                showMultipleOrgs={showMultipleOrgs}
                selectedEnv={selectedEnv}
                envObjectTypes={envObjectTypes}
                onEnvChange={handleEnvChange}
              />
            ) : selectedIds.size > 1 ? (
              <aside className="flex w-80 shrink-0 flex-col border-l border-gray-200 bg-white p-4">
                <p className="text-sm font-medium text-gray-800">
                  {selectedIds.size} nodes selected
                </p>
                <p className="mt-2 text-[11px] text-gray-500">
                  Press Delete or Backspace to remove them. Shift-click or
                  shift-drag to adjust selection.
                </p>
                <button
                  type="button"
                  onClick={deleteSelection}
                  className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 hover:bg-rose-100"
                >
                  Delete selected
                </button>
              </aside>
            ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

type InspectorIoTab = "input" | "parameters" | "output";

function Inspector({
  node,
  mode,
  running,
  output,
  error,
  edges,
  nodeOutputs,
  allNodes,
  envTypes,
  onModeChange,
  onClose,
  onConfig,
  onCode,
  onRunNode,
  results,
  environments,
  entityEnvironments,
  showMultipleOrgs,
  selectedEnv,
  envObjectTypes,
  onEnvChange,
}: {
  node: FlowNode;
  mode: InspectorMode;
  running: boolean;
  output: NodeOutput | null;
  error: string | null;
  edges: Edge[];
  nodeOutputs: Map<string, NodeOutput>;
  allNodes: FlowNode[];
  envTypes: EnvObjectType[];
  onModeChange: (m: InspectorMode) => void;
  onClose: () => void;
  onConfig: (partial: NodeConfig) => void;
  onCode: (code: string) => void;
  onRunNode: () => void;
  results: DemoResult[] | null;
  environments: EnvironmentSummary[];
  entityEnvironments: EnvironmentSummary[];
  showMultipleOrgs: boolean;
  selectedEnv: string | null;
  envObjectTypes: string[];
  onEnvChange: (slug: string) => void;
}) {
  const [ioTab, setIoTab] = useState<InspectorIoTab>("parameters");
  const accent = NODE_ACCENTS[node.type];
  const wide = node.type === "mapping";

  const nodeById = useMemo(() => {
    const m = new Map<string, { id: string; type: string }>();
    for (const n of allNodes) m.set(n.id, { id: n.id, type: n.type });
    return m;
  }, [allNodes]);

  const upstreamInput = useMemo(
    () => getUpstreamInput(node.id, edges, nodeOutputs, nodeById),
    [node.id, edges, nodeOutputs, nodeById],
  );

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-l border-gray-200 bg-white",
        wide ? "w-[26rem]" : "w-80",
      )}
    >
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

      <div className="flex border-b border-gray-200">
        {(["input", "parameters", "output"] as InspectorIoTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setIoTab(tab)}
            className={cn(
              "flex-1 py-2 text-center font-mono text-[10px] uppercase tracking-[0.12em] transition-colors",
              ioTab === tab
                ? "border-b-2 border-gray-900 text-gray-900"
                : "text-gray-400 hover:text-gray-600",
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {ioTab === "input" ? (
          <NodeDataPanel
            data={upstreamInput}
            draggableFields={node.type === "mapping"}
            emptyHint="Run upstream nodes to see input data."
          />
        ) : null}

        {ioTab === "parameters" ? (
          <>
            <div className="mb-3 flex gap-1">
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
            {mode === "lowcode" ? (
              <LowCodeForm
                node={node}
                onConfig={onConfig}
                results={results}
                environments={environments}
                entityEnvironments={entityEnvironments}
                showMultipleOrgs={showMultipleOrgs}
                selectedEnv={selectedEnv}
                envObjectTypes={envObjectTypes}
                envTypes={envTypes}
                upstreamInput={upstreamInput}
                onEnvChange={onEnvChange}
              />
            ) : (
              <div className="flex flex-col">
                <p className="mb-2 text-[11px] text-gray-400">
                  Editable pseudo-JS. In a real deployment this compiles to the same
                  behavior as the form.
                </p>
                <textarea
                  value={node.code}
                  onChange={(e) => onCode(e.target.value)}
                  spellCheck={false}
                  className="h-72 w-full resize-none rounded-md border border-gray-200 bg-gray-50 p-3 font-mono text-[12px] leading-relaxed text-gray-800 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
                />
              </div>
            )}
          </>
        ) : null}

        {ioTab === "output" ? (
          error ? (
            <div className="rounded-md border border-rose-300 bg-rose-50 p-2.5 text-[11px] text-rose-700">
              {error}
            </div>
          ) : (
            <NodeDataPanel
              data={output}
              emptyHint="Run this node to see output data."
            />
          )
        ) : null}
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
        className="w-full accent-indigo-600"
      />
    </Field>
  );
}

function LowCodeForm({
  node,
  onConfig,
  results,
  environments,
  entityEnvironments,
  showMultipleOrgs,
  selectedEnv,
  envObjectTypes,
  envTypes,
  upstreamInput,
  onEnvChange,
}: {
  node: FlowNode;
  onConfig: (partial: NodeConfig) => void;
  results: DemoResult[] | null;
  environments: EnvironmentSummary[];
  entityEnvironments: EnvironmentSummary[];
  showMultipleOrgs: boolean;
  selectedEnv: string | null;
  envObjectTypes: string[];
  envTypes: EnvObjectType[];
  upstreamInput: NodeDataBag;
  onEnvChange: (slug: string) => void;
}) {
  const [newTrigger, setNewTrigger] = useState("");
  const [ingestBusy, setIngestBusy] = useState(false);
  const [ingestMsg, setIngestMsg] = useState<string | null>(null);

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
            lastEventContentType: latest.contentType,
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
        <WebhookNodeForm
          config={{
            sourceId: node.config.sourceId,
            webhookUrl: node.config.webhookUrl,
            webhookMethod: node.config.webhookMethod,
            webhookConfig: node.config.webhookConfig,
            lastEventPayload: node.config.lastEventPayload,
          }}
          onConfig={onConfig}
        />
      );

    case "formatDetect":
      return (
        <FormatDetectNodeForm
          trustContentType={node.config.trustContentType ?? true}
          lastDetectedFormat={node.config.lastDetectedFormat}
          onChange={onConfig}
        />
      );

    case "transform":
      return (
        <>
          <Field label="Records path (optional)">
            <input
              type="text"
              value={node.config.recordsPath ?? ""}
              onChange={(e) => onConfig({ recordsPath: e.target.value })}
              placeholder="e.g. data.items — leave blank for top-level array"
              className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 font-mono text-[11px] text-gray-800 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
            />
          </Field>
          <label className="mb-2 flex items-center gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={node.config.transformTrim ?? true}
              onChange={(e) => onConfig({ transformTrim: e.target.checked })}
            />
            Trim whitespace on string fields
          </label>
          <label className="mb-2 flex items-center gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={node.config.transformDropEmpty ?? true}
              onChange={(e) => onConfig({ transformDropEmpty: e.target.checked })}
            />
            Drop empty / null fields
          </label>
          <p className="text-[11px] leading-relaxed text-gray-400">
            Normalizes ingested data into clean records (the dbt / Spark /
            OpenRefine stage) for mapping.
          </p>
        </>
      );

    case "mapping":
      return (
        <SchemaMappingPanel
          objectType={node.config.objectType ?? ""}
          fieldMap={node.config.fieldMap ?? []}
          envTypes={envTypes}
          upstreamInput={upstreamInput}
          onObjectTypeChange={(name) => onConfig({ objectType: name || undefined })}
          onFieldMapChange={(rows) => onConfig({ fieldMap: rows })}
        />
      );

    case "validation":
      return (
        <>
          <label className="mb-2 flex items-center gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={node.config.strictValidation ?? false}
              onChange={(e) => onConfig({ strictValidation: e.target.checked })}
            />
            Strict — fail the run if any instance is invalid
          </label>
          <p className="text-[11px] leading-relaxed text-gray-400">
            Checks each mapped instance against the property schema defined for
            its object type in the Ontology Manager. Invalid rows are dropped
            (or, in strict mode, stop the run).
          </p>
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

    case "saveOntology": {
      const envSlug = node.config.ontologyEnv ?? selectedEnv ?? "";
      const envName =
        entityEnvironments.find((e) => e.slug === envSlug)?.name ?? envSlug;
      const saveEnvs =
        entityEnvironments.length > 0 ? entityEnvironments : environments;
      return (
        <>
          <Field label="Environment">
            <select
              value={envSlug}
              onChange={(e) => {
                onEnvChange(e.target.value);
                onConfig({ ontologyEnv: e.target.value || undefined });
              }}
              disabled={saveEnvs.length === 0}
              className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 disabled:text-gray-400"
            >
              {saveEnvs.length === 0 ? (
                <option value="">No entity environments — create one first</option>
              ) : (
                saveEnvs.map((env) => (
                  <option key={env.id} value={env.slug}>
                    {formatEnvLabel(env, showMultipleOrgs)}
                  </option>
                ))
              )}
            </select>
          </Field>
          {entityEnvironments.length === 0 && environments.length > 0 ? (
            <p className="text-[11px] text-amber-700">
              Only entity environments accept clinical findings. Create an entity
              environment in Ontology mode.
            </p>
          ) : null}
          <Field label="Object type">
            <select
              value={node.config.objectType ?? "ClinicalFinding"}
              onChange={(e) => onConfig({ objectType: e.target.value })}
              className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
            >
              {(envObjectTypes.includes("ClinicalFinding")
                ? envObjectTypes
                : ["ClinicalFinding", ...envObjectTypes]
              ).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Patient identifier source">
            <input
              type="text"
              value={node.config.patientIdentifierSource ?? ""}
              onChange={(e) =>
                onConfig({ patientIdentifierSource: e.target.value })
              }
              placeholder="e.g. P-001 or payload.patientId"
              className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
            />
          </Field>
          <p className="text-[11px] leading-relaxed text-gray-400">
            Matched on this identifier only — never on name. No identifier →
            saved unlinked.
          </p>
          {envSlug ? (
            <p className="text-[10px] text-gray-400">
              Writes real data to{" "}
              <span className="font-medium text-gray-600">{envName}</span>
            </p>
          ) : null}
        </>
      );
    }

    case "ontologySource": {
      const envSlug = node.config.ontologyEnv ?? selectedEnv ?? "";
      return (
        <>
          <Field label="Environment">
            <select
              value={envSlug}
              onChange={(e) => {
                onEnvChange(e.target.value);
                onConfig({ ontologyEnv: e.target.value || undefined });
              }}
              disabled={environments.length === 0}
              className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 disabled:text-gray-400"
            >
              {environments.length === 0 ? (
                <option value="">No environments — sign in first</option>
              ) : (
                environments.map((env) => (
                  <option key={env.id} value={env.slug}>
                    {formatEnvLabel(env, showMultipleOrgs)}
                  </option>
                ))
              )}
            </select>
          </Field>
          <Field label="Object type">
            <select
              value={node.config.objectType ?? ""}
              onChange={(e) => onConfig({ objectType: e.target.value || undefined })}
              className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
            >
              <option value="">All types</option>
              {envObjectTypes.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Where filter">
            <input
              type="text"
              value={node.config.ontologyWhere ?? ""}
              onChange={(e) => onConfig({ ontologyWhere: e.target.value })}
              placeholder="assertion:affirmed,subject:patient"
              className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 font-mono text-[11px] text-gray-800 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
            />
          </Field>
          <Field label="Limit">
            <input
              type="number"
              min={1}
              max={200}
              value={node.config.ontologyLimit ?? 50}
              onChange={(e) =>
                onConfig({ ontologyLimit: Number(e.target.value) || 50 })
              }
              className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
            />
          </Field>
          <p className="text-[11px] leading-relaxed text-gray-400">
            Reads instances from the ontology to feed downstream workflow nodes.
          </p>
        </>
      );
    }

    case "output":
      return (
        <div>
          <span className="mb-2 block text-xs font-medium text-gray-700">
            Enriched result
          </span>
          <p className="mb-3 text-[10px] leading-relaxed text-gray-500">
            To persist findings, add a{" "}
            <span className="font-medium text-gray-700">Save to ontology</span>{" "}
            node between Decision and Output, then run the pipeline.
          </p>

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
