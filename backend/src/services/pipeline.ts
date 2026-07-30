import type { DbClient } from "../lib/db.js";
import { BadRequest, NotFound } from "../lib/errors.js";
import { proxyToNlp } from "../lib/nlp.js";
import {
  buildMapProperties,
  coerceValue,
  decide,
  readPath,
  type MappingRule,
} from "./channel-runner.js";
import { addReference, loadTableVersion, previewRows } from "./datasets.js";
import {
  findInstanceIdByKey,
  getOrCreateLinkType,
  insertLinkInstance,
  upsertInstanceByIdentity,
  type PropertyDef,
} from "./ontology.js";

// ---------------------------------------------------------------------------
// Pipeline execution.
//
// A pipeline is a DAG of nodes. Each node takes rows and returns rows; the
// executor walks the graph in dependency order and keeps per-node counts so the
// canvas can say where rows were lost. Losing rows silently is the failure this
// whole design is meant to make visible — a linear step list could report a
// final count and nothing else.
//
// Nodes are a fixed catalogue rather than user code. An escape hatch that runs
// arbitrary expressions over PHI is a security surface, and it removes the
// pressure to build the node someone actually needed.
// ---------------------------------------------------------------------------

export type Row = Record<string, unknown>;

/**
 * The single list of node kinds. The route's zod enum is built from this rather
 * than repeating it — a schema that silently disagrees with the type accepts a
 * node the executor cannot run, or rejects one it can.
 */
export const NODE_KINDS = [
  "dataset_input",
  "filter",
  "select",
  "derive",
  "cast",
  "join",
  "text_field",
  "extract_snomed",
  "validate_confidence",
  "object_output",
  "dataset_output",
] as const;

export type NodeKind = (typeof NODE_KINDS)[number];

export interface PipelineNode {
  id: string;
  kind: NodeKind;
  name: string;
  x: number;
  y: number;
  config: Record<string, unknown>;
}

/** toPort distinguishes the two inputs of a join; single-input nodes omit it. */
export interface PipelineEdge {
  from: string;
  to: string;
  toPort?: "left" | "right";
}

export interface Pipeline {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  description: string | null;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  status: "draft" | "live" | "paused";
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
}

export interface NodeStat {
  in: number;
  out: number;
  dropped: number;
  ms: number;
  /** Links created, on an object output that has link rules. */
  linked?: number;
  /** Rows whose link target could not be found — reported, never silent. */
  unresolved?: number;
  error?: string;
}

/**
 * Attach a new instance to an existing one.
 *
 * A property holding "6 Ouest — médecine" is a string; a link to the OrgUnit of
 * that name is a graph edge, and only the second one makes the twin count the
 * patient. This is the rule that turns the first into the second.
 */
export interface LinkRule {
  /** Link type name, e.g. "located_in". Created if it does not exist. */
  linkType: string;
  /** Object type to search, e.g. "OrgUnit". */
  targetType: string;
  /** Column on the row holding the value to match. */
  fromColumn: string;
  /** Property on the target instance to match it against, e.g. "name". */
  targetProperty: string;
  /** "out" = the new instance is the source of the link. Default "out". */
  direction?: "out" | "in";
}

export interface RunResult {
  runId: string | null;
  status: "succeeded" | "failed";
  rowsIn: number;
  rowsOut: number;
  nodeStats: Record<string, NodeStat>;
  /** Sample rows per node, populated in preview mode only. */
  samples: Record<string, Row[]>;
  error: string | null;
}

const PREVIEW_ROWS = 25;
const MAX_ROWS = 50_000;

export interface NodeMeta {
  kind: NodeKind;
  label: string;
  category: "Input" | "Clean" | "Shape" | "Combine" | "Clinical" | "Output";
  description: string;
  inputs: number;
  outputs: number;
}

/**
 * The palette. Kept in the backend for the same reason the connector catalogue
 * is: it is the one place that can honestly say what actually runs.
 */
export const NODE_CATALOGUE: NodeMeta[] = [
  {
    kind: "dataset_input",
    label: "Dataset",
    category: "Input",
    description: "Read a table or stream.",
    inputs: 0,
    outputs: 1,
  },
  {
    kind: "cast",
    label: "Cast / clean",
    category: "Clean",
    description: "Convert types, trim whitespace, fill blanks.",
    inputs: 1,
    outputs: 1,
  },
  {
    kind: "filter",
    label: "Filter",
    category: "Shape",
    description: "Keep only rows matching a rule.",
    inputs: 1,
    outputs: 1,
  },
  {
    kind: "select",
    label: "Select columns",
    category: "Shape",
    description: "Keep, drop or rename columns.",
    inputs: 1,
    outputs: 1,
  },
  {
    kind: "derive",
    label: "Derive column",
    category: "Shape",
    description: "Compute a new field from existing ones.",
    inputs: 1,
    outputs: 1,
  },
  {
    kind: "join",
    label: "Join",
    category: "Combine",
    description: "Combine two inputs on a key.",
    inputs: 2,
    outputs: 1,
  },
  {
    kind: "text_field",
    label: "Text field",
    category: "Clinical",
    description: "Pull the free text out of a column, following a path into JSON if needed.",
    inputs: 1,
    outputs: 1,
  },
  {
    kind: "extract_snomed",
    label: "Extract → SNOMED",
    category: "Clinical",
    description: "Find clinical concepts in free text. One note becomes one row per concept.",
    inputs: 1,
    outputs: 1,
  },
  {
    kind: "validate_confidence",
    label: "Validate",
    category: "Clinical",
    description: "Route low-confidence rows to review, and drop duplicates.",
    inputs: 1,
    outputs: 1,
  },
  {
    kind: "object_output",
    label: "Object type",
    category: "Output",
    description: "Upsert rows into the ontology.",
    inputs: 1,
    outputs: 0,
  },
  {
    kind: "dataset_output",
    label: "Dataset",
    category: "Output",
    description: "Write a derived table.",
    inputs: 1,
    outputs: 0,
  },
];

