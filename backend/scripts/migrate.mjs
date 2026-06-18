// Production-safe migration runner (pure JS, no tsx/devDependencies).
//
// Runs at container start (see railway.json startCommand) using the service's
// own DATABASE_URL, which resolves the internal Railway Postgres host. It is
// idempotent: already-applied versions are skipped via app.schema_migrations,
// and the SQL files themselves use IF NOT EXISTS guards.

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const { Client } = pg;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(SCRIPT_DIR, "migrations");

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set; skipping migrations.");
    process.exit(1);
  }

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();

  if (files.length === 0) {
    console.log("No migrations found.");
    return;
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    for (const file of files) {
      const version = file.replace(/\.sql$/, "");

      // schema_migrations may not exist on the very first run.
      let alreadyApplied = false;
      try {
        const existing = await client.query(
          "SELECT version FROM app.schema_migrations WHERE version = $1",
          [version],
        );
        alreadyApplied = (existing.rowCount ?? 0) > 0;
      } catch {
        alreadyApplied = false;
      }

      if (alreadyApplied) {
        console.log(`skip   ${version}`);
        continue;
      }

      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      const start = Date.now();
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO app.schema_migrations (version)
           VALUES ($1)
           ON CONFLICT (version) DO NOTHING`,
          [version],
        );
        await client.query("COMMIT");
        console.log(`applied ${version}  (${Date.now() - start}ms)`);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      }
    }

    console.log("\nMigrations complete.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
