import "dotenv/config";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { pool } from "../db/pool.js";
import type { DbClient } from "../lib/db.js";
import {
  listFlags,
  scanEnvironment,
  updateFlagStatus,
} from "./data-quality.js";
import {
  CLINICAL_FINDING_SCHEMA,
  getOrCreateObjectType,
  insertFindingInstance,
} from "./ontology.js";

const TEST_ENV_SLUG = "test-lab";
const TEST_USER_EMAIL = "victormorency7@gmail.com";
const INVALID_SNOMED = "999999999999";

const db: DbClient = {
  query: (sql, params) => pool.query(sql, params),
};

async function getUserId(): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "SELECT id FROM app.users WHERE email = $1",
    [TEST_USER_EMAIL],
  );
  assert.ok(rows[0], `seed user ${TEST_USER_EMAIL} must exist`);
  return rows[0].id;
}

async function ensureTestLabEnvironment(): Promise<{
  environmentId: string;
  findingTypeId: string;
}> {
  const userId = await getUserId();
  const { rows: orgRows } = await db.query<{ id: string }>(
    `SELECT o.id
       FROM app.organizations o
       JOIN app.organization_members om ON om.organization_id = o.id
      WHERE om.user_id = $1
      LIMIT 1`,
    [userId],
  );
  assert.ok(orgRows[0], "user must belong to an organization");
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
    "DQ test findings",
    CLINICAL_FINDING_SCHEMA,
  );

  return { environmentId, findingTypeId };
}

describe("data-quality integration (test-lab)", () => {
  let ctx: Awaited<ReturnType<typeof ensureTestLabEnvironment>>;
  let instanceId: string;
  const properties = {
    span: "bad finding",
    snomed_code: INVALID_SNOMED,
    display: "Invalid",
    confidence: 5,
    decision: "flag",
  };

  before(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for integration tests");
    }
    ctx = await ensureTestLabEnvironment();

    instanceId = await insertFindingInstance(
      db,
      ctx.findingTypeId,
      properties,
      { source: "dq-test" },
      {
        codeSystem: "http://snomed.info/sct",
        code: INVALID_SNOMED,
        display: "Invalid",
      },
    );
  });

  after(async () => {
    await db.query(
      `DELETE FROM app.data_quality_flag WHERE instance_id = $1`,
      [instanceId],
    );
    await db.query(`DELETE FROM app.ontology_object_instances WHERE id = $1`, [
      instanceId,
    ]);
    await pool.end();
  });

  it("scan creates open flags for invalid SNOMED and out-of-range values", async () => {
    const { summary } = await scanEnvironment(db, ctx.environmentId);
    assert.ok(summary.flagCount >= 2);

    const flags = await listFlags(db, ctx.environmentId, { status: "open" });
    const mine = flags.filter((f) => f.instanceId === instanceId);
    assert.ok(mine.some((f) => f.code === "SNOMED_NOT_FOUND" && f.layer === 1));
    assert.ok(mine.some((f) => f.code === "OUT_OF_RANGE" && f.layer === 2));
    assert.ok(mine.some((f) => f.code === "ORPHAN_INSTANCE" && f.layer === 3));

    const { rows: propRows } = await db.query<{ properties: Record<string, unknown> }>(
      `SELECT properties FROM app.ontology_object_instances WHERE id = $1`,
      [instanceId],
    );
    assert.deepEqual(propRows[0]?.properties, properties);
  });

  it("PATCH dismisses flag without mutating instance properties", async () => {
    const flags = await listFlags(db, ctx.environmentId, {
      status: "open",
      layer: 1,
    });
    const snomedFlag = flags.find(
      (f) => f.instanceId === instanceId && f.code === "SNOMED_NOT_FOUND",
    );
    assert.ok(snomedFlag);

    await updateFlagStatus(db, ctx.environmentId, snomedFlag!.id, "dismissed");

    const updated = await listFlags(db, ctx.environmentId);
    const dismissed = updated.find((f) => f.id === snomedFlag!.id);
    assert.equal(dismissed?.status, "dismissed");

    const { rows: propRows } = await db.query<{ properties: Record<string, unknown> }>(
      `SELECT properties FROM app.ontology_object_instances WHERE id = $1`,
      [instanceId],
    );
    assert.deepEqual(propRows[0]?.properties, properties);
  });
});
