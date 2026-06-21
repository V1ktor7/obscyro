import { randomUUID } from "node:crypto";

import type { DbClient } from "../lib/db.js";
import { withTransaction } from "../lib/transaction.js";
import {
  insertLinkInstance,
  insertObjectInstance,
} from "./ontology.js";

/** Decisions confident enough to auto-persist as findings. */
export const PERSISTABLE_DECISIONS = new Set(["accept", "flag"]);

export interface ExtractContextAxis {
  value: string;
  confidence: number;
  trigger?: string | null;
}

export interface PersistableExtractResult {
  span: string;
  code: string | null;
  candidates: Array<{ code: string; display: string }>;
  context: {
    assertion: ExtractContextAxis | null;
    subject: ExtractContextAxis | null;
    temporality: ExtractContextAxis | null;
    certainty: ExtractContextAxis | null;
    role: ExtractContextAxis | null;
  };
  context_confidence: number;
  readable_note: string;
  decision: "accept" | "flag" | "escalate";
  concept_confidence: number;
}

export interface ResolvePatientResult {
  id: string;
  identifier: string;
  created: boolean;
}

export interface PersistExtractInput {
  environmentId: string;
  environmentSlug: string;
  environmentName: string;
  objectTypeName: string;
  findingTypeId: string;
  patientTypeId: string;
  linkTypeId: string;
  patientIdentifier?: string | null;
  results: PersistableExtractResult[];
}

export interface PersistExtractOutput {
  environment: { id: string; slug: string; name: string };
  objectType: string;
  objectIds: string[];
  linkIds: string[];
  pipelineRunId: string;
  patient: { id: string; identifier: string; created: boolean } | null;
  linked: boolean;
  reason?: "no_patient_identifier";
}

function summarizeTriggers(context: PersistableExtractResult["context"]): string | null {
  const axes = [
    context.assertion,
    context.certainty,
    context.subject,
    context.temporality,
    context.role,
  ];
  const triggers: string[] = [];
  for (const axis of axes) {
    const t = axis?.trigger;
    if (t && !triggers.includes(t)) triggers.push(t);
  }
  return triggers.length > 0 ? triggers.join("; ") : null;
}

export function toFindingProperties(result: PersistableExtractResult): Record<string, unknown> {
  const chosen =
    result.candidates.find((c) => c.code === result.code) ?? result.candidates[0];
  return {
    span: result.span,
    snomed_code: result.code,
    display: chosen?.display ?? null,
    assertion: result.context.assertion?.value ?? null,
    subject: result.context.subject?.value ?? null,
    temporality: result.context.temporality?.value ?? null,
    certainty: result.context.certainty?.value ?? null,
    trigger: summarizeTriggers(result.context),
    confidence: result.context_confidence,
    decision: result.decision,
    readable_note: result.readable_note,
  };
}

/**
 * Resolve a Patient instance by explicit `properties.identifier` only.
 * Returns null when identifier is absent/empty — never guesses from name or text.
 */
export async function resolvePatient(
  db: DbClient,
  patientTypeId: string,
  identifier: string | null | undefined,
): Promise<ResolvePatientResult | null> {
  const normalized = identifier?.trim();
  if (!normalized) return null;

  const { rows } = await db.query<{ id: string }>(
    `SELECT oi.id
       FROM app.ontology_object_instances oi
      WHERE oi.object_type_id = $1
        AND oi.properties->>'identifier' = $2
      LIMIT 1`,
    [patientTypeId, normalized],
  );

  if (rows[0]) {
    return { id: rows[0].id, identifier: normalized, created: false };
  }

  const newId = await insertObjectInstance(
    db,
    patientTypeId,
    { identifier: normalized },
    { source: "pipeline", auto_created: true },
  );
  return { id: newId, identifier: normalized, created: true };
}

/** Idempotent lookup: same env finding type, SNOMED code, and linked patient (or unlinked bucket). */
export async function findExistingFinding(
  db: DbClient,
  findingTypeId: string,
  linkTypeId: string,
  snomedCode: string | null,
  patientInstanceId: string | null,
): Promise<string | null> {
  if (!snomedCode) return null;

  if (patientInstanceId) {
    const { rows } = await db.query<{ id: string }>(
      `SELECT oi.id
         FROM app.ontology_object_instances oi
         JOIN app.ontology_link_instances li
           ON li.to_instance_id = oi.id
          AND li.link_type_id = $3
          AND li.from_instance_id = $4
        WHERE oi.object_type_id = $1
          AND oi.properties->>'snomed_code' = $2
        LIMIT 1`,
      [findingTypeId, snomedCode, linkTypeId, patientInstanceId],
    );
    return rows[0]?.id ?? null;
  }

  const { rows } = await db.query<{ id: string }>(
    `SELECT oi.id
       FROM app.ontology_object_instances oi
      WHERE oi.object_type_id = $1
        AND oi.properties->>'snomed_code' = $2
        AND COALESCE(oi.provenance->>'unlinked', 'false') = 'true'
        AND NOT EXISTS (
          SELECT 1
            FROM app.ontology_link_instances li
           WHERE li.to_instance_id = oi.id
             AND li.link_type_id = $3
        )
      LIMIT 1`,
    [findingTypeId, snomedCode, linkTypeId],
  );
  return rows[0]?.id ?? null;
}

async function persistExtractResultsInTransaction(
  db: DbClient,
  input: PersistExtractInput,
): Promise<PersistExtractOutput> {
  const pipelineRunId = randomUUID();
  const nowIso = new Date().toISOString();
  const objectIds: string[] = [];
  const linkIds: string[] = [];

  const patient = await resolvePatient(
    db,
    input.patientTypeId,
    input.patientIdentifier,
  );

  const linked = patient !== null;
  const reason = linked ? undefined : ("no_patient_identifier" as const);

  for (const result of input.results) {
    if (!PERSISTABLE_DECISIONS.has(result.decision)) continue;

    const snomedCode = result.code;
    const existingId = await findExistingFinding(
      db,
      input.findingTypeId,
      input.linkTypeId,
      snomedCode,
      patient?.id ?? null,
    );

    if (existingId) {
      objectIds.push(existingId);
      continue;
    }

    const baseProperties = toFindingProperties(result);
    const findingProperties =
      linked
        ? baseProperties
        : {
            ...baseProperties,
            pending_patient_identity: true,
          };

    const findingProvenance: Record<string, unknown> = {
      source: "extract",
      created_at: nowIso,
      pipeline_run_id: pipelineRunId,
      confidence: result.concept_confidence,
    };
    if (!linked) {
      findingProvenance.unlinked = true;
    }

    const objectId = await insertObjectInstance(
      db,
      input.findingTypeId,
      findingProperties,
      findingProvenance,
    );
    objectIds.push(objectId);

    if (patient) {
      const linkId = await insertLinkInstance(
        db,
        input.linkTypeId,
        patient.id,
        objectId,
        { source: "extract", pipeline_run_id: pipelineRunId },
      );
      if (linkId) linkIds.push(linkId);
    }
  }

  return {
    environment: {
      id: input.environmentId,
      slug: input.environmentSlug,
      name: input.environmentName,
    },
    objectType: input.objectTypeName,
    objectIds,
    linkIds,
    pipelineRunId,
    patient,
    linked,
    ...(reason ? { reason } : {}),
  };
}

/** Persist accepted/flagged extraction results in one atomic transaction. */
export async function persistExtractResults(
  input: PersistExtractInput,
): Promise<PersistExtractOutput> {
  return withTransaction((db) => persistExtractResultsInTransaction(db, input));
}
