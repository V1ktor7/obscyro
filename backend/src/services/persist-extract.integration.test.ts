import "dotenv/config";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { pool } from "../db/pool.js";
import type { DbClient } from "../lib/db.js";
import {
  CLINICAL_FINDING_SCHEMA,
  PATIENT_SCHEMA,
  getOrCreateLinkType,
  getOrCreateObjectType,
} from "./ontology.js";
import {
  persistExtractResults,
  type PersistableExtractResult,
  type PersistExtractInput,
} from "./persist-extract.js";

const TEST_ENV_SLUG = "test-lab";
const TEST_USER_EMAIL = "victormorency7@gmail.com";

const db: DbClient = {
  query: (sql, params) => pool.query(sql, params),
};

function hashInput(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function acceptFinding(
  snomedCode: string,
  span = "chest pain",
): PersistableExtractResult {
  return {
    span,
    code: snomedCode,
    candidates: [{ code: snomedCode, display: "Chest pain" }],
    context: {
      assertion: { value: "affirmed", confidence: 0.9, trigger: null },
      subject: { value: "patient", confidence: 0.9, trigger: null },
      temporality: { value: "current", confidence: 0.9, trigger: null },
      certainty: { value: "confirmed", confidence: 0.9, trigger: null },
      role: null,
    },
    context_confidence: 0.9,
    readable_note: "Chest pain",
    decision: "accept",
    concept_confidence: 0.95,
  };
}

interface TestEnvContext {
  environmentId: string;
  findingTypeId: string;
  patientTypeId: string;
  linkTypeId: string;
}

function basePersistInput(
  ctx: TestEnvContext,
  overrides: Partial<PersistExtractInput>,
): PersistExtractInput {
  return {
    environmentId: ctx.environmentId,
    environmentSlug: TEST_ENV_SLUG,
    environmentName: "Test Lab",
    objectTypeName: "ClinicalFinding",
    findingTypeId: ctx.findingTypeId,
    patientTypeId: ctx.patientTypeId,
    linkTypeId: ctx.linkTypeId,
    inputHash: hashInput("default-test-input"),
    results: [],
    ...overrides,
  };
}

async function getUserId(): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "SELECT id FROM app.users WHERE email = $1",
    [TEST_USER_EMAIL],
  );
  assert.ok(rows[0], `seed user ${TEST_USER_EMAIL} must exist`);
  return rows[0].id;
}

async function ensureTestLabEnvironment(): Promise<TestEnvContext> {
  const userId = await getUserId();

  const { rows: orgRows } = await db.query<{ id: string }>(
    `SELECT o.id
       FROM app.organizations o
       JOIN app.organization_members om ON om.organization_id = o.id
      WHERE om.user_id = $1
      ORDER BY CASE WHEN o.slug = 'chum' THEN 0 ELSE 1 END
      LIMIT 1`,
    [userId],
  );
  assert.ok(orgRows[0], "user must belong to an organization (run migrations)");
  const organizationId = orgRows[0].id;

  const { rows: envRows } = await db.query<{ id: string }>(
    `INSERT INTO app.ontology_environments
       (owner_user_id, organization_id, name, slug, environment_type)
     VALUES ($1, $2, 'Test Lab', $3, 'entity')
     ON CONFLICT (organization_id, slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [userId, organizationId, TEST_ENV_SLUG],
  );
  const environmentId = envRows[0]!.id;

  const findingTypeId = await getOrCreateObjectType(
    db,
    environmentId,
    "ClinicalFinding",
    "Integration test findings",
    CLINICAL_FINDING_SCHEMA,
  );
  const patientTypeId = await getOrCreateObjectType(
    db,
    environmentId,
    "Patient",
    "Integration test patients",
    PATIENT_SCHEMA,
  );
  const linkTypeId = await getOrCreateLinkType(
    db,
    environmentId,
    "has_finding",
    patientTypeId,
    findingTypeId,
    "many_to_many",
  );

  return { environmentId, findingTypeId, patientTypeId, linkTypeId };
}

async function countPatientsWithIdentifier(identifier: string): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM app.ontology_object_instances oi
       JOIN app.ontology_object_types ot ON ot.id = oi.object_type_id
       JOIN app.ontology_environments e ON e.id = ot.environment_id
      WHERE e.slug = $1
        AND ot.name = 'Patient'
        AND oi.properties->>'identifier' = $2`,
    [TEST_ENV_SLUG, identifier],
  );
  return Number(rows[0]!.count);
}

