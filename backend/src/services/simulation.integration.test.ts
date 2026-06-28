import "dotenv/config";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { pool } from "../db/pool.js";
import type { DbClient } from "../lib/db.js";
import {
  countInstancesForEnv,
  getOrCreateLinkType,
  getOrCreateObjectType,
  insertLinkInstance,
  insertObjectInstance,
  PATIENT_SCHEMA,
} from "./ontology.js";
import {
  buildContactGraph,
  runOutbreak,
  type OutbreakParams,
} from "./simulation.js";

const TEST_ENV_SLUG = "test-lab";
const TEST_USER_EMAIL = "victormorency7@gmail.com";

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
  organizationId: string;
  userId: string;
  patientTypeId: string;
  contactLinkTypeId: string;
}> {
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

  const patientTypeId = await getOrCreateObjectType(
    db,
    environmentId,
    "Patient",
    "Simulation test patients",
    PATIENT_SCHEMA,
  );
  const contactLinkTypeId = await getOrCreateLinkType(
    db,
    environmentId,
    "contacts",
    patientTypeId,
    patientTypeId,
    "many_to_many",
  );

  return { environmentId, organizationId, userId, patientTypeId, contactLinkTypeId };
}

async function cleanupSimulationArtifacts(
  environmentId: string,
  instanceIds: string[],
): Promise<void> {
  if (instanceIds.length) {
    await db.query(
      `DELETE FROM app.ontology_link_instances
        WHERE from_instance_id = ANY($1::uuid[]) OR to_instance_id = ANY($1::uuid[])`,
      [instanceIds],
    );
    await db.query(`DELETE FROM app.ontology_object_instances WHERE id = ANY($1::uuid[])`, [
      instanceIds,
    ]);
  }
  await db.query(`DELETE FROM app.simulation_run WHERE scenario_id IN (
    SELECT id FROM app.scenario WHERE environment_id = $1
  )`, [environmentId]);
  await db.query(`DELETE FROM app.scenario_override WHERE scenario_id IN (
    SELECT id FROM app.scenario WHERE environment_id = $1
  )`, [environmentId]);
  await db.query(`DELETE FROM app.scenario WHERE environment_id = $1`, [environmentId]);
}

describe("simulation integration (test-lab)", () => {
  let ctx: Awaited<ReturnType<typeof ensureTestLabEnvironment>>;
  const instanceIds: string[] = [];
  const scenarioName = `sim-test-${Date.now()}`;

  before(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for integration tests");
    }
    ctx = await ensureTestLabEnvironment();
    await cleanupSimulationArtifacts(ctx.environmentId, instanceIds);
  });

  after(async () => {
    await cleanupSimulationArtifacts(ctx.environmentId, instanceIds);
    await pool.end();
  });

  it("runs reproducible outbreak simulation without mutating ontology instances", async () => {
    const p1 = await insertObjectInstance(
      db,
      ctx.patientTypeId,
      { identifier: "SIM-P1", label: "Patient 1" },
      { source: "sim-test" },
    );
    const p2 = await insertObjectInstance(
      db,
      ctx.patientTypeId,
      { identifier: "SIM-P2", label: "Patient 2" },
      { source: "sim-test" },
    );
    instanceIds.push(p1, p2);
    await insertLinkInstance(db, ctx.contactLinkTypeId, p1, p2, { source: "sim-test" });

    const countBefore = await countInstancesForEnv(db, ctx.environmentId);

    const { rows: scenarioRows } = await db.query<{ id: string }>(
      `INSERT INTO app.scenario (environment_id, name, params, owner_user_id, organization_id)
       VALUES ($1, $2, '{}'::jsonb, $3, $4)
       RETURNING id`,
      [ctx.environmentId, scenarioName, ctx.userId, ctx.organizationId],
    );
    const scenarioId = scenarioRows[0]!.id;

    const graph = await buildContactGraph(db, ctx.environmentId);
    const params: OutbreakParams = {
      runs: 5,
      horizonDays: 30,
      indexNodeIds: [p1],
      r0: 2.0,
    };
    const seed = 42_424;
    const result1 = runOutbreak(graph, params, seed);
    const result2 = runOutbreak(graph, params, seed);

    assert.equal(result1.summary.peakInfected, result2.summary.peakInfected);
    assert.equal(result1.summary.attackRate, result2.summary.attackRate);
    assert.ok("peakInfected" in result1.summary);
    assert.ok("peakIsolationDemand" in result1.summary);
    assert.ok("attackRate" in result1.summary);
    assert.ok(result1.trajectories.p50.length > 0);

    const { rows: runRows } = await db.query<{ id: string; status: string }>(
      `INSERT INTO app.simulation_run (scenario_id, status, seed, params, runs, summary, trajectories, finished_at)
       VALUES ($1, 'completed', $2, $3::jsonb, $4, $5::jsonb, $6::jsonb, NOW())
       RETURNING id, status`,
      [
        scenarioId,
        seed,
        JSON.stringify(params),
        params.runs,
        JSON.stringify(result1.summary),
        JSON.stringify(result1.trajectories),
      ],
    );
    assert.equal(runRows[0]?.status, "completed");

    const countAfter = await countInstancesForEnv(db, ctx.environmentId);
    assert.equal(countBefore, countAfter);
  });
});
