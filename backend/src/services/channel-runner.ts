import { createHash } from "node:crypto";

import type { DbClient } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { proxyToNlp } from "../lib/nlp.js";
import {
  CLINICAL_FINDING_SCHEMA,
  PATIENT_SCHEMA,
  findInstanceIdByKey,
  getOrCreateLinkType,
  getOrCreateObjectType,
  insertLinkInstance,
  insertObjectInstance,
  upsertInstanceByIdentity,
  type PropertyDef,
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
  type: "intake" | "transform" | "map" | "extract" | "validate" | "save";
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

export interface StepIoEntry {
  stepId: string;
  type: string;
  input: string;
  output: string;
  note?: string;
}

const STEP_IO_CLIP = 2000;

/** Clip a value's JSON form for step-IO storage (runs are debug aids, not archives). */
export function clipIo(value: unknown): string {
  let text: string;
  if (typeof value === "string") text = value;
  else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  return text.length > STEP_IO_CLIP ? `${text.slice(0, STEP_IO_CLIP)}… [truncated]` : text;
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
  stepIo: StepIoEntry[];
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
               saved_count, flagged_count, duration_ms, step_timings, step_io, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11)`,
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
        JSON.stringify(outcome.stepIo),
        outcome.error,
      ],
    )
    .catch(() => undefined);
}

export type CoerceKind = "string" | "number" | "boolean" | "date";
export type OnMissing = "skip" | "null" | "flag";

export interface MappingRule {
  from: string;
  /** Scalar target property (scalar rules) — omitted for link rules. */
  to?: string;
  kind?: "scalar" | "link";
  coerce?: CoerceKind;
  onMissing?: OnMissing;
  /** Link rules: resolve/create a target object and connect it. */
  linkType?: string;
  targetType?: string;
  targetKey?: string;
  createMissing?: boolean;
}

export interface MapIssue {
  field: string;
  reason: string;
}

/**
 * Coerce a raw payload value to a declared type. Locale-aware for numbers
 * ("3,2" and "1 234,5" are valid FR decimals). Returns an issue instead of a
 * silent NaN/garbage so the item can be routed to review, not the ontology.
 */
export function coerceValue(
  value: unknown,
  kind: CoerceKind | undefined,
  field: string,
): { value: unknown; issue: MapIssue | null } {
  if (value === null || value === undefined) return { value, issue: null };
  if (!kind || kind === "string") {
    return { value: typeof value === "object" ? JSON.stringify(value) : String(value), issue: null };
  }
  if (kind === "number") {
    if (typeof value === "number") return { value, issue: null };
    const raw = String(value).trim().replace(/\s/g, "").replace(",", ".");
    const n = Number(raw);
    if (raw === "" || Number.isNaN(n)) {
      return { value: null, issue: { field, reason: `"${String(value)}" is not a number` } };
    }
    return { value: n, issue: null };
  }
  if (kind === "boolean") {
    const s = String(value).trim().toLowerCase();
    if (["true", "1", "yes", "oui", "y"].includes(s)) return { value: true, issue: null };
    if (["false", "0", "no", "non", "n"].includes(s)) return { value: false, issue: null };
    return { value: null, issue: { field, reason: `"${String(value)}" is not a boolean` } };
  }
  // date
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) {
    return { value: null, issue: { field, reason: `"${String(value)}" is not a date` } };
  }
  return { value: d.toISOString(), issue: null };
}

export interface MapItemBuild {
  properties: Record<string, unknown>;
  issues: MapIssue[];
  missingRequired: string[];
}

/**
 * Build one target object's properties from a payload item and the scalar
 * mapping rules, honoring per-rule missing-value policy and coercion, then
 * check the type's required properties. Pure: no DB, so the dry-run preview
 * and the live runner share one transform (no client/server drift).
 */
export function buildMapProperties(
  item: Record<string, unknown>,
  scalarRules: MappingRule[],
  schema: PropertyDef[],
): MapItemBuild {
  const properties: Record<string, unknown> = {};
  const issues: MapIssue[] = [];
  for (const rule of scalarRules) {
    const to = (rule.to ?? "").trim();
    if (!to) continue;
    const raw = readPath(item, rule.from);
    if (raw === undefined) {
      const policy = rule.onMissing ?? "skip";
      if (policy === "null") properties[to] = null;
      else if (policy === "flag") issues.push({ field: rule.from, reason: "missing in payload" });
      continue;
    }
    const { value, issue } = coerceValue(raw, rule.coerce, rule.from);
    if (issue) issues.push(issue);
    else properties[to] = value;
  }
  const missingRequired = schema
    .filter((p) => p.required)
    .filter((p) => properties[p.key] === undefined || properties[p.key] === null)
    .map((p) => p.key);
  return { properties, issues, missingRequired };
}

/** Max payload items mapped per run when the webhook posts an array. */
const MAP_BATCH_CAP = 100;

/**
 * Structured pipeline: map JSON payload keys onto an existing ontology object
 * type and insert the instances directly. The target type must already exist
 * in the environment — the mapper binds to the ontology, it does not invent
 * schema on the fly.
 */
async function runMapPath(
  db: DbClient,
  channel: RunnableChannel,
  map: ChannelStepRow,
  inputText: string,
  timings: Record<string, number>,
  stepIo: StepIoEntry[],
  outcome: (
    partial: Omit<
      ChannelRunOutcome,
      "durationMs" | "stepTimings" | "stepIo" | "errorCode"
    > & { errorCode?: string | null },
  ) => ChannelRunOutcome,
): Promise<ChannelRunOutcome> {
  const t = Date.now();
  const objectType = ((map.config.objectType as string) || "").trim();
  const identity = (Array.isArray(map.config.identity) ? map.config.identity : [])
    .map((k) => String(k).trim())
    .filter(Boolean);
  const rules: MappingRule[] = (Array.isArray(map.config.mappings) ? map.config.mappings : [])
    .map((m) => m as MappingRule)
    .filter((m) => String(m.from ?? "").trim());
  const scalarRules = rules.filter((r) => (r.kind ?? "scalar") === "scalar" && r.to);
  const linkRules = rules.filter((r) => r.kind === "link" && r.targetType && r.targetKey);
  const mappings = scalarRules;

  if (!objectType) {
    return outcome({
      status: "failed",
      conceptCount: 0,
      savedCount: 0,
      flaggedCount: 0,
      error: "Map step has no target object type.",
      errorCode: "MAP_NO_TYPE",
    });
  }
  if (mappings.length === 0 && linkRules.length === 0) {
    return outcome({
      status: "failed",
      conceptCount: 0,
      savedCount: 0,
      flaggedCount: 0,
      error: "Map step has no key mappings.",
      errorCode: "MAP_NO_MAPPINGS",
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(inputText);
  } catch {
    return outcome({
      status: "failed",
      conceptCount: 0,
      savedCount: 0,
      flaggedCount: 0,
      error: "Map step needs a JSON payload (object or array of objects).",
      errorCode: "MAP_INPUT_NOT_JSON",
    });
  }
  const items = (Array.isArray(parsed) ? parsed : [parsed])
    .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
    .slice(0, MAP_BATCH_CAP);
  if (items.length === 0) {
    return outcome({
      status: "failed",
      conceptCount: 0,
      savedCount: 0,
      flaggedCount: 0,
      error: "Payload contains no JSON objects to map.",
      errorCode: "MAP_INPUT_EMPTY",
    });
  }

  const typeRes = await db.query<{ id: string; property_schema: PropertyDef[] }>(
    `SELECT id, property_schema FROM app.ontology_object_types
      WHERE environment_id = $1 AND name = $2`,
    [channel.environmentId, objectType],
  );
  const typeId = typeRes.rows[0]?.id;
  const schema = typeRes.rows[0]?.property_schema ?? [];
  if (!typeId) {
    return outcome({
      status: "failed",
      conceptCount: 0,
      savedCount: 0,
      flaggedCount: 0,
      error: `Object type "${objectType}" does not exist in this environment.`,
      errorCode: "MAP_TYPE_NOT_FOUND",
    });
  }

  let savedCount = 0;
  let reviewCount = 0;
  let linkCount = 0;
  const previews: Array<Record<string, unknown>> = [];
  for (const item of items) {
    const { properties, issues, missingRequired } = buildMapProperties(item, scalarRules, schema);
    if (Object.keys(properties).length === 0 && issues.length === 0) continue;

    // Coercion failure or a missing required property → the object would be
    // wrong/incomplete, so park it in the review queue instead of writing it.
    if (issues.length > 0 || missingRequired.length > 0) {
      const label =
        identity.map((k) => properties[k]).filter(Boolean).join(" · ") || objectType;
      await db
        .query(
          `INSERT INTO app.channel_review_item
                  (channel_id, environment_id, span, code, display, decision, confidence, payload)
           VALUES ($1, $2, $3, $4, $5, 'flag', $6, $7::jsonb)`,
          [
            channel.id,
            channel.environmentId,
            label,
            null,
            objectType,
            null,
            JSON.stringify({
              kind: "map",
              objectType,
              identity,
              properties,
              issues,
              missingRequired,
              item,
            }),
          ],
        )
        .catch(() => undefined);
      reviewCount += 1;
      continue;
    }

    // Upsert on the identity key so retries / looped feeds update, not double.
    const { id: objectId } = await upsertInstanceByIdentity(db, typeId, identity, properties, {
      source: "channel-map",
      channelId: channel.id,
    });
    savedCount += 1;

    // Link rules: resolve (or create) the target object by key and connect it,
    // so mapped references become graph edges instead of dead string columns.
    for (const link of linkRules) {
      const keyRaw = readPath(item, link.from);
      if (keyRaw === undefined || keyRaw === null || keyRaw === "") continue;
      const keyVal = String(keyRaw);
      const targetTypeRes = await db.query<{ id: string }>(
        `SELECT id FROM app.ontology_object_types WHERE environment_id = $1 AND name = $2`,
        [channel.environmentId, link.targetType],
      );
      const targetTypeId = targetTypeRes.rows[0]?.id;
      if (!targetTypeId) continue;
      let targetId = await findInstanceIdByKey(db, targetTypeId, link.targetKey!, keyVal);
      if (!targetId && link.createMissing) {
        targetId = await insertObjectInstance(
          db,
          targetTypeId,
          { [link.targetKey!]: keyVal },
          { source: "channel-map", channelId: channel.id },
        );
      }
      if (!targetId) continue;
      const linkTypeId = await getOrCreateLinkType(
        db,
        channel.environmentId,
        link.linkType || `${objectType}_${link.targetType}`,
        typeId,
        targetTypeId,
        "many_to_many",
      );
      const created = await insertLinkInstance(db, linkTypeId, objectId, targetId, {
        source: "channel-map",
        channelId: channel.id,
      });
      if (created) linkCount += 1;
    }
    if (previews.length < 3) previews.push(properties);
  }
  timings.map = Date.now() - t;
  stepIo.push({
    stepId: map.id,
    type: "map",
    input: clipIo(items.length === 1 ? items[0] : items),
    output: clipIo({ objectType, savedCount, reviewCount, linkCount, sample: previews }),
    note:
      `${savedCount} saved` +
      (linkCount > 0 ? `, ${linkCount} linked` : "") +
      (reviewCount > 0 ? `, ${reviewCount} to review` : ""),
  });

  if (savedCount === 0 && reviewCount === 0) {
    return outcome({
      status: "failed",
      conceptCount: items.length,
      savedCount: 0,
      flaggedCount: 0,
      error: "No payload keys matched the configured mappings.",
      errorCode: "MAP_NO_MATCHES",
    });
  }

  return outcome({
    status: reviewCount > 0 ? "flagged" : "succeeded",
    conceptCount: items.length,
    savedCount,
    flaggedCount: reviewCount,
    error: null,
  });
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
  const stepIo: StepIoEntry[] = [];

  const outcome = (
    partial: Omit<
      ChannelRunOutcome,
      "durationMs" | "stepTimings" | "stepIo" | "errorCode"
    > & { errorCode?: string | null },
  ): ChannelRunOutcome => ({
    ...partial,
    errorCode: partial.errorCode ?? null,
    durationMs: Date.now() - t0,
    stepTimings: timings,
    stepIo,
  });

  try {
    const enabled = channel.steps.filter((s) => s.enabled);
    const step = (type: ChannelStepRow["type"]) => enabled.find((s) => s.type === type);

    const intake = step("intake");
    stepIo.push({
      stepId: intake?.id ?? "intake",
      type: "intake",
      input: clipIo(inputText),
      output: clipIo(inputText),
    });

    // --- map (structured payloads) -----------------------------------------
    // A channel with an enabled map step is a structured pipeline: the JSON
    // payload is mapped key-by-key onto an existing ontology object type and
    // saved directly. NLP extract/validate never run — they are for free text.
    const map = step("map");
    if (map) {
      return await runMapPath(db, channel, map, inputText, timings, stepIo, outcome);
    }

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
      stepIo.push({
        stepId: transform.id,
        type: "transform",
        input: clipIo(inputText),
        output: clipIo(text),
        note: fieldPath ? `field: ${fieldPath}` : "raw text",
      });
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
    stepIo.push({
      stepId: extract.id,
      type: "extract",
      input: clipIo(text),
      output: clipIo(
        concepts.map((c) => ({ span: c.span, code: c.code, status: c.status, cosine: c.cosine })),
      ),
      note: `${concepts.length} span${concepts.length === 1 ? "" : "s"}`,
    });

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
      stepIo.push({
        stepId: validate.id,
        type: "validate",
        input: clipIo(results.length + duplicateCount),
        output: clipIo(results.map((r) => ({ span: r.span, decision: r.decision }))),
        note: duplicateCount > 0 ? `${duplicateCount} duplicate(s) dropped` : undefined,
      });
    }

    const accepted = results.filter((r) => r.decision === "accept");
    const flaggedCount = results.filter(
      (r) => r.decision === "flag" || r.decision === "escalate",
    ).length;

    // --- review queue: flag does not mean discard --------------------------
    // Non-accepted extractions are queued for human review; confirming one
    // later persists it with the same save settings this run would have used.
    const saveStep = step("save");
    const reviewable = results.filter(
      (r) => r.decision === "flag" || r.decision === "escalate",
    );
    if (reviewable.length > 0) {
      const objectTypeForReview =
        ((saveStep?.config.objectType as string) || "ClinicalFinding").trim();
      const pidSourceForReview =
        ((saveStep?.config.patientIdentifierSource as string) || "").trim();
      let reviewIdentifier: string | undefined;
      if (pidSourceForReview) {
        try {
          const parsed: unknown = JSON.parse(inputText);
          if (parsed && typeof parsed === "object") {
            const v = readPath(parsed as Record<string, unknown>, pidSourceForReview);
            if (typeof v === "string" || typeof v === "number") reviewIdentifier = String(v);
          }
        } catch {
          /* not JSON */
        }
      }
      const inputHash = createHash("sha256").update(text).digest("hex");
      for (const r of reviewable) {
        await db
          .query(
            `INSERT INTO app.channel_review_item
                    (channel_id, environment_id, span, code, display, decision, confidence, payload)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
            [
              channel.id,
              channel.environmentId,
              r.span,
              r.code,
              r.candidates[0]?.display ?? r.span,
              r.decision,
              r.concept_confidence,
              JSON.stringify({
                result: r,
                objectType: objectTypeForReview,
                patientIdentifier: reviewIdentifier ?? null,
                inputHash,
              }),
            ],
          )
          .catch(() => undefined);
      }
    }

    // --- save --------------------------------------------------------------------
    const save = saveStep;
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
      stepIo.push({
        stepId: save.id,
        type: "save",
        input: clipIo(accepted.map((r) => ({ span: r.span, code: r.code }))),
        output: clipIo({ savedCount, objectType }),
      });
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
