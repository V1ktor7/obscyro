import type { SourceRequest } from "../app/studio/source-schema";
import type {
  SanitizedWebhookConfig,
  WebhookConfig,
  WebhookMethod,
} from "../app/studio/webhook-schema";
import {
  API_BASE,
  apiFetch,
  getStoredKey,
  setSession,
  setStoredKey,
  type MeResult,
} from "./auth";

export interface LoginUser {
  id: string;
  email: string;
  name: string;
  company: string | null;
  useCase: string | null;
  createdAt: string;
}

export interface ApiKeySummary {
  id: string;
  prefix: string;
  name: string;
  plan: "free" | "starter" | "pro" | "enterprise";
  monthlyQuota: number;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface LoginResult {
  user: LoginUser;
  keys: ApiKeySummary[];
}

export async function login(email: string, code: string): Promise<LoginResult> {
  return apiFetch<LoginResult>("/v1/login", {
    method: "POST",
    body: { email, code },
  });
}

export async function mintKey(
  email: string,
  code: string,
  name: string,
): Promise<{ key: { id: string; rawKey: string; prefix: string; name: string } }> {
  return apiFetch("/v1/keys/mint", {
    method: "POST",
    body: { email, code, name },
  });
}

export async function createKey(
  name: string,
): Promise<{ key: { id: string; rawKey: string; prefix: string; name: string } }> {
  return apiFetch("/v1/keys", { method: "POST", body: { name } });
}

export async function listKeys(): Promise<{ keys: ApiKeySummary[] }> {
  return apiFetch("/v1/keys");
}

export async function revokeKey(id: string): Promise<{ ok: true }> {
  return apiFetch(`/v1/keys/${id}`, { method: "DELETE" });
}

/** If localStorage key prefix matches a server key, reuse it; else null. */
export function matchingStoredKey(keys: ApiKeySummary[]): ApiKeySummary | null {
  const stored = getStoredKey();
  if (!stored) return null;
  const prefix = stored.slice(0, 16);
  return keys.find((k) => stored.startsWith(k.prefix) || k.prefix.startsWith(prefix)) ?? null;
}

export function activateKey(rawKey: string): void {
  setStoredKey(rawKey);
  setSession();
}

// --- Extract / translate ---

export interface ConceptCandidate {
  code: string;
  display: string;
  cosine: number;
}

export interface ConceptOut {
  span: string;
  candidates: ConceptCandidate[];
  code: string | null;
  cosine: number;
  margin: number;
  concept_confidence: number;
  status: "resolved" | "flag" | "unresolved";
}

export interface AxisOut {
  value: string;
  confidence: number;
  trigger: string | null;
}

export interface ContextOut {
  code: string | null;
  span: string;
  context: {
    assertion: AxisOut | null;
    subject: AxisOut | null;
    temporality: AxisOut | null;
    certainty: AxisOut | null;
    role: AxisOut | null;
  };
  context_confidence: number;
  readable_note: string;
}

export type PipelineResult = {
  span: string;
  code: string | null;
  display: string;
  assertion: string;
  subject: string;
  certainty: string;
  decision: "accept" | "flag" | "escalate";
  readable_note?: string;
  translation?: string | null;
};

export async function extractConcepts(
  text: string,
  language = "auto",
): Promise<{ concepts: ConceptOut[] }> {
  return apiFetch("/v1/extract/concepts", {
    method: "POST",
    body: { text, language },
  });
}

export async function extractContexts(
  text: string,
  concepts: { span: string; code?: string | null }[],
  language = "auto",
): Promise<{ contexts: ContextOut[] }> {
  return apiFetch("/v1/extract/contexts", {
    method: "POST",
    body: { text, language, concepts },
  });
}

export async function translateCode(
  code: string,
  to: "icd10" | "icdo" | "ctv3" = "icd10",
): Promise<{ translations: { target: string }[] }> {
  return apiFetch("/v1/translate", {
    method: "POST",
    body: { code, from: "snomed", to, reverse: false },
  });
}

export function decide(
  status: string,
  destination: "research" | "problem_list",
  contextConfidence: number,
  assertion: string | null,
  certainty: string | null,
  acceptThreshold = 0.85,
): "accept" | "flag" | "escalate" {
  if (status === "flag" || status === "unresolved") return "escalate";
  if (destination === "problem_list") {
    if (assertion === "negated") return "accept";
    if (assertion === "uncertain" || certainty === "differential") return "escalate";
    if (contextConfidence < acceptThreshold) return "flag";
  }
  if (status === "resolved" && contextConfidence >= acceptThreshold) return "accept";
  if (assertion === "uncertain" || certainty === "differential") return "escalate";
  return "flag";
}

export async function runPipeline(opts: {
  text: string;
  language?: string;
  destination?: "research" | "problem_list";
  acceptThreshold?: number;
  targetSystem?: "icd10" | "icdo" | "ctv3";
}): Promise<PipelineResult[]> {
  const language = opts.language ?? "auto";
  const destination = opts.destination ?? "problem_list";
  const threshold = opts.acceptThreshold ?? 0.85;
  const targetSystem = opts.targetSystem ?? "icd10";

  const { concepts } = await extractConcepts(opts.text, language);
  if (!concepts.length) return [];

  const { contexts } = await extractContexts(
    opts.text,
    concepts.map((c) => ({ span: c.span, code: c.code })),
    language,
  );
  const ctxBySpan = new Map(contexts.map((c) => [c.span, c]));

  const results: PipelineResult[] = [];
  for (const concept of concepts) {
    const ctx = ctxBySpan.get(concept.span);
    const assertion = ctx?.context.assertion?.value ?? "affirmed";
    const subject = ctx?.context.subject?.value ?? "patient";
    const certainty = ctx?.context.certainty?.value ?? "confirmed";
    const contextConfidence = ctx?.context_confidence ?? 0;
    const display =
      concept.candidates[0]?.display ?? concept.span;
    const decision = decide(
      concept.status,
      destination,
      contextConfidence,
      assertion,
      certainty,
      threshold,
    );

    let translation: string | null = null;
    if (concept.code && concept.status === "resolved") {
      try {
        const mapped = await translateCode(concept.code, targetSystem);
        const first = mapped.translations[0] as { target?: string } | undefined;
        translation = first?.target ?? null;
      } catch {
        translation = null;
      }
    }

    results.push({
      span: concept.span,
      code: concept.code,
      display,
      assertion,
      subject,
      certainty,
      decision,
      readable_note: ctx?.readable_note,
      translation,
    });
  }
  return results;
}

// --- Ingest ---

export interface IngestSource {
  id: string;
  name: string;
  type: string;
  method: WebhookMethod;
  webhookUrl: string | null;
  webhookToken: string | null;
  config: SanitizedWebhookConfig;
  createdAt: string;
}

export async function createIngestSource(
  name: string,
  type: "rest" | "webhook",
  opts?: { method?: WebhookMethod; config?: WebhookConfig },
): Promise<{ source: IngestSource }> {
  return apiFetch("/v1/ingest/sources", {
    method: "POST",
    body: { name, type, method: opts?.method, config: opts?.config },
  });
}

export async function updateIngestSource(
  id: string,
  patch: { name?: string; method?: WebhookMethod; config?: WebhookConfig },
): Promise<{ source: IngestSource }> {
  return apiFetch(`/v1/ingest/sources/${id}`, { method: "PATCH", body: patch });
}

export async function testWebhook(
  id: string,
  payload?: unknown,
): Promise<{ eventId: string; receivedAt: string }> {
  return apiFetch(`/v1/ingest/sources/${id}/test`, {
    method: "POST",
    body: { payload },
  });
}

export async function listIngestSources(): Promise<{ sources: IngestSource[] }> {
  return apiFetch("/v1/ingest/sources");
}

export async function listIngestEvents(sourceId?: string): Promise<{
  events: {
    id: string;
    sourceId: string | null;
    payload: unknown;
    contentType: string;
    status: string;
    receivedAt: string;
  }[];
}> {
  const q = sourceId ? `?sourceId=${sourceId}&limit=20` : "?limit=20";
  return apiFetch(`/v1/ingest/events${q}`);
}

export async function ingestPayload(
  payload: unknown,
  sourceId?: string,
): Promise<{ eventId: string; receivedAt: string }> {
  return apiFetch("/v1/ingest", {
    method: "POST",
    body: { payload, sourceId },
  });
}

// --- Source (configurable HTTP request, server-side egress) ---

export type { SourceRequest } from "../app/studio/source-schema";

export interface SourceFetchResult {
  status: number;
  statusText: string;
  ok: boolean;
  headers?: Record<string, string>;
  body: unknown;
  /** Deterministic string-leaf harvest of the body, for downstream NLP. */
  text: string;
  pages: number;
  contentType?: string;
}

export async function runSourceFetch(
  request: SourceRequest,
): Promise<SourceFetchResult> {
  return apiFetch("/v1/source/fetch", { method: "POST", body: request });
}

// --- Ontology ---

export interface ObjectTypeDef {
  id: string;
  name: string;
  description: string | null;
  properties: { key: string; type: string; label?: string }[];
  createdAt: string;
}

export async function listObjectTypes(): Promise<{ types: ObjectTypeDef[] }> {
  return apiFetch("/v1/ontology/types");
}

export async function createObjectType(body: {
  name: string;
  description?: string;
  properties: { key: string; type: string; label?: string }[];
}): Promise<{ id: string }> {
  return apiFetch("/v1/ontology/types", { method: "POST", body });
}

export async function listObjects(typeId?: string): Promise<{
  objects: {
    id: string;
    typeId: string;
    typeName: string;
    properties: Record<string, unknown>;
    sourceEventId: string | null;
    createdAt: string;
    updatedAt: string;
  }[];
}> {
  const q = typeId ? `?typeId=${typeId}&limit=50` : "?limit=50";
  return apiFetch(`/v1/ontology/objects${q}`);
}

export async function createObject(body: {
  typeId: string;
  properties: Record<string, unknown>;
  sourceEventId?: string | null;
}): Promise<{ id: string }> {
  return apiFetch("/v1/ontology/objects", { method: "POST", body });
}

// --- Health (real probe, never hardcoded) ---

export type HealthStatus = "ok" | "degraded" | "offline";

/** Probes the public readiness endpoint. Never throws: offline on any error. */
export async function getHealth(): Promise<HealthStatus> {
  try {
    const res = await fetch(`${API_BASE}/v1/health`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as { status?: string } | null;
      return data?.status === "degraded" ? "degraded" : "ok";
    }
    if (res.status === 503) return "degraded";
    return "offline";
  } catch {
    return "offline";
  }
}

// --- Environment-scoped ontology (migration 010) ---

export type EnvironmentType = "reference" | "entity" | "operations";

export interface EnvironmentSummary {
  id: string;
  name: string;
  slug: string;
  type: EnvironmentType;
  organizationId: string;
  organizationName: string;
  createdAt: string;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "member";
  createdAt: string;
}

export type PropertyType = "string" | "number" | "boolean" | "object" | "array";

export interface PropertyDefinition {
  key: string;
  type: PropertyType;
  label?: string;
}

export type LinkCardinality =
  | "one_to_one"
  | "one_to_many"
  | "many_to_one"
  | "many_to_many";

export interface EnvObjectType {
  id: string;
  name: string;
  description: string | null;
  propertySchema: { key: string; type: string; label?: string }[];
  createdAt: string;
}

export interface EnvLinkType {
  id: string;
  name: string;
  fromType: string;
  toType: string;
  cardinality: string;
}

export interface EnvInstance {
  id: string;
  typeId: string;
  typeName: string;
  properties: Record<string, unknown>;
  provenance: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface EnvLinkEdge {
  id: string;
  linkType: string;
  direction: "out" | "in";
  otherId: string;
  otherType: string;
  otherProperties: Record<string, unknown>;
}

export async function listOrganizations(): Promise<{ organizations: OrganizationSummary[] }> {
  return apiFetch("/v1/ontology/organizations");
}

export async function listEnvironments(): Promise<{ environments: EnvironmentSummary[] }> {
  return apiFetch("/v1/ontology/environments");
}

export async function createEnvironment(body: {
  name: string;
  slug?: string;
  type: EnvironmentType;
}): Promise<EnvironmentSummary> {
  return apiFetch("/v1/ontology/environments", { method: "POST", body });
}

export async function listEnvTypes(
  env: string,
): Promise<{ types: EnvObjectType[]; linkTypes: EnvLinkType[] }> {
  return apiFetch(`/v1/ontology/${encodeURIComponent(env)}/types`);
}

export async function getEnvType(env: string, name: string): Promise<EnvObjectType> {
  return apiFetch(`/v1/ontology/${encodeURIComponent(env)}/types/${encodeURIComponent(name)}`);
}

export async function listEnvObjects(
  env: string,
  opts?: { type?: string; where?: string; limit?: number },
): Promise<{ objects: EnvInstance[] }> {
  const qs = new URLSearchParams();
  if (opts?.type) qs.set("type", opts.type);
  if (opts?.where) qs.set("where", opts.where);
  if (opts?.limit) qs.set("limit", String(opts.limit));
  const q = qs.toString();
  return apiFetch(`/v1/ontology/${encodeURIComponent(env)}/objects${q ? `?${q}` : ""}`);
}

export async function getEnvObject(
  env: string,
  id: string,
): Promise<{ object: EnvInstance; links: EnvLinkEdge[] }> {
  return apiFetch(`/v1/ontology/${encodeURIComponent(env)}/objects/${id}`);
}

export async function createEnvObject(
  env: string,
  body: { type: string; properties: Record<string, unknown>; provenance?: Record<string, unknown> },
): Promise<{ id: string }> {
  return apiFetch(`/v1/ontology/${encodeURIComponent(env)}/objects`, { method: "POST", body });
}

export async function createEnvLink(
  env: string,
  body: {
    linkType: string;
    fromId: string;
    toId: string;
    provenance?: Record<string, unknown>;
  },
): Promise<{ id: string }> {
  return apiFetch(`/v1/ontology/${encodeURIComponent(env)}/links`, { method: "POST", body });
}

// --- Ontology Manager CRUD ---

export async function createEnvType(
  env: string,
  body: { name: string; description?: string; propertySchema?: PropertyDefinition[] },
): Promise<EnvObjectType> {
  return apiFetch(`/v1/ontology/${encodeURIComponent(env)}/types`, { method: "POST", body });
}

export async function updateEnvType(
  env: string,
  name: string,
  body: { description?: string | null; propertySchema?: PropertyDefinition[] },
): Promise<EnvObjectType> {
  return apiFetch(`/v1/ontology/${encodeURIComponent(env)}/types/${encodeURIComponent(name)}`, {
    method: "PATCH",
    body,
  });
}

export async function deleteEnvType(env: string, name: string): Promise<{ ok: true }> {
  return apiFetch(`/v1/ontology/${encodeURIComponent(env)}/types/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

export async function createEnvLinkType(
  env: string,
  body: {
    name: string;
    fromType: string;
    toType: string;
    cardinality?: LinkCardinality;
  },
): Promise<EnvLinkType> {
  return apiFetch(`/v1/ontology/${encodeURIComponent(env)}/link-types`, { method: "POST", body });
}

export async function deleteEnvLinkType(env: string, name: string): Promise<{ ok: true }> {
  return apiFetch(
    `/v1/ontology/${encodeURIComponent(env)}/link-types/${encodeURIComponent(name)}`,
    { method: "DELETE" },
  );
}

export async function updateEnvObject(
  env: string,
  id: string,
  body: { properties: Record<string, unknown> },
): Promise<{ ok: true }> {
  return apiFetch(`/v1/ontology/${encodeURIComponent(env)}/objects/${id}`, {
    method: "PATCH",
    body,
  });
}

export async function deleteEnvObject(env: string, id: string): Promise<{ ok: true }> {
  return apiFetch(`/v1/ontology/${encodeURIComponent(env)}/objects/${id}`, { method: "DELETE" });
}

export async function deleteEnvLink(env: string, id: string): Promise<{ ok: true }> {
  return apiFetch(`/v1/ontology/${encodeURIComponent(env)}/links/${id}`, { method: "DELETE" });
}

// --- Combined extract (+ optional persist into an environment) ---

export interface CombinedExtractResult {
  span: string;
  candidates: ConceptCandidate[];
  code: string | null;
  cosine: number;
  margin: number;
  concept_confidence: number;
  status: "resolved" | "flag" | "unresolved";
  context: ContextOut["context"];
  context_confidence: number;
  readable_note: string;
  decision: "accept" | "flag" | "escalate";
}

export interface PersistedSummary {
  environment: { id: string; slug: string; name: string };
  objectType: string;
  objectIds: string[];
  linkIds: string[];
  pipelineRunId: string;
  patient: { id: string; identifier: string; created: boolean } | null;
  linked: boolean;
  reason?: "no_patient_identifier";
}

export interface ExtractPersistResult {
  destination: "research" | "problem_list";
  results: CombinedExtractResult[];
  persisted?: PersistedSummary;
}

export async function extractAndPersist(opts: {
  text: string;
  language?: string;
  destination?: "research" | "problem_list";
  persist?: {
    environment: string;
    objectType?: string;
    patient?: { identifier?: string };
  };
}): Promise<ExtractPersistResult> {
  return apiFetch("/v1/extract", {
    method: "POST",
    body: {
      text: opts.text,
      language: opts.language ?? "auto",
      destination: opts.destination ?? "research",
      ...(opts.persist ? { persist: opts.persist } : {}),
    },
  });
}

/** SHA-256 hex digest (browser-safe). */
export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Map graph pipeline results + upstream concept/context rows to combined extract shape. */
export function pipelineResultsToCombined(
  results: PipelineResult[],
  contexts: ContextOut[],
  concepts: ConceptOut[],
): CombinedExtractResult[] {
  const ctxBySpan = new Map(contexts.map((c) => [c.span, c]));
  const conceptBySpan = new Map(concepts.map((c) => [c.span, c]));
  return results.map((r) => {
    const ctx = ctxBySpan.get(r.span);
    const concept = conceptBySpan.get(r.span);
    const candidates = concept?.candidates ?? [
      { code: r.code ?? "", display: r.display, cosine: 0 },
    ];
    return {
      span: r.span,
      candidates,
      code: r.code,
      cosine: concept?.cosine ?? 0,
      margin: concept?.margin ?? 0,
      concept_confidence: concept?.concept_confidence ?? 0,
      status: concept?.status ?? "resolved",
      context: ctx?.context ?? {
        assertion: { value: r.assertion, confidence: 0.9, trigger: null },
        subject: { value: r.subject, confidence: 0.9, trigger: null },
        temporality: null,
        certainty: { value: r.certainty, confidence: 0.9, trigger: null },
        role: null,
      },
      context_confidence: ctx?.context_confidence ?? 0,
      readable_note: r.readable_note ?? ctx?.readable_note ?? r.display,
      decision: r.decision,
    };
  });
}

/** Persist graph/decision results without re-running NLP. */
export async function persistGraphResults(opts: {
  inputHash: string;
  results: CombinedExtractResult[];
  persist: {
    environment: string;
    objectType?: string;
    patient?: { identifier?: string };
  };
}): Promise<{ persisted: PersistedSummary }> {
  return apiFetch("/v1/extract/persist", {
    method: "POST",
    body: {
      inputHash: opts.inputHash,
      results: opts.results,
      persist: {
        objectType: opts.persist.objectType ?? "ClinicalFinding",
        environment: opts.persist.environment,
        ...(opts.persist.patient ? { patient: opts.persist.patient } : {}),
      },
    },
  });
}

// --- Digital twin (live + clone simulation) ---

export type TwinAlertSeverity = "info" | "warn" | "critical";

export interface TwinUnitMetrics {
  unitId: string;
  instanceCountByType: Record<string, number>;
  occupancyPct: number | null;
  numericMeans: Record<string, number>;
  freshnessSeconds: number | null;
  linkedInstanceCount: number;
}

export interface TwinUnitNode {
  id: string;
  name: string;
  kind: string;
  code: string;
  parentId: string | null;
  metrics: TwinUnitMetrics;
  worstAlertSeverity: TwinAlertSeverity | null;
  openAlertCount: number;
}

export interface TwinTreeEdge {
  fromId: string;
  toId: string;
}

export interface TwinTreeSnapshot {
  computedAt: string;
  nodes: TwinUnitNode[];
  edges: TwinTreeEdge[];
  roots: string[];
}

export interface TwinAlert {
  id: string;
  environmentId?: string;
  unitInstanceId: string;
  ruleId: string | null;
  severity: TwinAlertSeverity;
  metric: string;
  value: number;
  message: string;
  recommendation: string;
  status: "open" | "ack";
  createdAt?: string;
  ackedAt?: string | null;
}

export interface TwinUnitDetail {
  metrics: TwinUnitMetrics;
  alerts: TwinAlert[];
  recommendations: string[];
}

export interface OutbreakParams {
  beta?: number;
  r0?: number;
  incubationDays?: number;
  infectiousDays?: number;
  indexNodeIds?: string[];
  isolationCapacity?: number;
  runs?: number;
  horizonDays?: number;
  containThreshold?: number;
}

export interface DailyTrajectory {
  day: number;
  S: number;
  E: number;
  I: number;
  R: number;
  isolationDemand: number;
}

export interface OutbreakSummary {
  peakInfected: number;
  peakIsolationDemand: number;
  attackRate: number;
  daysToContain: number | null;
  hcwInfections: number;
}

export interface AlertTimelineEvent {
  day: number;
  unitInstanceId: string;
  ruleId: string | null;
  metric: string;
  value: number;
  severity: TwinAlertSeverity;
  message: string;
}

export interface CloneResult {
  scenarioId: string;
  instanceCount: number;
  linkCount: number;
}

export interface ScenarioSummary {
  id: string;
  name: string;
  rootUnitInstanceId: string | null;
  createdAt: string;
}

export interface ScenarioRunSummary {
  id: string;
  status: string;
  seed: string;
  runs: number;
  createdAt: string;
  finishedAt: string | null;
}

export interface ScenarioDetail {
  id: string;
  environmentId: string;
  name: string;
  params: Record<string, unknown>;
  rootUnitInstanceId: string | null;
  instanceCount: number;
  linkCount: number;
  createdAt: string;
  runs: ScenarioRunSummary[];
}

export interface RunResult {
  runId: string;
  summary: OutbreakSummary;
  trajectories: {
    p5: DailyTrajectory[];
    p50: DailyTrajectory[];
    p95: DailyTrajectory[];
  };
  alertTimeline: AlertTimelineEvent[];
}

export interface RunDetail {
  id: string;
  status: string;
  seed: string;
  params: Record<string, unknown>;
  runs: number;
  summary: OutbreakSummary | null;
  trajectories: RunResult["trajectories"] | null;
  alertTimeline: AlertTimelineEvent[] | null;
  createdAt: string;
  finishedAt: string | null;
}

function encEnv(env: string): string {
  return encodeURIComponent(env);
}

export async function fetchTwinTree(env: string): Promise<TwinTreeSnapshot> {
  return apiFetch(`/v1/ontology/${encEnv(env)}/twin/tree`);
}

export async function fetchTwinUnit(
  env: string,
  unitId: string,
): Promise<TwinUnitDetail> {
  return apiFetch(`/v1/ontology/${encEnv(env)}/twin/units/${unitId}`);
}

export async function ackTwinAlert(
  env: string,
  alertId: string,
): Promise<{ ok: true }> {
  return apiFetch(`/v1/ontology/${encEnv(env)}/twin/alerts/${alertId}`, {
    method: "PATCH",
    body: { status: "ack" },
  });
}

export async function seedTwinDemo(
  env: string,
): Promise<{ unitCount: number; instanceCount: number }> {
  return apiFetch(`/v1/ontology/${encEnv(env)}/twin/seed-demo`, {
    method: "POST",
    body: {},
  });
}

export async function cloneTwinUnit(
  env: string,
  unitId: string,
  name: string,
): Promise<CloneResult> {
  return apiFetch(`/v1/ontology/${encEnv(env)}/twin/units/${unitId}/clone`, {
    method: "POST",
    body: { name },
  });
}

export async function listScenarios(
  env: string,
): Promise<{ scenarios: ScenarioSummary[] }> {
  return apiFetch(`/v1/ontology/${encEnv(env)}/scenarios`);
}

export async function getScenario(
  env: string,
  scenarioId: string,
): Promise<ScenarioDetail> {
  return apiFetch(`/v1/ontology/${encEnv(env)}/scenarios/${scenarioId}`);
}

export async function injectScenario(
  env: string,
  scenarioId: string,
  body: {
    instances?: Array<{
      objectTypeName: string;
      properties: Record<string, unknown>;
      sourceInstanceId?: string | null;
    }>;
    paramOverrides?: Record<string, unknown>;
  },
): Promise<{ instanceIds: string[] }> {
  return apiFetch(`/v1/ontology/${encEnv(env)}/scenarios/${scenarioId}/inject`, {
    method: "POST",
    body,
  });
}

export async function runScenario(
  env: string,
  scenarioId: string,
  body?: { params?: OutbreakParams; runs?: number; seed?: number },
): Promise<RunResult> {
  return apiFetch(`/v1/ontology/${encEnv(env)}/scenarios/${scenarioId}/run`, {
    method: "POST",
    body: body ?? {},
  });
}

export async function getScenarioRun(
  env: string,
  scenarioId: string,
  runId: string,
): Promise<RunDetail> {
  return apiFetch(
    `/v1/ontology/${encEnv(env)}/scenarios/${scenarioId}/runs/${runId}`,
  );
}

/** Parse SSE buffer into JSON payloads from `data:` lines. */
export function parseSseJsonEvents<T>(buffer: string): {
  events: T[];
  remainder: string;
} {
  const events: T[] = [];
  const parts = buffer.split("\n\n");
  const remainder = parts.pop() ?? "";

  for (const part of parts) {
    for (const line of part.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        events.push(JSON.parse(payload) as T);
      } catch {
        /* ignore malformed */
      }
    }
  }

  return { events, remainder };
}

export function subscribeTwinStream(
  env: string,
  onData: (snapshot: TwinTreeSnapshot) => void,
  onError: () => void,
): () => void {
  const controller = new AbortController();
  const token = getStoredKey();
  const url = `${API_BASE}/v1/ontology/${encEnv(env)}/twin/stream`;

  void (async () => {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "text/event-stream",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        onError();
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, remainder } = parseSseJsonEvents<TwinTreeSnapshot>(buffer);
        buffer = remainder;
        for (const evt of events) onData(evt);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") onError();
    }
  })();

  return () => controller.abort();
}

export type { MeResult };
