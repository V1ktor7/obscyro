/**
 * Shared helpers for n8n-style input/output panels and field-path mapping.
 */

import type { GraphEdge } from "./studio-graph-ops";

/** Data bag flowing between nodes (subset used by panels + merge). */
export type NodeDataBag = {
  text?: string;
  concepts?: unknown[];
  contexts?: unknown[];
  results?: unknown[];
  payload?: unknown;
  contentType?: string;
  headers?: Record<string, string>;
  activeBranch?: string;
  detectedFormat?: string;
  persistGlance?: unknown;
  records?: Record<string, unknown>[];
  instances?: { type: string; properties: Record<string, unknown> }[];
  validationReport?: { valid: number; invalid: number; errors: string[] };
};

export type StudioNodeRef = {
  id: string;
  type: string;
};

/** Merge upstream node outputs the same way executeGraphSubset does. */
export function mergeNodeOutputs(outputs: NodeDataBag[]): NodeDataBag {
  const merged: NodeDataBag = {};
  for (const o of outputs) {
    if (o.text && !merged.text) merged.text = o.text;
    if (o.concepts?.length) {
      merged.concepts = [...(merged.concepts ?? []), ...o.concepts];
    }
    if (o.contexts?.length) {
      merged.contexts = [...(merged.contexts ?? []), ...o.contexts];
    }
    if (o.results?.length) {
      merged.results = [...(merged.results ?? []), ...o.results];
    }
    if (o.records?.length) {
      merged.records = [...(merged.records ?? []), ...o.records];
    }
    if (o.instances?.length) {
      merged.instances = [...(merged.instances ?? []), ...o.instances];
    }
    if (o.payload != null && merged.payload == null) merged.payload = o.payload;
    if (o.contentType && !merged.contentType) merged.contentType = o.contentType;
    if (o.headers && !merged.headers) merged.headers = { ...o.headers };
    if (o.activeBranch && !merged.activeBranch) merged.activeBranch = o.activeBranch;
    if (o.detectedFormat && !merged.detectedFormat) merged.detectedFormat = o.detectedFormat;
    if (o.validationReport && !merged.validationReport) {
      merged.validationReport = o.validationReport;
    }
    if (o.persistGlance && !merged.persistGlance) merged.persistGlance = o.persistGlance;
  }
  return merged;
}

function filterIncomingEdges(
  incoming: GraphEdge[],
  outputs: Map<string, NodeDataBag>,
  nodes: Map<string, StudioNodeRef>,
): GraphEdge[] {
  return incoming.filter((e) => {
    const src = nodes.get(e.source);
    const out = outputs.get(e.source);
    if (src?.type === "formatDetect" && out?.activeBranch) {
      return (e.sourcePort ?? "unknown") === out.activeBranch;
    }
    return true;
  });
}

/** Compute merged upstream input for a node (mirrors executeGraphSubset). */
export function getUpstreamInput(
  nodeId: string,
  edges: GraphEdge[],
  nodeOutputs: Map<string, NodeDataBag>,
  nodeById: Map<string, StudioNodeRef>,
): NodeDataBag {
  const incoming = edges.filter((e) => e.target === nodeId);
  const filtered = filterIncomingEdges(incoming, nodeOutputs, nodeById);
  return mergeNodeOutputs(filtered.map((e) => nodeOutputs.get(e.source) ?? {}));
}

/** Read a dotted path out of a record. */
export function readPath(rec: Record<string, unknown>, path: string): unknown {
  if (!path.includes(".")) return rec[path];
  let cur: unknown = rec;
  for (const seg of path.split(".")) {
    if (cur && typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

/** Flatten object keys into draggable dot-paths (e.g. address.city). */
export function collectFieldPaths(
  value: unknown,
  prefix = "",
  maxDepth = 4,
): string[] {
  if (maxDepth <= 0 || value == null) return prefix ? [prefix] : [];
  if (Array.isArray(value)) {
    if (value.length === 0) return prefix ? [prefix] : [];
    const first = value[0];
    if (first != null && typeof first === "object" && !Array.isArray(first)) {
      return collectFieldPaths(first, prefix, maxDepth);
    }
    return prefix ? [prefix] : [];
  }
  if (typeof value !== "object") {
    return prefix ? [prefix] : [];
  }
  const paths: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v != null && typeof v === "object" && !Array.isArray(v)) {
      paths.push(...collectFieldPaths(v, p, maxDepth - 1));
    } else {
      paths.push(p);
    }
  }
  return paths;
}

/** Sample record / payload for field-path discovery from upstream input. */
export function sampleRecordFromInput(input: NodeDataBag): Record<string, unknown> | null {
  if (input.records?.[0]) return input.records[0];
  if (input.instances?.[0]?.properties) return input.instances[0].properties;
  if (input.payload != null && typeof input.payload === "object") {
    const p = input.payload;
    if (Array.isArray(p) && p[0] && typeof p[0] === "object") {
      return p[0] as Record<string, unknown>;
    }
    if (!Array.isArray(p)) return p as Record<string, unknown>;
  }
  if (input.text) {
    try {
      const parsed = JSON.parse(input.text);
      if (Array.isArray(parsed) && parsed[0] && typeof parsed[0] === "object") {
        return parsed[0] as Record<string, unknown>;
      }
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* not JSON */
    }
  }
  return null;
}

export function fieldPathsFromInput(input: NodeDataBag): string[] {
  const sample = sampleRecordFromInput(input);
  if (!sample) return [];
  return collectFieldPaths(sample);
}

/** Pick a primary preview object for JSON tree display. */
export function formatNodeDataPreview(output: NodeDataBag): unknown {
  if (output.records?.length) return output.records;
  if (output.instances?.length) return output.instances;
  if (output.results?.length) return output.results;
  if (output.concepts?.length) return output.concepts;
  if (output.contexts?.length) return output.contexts;
  if (output.validationReport) return output.validationReport;
  if (output.payload != null) return output.payload;
  if (output.text) {
    try {
      return JSON.parse(output.text);
    } catch {
      return { text: output.text };
    }
  }
  return output;
}

export function hasNodeData(output: NodeDataBag | null | undefined): boolean {
  if (!output) return false;
  return (
    Boolean(output.text) ||
    output.records != null ||
    output.instances != null ||
    output.results != null ||
    output.concepts != null ||
    output.contexts != null ||
    output.payload != null ||
    output.validationReport != null
  );
}

/** Auto-match ontology property keys to source field paths. */
export function autoMatchFieldMap(
  properties: { key: string }[],
  sourcePaths: string[],
): { property: string; source: string }[] {
  const lowerPaths = sourcePaths.map((p) => ({ p, lower: p.toLowerCase() }));
  return properties.map(({ key }) => {
    const kLower = key.toLowerCase();
    const exact = lowerPaths.find((x) => x.lower === kLower);
    if (exact) return { property: key, source: exact.p };
    const suffix = lowerPaths.find(
      (x) => x.lower.endsWith(`.${kLower}`) || x.lower.endsWith(kLower),
    );
    if (suffix) return { property: key, source: suffix.p };
    const contains = lowerPaths.find(
      (x) => x.lower.includes(kLower) || kLower.includes(x.lower.split(".").pop() ?? ""),
    );
    if (contains) return { property: key, source: contains.p };
    return { property: key, source: "" };
  });
}

export const FIELD_PATH_MIME = "application/x-field-path";
