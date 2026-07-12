/**
 * Data channels — saved linear parse pipelines.
 *
 * CRUD talks to /v1/ontology/:env/channels. `executeChannel` runs a channel's
 * enabled steps in order against the existing extract/persist endpoints (the
 * same calls the graph editor nodes make), then records the run server-side.
 */

import { apiFetch } from "@/lib/auth";
import {
  decide,
  extractConcepts,
  extractContexts,
  persistGraphResults,
  pipelineResultsToCombined,
  sha256Hex,
  translateCode,
  type ContextOut,
  type PersistedSummary,
  type PipelineResult,
} from "@/lib/platform-api";
import { readPath } from "./studio-data";

export type ChannelStepType = "intake" | "transform" | "extract" | "validate" | "save";
export type ChannelStatus = "draft" | "live" | "paused";
export type ChannelRunStatus = "succeeded" | "flagged" | "failed";

export interface ChannelStep {
  id: string;
  type: ChannelStepType;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface ChannelStats {
  runsToday: number;
  avgDurationMs: number | null;
  savedToday: number;
  flaggedToday: number;
}

export interface DataChannel {
  id: string;
  name: string;
  slug: string;
  status: ChannelStatus;
  steps: ChannelStep[];
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  stats: ChannelStats;
}

export interface ChannelRun {
  id: string;
  status: ChannelRunStatus;
  trigger: "manual" | "webhook" | "source";
  inputChars: number | null;
  conceptCount: number;
  savedCount: number;
  flaggedCount: number;
  durationMs: number | null;
  stepTimings: Record<string, unknown>;
  error: string | null;
  createdAt: string;
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

export async function listChannels(env: string): Promise<{ channels: DataChannel[] }> {
  return apiFetch(`/v1/ontology/${enc(env)}/channels`);
}

export async function createChannel(
  env: string,
  body: { name: string; steps?: ChannelStep[] },
): Promise<DataChannel> {
  return apiFetch(`/v1/ontology/${enc(env)}/channels`, { method: "POST", body });
}

export async function updateChannel(
  env: string,
  slug: string,
  body: { name?: string; status?: ChannelStatus; steps?: ChannelStep[] },
): Promise<DataChannel> {
  return apiFetch(`/v1/ontology/${enc(env)}/channels/${enc(slug)}`, {
    method: "PATCH",
    body,
  });
}

export async function deleteChannel(env: string, slug: string): Promise<{ ok: true }> {
  return apiFetch(`/v1/ontology/${enc(env)}/channels/${enc(slug)}`, { method: "DELETE" });
}

export async function listChannelRuns(
  env: string,
  slug: string,
  limit = 20,
): Promise<{ runs: ChannelRun[] }> {
  return apiFetch(`/v1/ontology/${enc(env)}/channels/${enc(slug)}/runs?limit=${limit}`);
}

export async function recordChannelRun(
  env: string,
  slug: string,
  body: {
    status: ChannelRunStatus;
    trigger?: "manual" | "webhook" | "source";
    inputChars?: number | null;
    conceptCount?: number;
    savedCount?: number;
    flaggedCount?: number;
    durationMs?: number | null;
    stepTimings?: Record<string, number>;
    error?: string | null;
  },
): Promise<ChannelRun> {
  return apiFetch(`/v1/ontology/${enc(env)}/channels/${enc(slug)}/runs`, {
    method: "POST",
    body,
  });
}

// ---------------------------------------------------------------------------
// Step catalog metadata (labels + fresh default configs for the editor)
// ---------------------------------------------------------------------------

export const STEP_LABELS: Record<ChannelStepType, string> = {
  intake: "Intake",
  transform: "Transform",
  extract: "Extract + map to SNOMED",
  validate: "Validate",
  save: "Save to ontology",
};

export function newStep(type: ChannelStepType): ChannelStep {
  const id = `${type}-${Math.random().toString(36).slice(2, 8)}`;
  switch (type) {
    case "intake":
      return { id, type, enabled: true, config: { mode: "paste", ref: "" } };
    case "transform":
      return { id, type, enabled: true, config: { language: "auto", fieldPath: "" } };
    case "extract":
      return {
        id,
        type,
        enabled: true,
        config: { acceptThreshold: 0.85, translate: false, targetSystem: "icd10" },
      };
    case "validate":
      return { id, type, enabled: true, config: { minConfidence: 0.6, skipDuplicates: true } };
    case "save":
      return {
        id,
        type,
        enabled: true,
        config: { objectType: "ClinicalFinding", patientIdentifierSource: "" },
      };
  }
}

/** One-line config summary shown on a collapsed step card. */
export function stepSummary(step: ChannelStep): string {
  const c = step.config;
  switch (step.type) {
    case "intake": {
      const mode = (c.mode as string) || "paste";
      const ref = (c.ref as string) || "";
      return mode === "paste" ? "manual text input" : `${mode}${ref ? ` · ${ref}` : ""}`;
    }
    case "transform": {
      const lang = (c.language as string) || "auto";
      const path = (c.fieldPath as string) || "";
      return `language: ${lang}${path ? ` · field: ${path}` : " · raw text"}`;
    }
    case "extract": {
      const th = Number(c.acceptThreshold ?? 0.85);
      const tr = c.translate ? ` · translate → ${(c.targetSystem as string) || "icd10"}` : "";
      return `threshold ${th}${tr} · contexts: assertion, subject, certainty`;
    }
    case "validate": {
      const min = Number(c.minConfidence ?? 0.6);
      const dup = c.skipDuplicates ? " · duplicates → skip" : "";
      return `below ${min} → review${dup}`;
    }
    case "save": {
      const type = (c.objectType as string) || "ClinicalFinding";
      const pid = (c.patientIdentifierSource as string) || "";
      return `${type}${pid ? ` · link patient by ${pid}` : ""}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Channel runner
// ---------------------------------------------------------------------------

export interface ChannelResultRow {
  span: string;
  code: string | null;
  display: string;
  confidence: number;
  assertion: string;
  subject: string;
  decision: "accept" | "flag" | "escalate" | "duplicate";
  translation: string | null;
}

export interface ChannelRunOutcome {
  rows: ChannelResultRow[];
  acceptedCount: number;
  flaggedCount: number;
  persisted: PersistedSummary | null;
  timings: Record<string, number>;
  durationMs: number;
  status: ChannelRunStatus;
  error: string | null;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * Execute a channel's enabled steps in order over `inputText`, then record the
 * run. Extraction failures record a failed run and rethrow; a missing/disabled
 * extract step is an error since nothing downstream can operate.
 */
export async function executeChannel(
  env: string,
  channel: DataChannel,
  inputText: string,
  onStage?: (stage: ChannelStepType | "done") => void,
): Promise<ChannelRunOutcome> {
  const enabled = channel.steps.filter((s) => s.enabled);
  const step = (type: ChannelStepType) => enabled.find((s) => s.type === type);
  const timings: Record<string, number> = {};
  const t0 = now();

  const finishFailed = async (message: string) => {
    await recordChannelRun(env, channel.slug, {
      status: "failed",
      inputChars: inputText.length,
      durationMs: Math.round(now() - t0),
      stepTimings: timings,
      error: message,
    }).catch(() => undefined);
  };

  try {
    // --- transform ---------------------------------------------------------
    let text = inputText;
    let language = "auto";
    const transform = step("transform");
    if (transform) {
      onStage?.("transform");
      const t = now();
      language = (transform.config.language as string) || "auto";
      const fieldPath = ((transform.config.fieldPath as string) || "").trim();
      if (fieldPath) {
        try {
          const parsed: unknown = JSON.parse(text);
          if (parsed && typeof parsed === "object") {
            const v = readPath(parsed as Record<string, unknown>, fieldPath);
            if (typeof v === "string" && v.trim()) text = v;
          }
        } catch {
          /* input is not JSON — keep raw text */
        }
      }
      text = text.trim();
      timings.transform = Math.round(now() - t);
    }
    if (!text) throw new Error("Input is empty after the transform step.");

    // --- extract + map ------------------------------------------------------
    const extract = step("extract");
    if (!extract) throw new Error("Channel has no enabled extract step.");
    onStage?.("extract");
    const tExtract = now();
    const threshold = Number(extract.config.acceptThreshold ?? 0.85);
    const translate = Boolean(extract.config.translate);
    const targetSystem = ((extract.config.targetSystem as string) || "icd10") as
      | "icd10"
      | "icdo"
      | "ctv3";

    const { concepts } = await extractConcepts(text, language);
    let contexts: ContextOut[] = [];
    if (concepts.length > 0) {
      contexts = (
        await extractContexts(
          text,
          concepts.map((c) => ({ span: c.span, code: c.code })),
          language,
        )
      ).contexts;
    }
    const ctxBySpan = new Map(contexts.map((c) => [c.span, c]));

    const results: PipelineResult[] = [];
    for (const concept of concepts) {
      const ctx = ctxBySpan.get(concept.span);
      const assertion = ctx?.context.assertion?.value ?? "affirmed";
      const subject = ctx?.context.subject?.value ?? "patient";
      const certainty = ctx?.context.certainty?.value ?? "confirmed";
      const contextConfidence = ctx?.context_confidence ?? 0;
      const decision = decide(
        concept.status,
        "problem_list",
        contextConfidence,
        assertion,
        certainty,
        threshold,
      );
      let translation: string | null = null;
      if (translate && concept.code && concept.status === "resolved") {
        try {
          const mapped = await translateCode(concept.code, targetSystem);
          translation = (mapped.translations[0] as { target?: string } | undefined)?.target ?? null;
        } catch {
          translation = null;
        }
      }
      results.push({
        span: concept.span,
        code: concept.code,
        display: concept.candidates[0]?.display ?? concept.span,
        assertion,
        subject,
        certainty,
        decision,
        readable_note: ctx?.readable_note,
        translation,
      });
    }
    timings.extract = Math.round(now() - tExtract);

    // --- validate ------------------------------------------------------------
    const validate = step("validate");
    const conceptBySpan = new Map(concepts.map((c) => [c.span, c]));
    let rows: ChannelResultRow[] = results.map((r) => ({
      span: r.span,
      code: r.code,
      display: r.display,
      confidence: conceptBySpan.get(r.span)?.concept_confidence ?? 0,
      assertion: r.assertion,
      subject: r.subject,
      decision: r.decision,
      translation: r.translation ?? null,
    }));
    if (validate) {
      onStage?.("validate");
      const t = now();
      const minConfidence = Number(validate.config.minConfidence ?? 0);
      const skipDuplicates = Boolean(validate.config.skipDuplicates);
      const seen = new Set<string>();
      rows = rows.map((r) => {
        if (r.decision === "accept" && r.confidence < minConfidence) {
          return { ...r, decision: "flag" as const };
        }
        if (skipDuplicates && r.decision === "accept") {
          const key = `${r.code ?? r.span}|${r.assertion}`;
          if (seen.has(key)) return { ...r, decision: "duplicate" as const };
          seen.add(key);
        }
        return r;
      });
      timings.validate = Math.round(now() - t);
    }

    const acceptedSpans = new Set(
      rows.filter((r) => r.decision === "accept").map((r) => r.span),
    );
    const flaggedCount = rows.filter(
      (r) => r.decision === "flag" || r.decision === "escalate",
    ).length;

    // --- save ---------------------------------------------------------------
    const save = step("save");
    let persisted: PersistedSummary | null = null;
    if (save && acceptedSpans.size > 0) {
      onStage?.("save");
      const t = now();
      const objectType = ((save.config.objectType as string) || "ClinicalFinding").trim();
      const pidSource = ((save.config.patientIdentifierSource as string) || "").trim();
      let identifier: string | undefined;
      if (pidSource) {
        try {
          const parsed: unknown = JSON.parse(inputText);
          if (parsed && typeof parsed === "object") {
            const v = readPath(parsed as Record<string, unknown>, pidSource);
            if (typeof v === "string" || typeof v === "number") identifier = String(v);
          }
        } catch {
          /* not JSON — no patient link */
        }
      }
      const acceptedResults = results.filter((r) => acceptedSpans.has(r.span));
      const combined = pipelineResultsToCombined(acceptedResults, contexts, concepts);
      const { persisted: summary } = await persistGraphResults({
        inputHash: await sha256Hex(text),
        results: combined,
        persist: {
          environment: env,
          objectType,
          ...(identifier ? { patient: { identifier } } : {}),
        },
      });
      persisted = summary;
      timings.save = Math.round(now() - t);
    }

    const durationMs = Math.round(now() - t0);
    const status: ChannelRunStatus = flaggedCount > 0 ? "flagged" : "succeeded";
    await recordChannelRun(env, channel.slug, {
      status,
      inputChars: inputText.length,
      conceptCount: rows.length,
      savedCount: persisted ? persisted.objectIds.length : 0,
      flaggedCount,
      durationMs,
      stepTimings: timings,
    }).catch(() => undefined);
    onStage?.("done");

    return {
      rows,
      acceptedCount: acceptedSpans.size,
      flaggedCount,
      persisted,
      timings,
      durationMs,
      status,
      error: null,
    };
  } catch (err) {
    const message = (err as Error).message;
    await finishFailed(message);
    throw err;
  }
}
