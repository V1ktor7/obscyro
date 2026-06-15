import type { DbClient } from "../lib/db.js";

import { AppError } from "../lib/errors.js";

export interface UserRow {
  id: string;
  email: string;
  name: string;
  company: string | null;
  use_case: string | null;
  created_at: Date;
}

export interface KeyListRow {
  id: string;
  key_prefix: string;
  name: string;
  plan: string;
  monthly_quota: number;
  created_at: Date;
  last_used_at: Date | null;
}

export async function verifyUserLogin(
  db: DbClient,
  email: string,
  code: string,
): Promise<UserRow> {
  const { rows } = await db.query<UserRow & { password_hash: string | null }>(
    `SELECT id, email, name, company, use_case, created_at, password_hash
       FROM app.users
      WHERE email = $1`,
    [email.trim().toLowerCase()],
  );
  const user = rows[0];
  if (!user?.password_hash) {
    throw new AppError("INVALID_CREDENTIALS", "Invalid email or access code.", 401);
  }

  const ok = await db.query<{ match: boolean }>(
    `SELECT (password_hash = crypt($1, password_hash)) AS match
       FROM app.users
      WHERE id = $2`,
    [code, user.id],
  );
  if (!ok.rows[0]?.match) {
    throw new AppError("INVALID_CREDENTIALS", "Invalid email or access code.", 401);
  }

  const { password_hash: _ph, ...safe } = user;
  return safe;
}

export async function listUserKeys(
  db: DbClient,
  userId: string,
): Promise<KeyListRow[]> {
  const { rows } = await db.query<KeyListRow>(
    `SELECT id, key_prefix, name, plan, monthly_quota, created_at, last_used_at
       FROM app.api_keys
      WHERE user_id = $1 AND revoked_at IS NULL
      ORDER BY created_at DESC`,
    [userId],
  );
  return rows;
}

export async function resolveUserIdForApiKey(
  db: DbClient,
  apiKeyId: string,
): Promise<string | null> {
  const { rows } = await db.query<{ user_id: string | null }>(
    `SELECT user_id FROM app.api_keys WHERE id = $1`,
    [apiKeyId],
  );
  return rows[0]?.user_id ?? null;
}
