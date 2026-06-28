import "dotenv/config";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { pool } from "../db/pool.js";
import type { DbClient } from "../lib/db.js";
import {
  countInstancesForEnv,
  getOrCreateLinkType,
  insertLinkInstance,
  insertObjectInstance,
} from "./ontology.js";
import {
  buildContactGraphFromCopy,
  runOutbreakSimulation,
  type OutbreakParams,
} from "./simulation.js";
import { createAlertRule, seedTwinSchema } from "./twin.js";
import {
  cloneSubtree,
  injectScenario,
  loadScenarioCopy,
} from "./twin-clone.js";

const TEST_ENV_SLUG = "test-twin-clone";
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

async function ensureCloneTestEnvironment(): Promise<{
  environmentId: string;
  organizationId: string;
  userId: string;
  schema: Awaited<ReturnType<typeof seedTwinSchema>>;
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
     VALUES ($1, $2, 'Twin Clone Test Lab', $3, 'operations')
     ON CONFLICT (organization_id, slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [userId, organizationId, TEST_ENV_SLUG],
  );
  const environmentId = envRows[0]!.id;
  const schema = await seedTwinSchema(db, environmentId);
  const contactLinkTypeId = await getOrCreateLinkType(
    db,
    environmentId,
    "contacts",
    schema.patientTypeId,
    schema.patientTypeId,
    "many_to_many",
  );
  return { environmentId, organizationId, userId, schema, contactLinkTypeId };
}

async function cleanupCloneArtifacts(
  environmentId: string,
  instanceIds: string[],
): Promise<void> {
  await db.query(`DELETE FROM app.simulation_run WHERE scenario_id IN (
    SELECT id FROM app.scenario WHERE environment_id = $1
  )`, [environmentId]);
  await db.query(`DELETE FROM app.scenario_link WHERE scenario_id IN (
    SELECT id FROM app.scenario WHERE environment_id = $1
  )`, [environmentId]);
  await db.query(`DELETE FROM app.scenario_instance WHERE scenario_id IN (
    SELECT id FROM app.scenario WHERE environment_id = $1
  )`, [environmentId]);
  await db.query(`DELETE FROM app.scenario WHERE environment_id = $1`, [environmentId]);
  await db.query(`DELETE FROM app.twin_alert_rule WHERE environment_id = $1`, [environmentId]);
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
}