// --- graph ------------------------------------------------------------------

/** Nodes in dependency order. Throws on a cycle rather than looping. */
export function topoSort(nodes: PipelineNode[], edges: PipelineEdge[]): PipelineNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const indegree = new Map(nodes.map((n) => [n.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const e of edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
    outgoing.set(e.from, [...(outgoing.get(e.from) ?? []), e.to]);
  }
  const queue = nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: PipelineNode[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(byId.get(id)!);
    for (const next of outgoing.get(id) ?? []) {
      const d = (indegree.get(next) ?? 1) - 1;
      indegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  if (order.length !== nodes.length) {
    throw BadRequest("PIPELINE_CYCLE", "This pipeline has a cycle — rows would never stop moving.");
  }
  return order;
}

export interface ValidationIssue {
  nodeId: string | null;
  message: string;
}

/**
 * Problems worth blocking a run for. Reported all at once: fixing one at a time
 * because the executor stopped at the first is the slowest possible loop.
 */
export function validate(p: Pick<Pipeline, "nodes" | "edges">): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const inputsOf = new Map<string, PipelineEdge[]>();
  for (const e of p.edges) {
    inputsOf.set(e.to, [...(inputsOf.get(e.to) ?? []), e]);
  }

  if (p.nodes.length === 0) {
    issues.push({ nodeId: null, message: "The pipeline is empty." });
  }
  if (!p.nodes.some((n) => n.kind === "dataset_input")) {
    issues.push({ nodeId: null, message: "Add an input — a pipeline needs somewhere to read from." });
  }
  if (!p.nodes.some((n) => n.kind === "object_output" || n.kind === "dataset_output")) {
    issues.push({
      nodeId: null,
      message: "Add an output — otherwise the rows are computed and thrown away.",
    });
  }

  for (const n of p.nodes) {
    const ins = inputsOf.get(n.id) ?? [];
    if (n.kind === "dataset_input") {
      if (!n.config.datasetId) issues.push({ nodeId: n.id, message: "Pick a dataset to read." });
      if (ins.length > 0) issues.push({ nodeId: n.id, message: "An input node cannot have an input." });
      continue;
    }
    if (ins.length === 0) {
      issues.push({ nodeId: n.id, message: "Nothing feeds this node." });
      continue;
    }
    if (n.kind === "join") {
      const ports = new Set(ins.map((e) => e.toPort ?? "left"));
      if (ins.length !== 2 || ports.size !== 2) {
        issues.push({ nodeId: n.id, message: "A join needs exactly one left and one right input." });
      }
      if (!n.config.leftKey || !n.config.rightKey) {
        issues.push({ nodeId: n.id, message: "A join needs a key column on each side." });
      }
    } else if (ins.length > 1) {
      issues.push({ nodeId: n.id, message: "This node takes a single input." });
    }
    if (n.kind === "object_output") {
      const ident = n.config.identityProperties;
      if (!Array.isArray(ident) || ident.length === 0) {
        issues.push({
          nodeId: n.id,
          message:
            "Pick at least one property as the key, otherwise every run duplicates the rows instead of updating them.",
        });
      }
    }
    if (n.kind === "dataset_output" && !n.config.datasetId) {
      issues.push({ nodeId: n.id, message: "Pick a dataset to write to." });
    }
    if (n.kind === "object_output") {
      // A half-filled link rule is worse than none: it looks configured on the
      // canvas and silently links nothing.
      for (const r of (n.config.linkRules ?? []) as LinkRule[]) {
        const missing = (["linkType", "targetType", "fromColumn", "targetProperty"] as const).filter(
          (k) => !r?.[k],
        );
        if (missing.length > 0) {
          issues.push({
            nodeId: n.id,
            message: `A link rule is incomplete — missing ${missing.join(", ")}.`,
          });
        }
      }
    }
    if (n.kind === "text_field" && !n.config.column) {
      issues.push({ nodeId: n.id, message: "Pick the column that holds the text." });
    }
    if (n.kind === "extract_snomed" && !process.env.NLP_SERVICE_URL) {
      issues.push({
        nodeId: n.id,
        message: "Extraction needs NLP_SERVICE_URL configured — this node cannot run without it.",
      });
    }
  }

  // Sending free text straight to the ontology writes the note, not the
  // concepts in it; the extraction has to sit between them.
  const extracts = p.nodes.filter((n) => n.kind === "extract_snomed");
  for (const e of extracts) {
    const reaches = (from: string, seen = new Set<string>()): boolean => {
      if (seen.has(from)) return false;
      seen.add(from);
      return p.edges
        .filter((x) => x.from === from)
        .some((x) => {
          const next = p.nodes.find((n) => n.id === x.to);
          return next?.kind === "object_output" || reaches(x.to, seen);
        });
    };
    if (!reaches(e.id)) {
      issues.push({
        nodeId: e.id,
        message: "Extracted concepts do not reach an output — they are computed and discarded.",
      });
    }
  }
  return issues;
}

// --- transforms -------------------------------------------------------------

function compare(a: unknown, op: string, b: unknown): boolean {
  if (op === "is_null") return a === null || a === undefined || a === "";
  if (op === "not_null") return !(a === null || a === undefined || a === "");
  if (a === null || a === undefined) return false;
  const bothNumeric = !Number.isNaN(Number(a)) && !Number.isNaN(Number(b)) && b !== "";
  const x = bothNumeric ? Number(a) : String(a).toLowerCase();
  const y = bothNumeric ? Number(b) : String(b).toLowerCase();
  switch (op) {
    case "eq":
      return x === y;
    case "ne":
      return x !== y;
    case "gt":
      return x > y;
    case "gte":
      return x >= y;
    case "lt":
      return x < y;
    case "lte":
      return x <= y;
    case "contains":
      return String(a).toLowerCase().includes(String(b).toLowerCase());
    default:
      return false;
  }
}

export function applyFilter(rows: Row[], cfg: Record<string, unknown>): Row[] {
  const col = String(cfg.column ?? "");
  const op = String(cfg.op ?? "eq");
  const value = cfg.value;
  if (!col) return rows;
  return rows.filter((r) => compare(r[col], op, value));
}

export function applySelect(rows: Row[], cfg: Record<string, unknown>): Row[] {
  const keep = Array.isArray(cfg.keep) ? (cfg.keep as string[]) : null;
  const drop = new Set(Array.isArray(cfg.drop) ? (cfg.drop as string[]) : []);
  const rename = (cfg.rename ?? {}) as Record<string, string>;
  return rows.map((r) => {
    const out: Row = {};
    for (const [k, v] of Object.entries(r)) {
      if (drop.has(k)) continue;
      if (keep && keep.length > 0 && !keep.includes(k)) continue;
      out[rename[k] ?? k] = v;
    }
    return out;
  });
}

function datePart(value: unknown, part: string): unknown {
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  switch (part) {
    case "year":
      return d.getUTCFullYear();
    case "month":
      return d.getUTCMonth() + 1;
    case "day":
      return d.getUTCDate();
    case "hour":
      return d.getUTCHours();
    case "date":
      return d.toISOString().slice(0, 10);
    default:
      return null;
  }
}

/**
 * A fixed set of derivations rather than an expression language. The dropdown
 * covers what pipelines actually need; a parser would be a mini-compiler and an
 * injection surface for the sake of the cases it does not cover yet.
 */
export function applyDerive(rows: Row[], cfg: Record<string, unknown>): Row[] {
  const as = String(cfg.as ?? "").trim();
  const op = String(cfg.op ?? "constant");
  if (!as) return rows;
  const cols = Array.isArray(cfg.columns) ? (cfg.columns as string[]) : [];
  const sep = String(cfg.separator ?? "");
  const literal = cfg.value;

  return rows.map((r) => {
    let v: unknown = null;
    switch (op) {
      case "constant":
        v = literal ?? null;
        break;
      case "concat":
        v = cols.map((c) => (r[c] === null || r[c] === undefined ? "" : String(r[c]))).join(sep);
        break;
      case "coalesce":
        v = cols.map((c) => r[c]).find((x) => x !== null && x !== undefined && x !== "") ?? null;
        break;
      case "date_part":
        v = datePart(r[cols[0] ?? ""], String(cfg.part ?? "date"));
        break;
      case "arithmetic": {
        const a = Number(r[cols[0] ?? ""]);
        const b = cols[1] ? Number(r[cols[1]]) : Number(literal);
        if (Number.isNaN(a) || Number.isNaN(b)) {
          v = null;
          break;
        }
        const arith = String(cfg.arith ?? "add");
        v =
          arith === "add" ? a + b
          : arith === "subtract" ? a - b
          : arith === "multiply" ? a * b
          : arith === "divide" ? (b === 0 ? null : a / b)
          : null;
        break;
      }
      case "conditional":
        v = compare(r[cols[0] ?? ""], String(cfg.compareOp ?? "eq"), cfg.compareTo)
          ? (cfg.thenValue ?? null)
          : (cfg.elseValue ?? null);
        break;
      default:
        v = null;
    }
    return { ...r, [as]: v };
  });
}

interface CastRule {
  column: string;
  to: "string" | "number" | "boolean" | "date";
}

/**
 * Casting is where rows legitimately die: a value that will not become a number
 * is a real problem, not a formatting quirk. onError decides whether that costs
 * the field or the row, and either way the count is reported.
 */
export function applyCast(rows: Row[], cfg: Record<string, unknown>): { rows: Row[]; dropped: number } {
  const casts = (Array.isArray(cfg.casts) ? cfg.casts : []) as CastRule[];
  const trim = new Set(Array.isArray(cfg.trim) ? (cfg.trim as string[]) : []);
  const fill = (cfg.fillNulls ?? {}) as Record<string, unknown>;
  const onError = String(cfg.onError ?? "null");

  const out: Row[] = [];
  let dropped = 0;
  for (const r of rows) {
    const next: Row = { ...r };
    let fatal = false;
    for (const c of trim) {
      if (typeof next[c] === "string") next[c] = (next[c] as string).trim();
    }
    for (const [k, v] of Object.entries(fill)) {
      if (next[k] === null || next[k] === undefined || next[k] === "") next[k] = v;
    }
    for (const c of casts) {
      if (!c?.column) continue;
      const { value, issue } = coerceValue(next[c.column], c.to, c.column);
      if (issue && onError === "drop_row") {
        fatal = true;
        break;
      }
      next[c.column] = issue ? null : value;
    }
    if (fatal) dropped++;
    else out.push(next);
  }
  return { rows: out, dropped };
}

export function applyJoin(
  left: Row[],
  right: Row[],
  cfg: Record<string, unknown>,
): Row[] {
  const lk = String(cfg.leftKey ?? "");
  const rk = String(cfg.rightKey ?? "");
  const kind = String(cfg.kind ?? "inner");
  const prefix = String(cfg.rightPrefix ?? "");
  const index = new Map<string, Row[]>();
  for (const r of right) {
    const k = String(r[rk] ?? "");
    index.set(k, [...(index.get(k) ?? []), r]);
  }
  const out: Row[] = [];
  for (const l of left) {
    const matches = index.get(String(l[lk] ?? ""));
    if (!matches || matches.length === 0) {
      if (kind === "left") out.push({ ...l });
      continue;
    }
    for (const m of matches) {
      const merged: Row = { ...l };
      for (const [k, v] of Object.entries(m)) {
        // A right-side column with the same name as a left-side one would
        // overwrite it and read as data loss later, so collisions are renamed
        // rather than resolved silently.
        const key = prefix ? `${prefix}${k}` : k in l && k !== rk ? `${k}_right` : k;
        merged[key] = v;
      }
      out.push(merged);
    }
  }
  return out;
}

// --- clinical text nodes ----------------------------------------------------
//
// These three carried the channel's actual value. Splitting them out of the
// linear runner is what lets any dataset feed them, and what lets the concepts
// they produce be filtered, joined and mapped like any other rows.

interface NlpConcept {
  span: string;
  candidates: Array<{ code: string; display: string; cosine: number }>;
  code: string | null;
  cosine: number;
  concept_confidence: number;
  status: "resolved" | "flag" | "unresolved";
}

interface NlpAxis {
  value: string;
  confidence: number;
}

interface NlpContext {
  span: string;
  context: {
    assertion: NlpAxis | null;
    subject: NlpAxis | null;
    temporality: NlpAxis | null;
    certainty: NlpAxis | null;
    role: NlpAxis | null;
  };
  context_confidence: number;
  readable_note: string;
}

/**
 * Pull the free text out of a row. A column may hold plain text or a JSON blob
 * the useful part is buried in, so a dot path is accepted for the second case.
 */
export function applyTextField(
  rows: Row[],
  cfg: Record<string, unknown>,
): { rows: Row[]; dropped: number } {
  const from = String(cfg.column ?? "");
  const path = String(cfg.fieldPath ?? "").trim();
  const as = String(cfg.as ?? "text");
  if (!from) return { rows, dropped: 0 };

  const out: Row[] = [];
  let dropped = 0;
  for (const r of rows) {
    let text = r[from];
    if (path) {
      const source =
        typeof text === "string" ? safeJson(text) : (text as Record<string, unknown> | null);
      if (source) text = readPath(source, path);
    }
    // A row with no text cannot be extracted from; dropping it here and
    // counting it beats sending empty strings to the model.
    if (typeof text !== "string" || text.trim() === "") {
      dropped++;
      continue;
    }
    out.push({ ...r, [as]: text });
  }
  return { rows: out, dropped };
}

function safeJson(s: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Extract SNOMED concepts from a text column.
 *
 * This node fans out: one note produces one row per concept found. Row counts
 * going up here is correct, not a bug — and a note that yields nothing is
 * counted as dropped rather than vanishing, which is the failure the channel
 * version reported only in aggregate.
 */
export async function applyExtractSnomed(
  rows: Row[],
  cfg: Record<string, unknown>,
): Promise<{ rows: Row[]; dropped: number }> {
  const textCol = String(cfg.textColumn ?? "text");
  const language = String(cfg.language ?? "auto");
  const threshold = Number(cfg.acceptThreshold ?? 0.85);
  const withContexts = cfg.withContexts !== false;

  const out: Row[] = [];
  let dropped = 0;

  for (const r of rows) {
    const text = r[textCol];
    if (typeof text !== "string" || text.trim() === "") {
      dropped++;
      continue;
    }

    const { concepts } = await proxyToNlp<{ concepts: NlpConcept[] }>("/extract/concepts", {
      text,
      language,
    });
    if (concepts.length === 0) {
      dropped++;
      continue;
    }

    let contexts: NlpContext[] = [];
    if (withContexts) {
      contexts = (
        await proxyToNlp<{ contexts: NlpContext[] }>("/extract/contexts", {
          text,
          language,
          concepts: concepts.map((c) => ({ span: c.span, code: c.code })),
        })
      ).contexts;
    }
    const ctxBySpan = new Map(contexts.map((c) => [c.span, c]));

    for (const c of concepts) {
      const ctx = ctxBySpan.get(c.span);
      const assertion = ctx?.context.assertion?.value ?? "affirmed";
      const certainty = ctx?.context.certainty?.value ?? "confirmed";
      const contextConfidence = ctx?.context_confidence ?? 0;
      // The source row is carried through so downstream nodes can still see
      // the patient, encounter and timestamp the concept came from.
      out.push({
        ...r,
        span: c.span,
        code: c.code,
        display: c.candidates[0]?.display ?? null,
        assertion,
        certainty,
        subject: ctx?.context.subject?.value ?? null,
        temporality: ctx?.context.temporality?.value ?? null,
        conceptConfidence: c.concept_confidence,
        contextConfidence,
        readableNote: ctx?.readable_note ?? "",
        decision: decide(c.status, contextConfidence, assertion, certainty, threshold),
      });
    }
  }
  return { rows: out, dropped };
}

/**
 * Route rows by confidence and drop duplicates.
 *
 * "review" writes to the shared review queue rather than discarding: a
 * low-confidence clinical finding that silently disappears is the worst
 * outcome available, worse than a false positive somebody can reject.
 */
export async function applyValidate(
  db: DbClient,
  pipeline: Pipeline,
  node: PipelineNode,
  rows: Row[],
  preview: boolean,
): Promise<{ rows: Row[]; dropped: number; queued: number }> {
  const cfg = node.config;
  const min = Number(cfg.minConfidence ?? 0);
  const onLow = String(cfg.onLow ?? "flag");
  const dedupeOn = (Array.isArray(cfg.dedupeOn) ? cfg.dedupeOn : []) as string[];

  const seen = new Set<string>();
  const out: Row[] = [];
  let dropped = 0;
  let queued = 0;

  for (const r of rows) {
    if (dedupeOn.length > 0) {
      const key = dedupeOn.map((c) => String(r[c] ?? "")).join(" ");
      if (seen.has(key)) {
        dropped++;
        continue;
      }
      seen.add(key);
    }

    const confidence = Number(r.contextConfidence ?? r.conceptConfidence ?? 1);
    const low = Number.isFinite(confidence) && confidence < min;
    if (!low) {
      out.push(r);
      continue;
    }

    if (onLow === "drop") {
      dropped++;
    } else if (onLow === "review") {
      dropped++;
      queued++;
      if (!preview) {
        await db
          .query(
            `INSERT INTO app.review_item
                    (pipeline_id, node_id, project_id, span, code, display,
                     decision, confidence, payload)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
            [
              pipeline.id,
              node.id,
              pipeline.projectId,
              String(r.span ?? ""),
              r.code ?? null,
              r.display ?? null,
              r.decision === "escalate" ? "escalate" : "flag",
              confidence,
              JSON.stringify({ row: r, nodeName: node.name }),
            ],
          )
          .catch(() => undefined);
      }
    } else {
      out.push({ ...r, decision: "flag" });
    }
  }
  return { rows: out, dropped, queued };
}

// --- execution --------------------------------------------------------------

export interface RunOptions {
  /** Compute everything but write nothing, and keep samples for the canvas. */
  preview?: boolean;
  limit?: number;
  trigger?: "manual" | "preview" | "stream" | "schedule";
}

export async function execute(
  db: DbClient,
  pipeline: Pipeline,
  opts: RunOptions = {},
): Promise<RunResult> {
  const preview = opts.preview === true;
  const limit = Math.min(opts.limit ?? (preview ? PREVIEW_ROWS : MAX_ROWS), MAX_ROWS);

  const issues = validate(pipeline);
  if (issues.length > 0 && !preview) {
    throw BadRequest("PIPELINE_INVALID", issues.map((i) => i.message).join(" "));
  }

  const order = topoSort(pipeline.nodes, pipeline.edges);
  const produced = new Map<string, Row[]>();
  const nodeStats: Record<string, NodeStat> = {};
  const samples: Record<string, Row[]> = {};

  const inputsOf = (id: string) => pipeline.edges.filter((e) => e.to === id);
  let rowsIn = 0;
  let rowsOut = 0;

  let runId: string | null = null;
  if (!preview) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO app.pipeline_run (pipeline_id, trigger) VALUES ($1, $2) RETURNING id`,
      [pipeline.id, opts.trigger ?? "manual"],
    );
    runId = rows[0]!.id;
  }

  try {
    for (const node of order) {
      const started = Date.now();
      const ins = inputsOf(node.id);
      const inRows = ins.flatMap((e) => produced.get(e.from) ?? []);
      let out: Row[] = [];
      let dropped = 0;
      let linkCounts: { linked: number; unresolved: number } | null = null;

      switch (node.kind) {
        case "dataset_input": {
          out = (await previewRows(db, String(node.config.datasetId), limit)) as Row[];
          rowsIn += out.length;
          break;
        }
        case "filter":
          out = applyFilter(inRows, node.config);
          dropped = inRows.length - out.length;
          break;
        case "select":
          out = applySelect(inRows, node.config);
          break;
        case "derive":
          out = applyDerive(inRows, node.config);
          break;
        case "cast": {
          const r = applyCast(inRows, node.config);
          out = r.rows;
          dropped = r.dropped;
          break;
        }
        case "text_field": {
          const r = applyTextField(inRows, node.config);
          out = r.rows;
          dropped = r.dropped;
          break;
        }
        case "extract_snomed": {
          const r = await applyExtractSnomed(inRows, node.config);
          out = r.rows;
          dropped = r.dropped;
          break;
        }
        case "validate_confidence": {
          const r = await applyValidate(db, pipeline, node, inRows, preview);
          out = r.rows;
          dropped = r.dropped;
          break;
        }
        case "join": {
          const left = ins.find((e) => (e.toPort ?? "left") === "left");
          const right = ins.find((e) => e.toPort === "right");
          out = applyJoin(
            left ? (produced.get(left.from) ?? []) : [],
            right ? (produced.get(right.from) ?? []) : [],
            node.config,
          );
          break;
        }
        case "dataset_output": {
          out = inRows;
          if (!preview && out.length > 0) {
            await loadTableVersion(db, String(node.config.datasetId), out, {
              note: `pipeline ${pipeline.slug}`,
            });
          }
          rowsOut += out.length;
          break;
        }
        case "object_output": {
          const r = await writeObjects(db, pipeline, node, inRows, preview);
          out = inRows;
          dropped = r.skipped;
          rowsOut += r.written;
          linkCounts = { linked: r.linked, unresolved: r.unresolved };
          break;
        }
      }

      if (out.length > limit) out = out.slice(0, limit);
      produced.set(node.id, out);
      nodeStats[node.id] = {
        in: node.kind === "dataset_input" ? 0 : inRows.length,
        out: out.length,
        dropped,
        ms: Date.now() - started,
        ...(linkCounts ?? {}),
      };
      if (preview) samples[node.id] = out.slice(0, 5);
    }
  } catch (err) {
    const message = (err as Error).message;
    if (runId) await finishRun(db, runId, pipeline.id, "failed", rowsIn, rowsOut, nodeStats, message);
    return { runId, status: "failed", rowsIn, rowsOut, nodeStats, samples, error: message };
  }

  if (runId) await finishRun(db, runId, pipeline.id, "succeeded", rowsIn, rowsOut, nodeStats, null);
  return { runId, status: "succeeded", rowsIn, rowsOut, nodeStats, samples, error: null };
}

async function writeObjects(
  db: DbClient,
  pipeline: Pipeline,
  node: PipelineNode,
  rows: Row[],
  preview: boolean,
): Promise<{ written: number; skipped: number; linked: number; unresolved: number }> {
  const typeName = String(node.config.objectTypeName ?? "");
  const identity = (node.config.identityProperties ?? []) as string[];
  const mapping = (node.config.columnMapping ?? []) as MappingRule[];
  const linkRules = ((node.config.linkRules ?? []) as LinkRule[]).filter(
    (r) => r?.linkType && r.targetType && r.fromColumn && r.targetProperty,
  );
  if (!typeName || identity.length === 0) {
    return { written: 0, skipped: rows.length, linked: 0, unresolved: 0 };
  }

  const t = await db.query<{ id: string; property_schema: PropertyDef[] }>(
    `SELECT t.id, t.property_schema
       FROM app.ontology_object_types t
       JOIN app.project p ON p.organization_id = t.organization_id
      WHERE p.id = $1 AND t.name = $2`,
    [pipeline.projectId, typeName],
  );
  const objectTypeId = t.rows[0]?.id;
  if (!objectTypeId) throw NotFound("TYPE_NOT_FOUND", `Object type "${typeName}" not found.`);
  const schema = t.rows[0]?.property_schema ?? [];
  const rules = mapping.filter((r) => r.from && r.to);

  // Resolve each rule's target type and link type once rather than per row.
  // A file of 100 patients all on six wards would otherwise do 200 lookups
  // for six answers.
  const resolved: {
    rule: LinkRule;
    targetTypeId: string;
    linkTypeId: string;
    cache: Map<string, string | null>;
  }[] = [];
  for (const rule of linkRules) {
    const tt = await db.query<{ id: string }>(
      `SELECT t.id FROM app.ontology_object_types t
         JOIN app.project p ON p.organization_id = t.organization_id
        WHERE p.id = $1 AND t.name = $2`,
      [pipeline.projectId, rule.targetType],
    );
    const targetTypeId = tt.rows[0]?.id;
    if (!targetTypeId) {
      throw NotFound("TYPE_NOT_FOUND", `Link target type "${rule.targetType}" not found.`);
    }
    const out = (rule.direction ?? "out") === "out";
    const linkTypeId = await getOrCreateLinkType(
      db,
      pipeline.projectId,
      rule.linkType,
      out ? objectTypeId : targetTypeId,
      out ? targetTypeId : objectTypeId,
      "many_to_one",
    );
    resolved.push({ rule, targetTypeId, linkTypeId, cache: new Map() });
  }

  let written = 0;
  let skipped = 0;
  let linked = 0;
  let unresolved = 0;

  for (const row of rows) {
    const { properties, issues, missingRequired } = buildMapProperties(row, rules, schema);
    if (issues.length > 0 || missingRequired.length > 0) {
      skipped++;
      continue;
    }

    let instanceId: string | null = null;
    if (!preview) {
      const up = await upsertInstanceByIdentity(db, objectTypeId, identity, properties, {
        source: "pipeline",
        pipelineId: pipeline.id,
        nodeId: node.id,
      });
      instanceId = up.id;
    }
    written++;

    for (const r of resolved) {
      const raw = row[r.rule.fromColumn];
      if (raw === null || raw === undefined || String(raw).trim() === "") {
        unresolved++;
        continue;
      }
      const key = String(raw).trim();

      let targetId = r.cache.get(key);
      if (targetId === undefined) {
        targetId = await findInstanceIdByKey(db, r.targetTypeId, r.rule.targetProperty, key);
        r.cache.set(key, targetId);
      }
      // A patient on a ward the ontology has never heard of is a real finding,
      // not a row to drop. The instance stands; the miss is counted.
      if (!targetId) {
        unresolved++;
        continue;
      }
      if (!preview && instanceId) {
        const out = (r.rule.direction ?? "out") === "out";
        await insertLinkInstance(
          db,
          r.linkTypeId,
          out ? instanceId : targetId,
          out ? targetId : instanceId,
          { source: "pipeline", pipelineId: pipeline.id, nodeId: node.id },
        );
      }
      linked++;
    }
  }
  return { written, skipped, linked, unresolved };
}

async function finishRun(
  db: DbClient,
  runId: string,
  pipelineId: string,
  status: "succeeded" | "failed",
  rowsIn: number,
  rowsOut: number,
  nodeStats: Record<string, NodeStat>,
  error: string | null,
): Promise<void> {
  await db
    .query(
      `UPDATE app.pipeline_run
          SET status = $2, rows_in = $3, rows_out = $4, node_stats = $5::jsonb,
              error = $6, finished_at = now()
        WHERE id = $1`,
      [runId, status, rowsIn, rowsOut, JSON.stringify(nodeStats), error],
    )
    .catch(() => undefined);
  await db
    .query(
      `UPDATE app.pipeline
          SET last_run_at = now(), last_status = $2, last_error = $3, updated_at = now()
        WHERE id = $1`,
      [pipelineId, status, error],
    )
    .catch(() => undefined);
}

// --- persistence ------------------------------------------------------------

interface PipelineDbRow {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  description: string | null;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  status: "draft" | "live" | "paused";
  last_run_at: Date | null;
  last_status: string | null;
  last_error: string | null;
}

const P_SELECT = `
  SELECT id, project_id, name, slug, description, nodes, edges, status,
         last_run_at, last_status, last_error
    FROM app.pipeline`;

function outRow(r: PipelineDbRow): Pipeline {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    nodes: r.nodes ?? [],
    edges: r.edges ?? [],
    status: r.status,
    lastRunAt: r.last_run_at ? r.last_run_at.toISOString() : null,
    lastStatus: r.last_status,
    lastError: r.last_error,
  };
}

export async function listPipelines(db: DbClient, projectId: string): Promise<Pipeline[]> {
  const { rows } = await db.query<PipelineDbRow>(
    `${P_SELECT} WHERE project_id = $1 ORDER BY created_at ASC`,
    [projectId],
  );
  return rows.map(outRow);
}

export async function getPipeline(db: DbClient, id: string): Promise<Pipeline> {
  const { rows } = await db.query<PipelineDbRow>(`${P_SELECT} WHERE id = $1`, [id]);
  if (!rows[0]) throw NotFound("PIPELINE_NOT_FOUND", "Pipeline not found.");
  return outRow(rows[0]);
}

export async function createPipeline(
  db: DbClient,
  input: { projectId: string; name: string; slug: string; description?: string | null; createdBy?: string | null },
): Promise<Pipeline> {
  const { rows } = await db.query<PipelineDbRow>(
    `INSERT INTO app.pipeline (project_id, name, slug, description, created_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (project_id, slug) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
     RETURNING id, project_id, name, slug, description, nodes, edges, status,
               last_run_at, last_status, last_error`,
    [input.projectId, input.name, input.slug, input.description ?? null, input.createdBy ?? null],
  );
  return outRow(rows[0]!);
}

/**
 * Save the graph. Lineage edges are rewritten from the pipeline's inputs and
 * outputs on every save, so the read-only graph stays a by-product of what was
 * actually built rather than something to maintain separately.
 */
export async function savePipeline(
  db: DbClient,
  id: string,
  patch: { name?: string; nodes?: PipelineNode[]; edges?: PipelineEdge[]; status?: string },
): Promise<Pipeline> {
  const { rows } = await db.query<PipelineDbRow>(
    `UPDATE app.pipeline
        SET name = COALESCE($2, name),
            nodes = COALESCE($3::jsonb, nodes),
            edges = COALESCE($4::jsonb, edges),
            status = COALESCE($5, status),
            updated_at = now()
      WHERE id = $1
      RETURNING id, project_id, name, slug, description, nodes, edges, status,
                last_run_at, last_status, last_error`,
    [
      id,
      patch.name ?? null,
      patch.nodes ? JSON.stringify(patch.nodes) : null,
      patch.edges ? JSON.stringify(patch.edges) : null,
      patch.status ?? null,
    ],
  );
  if (!rows[0]) throw NotFound("PIPELINE_NOT_FOUND", "Pipeline not found.");
  const p = outRow(rows[0]);
  await syncLineage(db, p);
  return p;
}

async function syncLineage(db: DbClient, p: Pipeline): Promise<void> {
  const inputs = p.nodes.filter((n) => n.kind === "dataset_input" && n.config.datasetId);
  const outputs = p.nodes.filter((n) => n.kind === "dataset_output" && n.config.datasetId);
  for (const i of inputs) {
    for (const o of outputs) {
      await addReference(db, {
        fromType: "dataset",
        fromId: String(i.config.datasetId),
        toType: "dataset",
        toId: String(o.config.datasetId),
        kind: "derives",
      }).catch(() => undefined);
    }
  }
}

export async function deletePipeline(db: DbClient, id: string): Promise<void> {
  await db.query(`DELETE FROM app.pipeline WHERE id = $1`, [id]);
}

export interface PipelineRunRow {
  id: string;
  status: string;
  trigger: string;
  rowsIn: number;
  rowsOut: number;
  nodeStats: Record<string, NodeStat>;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

// ---------------------------------------------------------------------------
// Live pipelines
//
// A pipeline marked live re-runs when rows land on its input stream, so the
// ontology — and the twin's SSE reading it — move without anyone pressing a
// button. That was the missing half: the twin already streams every few
// seconds, it was just faithfully pushing data nothing had changed.
//
// This is a scheduler rather than a hook on appendToStream deliberately. The
// append happens inside the webhook request, and hospital integration engines
// retry on timeout — running a whole pipeline there would turn a slow model
// call into duplicate inbound messages.
// ---------------------------------------------------------------------------

const PIPELINE_TICK_MS = 5_000;
const PIPELINE_BATCH = 3;
let pipelineSchedulerStarted = false;

/** Live pipelines whose stream input has rows newer than their last run. */
export async function findDuePipelines(db: DbClient, limit = PIPELINE_BATCH): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT DISTINCT p.id, p.last_run_at
       FROM app.pipeline p
       JOIN LATERAL jsonb_array_elements(p.nodes) AS n ON TRUE
       JOIN app.dataset d
         ON d.id = (n->'config'->>'datasetId')::uuid
      WHERE p.status = 'live'
        AND n->>'kind' = 'dataset_input'
        -- Guard the cast: a half-configured node holds '' or a name, and
        -- ::uuid on that aborts the whole query rather than skipping the row.
        AND n->'config'->>'datasetId' ~ '^[0-9a-fA-F-]{36}$'
        AND d.kind = 'stream'
        AND d.last_written_at IS NOT NULL
        AND (p.last_run_at IS NULL OR d.last_written_at > p.last_run_at)
      ORDER BY p.last_run_at ASC NULLS FIRST
      LIMIT $1`,
    [limit],
  );
  return rows.map((r) => r.id);
}

export function startPipelineScheduler(
  pool: { query: DbClient["query"] },
  log: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void },
): void {
  if (pipelineSchedulerStarted || process.env.PIPELINE_SCHEDULER_DISABLED === "1") return;
  pipelineSchedulerStarted = true;
  log.info({ tickMs: PIPELINE_TICK_MS }, "pipeline scheduler started");

  setInterval(() => {
    void (async () => {
      const db = pool as DbClient;
      try {
        for (const id of await findDuePipelines(db)) {
          // One failure must not stop the others: a live pipeline that errors
          // records the error on itself and the rest keep moving.
          try {
            const p = await getPipeline(db, id);
            await execute(db, p, { trigger: "stream" });
          } catch (err) {
            log.warn({ err, pipelineId: id }, "live pipeline run failed");
          }
        }
      } catch (err) {
        log.warn({ err }, "pipeline scheduler tick failed");
      }
    })();
  }, PIPELINE_TICK_MS).unref?.();
}

export async function listRuns(db: DbClient, pipelineId: string, limit = 20): Promise<PipelineRunRow[]> {
  const { rows } = await db.query<{
    id: string;
    status: string;
    trigger: string;
    rows_in: number;
    rows_out: number;
    node_stats: Record<string, NodeStat>;
    error: string | null;
    started_at: Date;
    finished_at: Date | null;
  }>(
    `SELECT id, status, trigger, rows_in, rows_out, node_stats, error, started_at, finished_at
       FROM app.pipeline_run WHERE pipeline_id = $1 ORDER BY started_at DESC LIMIT $2`,
    [pipelineId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    trigger: r.trigger,
    rowsIn: r.rows_in,
    rowsOut: r.rows_out,
    nodeStats: r.node_stats ?? {},
    error: r.error,
    startedAt: r.started_at.toISOString(),
    finishedAt: r.finished_at ? r.finished_at.toISOString() : null,
  }));
}
