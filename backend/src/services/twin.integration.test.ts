import "dotenv/config";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { pool } from "../db/pool.js";
import type { DbClient } from "../lib/db.js";
import {
  getOrCreateLinkType,
  insertLinkInstance,
  insertObjectInstance,
} from "./ontology.js";
import {
  ackAlert,
  createAlertRule,
  evaluateAlerts,
  getUnitTree,
  listOpenAlerts,
  rollupUnit,
  seedTwinSchema,
} from "./twin.js";

const TEST_ENV_SLUG = "test-twin";
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

async function ensureTwinTestEnvironment(): Promise<{
  environmentId: string;
  organizationId: string;
  userId: string;
  schema: Awaited<ReturnType<typeof seedTwinSchema>>;
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
     VALUES ($1, $2, 'Twin Test Lab', $3, 'operations')
     ON CONFLICT (organization_id, slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [userId, organizationId, TEST_ENV_SLUG],
  );
  const environmentId = envRows[0]!.id;
  const schema = await seedTwinSchema(db, environmentId);
  return { environmentId, organizationId, userId, schema };
}

async function cleanupTwinArtifacts(
  environmentId: string,
  instanceIds: string[],
): Promise<void> {
  await db.query(`DELETE FROM app.twin_alert WHERE environment_id = $1`, [environmentId]);
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

describe("twin integration (test-twin)", () => {
  let ctx: Awaited<ReturnType<typeof ensureTwinTestEnvironment>>;
  const instanceIds: string[] = [];

  before(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for integration tests");
    }
    ctx = await ensureTwinTestEnvironment();
    await cleanupTwinArtifacts(ctx.environmentId, instanceIds);
  });

  after(async () => {
    await cleanupTwinArtifacts(ctx.environmentId, instanceIds);
    await pool.end();
  });

  it("builds unit tree, rollups, alerts, and does not mutate instance properties", async () => {
    const root = await insertObjectInstance(
      db,
      ctx.schema.orgUnitTypeId,
      { name: "Test Org", kind: "org", code: "TORG" },
      { source: "twin-test" },
    );
    const ward = await insertObjectInstance(
      db,
      ctx.schema.orgUnitTypeId,
      { name: "Ward A", kind: "ward", code: "WA" },
      { source: "twin-test" },
    );
    instanceIds.push(root, ward);
    await insertLinkInstance(db, ctx.schema.containsLinkTypeId, root, ward, {
      source: "twin-test",
    });

    const bed1 = await insertObjectInstance(
      db,
      ctx.schema.bedTypeId,
      { label: "Bed 1", status: "occupied" },
      { source: "twin-test" },
    );
    const bed2 = await insertObjectInstance(
      db,
      ctx.schema.bedTypeId,
      { label: "Bed 2", status: "available" },
      { source: "twin-test" },
    );
    instanceIds.push(bed1, bed2);
    await insertLinkInstance(db, ctx.schema.locatedInBedLinkTypeId, bed1, ward, {
      source: "twin-test",
    });
    await insertLinkInstance(db, ctx.schema.locatedInBedLinkTypeId, bed2, ward, {
      source: "twin-test",
    });

    const tree = await getUnitTree(db, ctx.environmentId);
    assert.ok(tree.nodes.length >= 2);
    assert.ok(tree.roots.includes(root));
    assert.ok(tree.edges.some((e) => e.fromId === root && e.toId === ward));

    const wardMetrics = await rollupUnit(db, ctx.environmentId, ward);
    assert.equal(wardMetrics.instanceCountByType.Bed, 2);
    assert.equal(wardMetrics.occupancyPct, 50);
    assert.equal(wardMetrics.linkedInstanceCount, 2);

    const { rows: propsBefore } = await db.query<{ properties: Record<string, unknown> }>(
      `SELECT properties FROM app.ontology_object_instances WHERE id = $1`,
      [bed1],
    );
    const beforeJson = JSON.stringify(propsBefore[0]!.properties);

    const rule = await createAlertRule(db, ctx.environmentId, ctx.userId, ctx.organizationId, {
      unitKind: "ward",
      metric: "occupancyPct",
      op: ">",
      threshold: 40,
      severity: "warn",
      messageTemplate: "Occupancy {{value}}% exceeds {{threshold}}%",
      recommendationTemplate: "Review bed allocation",
    });

    const unitKinds = new Map(tree.nodes.map((n) => [n.id, n.kind]));
    const metricsMap = new Map([[ward, wardMetrics]]);
    const alerts = await evaluateAlerts(
      db,
      ctx.environmentId,
      metricsMap,
      unitKinds,
      [rule],
    );
    assert.ok(alerts.length >= 1);
    assert.equal(alerts[0]!.status, "open");
    assert.equal(alerts[0]!.isNew, true);

    // Idempotency: re-evaluating must refresh the same open alert, not spam a
    // new row every SSE/poll tick.
    const before = await listOpenAlerts(db, ctx.environmentId, ward);
    const reEval = await evaluateAlerts(db, ctx.environmentId, metricsMap, unitKinds, [rule]);
    assert.equal(reEval[0]!.id, alerts[0]!.id);
    assert.equal(reEval[0]!.isNew, false);
    const after = await listOpenAlerts(db, ctx.environmentId, ward);
    assert.equal(after.length, before.length);

    await ackAlert(db, ctx.environmentId, alerts[0]!.id);
    const { rows: ackRows } = await db.query<{ status: string; acked_at: Date | null }>(
      `SELECT status, acked_at FROM app.twin_alert WHERE id = $1`,
      [alerts[0]!.id],
    );
    assert.equal(ackRows[0]?.status, "ack");
    assert.ok(ackRows[0]?.acked_at);

    const { rows: propsAfter } = await db.query<{ properties: Record<string, unknown> }>(
      `SELECT properties FROM app.ontology_object_instances WHERE id = $1`,
      [bed1],
    );
    assert.equal(JSON.stringify(propsAfter[0]!.properties), beforeJson);
  });
});