describe("twin-clone integration (test-twin-clone)", () => {
  let ctx: Awaited<ReturnType<typeof ensureCloneTestEnvironment>>;
  const instanceIds: string[] = [];
  const scenarioName = `clone-test-${Date.now()}`;

  before(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for integration tests");
    }
    ctx = await ensureCloneTestEnvironment();
    await cleanupCloneArtifacts(ctx.environmentId, instanceIds);
  });

  after(async () => {
    await cleanupCloneArtifacts(ctx.environmentId, instanceIds);
    await pool.end();
  });

  it("clones subtree, injects index patient, runs simulation without mutating live instances", async () => {
    const root = await insertObjectInstance(
      db,
      ctx.schema.orgUnitTypeId,
      { name: "Clone Org", kind: "org", code: "CORG" },
      { source: "clone-test" },
    );
    const ward = await insertObjectInstance(
      db,
      ctx.schema.orgUnitTypeId,
      { name: "Clone Ward", kind: "ward", code: "CW" },
      { source: "clone-test" },
    );
    instanceIds.push(root, ward);
    await insertLinkInstance(db, ctx.schema.containsLinkTypeId, root, ward, {
      source: "clone-test",
    });

    const p1 = await insertObjectInstance(
      db,
      ctx.schema.patientTypeId,
      { identifier: "CL-P1", label: "Patient 1" },
      { source: "clone-test" },
    );
    const p2 = await insertObjectInstance(
      db,
      ctx.schema.patientTypeId,
      { identifier: "CL-P2", label: "Patient 2" },
      { source: "clone-test" },
    );
    instanceIds.push(p1, p2);
    await insertLinkInstance(db, ctx.schema.locatedInLinkTypeId, p1, ward, {
      source: "clone-test",
    });
    await insertLinkInstance(db, ctx.schema.locatedInLinkTypeId, p2, ward, {
      source: "clone-test",
    });
    await insertLinkInstance(db, ctx.contactLinkTypeId, p1, p2, { source: "clone-test" });

    const countBefore = await countInstancesForEnv(db, ctx.environmentId);

    const { scenarioId, instanceCount } = await cloneSubtree(
      db,
      ctx.environmentId,
      ward,
      scenarioName,
      ctx.userId,
      ctx.organizationId,
    );
    assert.ok(instanceCount >= 3);

    let copy = await loadScenarioCopy(db, scenarioId);
    assert.ok(copy.instances.length >= 3);

    const patientCopies = copy.instances.filter((i) => i.objectTypeName === "Patient");
    assert.ok(patientCopies.length >= 2);
    if (patientCopies.length >= 2) {
      await db.query(
        `INSERT INTO app.scenario_link (scenario_id, link_type_name, from_id, to_id)
         VALUES ($1, 'contacts', $2, $3)`,
        [scenarioId, patientCopies[0]!.id, patientCopies[1]!.id],
      );
    }

    const { instanceIds: injectedIds } = await injectScenario(db, scenarioId, {
      instances: [
        {
          objectTypeName: "Patient",
          properties: { identifier: "CL-IDX", label: "Index case" },
        },
      ],
      paramOverrides: { horizonDays: 20 },
    });
    assert.equal(injectedIds.length, 1);

    copy = await loadScenarioCopy(db, scenarioId);
    const indexId = injectedIds[0]!;
    await db.query(
      `INSERT INTO app.scenario_link (scenario_id, link_type_name, from_id, to_id)
       VALUES ($1, 'contacts', $2, $3)`,
      [scenarioId, indexId, patientCopies[0]!.id],
    );
    copy = await loadScenarioCopy(db, scenarioId);

    await createAlertRule(db, ctx.environmentId, ctx.userId, ctx.organizationId, {
      unitKind: "ward",
      metric: "infectedCount",
      op: ">=",
      threshold: 1,
      severity: "critical",
      messageTemplate: "Infected count {{value}} on ward",
      recommendationTemplate: "Activate isolation protocol",
    });

    const graph = buildContactGraphFromCopy(copy.instances, copy.links);
    const params: OutbreakParams = {
      runs: 5,
      horizonDays: 20,
      indexNodeIds: [indexId],
      r0: 2.5,
    };
    const seed = 99_001;
    const result = runOutbreakSimulation(graph, params, seed);

    assert.ok("peakInfected" in result.summary);
    assert.ok("peakIsolationDemand" in result.summary);
    assert.ok("attackRate" in result.summary);
    assert.ok(result.trajectories.p50.length > 0);
    assert.ok(Array.isArray(result.alertTimeline));

    const { rows: runRows } = await db.query<{ id: string; alert_timeline: unknown }>(
      `INSERT INTO app.simulation_run
         (scenario_id, status, seed, params, runs, summary, trajectories, alert_timeline, finished_at)
       VALUES ($1, 'completed', $2, $3::jsonb, $4, $5::jsonb, $6::jsonb, $7::jsonb, NOW())
       RETURNING id, alert_timeline`,
      [
        scenarioId,
        seed,
        JSON.stringify(params),
        params.runs,
        JSON.stringify(result.summary),
        JSON.stringify(result.trajectories),
        JSON.stringify(result.alertTimeline),
      ],
    );
    assert.ok(runRows[0]?.alert_timeline);

    const countAfter = await countInstancesForEnv(db, ctx.environmentId);
    assert.equal(countBefore, countAfter);
  });
});
