/**
 * Signals — the kinetic half of the ontology.
 *
 * The ontology says what things are; this says what happens about them. The
 * domains, the workflows and their stages are configuration, not constants:
 * everything below arrives as data and the board draws whatever it is given.
 */

import { apiFetch } from "@/lib/auth";

export type Severity = "info" | "warn" | "critical";

export interface WorkflowStage {
  id: string;
  workflowId: string;
  seq: number;
  key: string;
  name: string;
  requiresApproval: boolean;
  isTerminal: boolean;
}

export interface Workflow {
  id: string;
  organizationId: string;
  key: string;
  name: string;
  description: string | null;
  stages: WorkflowStage[];
}

export interface SignalType {
  id: string;
  organizationId: string;
  key: string;
  name: string;
  domain: string;
  workflowId: string;
  defaultSeverity: Severity;
  description: string | null;
  active: boolean;
  alertMetric: string | null;
}

export interface Signal {
  id: string;
  projectId: string;
  signalTypeId: string;
  stageId: string;
  subjectKind: string;
  subjectId: string | null;
  title: string;
  detail: string | null;
  severity: Severity;
  properties: Record<string, unknown>;
  scenarioId: string | null;
  originKind: string;
  dedupeKey: string | null;
  closedAt: string | null;
  closedReason: string | null;
  detectedAt: string;
}

/** A signal with the bits the board needs, denormalized by the server. */
export interface BoardSignal extends Signal {
  domain: string;
  signalTypeName: string;
  stageKey: string;
  workflowId: string;
}

export interface SignalEvent {
  id: string;
  signalId: string;
  seq: number;
  kind: string;
  fromStageId: string | null;
  toStageId: string | null;
  actorUserId: string | null;
  note: string | null;
  createdAt: string;
}

export interface CommandBoard {
  domains: { domain: string; open: number; critical: number }[];
  workflows: Workflow[];
  signalTypes: SignalType[];
  signals: BoardSignal[];
}

/**
 * Does an alert on this metric reach anyone?
 *
 * The bridge that turns a twin alert into a signal is an inner join:
 *
 *   JOIN signal_type st ON st.alert_metric = a.metric AND st.active
 *
 * So a rule whose metric no active signal type claims raises an alert that
 * reaches nobody — no error, no log, no row. The rule looks configured, the
 * twin turns red, and the response board stays empty.
 *
 * This is that join's other half, in the client, and the two have to keep
 * agreeing: both conditions are here on purpose, including `active`.
 */
export function signalTypeForMetric(
  signalTypes: readonly SignalType[],
  metricKey: string,
): SignalType | null {
  if (!metricKey) return null;
  return (
    signalTypes.find((st) => st.active && st.alertMetric === metricKey) ?? null
  );
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

export async function getCommandBoard(
  env: string,
  opts?: { includeClosed?: boolean; scenarioId?: string },
): Promise<CommandBoard> {
  const qs = new URLSearchParams();
  if (opts?.includeClosed) qs.set("includeClosed", "true");
  if (opts?.scenarioId) qs.set("scenarioId", opts.scenarioId);
  const q = qs.toString();
  return apiFetch(`/v1/ontology/${enc(env)}/command-board${q ? `?${q}` : ""}`);
}

export async function seedSignalConfig(
  env: string,
): Promise<{ workflows: number; signalTypes: number; note: string }> {
  return apiFetch(`/v1/ontology/${enc(env)}/signal-config/seed`, { method: "POST", body: {} });
}

/**
 * Define a signal type. Naming a domain that does not exist yet creates it —
 * a domain is only ever the string its types agree on.
 */
export async function createSignalType(
  env: string,
  body: {
    key: string;
    name: string;
    domain: string;
    workflowId: string;
    defaultSeverity?: Severity;
    description?: string;
    alertMetric?: string | null;
  },
): Promise<SignalType> {
  return apiFetch(`/v1/ontology/${enc(env)}/signal-types`, { method: "POST", body });
}

export async function renameSignalDomain(
  env: string,
  domain: string,
  name: string,
): Promise<{ domain: string; signalTypes: number }> {
  return apiFetch(`/v1/ontology/${enc(env)}/signal-domains/${enc(domain)}`, {
    method: "PATCH",
    body: { name },
  });
}

export async function getSignalDetail(
  id: string,
): Promise<{ signal: Signal; stages: WorkflowStage[]; events: SignalEvent[] }> {
  return apiFetch(`/v1/signals/${id}`);
}

export async function moveSignal(
  id: string,
  body: { direction: "forward" | "back"; note?: string; reason?: string },
): Promise<Signal> {
  return apiFetch(`/v1/signals/${id}/move`, { method: "POST", body });
}

/** Close as a false positive. The reason is required — that is the record. */
export async function dismissSignal(id: string, reason: string): Promise<Signal> {
  return apiFetch(`/v1/signals/${id}/dismiss`, { method: "POST", body: { reason } });
}

export async function raiseSignal(
  env: string,
  body: {
    signalTypeId: string;
    title: string;
    detail?: string;
    severity?: Severity;
    subjectKind?: string;
    subjectId?: string | null;
  },
): Promise<{ signal: Signal; created: boolean }> {
  return apiFetch(`/v1/ontology/${enc(env)}/signals`, { method: "POST", body });
}
