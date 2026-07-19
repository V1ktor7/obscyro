/**
 * Feed simulator client — streams run server-side (the API process generates
 * and POSTs objects continuously, even with no browser open). This module is
 * the API client plus the template presets and a local preview renderer.
 */

import { apiFetch } from "@/lib/auth";

export type FeedTargetMode = "channel" | "url";
export type FeedTemplateMode = "template" | "dataset";

export interface FeedDataset {
  name: string;
  rows: Record<string, string>[];
}

export interface FeedStreamConfig {
  targetMode: FeedTargetMode;
  channelSlug: string;
  url: string;
  templateMode: FeedTemplateMode;
  templateKind: string;
  template: string;
  datasets: FeedDataset[];
  datasetLoop: boolean;
  ratePerSec: number;
  diurnal: boolean;
  weekendDipPct: number;
  maxCount: number;
  abnormalPct: number;
  malformedPct: number;
  duplicatePct: number;
  poolSize: number;
}

export interface FeedStream {
  id: string;
  name: string;
  status: "running" | "paused";
  config: FeedStreamConfig;
  sentCount: number;
  failedCount: number;
  datasetIndex: number;
  surgeUntil: string | null;
  stallUntil: string | null;
  lastSentAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface FeedSend {
  id: string;
  streamId: string;
  streamName: string;
  payload: unknown;
  statusCode: number | null;
  note: string | null;
  createdAt: string;
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

export async function listFeedStreams(env: string): Promise<{ streams: FeedStream[] }> {
  return apiFetch(`/v1/ontology/${enc(env)}/feed-streams`);
}

export async function createFeedStream(
  env: string,
  body: { name: string; config: FeedStreamConfig },
): Promise<FeedStream> {
  return apiFetch(`/v1/ontology/${enc(env)}/feed-streams`, { method: "POST", body });
}

export async function updateFeedStream(
  env: string,
  id: string,
  body: { name?: string; config?: FeedStreamConfig; status?: "running" | "paused" },
): Promise<FeedStream> {
  return apiFetch(`/v1/ontology/${enc(env)}/feed-streams/${enc(id)}`, { method: "PATCH", body });
}

export async function deleteFeedStream(env: string, id: string): Promise<{ ok: true }> {
  return apiFetch(`/v1/ontology/${enc(env)}/feed-streams/${enc(id)}`, { method: "DELETE" });
}

export async function injectFeedEvent(
  env: string,
  id: string,
  body: { kind: "surge" | "stall"; minutes?: number; factor?: number },
): Promise<FeedStream> {
  return apiFetch(`/v1/ontology/${enc(env)}/feed-streams/${enc(id)}/inject`, {
    method: "POST",
    body,
  });
}

export async function listFeedSends(
  env: string,
  opts?: { streamId?: string; stream?: string; limit?: number },
): Promise<{ sends: FeedSend[] }> {
  const qs = new URLSearchParams();
  if (opts?.streamId) qs.set("streamId", opts.streamId);
  if (opts?.stream?.trim()) qs.set("stream", opts.stream.trim());
  if (opts?.limit) qs.set("limit", String(opts.limit));
  const q = qs.toString();
  return apiFetch(`/v1/ontology/${enc(env)}/feed-sends${q ? `?${q}` : ""}`);
}

// --- template presets --------------------------------------------------------

export const TEMPLATE_LIBRARY: Record<string, { label: string; template: string }> = {
  admission: {
    label: "Admission note",
    template: `{
  "mrn": "{{patient.mrn}}",
  "text": "Patient de {{patient.age}} ans admis pour {{complaint}}. ATCD: {{history}}. {{finding}}.",
  "site": "{{site}}",
  "recorded_at": "{{now}}"
}`,
  },
  lab: {
    label: "Lab result",
    template: `{
  "mrn": "{{patient.mrn}}",
  "test": "{{lab.code}}",
  "value": {{lab.value}},
  "unit": "{{lab.unit}}",
  "site": "{{site}}",
  "collected_at": "{{now}}"
}`,
  },
  shipment: {
    label: "Supply shipment",
    template: `{
  "shipment_id": "SHP-{{seq}}",
  "item": "{{supply.item}}",
  "quantity": {{supply.qty}},
  "from": "Fournisseur central",
  "to": "{{site}}",
  "eta_hours": {{supply.eta}},
  "sent_at": "{{now}}"
}`,
  },
  transfer: {
    label: "Patient transfer",
    template: `{
  "mrn": "{{patient.mrn}}",
  "from_site": "{{site}}",
  "to_site": "{{site2}}",
  "reason": "{{complaint}}",
  "requested_at": "{{now}}"
}`,
  },
  adt: {
    label: "ADT event",
    template: `{
  "mrn": "{{patient.mrn}}",
  "event": "{{adt.event}}",
  "ward": "{{adt.ward}}",
  "site": "{{site}}",
  "at": "{{now}}"
}`,
  },
};

export function defaultStreamConfig(): FeedStreamConfig {
  return {
    targetMode: "channel",
    channelSlug: "",
    url: "",
    templateMode: "template",
    templateKind: "lab",
    template: TEMPLATE_LIBRARY.lab.template,
    datasets: [],
    datasetLoop: true,
    ratePerSec: 1,
    diurnal: true,
    weekendDipPct: 35,
    maxCount: 0,
    abnormalPct: 10,
    malformedPct: 2,
    duplicatePct: 3,
    poolSize: 250,
  };
}

/** Sample values for the local template preview (the server generates the real ones). */
const PREVIEW_VARS: Record<string, string> = {
  "patient.mrn": "48-2210",
  "patient.age": "67",
  "patient.sex": "F",
  "lab.code": "TROPO-I",
  "lab.value": "61.4",
  "lab.unit": "ng/L",
  site: "CHUM",
  site2: "Hôpital Nord",
  now: new Date().toISOString(),
  seq: "42",
  complaint: "douleur thoracique",
  history: "diabète type 2",
  finding: "sus-décalage ST — IDM probable",
  "supply.item": "O2 bottles",
  "supply.qty": "24",
  "supply.eta": "2",
  "adt.event": "admit",
  "adt.ward": "ED",
};

export function previewTemplate(template: string, row?: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    if (key.startsWith("row.") && row) {
      const v = row[key.slice(4)];
      if (v !== undefined) return v;
    }
    return PREVIEW_VARS[key] ?? `{{${key}}}`;
  });
}
