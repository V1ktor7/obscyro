import "dotenv/config";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { pool } from "../db/pool.js";
import type { DbClient } from "../lib/db.js";
import {
  computeMetrics,
  DEFAULT_SCORE_SPEC,
  scoreInstance,
} from "./live-analysis.js";
import {
  getOrCreateObjectType,
  insertObjectInstance,
  PATIENT_SCHEMA,
} from "./ontology.js";

const TEST_ENV_SLUG = "test-lab";
const TEST_USER_EMAIL = "victormorency7@gmail.com";

const db: DbClient = {
  query: (sql, params) => pool.query(sql, params),
};

const VITALS_SCHEMA = [
  { key: "respiratory_rate", type: "number" as const, label: "RR" },
  { key: "spo2", type: "number" as const, label: "SpO2" },
];

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
  vitalsTypeId: string;
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

  await getOrCreateObjectType(db, environmentId, "Patient", "Test patients", PATIENT_SCHEMA);
  const vitalsTypeId = await getOrCreateObjectType(
    db,
    environmentId,
    "VitalsObservation",
    "Live metrics test vitals",
    VITALS_SCHEMA,
  );

  return { environmentId, vitalsTypeId };
}

describe("live-analysis integration (test-lab)", () => {
  let ctx: Awaited<ReturnType<typeof ensureTestLabEnvironment>>;
  let vitalsInstanceId: string;

  before(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for integration tests");
    }
    ctx = await ensureTestLabEnvironment();

    vitalsInstanceId = await insertObjectInstance(
      db,
      ctx.vitalsTypeId,
      { respiratory_rate: 22, spo2: 94 },
      { source: "live-test" },
    );
  });

  after(async () => {
    if (vitalsInstanceId) {
      await db.query(`DELETE FROM app.ontology_object_instances WHERE id = $1`, [
        vitalsInstanceId,
      ]);
    }
    await pool.end();
  });

  it("computeMetrics returns counts and freshness", async () => {
    const metrics = await computeMetrics(db, ctx.environmentId);
    assert.ok(metrics.totalInstances >= 1);
    assert.ok(metrics.computedAt);
    const vitals = metrics.byType.find((t) => t.typeName === "VitalsObservation");
    assert.ok(vitals);
    assert.ok(vitals!.count >= 1);
    assert.ok(vitals!.freshnessSeconds != null);
  });

  it("scoreInstance applies NEWS2-style banding", async () => {
    const score = await scoreInstance(
      db,
      ctx.environmentId,
      vitalsInstanceId,
      DEFAULT_SCORE_SPEC,
    );
    assert.equal(score.instanceId, vitalsInstanceId);
    assert.equal(score.typeName, "VitalsObservation");
    assert.equal(score.breakdown.respiratory_rate, 2);
    assert.equal(score.breakdown.spo2, 1);
    assert.equal(score.total, 3);
  });
});
