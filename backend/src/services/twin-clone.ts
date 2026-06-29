import { clampLimit, clampOffset } from "../lib/config.js";
import type { DbClient } from "../lib/db.js";
import { NotFound } from "../lib/errors.js";
import { withTransaction } from "../lib/transaction.js";
import { CONTAINS_LINK, LOCATED_IN_LINK_NAMES } from "./twin.js";
import { listInstancesForEnv, listLinksForEnv } from "./ontology.js";

export interface ScenarioInstanceRow {
  id: string;
  scenarioId: string;
  sourceInstanceId: string | null;
  objectTypeName: string;
  properties: Record<string, unknown>;
}

export interface ScenarioLinkRow {
  id: string;
  scenarioId: string;
  linkTypeName: string;
  fromId: string;
  toId: string;
}

export interface ScenarioRow {
  id: string;
  environmentId: string;
  name: string;
  params: Record<string, unknown>;
  rootUnitInstanceId: string | null;
  ownerUserId: string;
  organizationId: string;
  createdAt: Date;
}

export async function getScenarioForEnv(
  db: DbClient,
  scenarioId: string,
  environmentId: string,
): Promise<ScenarioRow> {
  const { rows } = await db.query<{
    id: string;
    environment_id: string;
    name: string;
    params: Record<string, unknown>;
    root_unit_instance_id: string | null;
    owner_user_id: string;
    organization_id: string;
    created_at: Date;
  }>(
    `SELECT id, environment_id, name, params, root_unit_instance_id,
            owner_user_id, organization_id, created_at
       FROM app.scenario
      WHERE id = $1 AND environment_id = $2`,
    [scenarioId, environmentId],
  );
  const r = rows[0];
  if (!r) throw NotFound("SCENARIO_NOT_FOUND", "Scenario not found in this environment.");
  return {
    id: r.id,
    environmentId: r.environment_id,
    name: r.name,
    params: r.params ?? {},
    rootUnitInstanceId: r.root_unit_instance_id,
    ownerUserId: r.owner_user_id,
    organizationId: r.organization_id,
    createdAt: r.created_at,
  };
}

export async function listScenarios(
  db: DbClient,
  environmentId: string,
  page?: { limit?: number; offset?: number },
): Promise<ScenarioRow[]> {
  const limit = clampLimit(page?.limit);
  const offset = clampOffset(page?.offset);
  const { rows } = await db.query<{
    id: string;
    environment_id: string;
    name: string;
    params: Record<string, unknown>;
    root_unit_instance_id: string | null;
    owner_user_id: string;
    organization_id: string;
    created_at: Date;
  }>(
    `SELECT id, environment_id, name, params, root_unit_instance_id,
            owner_user_id, organization_id, created_at
       FROM app.scenario
      WHERE environment_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [environmentId, limit, offset],
  );
  return rows.map((r) => ({
    id: r.id,
    environmentId: r.environment_id,
    name: r.name,
    params: r.params ?? {},
    rootUnitInstanceId: r.root_unit_instance_id,
    ownerUserId: r.owner_user_id,
    organizationId: r.organization_id,
    createdAt: r.created_at,
  }));
}

function collectSubtree(
  rootId: string,
  containsEdges: Array<{ from: string; to: string }>,
): Set<string> {
  const units = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of containsEdges) {
      if (units.has(e.from) && !units.has(e.to)) {
        units.add(e.to);
        changed = true;
      }
    }
  }
  return units;
}

export async function cloneSubtree(
  db: DbClient,
  environmentId: string,
  rootUnitId: string,
  name: string,
  userId: string,
  organizationId: string,
): Promise<{ scenarioId: string; instanceCount: number; linkCount: number }> {
  return withTransaction(async (tx) => {
    const instances = await listInstancesForEnv(tx, environmentId, { limit: 10_000 });
    const links = await listLinksForEnv(tx, environmentId);

    const unitIds = new Set(
      instances.filter((i) => i.typeName === "OrgUnit").map((i) => i.id),
    );
    if (!unitIds.has(rootUnitId)) {
      throw NotFound("UNIT_NOT_FOUND", "Root OrgUnit not found.");
    }

    const containsEdges = links
      .filter((l) => l.linkTypeName === CONTAINS_LINK)
      .map((l) => ({ from: l.fromInstanceId, to: l.toInstanceId }));
    const subtreeUnits = collectSubtree(rootUnitId, containsEdges);

    const locatedLinks = links.filter(
      (l) =>
        LOCATED_IN_LINK_NAMES.includes(l.linkTypeName as (typeof LOCATED_IN_LINK_NAMES)[number]) &&
        subtreeUnits.has(l.toInstanceId),
    );

    const liveInstanceIds = new Set<string>([...subtreeUnits]);
    for (const l of locatedLinks) liveInstanceIds.add(l.fromInstanceId);

    const relevantContains = links.filter(
      (l) =>
        l.linkTypeName === CONTAINS_LINK &&
        subtreeUnits.has(l.fromInstanceId) &&
        subtreeUnits.has(l.toInstanceId),
    );

    const idMap = new Map<string, string>();

    const { rows: scenarioRows } = await tx.query<{ id: string }>(
      `INSERT INTO app.scenario
         (environment_id, name, params, root_unit_instance_id, owner_user_id, organization_id)
       VALUES ($1, $2, '{}'::jsonb, $3, $4, $5)
       RETURNING id`,
      [environmentId, name, rootUnitId, userId, organizationId],
    );
    const scenarioId = scenarioRows[0]!.id;

    for (const liveId of liveInstanceIds) {
      const inst = instances.find((i) => i.id === liveId);
      if (!inst) continue;
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO app.scenario_instance
           (scenario_id, source_instance_id, object_type_name, properties)
         VALUES ($1, $2, $3, $4::jsonb)
         RETURNING id`,
        [scenarioId, liveId, inst.typeName, JSON.stringify(inst.properties)],
      );
      idMap.set(liveId, rows[0]!.id);
    }

    let linkCount = 0;
    const allLiveLinks = [...relevantContains, ...locatedLinks];
    for (const l of allLiveLinks) {
      const fromId = idMap.get(l.fromInstanceId);
      const toId = idMap.get(l.toInstanceId);
      if (!fromId || !toId) continue;
      await tx.query(
        `INSERT INTO app.scenario_link (scenario_id, link_type_name, from_id, to_id)
         VALUES ($1, $2, $3, $4)`,
        [scenarioId, l.linkTypeName, fromId, toId],
      );
      linkCount++;
    }

    return {
      scenarioId,
      instanceCount: idMap.size,
      linkCount,
    };
  });
}

