import type { DbClient } from "../lib/db.js";
import { AppError, BadRequest, NotFound } from "../lib/errors.js";

// ---------------------------------------------------------------------------
// Scenarios as an overlay.
//
// A scenario is a named, ordered list of edits over the live ontology — not a
// copy of it. The copy that exists today (scenario_instance / scenario_link) is
// frozen at clone time and lives in tables nothing else reads, which is why the
// twin cannot render a scenario and alerts cannot evaluate one.
//
// Resolution is defined here and used by reads in a later phase. Defining it
// first means the shape is settled before thirty call sites depend on it.
// ---------------------------------------------------------------------------

export type OverrideTargetType = "instance" | "link" | "param";
export type OverrideOp =
  | "create"
  | "set_property"
  | "delete"
  | "link"
  | "unlink"
  | "set_param";

export interface ScenarioOverride {
  id: string;
  scenarioId: string;
  seq: number;
  targetType: OverrideTargetType;
  targetId: string | null;
  targetLocalKey: string | null;
  op: OverrideOp;
  payload: Record<string, unknown>;
  effectiveOffsetHours: number;
  durationHours: number | null;
  note: string | null;
}

export interface Scenario {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  parentScenarioId: string | null;
  baseAsOf: string | null;
  status: "draft" | "ready" | "submitted" | "archived";
  createdAt: string;
}

interface ScenarioDbRow {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  parent_scenario_id: string | null;
  base_as_of: Date | null;
  status: Scenario["status"];
  created_at: Date;
}

interface OverrideDbRow {
  id: string;
  scenario_id: string;
  seq: number;
  target_type: OverrideTargetType;
  target_id: string | null;
  target_local_key: string | null;
  op: OverrideOp;
  payload: Record<string, unknown>;
  effective_offset_hours: number;
  duration_hours: number | null;
  note: string | null;
}

const S_SELECT = `
  SELECT id, project_id, name, description, parent_scenario_id, base_as_of, status, created_at
    FROM app.scenario`;

const O_SELECT = `
  SELECT id, scenario_id, seq, target_type, target_id, target_local_key, op,
         payload, effective_offset_hours, duration_hours, note
    FROM app.scenario_override`;

function outScenario(r: ScenarioDbRow): Scenario {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    description: r.description,
    parentScenarioId: r.parent_scenario_id,
    baseAsOf: r.base_as_of ? r.base_as_of.toISOString() : null,
    status: r.status,
    createdAt: r.created_at.toISOString(),
  };
}

function outOverride(r: OverrideDbRow): ScenarioOverride {
  return {
    id: r.id,
    scenarioId: r.scenario_id,
    seq: r.seq,
    targetType: r.target_type,
    targetId: r.target_id,
    targetLocalKey: r.target_local_key,
    op: r.op,
    payload: r.payload ?? {},
    effectiveOffsetHours: r.effective_offset_hours,
    durationHours: r.duration_hours,
    note: r.note,
  };
}

// --- scenarios ---------------------------------------------------------------

export async function getOverlayScenario(db: DbClient, id: string): Promise<Scenario> {
  const { rows } = await db.query<ScenarioDbRow>(`${S_SELECT} WHERE id = $1`, [id]);
  if (!rows[0]) throw NotFound("SCENARIO_NOT_FOUND", "Scenario not found.");
  return outScenario(rows[0]);
}

/**
 * Rename a scenario, or move it along its lifecycle.
 *
 * A scenario is a question somebody asked, and the first name it gets is the
 * one typed before the question was fully formed. Without this, "simulation de
 * scenario" stays "simulation de scenario" for ever, and a list of six of them
 * is a list nobody can read.
 *
 * Only the fields a person can reasonably change. Not the parent — re-parenting
 * changes what the scenario inherits and therefore what every one of its edits
 * resolves to, which is a different operation with a different confirmation.
 */
export async function updateOverlayScenario(
  db: DbClient,
  id: string,
  patch: { name?: string; description?: string | null; status?: Scenario["status"] },
): Promise<Scenario> {
  const { rows } = await db.query<ScenarioDbRow>(
    `UPDATE app.scenario
        SET name        = COALESCE($2, name),
            description = CASE WHEN $3::boolean THEN $4 ELSE description END,
            status      = COALESCE($5, status)
      WHERE id = $1
      RETURNING *`,
    [
      id,
      patch.name ?? null,
      patch.description !== undefined,
      patch.description ?? null,
      patch.status ?? null,
    ],
  );
  if (!rows[0]) throw NotFound("SCENARIO_NOT_FOUND", "Scenario not found.");
  return outScenario(rows[0]);
}

