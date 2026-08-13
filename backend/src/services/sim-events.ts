import type { DbClient } from "../lib/db.js";
import { BadRequest, Conflict, NotFound } from "../lib/errors.js";

/**
 * Events an institution composed for itself.
 *
 * The three shipped templates generate their effects from the state of the
 * network, which makes them portable and useless for anything specific: nobody
 * can express "the east wing is out from week two to week six" or "the new
 * vaccination programme removes a fifth of the winter wave". Those are the
 * questions a health authority actually has.
 *
 * Nothing here knows what an effect means. The shape belongs to the engine,
 * which validates it with pydantic and refuses effects aimed at things the twin
 * does not contain. Re-deriving that in SQL or in zod would create a second
 * truth to keep in agreement, and it is always the copy that falls behind.
 * What this layer does own is the two questions the engine cannot answer:
 * whether this event belongs to the caller, and whether it still points at a
 * world that exists.
 */

export type EffectKind = "demand" | "capacity" | "connectivity";

export interface SimEventRow {
  id: string;
  name: string;
  description: string;
  horizon: number;
  effects: Array<Record<string, unknown>>;
  twinScenarioId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  name: string;
  description: string;
  horizon: number;
  effects: Array<Record<string, unknown>>;
  twin_scenario_id: string | null;
  created_at: Date;
  updated_at: Date;
}

function toRow(r: Row): SimEventRow {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    horizon: r.horizon,
    effects: r.effects ?? [],
    twinScenarioId: r.twin_scenario_id,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

const SELECT = `SELECT id, name, description, horizon, effects, twin_scenario_id,
                       created_at, updated_at
                  FROM app.sim_event`;

const ORG = `(SELECT organization_id FROM app.project WHERE id = $1)`;

export async function listSimEvents(
  db: DbClient,
  environmentId: string,
): Promise<SimEventRow[]> {
  const { rows } = await db.query<Row>(
    `${SELECT} WHERE organization_id = ${ORG} ORDER BY created_at DESC`,
    [environmentId],
  );
  return rows.map(toRow);
}

export async function getSimEvent(
  db: DbClient,
  environmentId: string,
  id: string,
): Promise<SimEventRow> {
  const { rows } = await db.query<Row>(
    `${SELECT} WHERE organization_id = ${ORG} AND id = $2`,
    [environmentId, id],
  );
  const r = rows[0];
  if (!r) throw NotFound("EVENT_NOT_FOUND", "Event not found.");
  return toRow(r);
}

export interface SimEventInput {
  name: string;
  description?: string;
  horizon: number;
  effects: Array<Record<string, unknown>>;
  twinScenarioId?: string | null;
}

/**
 * The one structural rule worth enforcing here rather than in the engine.
 *
 * Effect ids end up in the trace as the reason a rule fired, so two effects
 * sharing one id makes an audit trail that cannot be followed back — and the
 * engine would not notice, because both are perfectly valid on their own.
 */
function assertDistinctIds(effects: Array<Record<string, unknown>>): void {
  const seen = new Set<string>();
  for (const e of effects) {
    const id = String(e.id ?? "").trim();
    if (!id) throw BadRequest("EFFECT_NEEDS_ID", "Every effect needs an id.");
    if (seen.has(id)) {
      throw BadRequest(
        "EFFECT_ID_REPEATED",
        `Two effects are both called "${id}". Effect ids appear in the trace as the ` +
          `reason something happened, so they have to be distinct.`,
      );
    }
    seen.add(id);
  }
}

export async function createSimEvent(
  db: DbClient,
  environmentId: string,
  userId: string,
  input: SimEventInput,
): Promise<SimEventRow> {
  assertDistinctIds(input.effects);
  try {
    const { rows } = await db.query<Row>(
      `INSERT INTO app.sim_event
           (organization_id, name, description, horizon, effects, twin_scenario_id, created_by)
       VALUES (${ORG}, $2, $3, $4, $5::jsonb, $6, $7)
       RETURNING id, name, description, horizon, effects, twin_scenario_id,
                 created_at, updated_at`,
      [
        environmentId,
        input.name,
        input.description ?? "",
        input.horizon,
        JSON.stringify(input.effects),
        input.twinScenarioId ?? null,
        userId,
      ],
    );
    return toRow(rows[0]!);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw Conflict("EVENT_EXISTS", `An event called "${input.name}" already exists.`);
    }
    throw err;
  }
}

export async function updateSimEvent(
  db: DbClient,
  environmentId: string,
  id: string,
  input: SimEventInput,
): Promise<SimEventRow> {
  assertDistinctIds(input.effects);
  try {
    const { rows } = await db.query<Row>(
      `UPDATE app.sim_event
          SET name = $3, description = $4, horizon = $5, effects = $6::jsonb,
              twin_scenario_id = $7, updated_at = NOW()
        WHERE organization_id = ${ORG} AND id = $2
        RETURNING id, name, description, horizon, effects, twin_scenario_id,
                  created_at, updated_at`,
      [
        environmentId,
        id,
        input.name,
        input.description ?? "",
        input.horizon,
        JSON.stringify(input.effects),
        input.twinScenarioId ?? null,
      ],
    );
    const r = rows[0];
    if (!r) throw NotFound("EVENT_NOT_FOUND", "Event not found.");
    return toRow(r);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw Conflict("EVENT_EXISTS", `An event called "${input.name}" already exists.`);
    }
    throw err;
  }
}

export async function deleteSimEvent(
  db: DbClient,
  environmentId: string,
  id: string,
): Promise<void> {
  const res = await db.query(
    `DELETE FROM app.sim_event WHERE organization_id = ${ORG} AND id = $2`,
    [environmentId, id],
  );
  if (!res.rowCount) throw NotFound("EVENT_NOT_FOUND", "Event not found.");
}

/**
 * Refuse to run an event against a world it was not written for.
 *
 * Effects name instances by id. Run one composed against a scenario on the live
 * twin and every target is a stranger — the engine rejects it with "no facility
 * <uuid>", which is true and tells the reader nothing about what they actually
 * did wrong. Saying it here, in terms of the two worlds, is the difference
 * between a puzzle and an instruction.
 */
export function assertEventMatchesWorld(
  event: SimEventRow,
  twinScenarioId: string | null,
): void {
  const want = event.twinScenarioId ?? null;
  const have = twinScenarioId ?? null;
  if (want === have) return;
  throw BadRequest(
    "EVENT_WORLD_MISMATCH",
    want === null
      ? `"${event.name}" was composed against the live twin, so its effects name ` +
          `instances that a scenario may have changed or removed. Switch back to the ` +
          `live twin, or copy the event and re-target it.`
      : `"${event.name}" was composed against a scenario, and its effects name ` +
          `instances that only exist there. Select that scenario to run it.`,
  );
}
