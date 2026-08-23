import type { DbClient } from "../lib/db.js";
import { BadRequest, Conflict, NotFound } from "../lib/errors.js";

/**
 * Responses an institution wrote for itself.
 *
 * The engine ships three — do nothing, transfer when full, surge then transfer
 * — generated in Python from the state of the network. `Policy` was already
 * fully inspectable data: a typed condition tree, four kinds of action, and the
 * frictions that stop a response from looking free and instant. It was simply
 * unreachable, because the only way in was a name in a dictionary of three.
 *
 * Nothing here knows what a rule means. The shape belongs to the engine, which
 * validates it with pydantic and refuses one aimed at something the twin does
 * not contain. Re-deriving that in SQL or in zod would create a second truth to
 * keep in agreement, and it is always the copy that falls behind.
 *
 * Unlike an event, a response carries no world. An event names instances by id
 * and therefore only means something in the world it was written in; a response
 * names facilities and catchments, which exist in both. A rule whose target has
 * gone is refused by the engine at load, which is the right failure.
 */

export interface SimPolicyRow {
  id: string;
  name: string;
  description: string;
  rules: Array<Record<string, unknown>>;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  name: string;
  description: string;
  rules: Array<Record<string, unknown>>;
  created_at: Date;
  updated_at: Date;
}

function toRow(r: Row): SimPolicyRow {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    rules: r.rules ?? [],
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

const SELECT = `SELECT id, name, description, rules, created_at, updated_at
                  FROM app.sim_policy`;

const ORG = `(SELECT organization_id FROM app.project WHERE id = $1)`;

export async function listSimPolicies(
  db: DbClient,
  environmentId: string,
): Promise<SimPolicyRow[]> {
  const { rows } = await db.query<Row>(
    `${SELECT} WHERE organization_id = ${ORG} ORDER BY updated_at DESC`,
    [environmentId],
  );
  return rows.map(toRow);
}

export async function getSimPolicy(
  db: DbClient,
  environmentId: string,
  id: string,
): Promise<SimPolicyRow> {
  const { rows } = await db.query<Row>(
    `${SELECT} WHERE organization_id = ${ORG} AND id = $2`,
    [environmentId, id],
  );
  const r = rows[0];
  if (!r) throw NotFound("POLICY_NOT_FOUND", "Response not found.");
  return toRow(r);
}

export interface SimPolicyInput {
  name: string;
  description?: string;
  rules: Array<Record<string, unknown>>;
}

/**
 * Rule ids appear in the trace as the reason something happened, so two rules
 * sharing one makes an audit trail that cannot be followed back. The engine
 * would not notice: both are valid on their own.
 */
function assertDistinctIds(rules: Array<Record<string, unknown>>): void {
  const seen = new Set<string>();
  for (const r of rules) {
    const id = String(r.id ?? "").trim();
    if (!id) throw BadRequest("RULE_NEEDS_ID", "Every rule needs an id.");
    if (seen.has(id)) {
      throw BadRequest(
        "RULE_ID_REPEATED",
        `Two rules are both called "${id}". Rule ids appear in the trace as the ` +
          `reason something happened, so they have to be distinct.`,
      );
    }
    seen.add(id);
  }
}

export async function createSimPolicy(
  db: DbClient,
  environmentId: string,
  userId: string,
  input: SimPolicyInput,
): Promise<SimPolicyRow> {
  assertDistinctIds(input.rules);
  try {
    const { rows } = await db.query<Row>(
      `INSERT INTO app.sim_policy (organization_id, name, description, rules, created_by)
       VALUES (${ORG}, $2, $3, $4::jsonb, $5)
       RETURNING id, name, description, rules, created_at, updated_at`,
      [environmentId, input.name, input.description ?? "", JSON.stringify(input.rules), userId],
    );
    return toRow(rows[0]!);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw Conflict("POLICY_EXISTS", `A response called "${input.name}" already exists.`);
    }
    throw err;
  }
}

export async function updateSimPolicy(
  db: DbClient,
  environmentId: string,
  id: string,
  input: SimPolicyInput,
): Promise<SimPolicyRow> {
  assertDistinctIds(input.rules);
  try {
    const { rows } = await db.query<Row>(
      `UPDATE app.sim_policy
          SET name = $3, description = $4, rules = $5::jsonb, updated_at = NOW()
        WHERE organization_id = ${ORG} AND id = $2
        RETURNING id, name, description, rules, created_at, updated_at`,
      [environmentId, id, input.name, input.description ?? "", JSON.stringify(input.rules)],
    );
    const r = rows[0];
    if (!r) throw NotFound("POLICY_NOT_FOUND", "Response not found.");
    return toRow(r);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw Conflict("POLICY_EXISTS", `A response called "${input.name}" already exists.`);
    }
    throw err;
  }
}

export async function deleteSimPolicy(
  db: DbClient,
  environmentId: string,
  id: string,
): Promise<void> {
  const res = await db.query(
    `DELETE FROM app.sim_policy WHERE organization_id = ${ORG} AND id = $2`,
    [environmentId, id],
  );
  if (!res.rowCount) throw NotFound("POLICY_NOT_FOUND", "Response not found.");
}
