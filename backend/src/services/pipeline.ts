import type { DbClient } from "../lib/db.js";
import { BadRequest, NotFound } from "../lib/errors.js";
import { buildMapProperties, coerceValue, type MappingRule } from "./channel-runner.js";
import { addReference, loadTableVersion, previewRows } from "./datasets.js";
import { upsertInstanceByIdentity, type PropertyDef } from "./ontology.js";

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

export type NodeKind =
  | "dataset_input"
  | "filter"
  | "select"
  | "derive"
  | "cast"
  | "join"
  | "object_output"
  | "dataset_output";

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
  error?: string;
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
  category: "Input" | "Clean" | "Shape" | "Combine" | "Output";
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
): Promise<{ written: number; skipped: number }> {
  const typeName = String(node.config.objectTypeName ?? "");
  const identity = (node.config.identityProperties ?? []) as string[];
  const mapping = (node.config.columnMapping ?? []) as MappingRule[];
  if (!typeName || identity.length === 0) return { written: 0, skipped: rows.length };

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

  let written = 0;
  let skipped = 0;
  for (const row of rows) {
    const { properties, issues, missingRequired } = buildMapProperties(row, rules, schema);
    if (issues.length > 0 || missingRequired.length > 0) {
      skipped++;
      continue;
    }
    if (!preview) {
      await upsertInstanceByIdentity(db, objectTypeId, identity, properties, {
        source: "pipeline",
        pipelineId: pipeline.id,
        nodeId: node.id,
      });
    }
    written++;
  }
  return { written, skipped };
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
