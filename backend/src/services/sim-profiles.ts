import type { DbClient } from "../lib/db.js";
import { BadRequest, Conflict, NotFound } from "../lib/errors.js";

/**
 * Profiles an organisation saved for itself: a series it imported, an
 * exposure it described, changes it kept from an event.
 *
 * A profile is reusable on any network, so it stores nothing of the twin it
 * was made in: a series is a rate per 1,000 residents, an exposure a
 * coefficient and its values, and saved changes are re-aimed when they are
 * dropped into an event. The engine never reads a profile; it only sees the
 * effects one produces once it is in an event.
 *
 * Nothing here interprets the body beyond its kind and its size. The Studio
 * owns the shape, and the effects it produces are checked by the engine like
 * any others.
 */

export type ProfileKind = "series" | "exposure" | "changes";
const KINDS: ProfileKind[] = ["series", "exposure", "changes"];

/** A profile is a few kilobytes; a megabyte is an imported file, not a profile. */
const MAX_BODY_BYTES = 512 * 1024;

export interface SimProfileRow {
  id: string;
  name: string;
  description: string;
  body: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  name: string;
  description: string;
  body: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

function toRow(r: Row): SimProfileRow {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    body: r.body ?? {},
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

const SELECT = `SELECT id, name, description, body, created_at, updated_at
                  FROM app.sim_profile`;

const ORG = `(SELECT organization_id FROM app.project WHERE id = $1)`;

export interface SimProfileInput {
  name: string;
  description?: string;
  body: Record<string, unknown>;
}

/** The two things worth refusing here: a kind the Studio cannot rebuild, and a body that is a file. */
export function assertProfileBody(body: Record<string, unknown>): void {
  const kind = body.kind;
  if (typeof kind !== "string" || !KINDS.includes(kind as ProfileKind)) {
    throw BadRequest("PROFILE_KIND", `A profile is a series, an exposure or saved changes; got "${String(kind)}".`);
  }
  const size = Buffer.byteLength(JSON.stringify(body), "utf8");
  if (size > MAX_BODY_BYTES) {
    throw BadRequest("PROFILE_TOO_LARGE", `This profile is ${Math.round(size / 1024)} KB. A profile keeps the daily rate, not the file it came from: keep it under ${MAX_BODY_BYTES / 1024} KB.`);
  }
  if (kind === "series") {
    const curve = body.curve;
    if (!Array.isArray(curve) || curve.length === 0 || curve.some((v) => typeof v !== "number" || !Number.isFinite(v) || v < 0)) {
      throw BadRequest("PROFILE_SERIES", "A series profile needs a daily rate: a list of numbers, none negative.");
    }
  }
}

export async function listSimProfiles(db: DbClient, environmentId: string): Promise<SimProfileRow[]> {
  const { rows } = await db.query<Row>(`${SELECT} WHERE organization_id = ${ORG} ORDER BY updated_at DESC`, [environmentId]);
  return rows.map(toRow);
}

export async function createSimProfile(db: DbClient, environmentId: string, userId: string, input: SimProfileInput): Promise<SimProfileRow> {
  assertProfileBody(input.body);
  try {
    const { rows } = await db.query<Row>(
      `INSERT INTO app.sim_profile (organization_id, name, description, body, created_by)
       VALUES (${ORG}, $2, $3, $4::jsonb, $5)
       RETURNING id, name, description, body, created_at, updated_at`,
      [environmentId, input.name, input.description ?? "", JSON.stringify(input.body), userId],
    );
    return toRow(rows[0]!);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw Conflict("PROFILE_EXISTS", `A profile called "${input.name}" already exists.`);
    throw err;
  }
}

export async function updateSimProfile(db: DbClient, environmentId: string, id: string, input: SimProfileInput): Promise<SimProfileRow> {
  assertProfileBody(input.body);
  try {
    const { rows } = await db.query<Row>(
      `UPDATE app.sim_profile
          SET name = $3, description = $4, body = $5::jsonb, updated_at = NOW()
        WHERE organization_id = ${ORG} AND id = $2
        RETURNING id, name, description, body, created_at, updated_at`,
      [environmentId, id, input.name, input.description ?? "", JSON.stringify(input.body)],
    );
    const r = rows[0];
    if (!r) throw NotFound("PROFILE_NOT_FOUND", "Profile not found.");
    return toRow(r);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw Conflict("PROFILE_EXISTS", `A profile called "${input.name}" already exists.`);
    throw err;
  }
}

export async function deleteSimProfile(db: DbClient, environmentId: string, id: string): Promise<void> {
  const res = await db.query(`DELETE FROM app.sim_profile WHERE organization_id = ${ORG} AND id = $2`, [environmentId, id]);
  if (!res.rowCount) throw NotFound("PROFILE_NOT_FOUND", "Profile not found.");
}
