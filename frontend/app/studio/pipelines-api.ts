/**
 * Pipelines — the transformation between a dataset and what it becomes.
 *
 * A pipeline is a DAG, not a list of steps: that is the whole reason it exists.
 * One input can feed two branches, two inputs can be joined, and an output can
 * be an ontology object type or another dataset.
 */

import { apiFetch } from "@/lib/auth";

export type NodeKind =
  | "dataset_input"
  | "filter"
  | "select"
  | "derive"
  | "cast"
  | "join"
  | "text_field"
  | "extract_snomed"
  | "validate_confidence"
  | "object_output"
  | "dataset_output";

export type NodeCategory = "Input" | "Clean" | "Shape" | "Combine" | "Clinical" | "Output";

export interface NodeMeta {
  kind: NodeKind;
  label: string;
  category: NodeCategory;
  description: string;
  inputs: number;
  outputs: number;
}

export interface PipelineNode {
  id: string;
  kind: NodeKind;
  name: string;
  x: number;
  y: number;
  config: Record<string, unknown>;
}

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
  /** Rows whose link target could not be found. */
  unresolved?: number;
  error?: string;
}

/** Attach a new instance to an existing one by matching a column to a property. */
export interface LinkRule {
  linkType: string;
  targetType: string;
  fromColumn: string;
  targetProperty: string;
  direction?: "out" | "in";
}

export interface RunResult {
  runId: string | null;
  status: "succeeded" | "failed";
  rowsIn: number;
  rowsOut: number;
  nodeStats: Record<string, NodeStat>;
  samples: Record<string, Record<string, unknown>[]>;
  error: string | null;
}

export interface ValidationIssue {
  nodeId: string | null;
  message: string;
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

export async function listNodeTypes(): Promise<{ nodes: NodeMeta[] }> {
  return apiFetch("/v1/pipeline-nodes");
}

export async function listPipelines(env: string): Promise<{ pipelines: Pipeline[] }> {
  return apiFetch(`/v1/ontology/${enc(env)}/pipelines`);
}

export async function createPipeline(
  env: string,
  body: { name: string; description?: string },
): Promise<Pipeline> {
  return apiFetch(`/v1/ontology/${enc(env)}/pipelines`, { method: "POST", body });
}

export async function getPipeline(id: string): Promise<Pipeline> {
  return apiFetch(`/v1/pipelines/${id}`);
}

export async function savePipeline(
  id: string,
  body: {
    name?: string;
    nodes?: PipelineNode[];
    edges?: PipelineEdge[];
    status?: "draft" | "live" | "paused";
  },
): Promise<Pipeline> {
  return apiFetch(`/v1/pipelines/${id}`, { method: "PATCH", body });
}

export async function deletePipeline(id: string): Promise<{ deleted: boolean }> {
  return apiFetch(`/v1/pipelines/${id}`, { method: "DELETE" });
}

export async function validatePipeline(id: string): Promise<{ issues: ValidationIssue[] }> {
  return apiFetch(`/v1/pipelines/${id}/validate`, { method: "POST", body: {} });
}

/** Compute everything, write nothing, keep a sample per node. */
export async function previewPipeline(id: string, limit = 25): Promise<RunResult> {
  return apiFetch(`/v1/pipelines/${id}/preview`, { method: "POST", body: { limit } });
}

export async function runPipeline(id: string): Promise<RunResult> {
  return apiFetch(`/v1/pipelines/${id}/run`, { method: "POST", body: {} });
}
