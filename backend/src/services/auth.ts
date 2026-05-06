import crypto from "node:crypto";

import { pool } from "../db/pool.js";

const KEY_PREFIX = "obs_live_";
const PREFIX_DISPLAY_LEN = KEY_PREFIX.length + 8;

export type Plan = "free" | "starter" | "pro" | "enterprise";

export interface ApiKeyRow {
  id: string;
  key_prefix: string;
  name: string;
  owner_email: string;
  plan: Plan;
  monthly_quota: number;
}

export interface NewApiKey {
  rawKey: string;
  hash: string;
  prefix: string;
}

/**
 * Generates a fresh API key in the format `obs_live_<32 url-safe chars>`.
 * The hash is the SHA-256 hex of the full raw key. Only the hash is stored;
 * the raw key is shown to the user once and never persisted.
 */
export function generateApiKey(): NewApiKey {
  const body = crypto.randomBytes(24).toString("base64url");
  const rawKey = `${KEY_PREFIX}${body}`;
  const hash = sha256Hex(rawKey);
  return {
    rawKey,
    hash,
    prefix: rawKey.slice(0, PREFIX_DISPLAY_LEN),
  };
}

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

interface CacheEntry {
  row: ApiKeyRow | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 1000;

function rememberInCache(hash: string, row: ApiKeyRow | null): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(hash, { row, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * Verifies a bearer token against `app.api_keys`. Returns the row when found
 * and not revoked, otherwise null. A 60-second in-memory TTL cache avoids
 * hitting Postgres on every request from a hot key.
 */
export async function verifyApiKey(rawKey: string): Promise<ApiKeyRow | null> {
  if (!rawKey || !rawKey.startsWith(KEY_PREFIX)) return null;

  const hash = sha256Hex(rawKey);
  const cached = cache.get(hash);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.row;
  }

  const { rows } = await pool.query<ApiKeyRow>(
    `SELECT id, key_prefix, name, owner_email, plan, monthly_quota
       FROM app.api_keys
      WHERE key_hash = $1 AND revoked_at IS NULL`,
    [hash],
  );

  const row = rows[0] ?? null;
  rememberInCache(hash, row);

  if (row) {
    setImmediate(() => {
      pool
        .query("UPDATE app.api_keys SET last_used_at = NOW() WHERE id = $1", [row.id])
        .catch(() => {
          /* fire and forget */
        });
    });
  }

  return row;
}
