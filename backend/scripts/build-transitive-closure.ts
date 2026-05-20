import "dotenv/config";

import { Client } from "pg";

import { populateTransitiveClosure } from "./lib/populate-transitive-closure.js";

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = ((ms % 60_000) / 1000).toFixed(0);
  return `${m}m${s}s`;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set. Copy backend/.env.example to backend/.env first.");
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const started = Date.now();

  try {
    const { rows: before } = await client.query(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'snomed' AND table_name = 'transitive_closure') AS ok",
    );
    if (!before[0]?.ok) {
      console.error("snomed.transitive_closure does not exist. Run: npm run migrate");
      process.exit(1);
    }

    console.log("Rebuilding snomed.transitive_closure (TRUNCATE + semi-naive fill) ...");
    await populateTransitiveClosure(client);

    const { rows } = await client.query<{ c: string }>(
      "SELECT COUNT(*)::text AS c FROM snomed.transitive_closure",
    );
    console.log(`Rows: ${rows[0]?.c ?? "?"}`);
    console.log(`Total time: ${fmtDuration(Date.now() - started)}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
