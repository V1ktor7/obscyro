import type { Pool } from "pg";

import { pool } from "../db/pool.js";
import type { DbClient } from "./db.js";

/**
 * Run `fn` inside a single Postgres transaction. Commits on success; rolls back
 * on any thrown error so partial writes never land.
 */
export async function withTransaction<T>(
  fn: (db: DbClient) => Promise<T>,
  pg: Pool = pool,
): Promise<T> {
  const client = await pg.connect();
  const db: DbClient = {
    query: (sql, params) => client.query(sql, params),
  };

  try {
    await client.query("BEGIN");
    const result = await fn(db);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
