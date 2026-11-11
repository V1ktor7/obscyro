/** The three calls behind "Add data as a layer". See backend routes/twin-layers.ts. */

import { apiFetch } from "@/lib/auth";

export type LayerRole = "capacity" | "population" | "reading" | "exposure" | "outcome";
export type LayerAggregate = "sum" | "mean" | "max" | "count";

export interface LayerSource {
  file?: string;
  column?: string;
  filter?: string;
  datasetId?: string | null;
  rows?: number;
  loadedAt?: string;
}

export interface LayerDecl {
  role: LayerRole;
  aggregate: LayerAggregate;
  source?: LayerSource;
}

export interface TwinLayer {
  type: string;
  key: string;
  label: string;
  unit: string | null;
  layer: LayerDecl;
  points: [number, number, number][];
  catchments: [string, number][];
  unplaced: number;
}

export interface MatchCandidate {
  column: string;
  target: "site" | "catchment";
  type: string;
  property: string;
  matched: number;
  distinct: number;
  instances: number;
  unmatched: string[];
  unmatchedTruncated: boolean;
  examples: string[];
}

export interface LayerRowOut {
  match?: string | null;
  lat?: number | null;
  lon?: number | null;
  name?: string | null;
  value: number;
}

export interface LayerWriteResult {
  key: string;
  type: string;
  written: number;
  unmatched: string[];
  cleared: number;
  replaced: boolean;
}

const enc = (s: string) => encodeURIComponent(s);

export async function listTwinLayers(env: string): Promise<{ layers: TwinLayer[] }> {
  return apiFetch(`/v1/ontology/${enc(env)}/twin/layers`);
}

export async function matchLayerColumns(
  env: string,
  columns: { name: string; values: string[] }[],
): Promise<{ placeable: number; candidates: MatchCandidate[] }> {
  return apiFetch(`/v1/ontology/${enc(env)}/twin/layers/match`, { method: "POST", body: { columns } });
}

export async function writeTwinLayer(
  env: string,
  body: {
    label: string;
    unit?: string;
    layer: LayerDecl;
    target: { mode: "match"; type: string; property: string } | { mode: "points"; typeName: string };
    rows: LayerRowOut[];
  },
): Promise<LayerWriteResult> {
  return apiFetch(`/v1/ontology/${enc(env)}/twin/layers`, { method: "POST", body });
}