async function countFindingsWithCode(snomedCode: string): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM app.ontology_object_instances oi
       JOIN app.ontology_object_types ot ON ot.id = oi.object_type_id
       JOIN app.ontology_environments e ON e.id = ot.environment_id
      WHERE e.slug = $1
        AND ot.name = 'ClinicalFinding'
        AND oi.code = $2`,
    [TEST_ENV_SLUG, snomedCode],
  );
  return Number(rows[0]!.count);
}

async function cleanupTestArtifacts(snomedCodes: string[], patientIds: string[]): Promise<void> {
  if (snomedCodes.length > 0) {
    await db.query(
      `DELETE FROM app.ontology_link_instances li
        USING app.ontology_object_instances oi,
              app.ontology_object_types ot,
              app.ontology_environments e
        WHERE li.to_instance_id = oi.id
          AND oi.object_type_id = ot.id
          AND ot.environment_id = e.id
          AND e.slug = $1
          AND oi.code = ANY($2::text[])`,
      [TEST_ENV_SLUG, snomedCodes],
    );
    await db.query(
      `DELETE FROM app.ontology_object_instances oi
        USING app.ontology_object_types ot, app.ontology_environments e
        WHERE oi.object_type_id = ot.id
          AND ot.environment_id = e.id
          AND e.slug = $1
          AND oi.code = ANY($2::text[])`,
      [TEST_ENV_SLUG, snomedCodes],
    );
  }

  if (patientIds.length > 0) {
    await db.query(
      `DELETE FROM app.ontology_link_instances
        WHERE from_instance_id = ANY($1::uuid[]) OR to_instance_id = ANY($1::uuid[])`,
      [patientIds],
    );
    await db.query(
      `DELETE FROM app.ontology_object_instances
        WHERE id = ANY($1::uuid[])`,
      [patientIds],
    );
  }
}

describe("persistExtractResults integration (test-lab)", () => {
  let ctx: TestEnvContext;
  const linkedCode = "999001001";
  const unlinkedCode = "999001002";
  const enrichmentCode = "999001003";
  let linkedPatientId: string | null = null;

  before(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for integration tests");
    }
    ctx = await ensureTestLabEnvironment();
    await cleanupTestArtifacts([linkedCode, unlinkedCode, enrichmentCode], []);
  });

  after(async () => {
    const patientIds = linkedPatientId ? [linkedPatientId] : [];
    await cleanupTestArtifacts([linkedCode, unlinkedCode, enrichmentCode], patientIds);
    await pool.end();
  });

  it("a. persist identifier P-001 creates patient and links finding", async () => {
    const result = await persistExtractResults(
      basePersistInput(ctx, {
        inputHash: hashInput("test-a"),
        patientIdentifier: "P-001",
        results: [acceptFinding(linkedCode)],
      }),
    );

    assert.equal(result.patient?.identifier, "P-001");
    assert.equal(result.patient?.created, true);
    assert.equal(result.linked, true);
    assert.equal(result.reason, undefined);
    assert.equal(result.linkIds.length, 1);
    assert.equal(result.objectIds.length, 1);

    linkedPatientId = result.patient!.id;
    assert.equal(await countPatientsWithIdentifier("P-001"), 1);
    assert.equal(await countFindingsWithCode(linkedCode), 1);
  });

  it("b. persist P-001 again reuses patient without duplicate row", async () => {
    const result = await persistExtractResults(
      basePersistInput(ctx, {
        inputHash: hashInput("test-b"),
        patientIdentifier: "P-001",
        results: [acceptFinding(linkedCode)],
      }),
    );

    assert.equal(result.patient?.identifier, "P-001");
    assert.equal(result.patient?.created, false);
    assert.equal(result.linked, true);
    assert.equal(await countPatientsWithIdentifier("P-001"), 1);
    assert.equal(await countFindingsWithCode(linkedCode), 1);
  });

  it("c. persist without identifier stores unlinked finding", async () => {
    const result = await persistExtractResults(
      basePersistInput(ctx, {
        inputHash: hashInput("test-c"),
        patientIdentifier: undefined,
        results: [acceptFinding(unlinkedCode)],
      }),
    );

    assert.equal(result.patient, null);
    assert.equal(result.linked, false);
    assert.equal(result.reason, "no_patient_identifier");
    assert.equal(result.linkIds.length, 0);
    assert.equal(result.objectIds.length, 1);

    const { rows } = await db.query<{
      provenance: { unlinked?: boolean };
      properties: { pending_patient_identity?: boolean };
    }>(
      `SELECT oi.provenance, oi.properties
         FROM app.ontology_object_instances oi
        WHERE oi.id = $1`,
      [result.objectIds[0]],
    );
    assert.equal(rows[0]?.provenance.unlinked, true);
    assert.equal(rows[0]?.properties.pending_patient_identity, true);
    assert.equal(await countFindingsWithCode(unlinkedCode), 1);
  });

  it("d. retry identical unlinked request is idempotent", async () => {
    const input = basePersistInput(ctx, {
      inputHash: hashInput("test-d"),
      patientIdentifier: undefined,
      results: [acceptFinding(unlinkedCode)],
    });

    const first = await persistExtractResults(input);
    const second = await persistExtractResults(input);

    assert.equal(first.objectIds[0], second.objectIds[0]);
    assert.equal(await countFindingsWithCode(unlinkedCode), 1);
  });

  it("e. finding has context column and succeeded pipeline_run", async () => {
    const result = await persistExtractResults(
      basePersistInput(ctx, {
        inputHash: hashInput("test-e-enrichment"),
        patientIdentifier: "P-E",
        results: [acceptFinding(enrichmentCode, "dyspnea")],
      }),
    );

    const { rows } = await db.query<{
      context: {
        assertion?: { value: string; trigger: string | null; confidence: number };
      } | null;
      code: string | null;
      code_system: string | null;
      display: string | null;
      pipeline_run_id: string;
      run_status: string;
    }>(
      `SELECT oi.context,
              oi.code,
              oi.code_system,
              oi.display,
              oi.provenance->>'pipeline_run_id' AS pipeline_run_id,
              pr.status AS run_status
         FROM app.ontology_object_instances oi
         JOIN app.ontology_pipeline_run pr
           ON pr.id = (oi.provenance->>'pipeline_run_id')::uuid
        WHERE oi.id = $1`,
      [result.objectIds[0]],
    );

    assert.ok(rows[0]?.context);
    assert.equal(rows[0]?.context?.assertion?.value, "affirmed");
    assert.equal(rows[0]?.code, enrichmentCode);
    assert.equal(rows[0]?.code_system, "http://snomed.info/sct");
    assert.equal(rows[0]?.display, "Chest pain");
    assert.equal(rows[0]?.pipeline_run_id, result.pipelineRunId);
    assert.equal(rows[0]?.run_status, "succeeded");
  });
});
