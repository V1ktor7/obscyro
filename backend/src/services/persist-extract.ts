import type { DbClient } from "../lib/db.js";
import { pool } from "../db/pool.js";
import {
  createPipelineRun,
  finishPipelineRun,
  insertFailedPipelineRun,
  insertFindingInstance,
  insertLinkInstance,
  insertObjectInstance,
} from "./ontology.js";

/** Decisions confident enough to auto-persist as findings. */
export const PERSISTABLE_DECISIONS = new Set(["accept", "flag"]);

export const SNOMED_CODE_SYSTEM = "http://snomed.info/sct";

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
  inputHash: string;
  results: PersistableExtractResult[];
  /** When true, run L1–L3 quality scan on each newly inserted finding (non-blocking). */
  qualityScanOnWrite?: boolean;
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

function contextAxis(
  axis: ExtractContextAxis | null,
): { value: string; trigger: string | null; confidence: number } | null {
  if (!axis) return null;
  return {
    value: axis.value,
    trigger: axis.trigger ?? null,
    confidence: axis.confidence,
  };
}

export function toFindingContext(
  context: PersistableExtractResult["context"],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const assertion = contextAxis(context.assertion);
  const subject = contextAxis(context.subject);
  const temporality = contextAxis(context.temporality);
  const certainty = contextAxis(context.certainty);
  const role = contextAxis(context.role);
  if (assertion) out.assertion = assertion;
  if (subject) out.subject = subject;
  if (temporality) out.temporality = temporality;
  if (certainty) out.certainty = certainty;
  if (role) out.role = role;
  return out;
}

export function toFindingProperties(
  result: PersistableExtractResult,
  linked: boolean,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    span: result.span,
    readable_note: result.readable_note,
    decision: result.decision,
  };
  if (!linked) {
    properties.pending_patient_identity = true;
  }
  return properties;
}

export function toFindingColumns(result: PersistableExtractResult): {
  codeSystem: string | null;
  code: string | null;
  display: string | null;
  context: Record<string, unknown>;
} {
  const chosen =
    result.candidates.find((c) => c.code === result.code) ?? result.candidates[0];
  return {
    codeSystem: result.code ? SNOMED_CODE_SYSTEM : null,
    code: result.code,
    display: chosen?.display ?? null,
    context: toFindingContext(result.context),
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
          AND oi.code = $2
        LIMIT 1`,
      [findingTypeId, snomedCode, linkTypeId, patientInstanceId],
    );
    return rows[0]?.id ?? null;
  }

  const { rows } = await db.query<{ id: string }>(
    `SELECT oi.id
       FROM app.ontology_object_instances oi
      WHERE oi.object_type_id = $1
        AND oi.code = $2
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
  pipelineRunId: string,
): Promise<PersistExtractOutput & { newInstanceIds: string[] }> {
  const nowIso = new Date().toISOString();
  const objectIds: string[] = [];
  const newInstanceIds: string[] = [];
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

    const columns = toFindingColumns(result);
    const findingProvenance: Record<string, unknown> = {
      source: "extract",
      created_at: nowIso,
      pipeline_run_id: pipelineRunId,
      confidence: result.concept_confidence,
    };
    if (!linked) {
      findingProvenance.unlinked = true;
    }

    const objectId = await insertFindingInstance(
      db,
      input.findingTypeId,
      toFindingProperties(result, linked),
      findingProvenance,
      columns,
    );
    objectIds.push(objectId);
    newInstanceIds.push(objectId);

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

  await finishPipelineRun(db, pipelineRunId, "succeeded", {
    object_count: objectIds.length,
    link_count: linkIds.length,
  });

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
    newInstanceIds,
    ...(reason ? { reason } : {}),
  };
}

/** Persist accepted/flagged extraction results in one atomic transaction. */
export async function persistExtractResults(
  input: PersistExtractInput,
): Promise<PersistExtractOutput> {
  const client = await pool.connect();
  const db: DbClient = {
    query: (sql, params) => client.query(sql, params),
  };

  try {
    await client.query("BEGIN");
    const pipelineRunId = await createPipelineRun(
      db,
      input.environmentId,
      input.inputHash,
    );
    const { newInstanceIds, ...result } = await persistExtractResultsInTransaction(
      db,
      input,
      pipelineRunId,
    );
    await client.query("COMMIT");

    if (input.qualityScanOnWrite && newInstanceIds.length > 0) {
      const { scanInstanceOnWrite } = await import("./data-quality.js");
      for (const instanceId of newInstanceIds) {
        try {
          await scanInstanceOnWrite(pool, input.environmentId, instanceId);
        } catch {
          /* quality scan must not block persist */
        }
      }
    }

    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    await insertFailedPipelineRun(pool, input.environmentId, input.inputHash);
    throw err;
  } finally {
    client.release();
  }
}
