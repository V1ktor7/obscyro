import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Client, PoolClient } from "pg";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const POPULATE_SQL_PATH = path.resolve(SCRIPT_DIR, "..", "sql", "transitive_closure_populate.sql");

type DbClient = Client | PoolClient;

/**
 * Truncates and rebuilds snomed.transitive_closure from active IS-A relationships.
 * Safe to call after a full SNOMED RF2 reload.
 */
export async function populateTransitiveClosure(client: DbClient): Promise<void> {
  const sql = await readFile(POPULATE_SQL_PATH, "utf8");
  await client.query(sql);
}
