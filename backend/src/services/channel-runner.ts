import { createHash } from "node:crypto";

import type { DbClient } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { proxyToNlp } from "../lib/nlp.js";
import {
  CLINICAL_FINDING_SCHEMA,
  PATIENT_SCHEMA,
  getOrCreateLinkType,
  getOrCreateObjectType,
} from "./ontology.js";
import {
  persistExtractResults,
  type PersistableExtractResult,
} from "./persist-extract.js";

// ---------------------------------------------------------------------------
// Server-side data-channel executor.
//
// Port of the client runner in frontend/app/studio/channels-api.ts so that
// webhook-fed channels run 24/7 without a browser. Steps: transform (JSON
// field extraction) → extract (NLP concepts + contexts) → validate
// (min-confidence, duplicates) → save (persistExtractResults). Translation is
// display-only in the client runner and is skipped here — it never persists.
// Execution is driven by the durable job queue in channel-jobs.ts.
// ---------------------------------------------------------------------------

export interface ChannelStepRow {
  id: string;
  type: "intake" | "transform" | "extract" | "validate" | "save";
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface RunnableChannel {
  id: string;
  environmentId: string;
  status: "draft" | "live" | "paused";
  steps: ChannelStepRow[];
}

interface NlpConcept {
  span: string;
  candidates: Array<{ code: string; display: string; cosine: number }>;
  code: string | null;
  cosine: number;
  margin: number;
  concept_confidence: number;
  status: "resolved" | "flag" | "unresolved";
}

interface NlpContextAxis {
  value: string;
  confidence: number;
  trigger?: string | null;
}

interface NlpContext {
  code: string | null;
  span: string;
  context: {
    assertion: NlpContextAxis | null;
    subject: NlpContextAxis | null;
    temporality: NlpContextAxis | null;
    certainty: NlpContextAxis | null;
    role: NlpContextAxis | null;
  };
  context_confidence: number;
  readable_note: string;
}

/** Same policy as the client `decide()` in frontend/lib/platform-api.ts. */
export function decide(
  status: string,
  contextConfidence: number,
  assertion: string | null,
  certainty: string | null,
  acceptThreshold: number,
): "accept" | "flag" | "escalate" {
  if (status === "flag" || status === "unresolved") return "escalate";
  if (assertion === "negated") return "accept";
  if (assertion === "uncertain" || certainty === "differential") return "escalate";
  if (contextConfidence < acceptThreshold) return "flag";
  if (status === "resolved" && contextConfidence >= acceptThreshold) return "accept";
  return "flag";
}

/** Dot-path read, matching the client `readPath` in studio-data.ts. */
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

/**
 * Derive the input text for a channel run from a webhook/REST payload.
 * A string payload is used as-is; objects are JSON-stringified so the
 * transform step's `fieldPath` can extract from them (client parity). When
 * no fieldPath is configured, a top-level string `text` or `raw` property
 * is used as a pragmatic default.
 */
export function payloadToInputText(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (payload == null) return "";
  return JSON.stringify(payload);
}

export interface ChannelRunOutcome {
  status: "succeeded" | "flagged" | "failed";
  conceptCount: number;
  savedCount: number;
  flaggedCount: number;
  error: string | null;
  /** AppError code when available (e.g. NLP_UNAVAILABLE) — lets the job worker classify retryable failures. */
  errorCode: string | null;
  durationMs: number;
  stepTimings: Record<string, number>;
}

/** Failure codes worth retrying: the input is fine, a dependency was down. */
const RETRYABLE_ERROR_CODES = new Set(["NLP_UNAVAILABLE", "NLP_UPSTREAM_ERROR"]);

export function isRetryableOutcome(outcome: ChannelRunOutcome): boolean {
  return (
    outcome.status === "failed" &&
    outcome.errorCode !== null &&
    RETRYABLE_ERROR_CODES.has(outcome.errorCode)
  );
}

/** Persist a run's final outcome into the channel run history. Never throws. */
export async function recordChannelRun(
  db: DbClient,
  channelId: string,
  trigger: "webhook" | "source",
  inputChars: number,
  outcome: ChannelRunOutcome,
): Promise<void> {
  await db
    .query(
      `INSERT INTO app.data_channel_run
              (channel_id, status, run_trigger, input_chars, concept_count,
               saved_count, flagged_count, duration_ms, step_timings, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
      [
        channelId,
        outcome.status,
        trigger,
        inputChars,
        outcome.conceptCount,
        outcome.savedCount,
        outcome.flaggedCount,
        outcome.durationMs,
        JSON.stringify(outcome.stepTimings),
        outcome.error,
      ],
    )
    .catch(() => undefined);
}

/**
 * Execute a channel's enabled steps over `inputText` WITHOUT recording the
 * run. Never throws — failures are returned as failed outcomes. The job
 * worker records only final outcomes so retried attempts don't pollute the
 * run history.
 */
export async function executeChannel(
  db: DbClient,
  channel: RunnableChannel,
  inputText: string,
): Promise<ChannelRunOutcome> {
  const t0 = Date.now();
  const timings: Record<string, number> = {};

  const outcome = (
    partial: Omit<ChannelRunOutcome, "durationMs" | "stepTimings" | "errorCode"> & {
      errorCode?: string | null;
    },
  ): ChannelRunOutcome => ({
    ...partial,
    errorCode: partial.errorCode ?? null,
    durationMs: Date.now() - t0,
    stepTimings: timings,
  });

  try {
    const enabled = channel.steps.filter((s) => s.enabled);
    const step = (type: ChannelStepRow["type"]) => enabled.find((s) => s.type === type);

    // --- transform ----------------------------------------------------------
    let text = inputText;
    let language = "auto";
    const transform = step("transform");
    const fieldPath = ((transform?.config.fieldPath as string) || "").trim();
    if (transform) {
      const t = Date.now();
      language = (transform.config.language as string) || "auto";
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
      timings.transform = Date.now() - t;
    }
    if (!fieldPath) {
      // No explicit path — accept common `{ "text": ... }` / `{ "raw": ... }` payloads.
      try {
        const parsed: unknown = JSON.parse(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const obj = parsed as Record<string, unknown>;
          const v = obj.text ?? obj.raw;
          if (typeof v === "string" && v.trim()) text = v;
        }
      } catch {
        /* plain text payload */
      }
    }
    text = text.trim();
    if (!text) {
      return outcome({
        status: "failed",
        conceptCount: 0,
        savedCount: 0,
        flaggedCount: 0,
        error: "Input is empty after the transform step.",
        errorCode: "EMPTY_INPUT",
      });
    }

    // --- extract --------------------------------------------------------------
    const extract = step("extract");
    if (!extract) {
      return outcome({
        status: "failed",
        conceptCount: 0,
        savedCount: 0,
        flaggedCount: 0,
        error: "Channel has no enabled extract step.",
        errorCode: "NO_EXTRACT_STEP",
      });
    }
    const tExtract = Date.now();
    const threshold = Number(extract.config.acceptThreshold ?? 0.85);

    const { concepts } = await proxyToNlp<{ concepts: NlpConcept[] }>(
      "/extract/concepts",
      { text, language },
    );
    let contexts: NlpContext[] = [];
    if (concepts.length > 0) {
      contexts = (
        await proxyToNlp<{ contexts: NlpContext[] }>("/extract/contexts", {
          text,
          language,
          concepts: concepts.map((c) => ({ span: c.span, code: c.code })),
        })
      ).contexts;
    }
    timings.extract = Date.now() - tExtract;

    const ctxBySpan = new Map(contexts.map((c) => [c.span, c]));
    const emptyContext = {
      assertion: null,
      subject: null,
      temporality: null,
      certainty: null,
      role: null,
    };

    let results: PersistableExtractResult[] = concepts.map((concept) => {
      const ctx = ctxBySpan.get(concept.span);
      const assertion = ctx?.context.assertion?.value ?? "affirmed";
      const certainty = ctx?.context.certainty?.value ?? "confirmed";
      const contextConfidence = ctx?.context_confidence ?? 0;
      return {
        span: concept.span,
        code: concept.code,
        candidates: concept.candidates,
        context: ctx?.context ?? emptyContext,
        context_confidence: contextConfidence,
        readable_note: ctx?.readable_note ?? "",
        decision: decide(concept.status, contextConfidence, assertion, certainty, threshold),
        concept_confidence: concept.concept_confidence,
      };
    });

    // --- validate ---------------------------------------------------------------
    const validate = step("validate");
    let duplicateCount = 0;
    if (validate) {
      const t = Date.now();
      const minConfidence = Number(validate.config.minConfidence ?? 0);
      const skipDuplicates = Boolean(validate.config.skipDuplicates);
      const seen = new Set<string>();
      results = results
        .map((r) => {
          if (r.decision === "accept" && r.concept_confidence < minConfidence) {
            return { ...r, decision: "flag" as const };
          }
          return r;
        })
        .filter((r) => {
          if (!skipDuplicates || r.decision !== "accept") return true;
          const key = `${r.code ?? r.span}|${r.context.assertion?.value ?? "affirmed"}`;
          if (seen.has(key)) {
            duplicateCount += 1;
            return false;
          }
          seen.add(key);
          return true;
        });
      timings.validate = Date.now() - t;
    }

    const accepted = results.filter((r) => r.decision === "accept");
    const flaggedCount = results.filter(
      (r) => r.decision === "flag" || r.decision === "escalate",
    ).length;

    // --- save --------------------------------------------------------------------
    const save = step("save");
    let savedCount = 0;
    if (save && accepted.length > 0) {
      const t = Date.now();
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

      const envRes = await db.query<{ id: string; slug: string; name: string }>(
        `SELECT id, slug, name FROM app.ontology_environments WHERE id = $1`,
        [channel.environmentId],
      );
      const env = envRes.rows[0];
      if (!env) {
        return outcome({
          status: "failed",
          conceptCount: results.length + duplicateCount,
          savedCount: 0,
          flaggedCount,
          error: "Channel environment not found.",
          errorCode: "ENVIRONMENT_NOT_FOUND",
        });
      }

      const findingTypeId = await getOrCreateObjectType(
        db,
        env.id,
        objectType,
        "Clinical finding extracted from text with its context envelope",
        CLINICAL_FINDING_SCHEMA,
      );
      const patientTypeId = await getOrCreateObjectType(
        db,
        env.id,
        "Patient",
        "Subject of clinical findings",
        PATIENT_SCHEMA,
      );
      const linkTypeId = await getOrCreateLinkType(
        db,
        env.id,
        "has_finding",
        patientTypeId,
        findingTypeId,
        "many_to_many",
      );

      const persisted = await persistExtractResults({
        environmentId: env.id,
        environmentSlug: env.slug,
        environmentName: env.name,
        objectTypeName: objectType,
        findingTypeId,
        patientTypeId,
        linkTypeId,
        patientIdentifier: identifier,
        inputHash: createHash("sha256").update(text).digest("hex"),
        results: accepted,
      });
      savedCount = persisted.objectIds.length;
      timings.save = Date.now() - t;
    }

    return outcome({
      status: flaggedCount > 0 ? "flagged" : "succeeded",
      conceptCount: results.length + duplicateCount,
      savedCount,
      flaggedCount,
      error: null,
    });
  } catch (err) {
    return outcome({
      status: "failed",
      conceptCount: 0,
      savedCount: 0,
      flaggedCount: 0,
      error: (err as Error).message,
      errorCode: err instanceof AppError ? err.code : "INTERNAL_ERROR",
    });
  }
}

/** Execute a channel and record the run in one call (manual/one-shot use). */
export async function runChannel(
  db: DbClient,
  channel: RunnableChannel,
  inputText: string,
  trigger: "webhook" | "source",
): Promise<ChannelRunOutcome> {
  const result = await executeChannel(db, channel, inputText);
  await recordChannelRun(db, channel.id, trigger, inputText.length, result);
  return result;
}
