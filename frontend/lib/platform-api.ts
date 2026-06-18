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

export interface EnvironmentSummary {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

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

export async function listEnvironments(): Promise<{ environments: EnvironmentSummary[] }> {
  return apiFetch("/v1/ontology/environments");
}

export async function createEnvironment(body: {
  name: string;
  slug?: string;
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

export interface ExtractPersistResult {
  destination: "research" | "problem_list";
  results: CombinedExtractResult[];
  persisted?: {
    environment: { id: string; slug: string; name: string };
    objectType: string;
    objectIds: string[];
    linkIds: string[];
    pipelineRunId: string;
  };
}

export async function extractAndPersist(opts: {
  text: string;
  language?: string;
  destination?: "research" | "problem_list";
  persist?: { environment: string; objectType?: string };
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

export type { MeResult };