/**
 * Delete a scenario and everything proposed inside it.
 *
 * Refused while anything inherits from it. A child resolves its own edits *on
 * top of* its parent's, so removing the parent would silently change what every
 * one of the child's edits means — the child would keep running and answer a
 * different question, which is the failure this codebase is written against.
 */
export async function deleteOverlayScenario(
  db: DbClient,
  id: string,
): Promise<{ deleted: boolean; overrides: number }> {
  const { rows: children } = await db.query<{ name: string }>(
    `SELECT name FROM app.scenario WHERE parent_scenario_id = $1 ORDER BY name`,
    [id],
  );
  if (children.length > 0) {
    throw new AppError(
      "SCENARIO_HAS_CHILDREN",
      `This scenario is the basis for ${children.map((c) => `"${c.name}"`).join(", ")}. ` +
        `Deleting it would change what their edits resolve to. Delete or re-base those first.`,
      409,
    );
  }
  const { rows: counted } = await db.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM app.scenario_override WHERE scenario_id = $1`,
    [id],
  );
  const { rowCount } = await db.query(`DELETE FROM app.scenario WHERE id = $1`, [id]);
  if (!rowCount) throw NotFound("SCENARIO_NOT_FOUND", "Scenario not found.");
  return { deleted: true, overrides: Number(counted[0]?.n ?? 0) };
}

/**
 * The scenario and every ancestor, nearest last. Resolution applies them in
 * that order so a variant's own edits win over the ones it inherited.
 */
export async function scenarioChain(db: DbClient, id: string): Promise<Scenario[]> {
  const chain: Scenario[] = [];
  let cursor: string | null = id;
  const seen = new Set<string>();
  while (cursor) {
    // The database has a cycle trigger, but a chain assembled here is walked
    // one row at a time and a stale cycle would spin forever.
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const s: Scenario = await getOverlayScenario(db, cursor);
    chain.unshift(s);
    cursor = s.parentScenarioId;
  }
  return chain;
}

/** Every overlay scenario in a project, with how many edits each carries. */
export async function listOverlayScenarios(
  db: DbClient,
  projectId: string,
): Promise<(Scenario & { overrideCount: number })[]> {
  const { rows } = await db.query<ScenarioDbRow & { override_count: string }>(
    `SELECT s.id, s.project_id, s.name, s.description, s.parent_scenario_id,
            s.base_as_of, s.status, s.created_at,
            (SELECT COUNT(*) FROM app.scenario_override o WHERE o.scenario_id = s.id)
              AS override_count
       FROM app.scenario s
      WHERE s.project_id = $1
        AND s.status <> 'archived'
      ORDER BY s.created_at ASC`,
    [projectId],
  );
  return rows.map((r) => ({ ...outScenario(r), overrideCount: Number(r.override_count) }));
}

export async function createOverlayScenario(
  db: DbClient,
  input: {
    projectId: string;
    organizationId: string;
    name: string;
    description?: string | null;
    parentScenarioId?: string | null;
    baseAsOf?: string | null;
    ownerUserId: string;
  },
): Promise<Scenario> {
  const { rows } = await db.query<ScenarioDbRow>(
    `INSERT INTO app.scenario
            (project_id, organization_id, name, description, parent_scenario_id,
             base_as_of, owner_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, project_id, name, description, parent_scenario_id, base_as_of,
               status, created_at`,
    [
      input.projectId,
      input.organizationId,
      input.name,
      input.description ?? null,
      input.parentScenarioId ?? null,
      input.baseAsOf ?? null,
      input.ownerUserId,
    ],
  );
  return outScenario(rows[0]!);
}

// --- overrides ---------------------------------------------------------------

export async function listOverrides(db: DbClient, scenarioId: string): Promise<ScenarioOverride[]> {
  const { rows } = await db.query<OverrideDbRow>(
    `${O_SELECT} WHERE scenario_id = $1 ORDER BY effective_offset_hours ASC, seq ASC`,
    [scenarioId],
  );
  return rows.map(outOverride);
}

export async function addOverride(
  db: DbClient,
  scenarioId: string,
  input: Omit<ScenarioOverride, "id" | "scenarioId" | "seq"> & { seq?: number },
): Promise<ScenarioOverride> {
  const seq =
    input.seq ??
    (
      await db.query<{ next: number }>(
        `SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM app.scenario_override WHERE scenario_id = $1`,
        [scenarioId],
      )
    ).rows[0]!.next;

  const { rows } = await db.query<OverrideDbRow>(
    `INSERT INTO app.scenario_override
            (scenario_id, seq, target_type, target_id, target_local_key, op,
             payload, effective_offset_hours, duration_hours, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
     RETURNING id, scenario_id, seq, target_type, target_id, target_local_key, op,
               payload, effective_offset_hours, duration_hours, note`,
    [
      scenarioId,
      seq,
      input.targetType,
      input.targetId ?? null,
      input.targetLocalKey ?? null,
      input.op,
      JSON.stringify(input.payload ?? {}),
      input.effectiveOffsetHours ?? 0,
      input.durationHours ?? null,
      input.note ?? null,
    ],
  );
  return outOverride(rows[0]!);
}

export async function deleteOverride(db: DbClient, id: string): Promise<void> {
  await db.query(`DELETE FROM app.scenario_override WHERE id = $1`, [id]);
}

// --- resolution --------------------------------------------------------------

/**
 * The overrides in effect at a point in a scenario's timeline.
 *
 * Ancestors first, then the scenario's own, each ordered by seq. An override
 * applies once its offset has been reached, and stops applying once its
 * duration has elapsed — a ward closed for a week is open again on day 16.
 */
export function effectiveAt(
  overrides: ScenarioOverride[],
  atOffsetHours: number,
): ScenarioOverride[] {
  return overrides.filter((o) => {
    if (o.effectiveOffsetHours > atOffsetHours) return false;
    if (o.durationHours == null) return true;
    return atOffsetHours < o.effectiveOffsetHours + o.durationHours;
  });
}

/** Ancestors first, then own — the order later edits must win in. */
export async function resolveOverrides(
  db: DbClient,
  scenarioId: string,
  atOffsetHours = 0,
): Promise<ScenarioOverride[]> {
  const chain = await scenarioChain(db, scenarioId);
  const all: ScenarioOverride[] = [];
  for (const s of chain) {
    all.push(...(await listOverrides(db, s.id)));
  }
  return effectiveAt(all, atOffsetHours);
}

// --- validation --------------------------------------------------------------

export interface OverrideIssue {
  overrideId: string | null;
  message: string;
}

/**
 * Problems that would make a scenario resolve into something other than what
 * it looks like on the canvas. Reported together, same as the pipeline: fixing
 * one per run because resolution stopped at the first is the slowest loop.
 */
export function validateOverrides(overrides: ScenarioOverride[]): OverrideIssue[] {
  const issues: OverrideIssue[] = [];
  const created = new Set<string>();
  const deleted = new Set<string>();
  const seenProperty = new Map<string, string>();

  const ordered = [...overrides].sort(
    (a, b) => a.effectiveOffsetHours - b.effectiveOffsetHours || a.seq - b.seq,
  );

  for (const o of ordered) {
    if (!o.targetId && !o.targetLocalKey && o.targetType !== "param") {
      issues.push({ overrideId: o.id, message: "This edit names no target." });
      continue;
    }
    if (o.op === "create" && o.targetLocalKey) created.add(o.targetLocalKey);

    // Pointing at something this scenario invents, before it invents it.
    if (o.targetLocalKey && o.op !== "create" && !created.has(o.targetLocalKey)) {
      issues.push({
        overrideId: o.id,
        message: `"${o.targetLocalKey}" is not created by any earlier edit in this scenario.`,
      });
    }

    const key = o.targetId ?? o.targetLocalKey ?? "";
    if (o.op === "delete") deleted.add(key);
    else if (deleted.has(key)) {
      issues.push({
        overrideId: o.id,
        message: "This edit changes something an earlier edit deleted, so it does nothing.",
      });
    }

    // Two writes to the same property at the same instant: seq decides, but
    // the order is arbitrary from the author's point of view.
    if (o.op === "set_property") {
      const prop = String(o.payload.property ?? "");
      const slot = `${key}|${prop}|${o.effectiveOffsetHours}`;
      if (seenProperty.has(slot)) {
        issues.push({
          overrideId: o.id,
          message: `Two edits set "${prop}" at the same offset; the later one silently wins.`,
        });
      }
      seenProperty.set(slot, o.id);
    }

    if (o.durationHours != null && o.durationHours <= 0) {
      issues.push({ overrideId: o.id, message: "A duration must be at least one hour." });
    }
    if (o.effectiveOffsetHours < 0) {
      issues.push({ overrideId: o.id, message: "An offset cannot be before the scenario starts." });
    }
  }
  return issues;
}

/** Refuse a scenario that cannot resolve. Used before a run, not on every edit. */
export function assertResolvable(overrides: ScenarioOverride[]): void {
  const issues = validateOverrides(overrides);
  const blocking = issues.filter((i) => !i.message.includes("silently wins"));
  if (blocking.length > 0) {
    throw BadRequest("SCENARIO_INVALID", blocking.map((i) => i.message).join(" "));
  }
}