export async function loadScenarioCopy(
  db: DbClient,
  scenarioId: string,
): Promise<{ instances: ScenarioInstanceRow[]; links: ScenarioLinkRow[] }> {
  const { rows: instRows } = await db.query<{
    id: string;
    scenario_id: string;
    source_instance_id: string | null;
    object_type_name: string;
    properties: Record<string, unknown>;
  }>(
    `SELECT id, scenario_id, source_instance_id, object_type_name, properties
       FROM app.scenario_instance
      WHERE scenario_id = $1`,
    [scenarioId],
  );
  const { rows: linkRows } = await db.query<{
    id: string;
    scenario_id: string;
    link_type_name: string;
    from_id: string;
    to_id: string;
  }>(
    `SELECT id, scenario_id, link_type_name, from_id, to_id
       FROM app.scenario_link
      WHERE scenario_id = $1`,
    [scenarioId],
  );
  return {
    instances: instRows.map((r) => ({
      id: r.id,
      scenarioId: r.scenario_id,
      sourceInstanceId: r.source_instance_id,
      objectTypeName: r.object_type_name,
      properties: r.properties ?? {},
    })),
    links: linkRows.map((r) => ({
      id: r.id,
      scenarioId: r.scenario_id,
      linkTypeName: r.link_type_name,
      fromId: r.from_id,
      toId: r.to_id,
    })),
  };
}

export async function injectScenario(
  db: DbClient,
  scenarioId: string,
  body: {
    instances?: Array<{
      objectTypeName: string;
      properties: Record<string, unknown>;
      sourceInstanceId?: string | null;
    }>;
    paramOverrides?: Record<string, unknown>;
  },
): Promise<{ instanceIds: string[] }> {
  const instanceIds: string[] = [];
  for (const inst of body.instances ?? []) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO app.scenario_instance
         (scenario_id, source_instance_id, object_type_name, properties)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING id`,
      [
        scenarioId,
        inst.sourceInstanceId ?? null,
        inst.objectTypeName,
        JSON.stringify(inst.properties),
      ],
    );
    instanceIds.push(rows[0]!.id);
  }
  if (body.paramOverrides && Object.keys(body.paramOverrides).length > 0) {
    await db.query(
      `UPDATE app.scenario
          SET params = params || $2::jsonb
        WHERE id = $1`,
      [scenarioId, JSON.stringify(body.paramOverrides)],
    );
  }
  return { instanceIds };
}

export async function getSimulationRun(
  db: DbClient,
  scenarioId: string,
  runId: string,
): Promise<{
  id: string;
  status: string;
  seed: string;
  params: Record<string, unknown>;
  runs: number;
  summary: Record<string, unknown> | null;
  trajectories: Record<string, unknown> | null;
  alertTimeline: unknown[] | null;
  createdAt: Date;
  finishedAt: Date | null;
}> {
  const { rows } = await db.query<{
    id: string;
    status: string;
    seed: string;
    params: Record<string, unknown>;
    runs: number;
    summary: Record<string, unknown> | null;
    trajectories: Record<string, unknown> | null;
    alert_timeline: unknown[] | null;
    created_at: Date;
    finished_at: Date | null;
  }>(
    `SELECT id, status, seed::text, params, runs, summary, trajectories,
            alert_timeline, created_at, finished_at
       FROM app.simulation_run
      WHERE id = $1 AND scenario_id = $2`,
    [runId, scenarioId],
  );
  const r = rows[0];
  if (!r) throw NotFound("RUN_NOT_FOUND", "Simulation run not found.");
  return {
    id: r.id,
    status: r.status,
    seed: r.seed,
    params: r.params ?? {},
    runs: r.runs,
    summary: r.summary,
    trajectories: r.trajectories,
    alertTimeline: r.alert_timeline,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
  };
}

export async function listScenarioRuns(
  db: DbClient,
  scenarioId: string,
  page?: { limit?: number; offset?: number },
): Promise<
  Array<{
    id: string;
    status: string;
    seed: string;
    runs: number;
    createdAt: Date;
    finishedAt: Date | null;
  }>
> {
  const limit = clampLimit(page?.limit ?? 50);
  const offset = clampOffset(page?.offset);
  const { rows } = await db.query<{
    id: string;
    status: string;
    seed: string;
    runs: number;
    created_at: Date;
    finished_at: Date | null;
  }>(
    `SELECT id, status, seed::text, runs, created_at, finished_at
       FROM app.simulation_run
      WHERE scenario_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [scenarioId, limit, offset],
  );
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    seed: r.seed,
    runs: r.runs,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
  }));
}
