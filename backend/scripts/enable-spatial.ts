import "dotenv/config";

import { Client } from "pg";

/**
 * Turn on the spatial features. Run once, deliberately.
 *
 * This is not a migration, and that is the point. `railway.json` starts the API
 * with
 *
 *     node scripts/migrate.mjs && node dist/index.js
 *
 * so a migration that fails takes the whole product offline. `CREATE EXTENSION
 * postgis` can fail for reasons that have nothing to do with this code — the
 * extension is not packaged with the image, or the role lacks the right — and
 * discovering that during a deploy would mean an outage caused by adding a
 * feature nobody was using yet.
 *
 * Enabling an extension on a production database is a decision. It gets a
 * command, not a side effect of shipping.
 *
 * Everything degrades without it: `spatialAvailable()` reports false, the geo
 * routes answer honestly, and the rest of the product does not notice.
 *
 *     npm run enable-spatial
 */

const DDL = [
  `CREATE EXTENSION IF NOT EXISTS postgis`,

  // A table of its own rather than a column on the instances: geometry belongs
  // to the few objects that have a real extent, and its GiST index has no
  // business weighing down the table everything else reads.
  `CREATE TABLE IF NOT EXISTS app.instance_geometry (
     instance_id UUID PRIMARY KEY
       REFERENCES app.ontology_object_instances(id) ON DELETE CASCADE,

     -- What the shape means. Free text, like a signal's domain: "catchment",
     -- "exclusion zone", "corridor" is not a list anyone can close in advance.
     kind TEXT NOT NULL DEFAULT 'perimeter',

     -- geography, not geometry: the distance between two hospitals has to come
     -- back in metres. On lat/lon, geometry returns degrees — and a degree of
     -- longitude is 78 km in Montréal and 111 km at the equator.
     geom geography(Geometry, 4326) NOT NULL,

     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,

  `CREATE INDEX IF NOT EXISTS instance_geometry_gist
     ON app.instance_geometry USING GIST (geom)`,

  `CREATE INDEX IF NOT EXISTS instance_geometry_kind
     ON app.instance_geometry (kind)`,
];

/**
 * Can this database do spatial, without changing anything?
 *
 * `pg_available_extensions` lists what the server *could* install, which is the
 * question worth asking before touching a production database: an image without
 * PostGIS is not a permissions problem to work around, it is a different image.
 */
async function check(client: Client): Promise<void> {
  const { rows: avail } = await client.query<{ name: string; default_version: string }>(
    `SELECT name, default_version FROM pg_available_extensions
      WHERE name LIKE 'postgis%' ORDER BY name`,
  );
  const { rows: installed } = await client.query<{ extname: string; extversion: string }>(
    `SELECT extname, extversion FROM pg_extension WHERE extname LIKE 'postgis%'`,
  );
  const { rows: who } = await client.query<{ usr: string; superuser: boolean }>(
    `SELECT current_user AS usr,
            (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser`,
  );

  console.log(`role      ${who[0]?.usr} (superuser: ${who[0]?.superuser ? "yes" : "no"})`);

  if (installed.length > 0) {
    console.log(`installed ${installed.map((r) => `${r.extname} ${r.extversion}`).join(", ")}`);
    console.log("\nAlready enabled. `npm run enable-spatial` will create the tables.");
    return;
  }

  if (avail.length === 0) {
    console.log("available (none)");
    console.log(
      "\nThis Postgres image does not ship PostGIS, so no privilege will help —\n" +
        "it is a different image, not a permission. Moving an existing database to\n" +
        "one is a data migration, not a setting, and the replacement must also ship\n" +
        "pgvector: snomed.description_embeddings depends on it. Everything else in\n" +
        "the product keeps working: the geo routes report the capability as\n" +
        "unavailable.",
    );
    return;
  }

  console.log(`available ${avail.map((r) => `${r.name} ${r.default_version}`).join(", ")}`);
  console.log("\nPostGIS can be installed here. Run `npm run enable-spatial` to do it.");
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const readOnly = process.argv.includes("--check");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    if (readOnly) {
      await check(client);
      return;
    }
    for (const sql of DDL) {
      const label = sql.trim().split("\n")[0]!.slice(0, 60);
      try {
        await client.query(sql);
        console.log(`ok    ${label}`);
      } catch (err) {
        console.error(`FAIL  ${label}`);
        console.error(`      ${(err as Error).message}`);
        if (/extension "postgis" is not available/i.test((err as Error).message)) {
          console.error(
            "\nThis Postgres build does not ship PostGIS, so this is an image, not a\n" +
              "permission — no privilege will help. Moving to one that has it is a data\n" +
              "migration, and the replacement must also ship pgvector: snomed.\n" +
              "description_embeddings depends on it, and SNOMED search already works.\n" +
              "Nothing else in the product is affected — the geo routes report the\n" +
              "capability as unavailable and every other feature works.",
          );
        }
        if (/permission denied|must be superuser/i.test((err as Error).message)) {
          console.error(
            "\nThe role this connection uses may not create extensions. Ask whoever\n" +
              "owns the database to run `CREATE EXTENSION postgis;` once, then run\n" +
              "this again — the rest of the statements need no special right.",
          );
        }
        process.exit(1);
      }
    }

    const { rows } = await client.query<{ version: string }>(`SELECT PostGIS_Version() AS version`);
    console.log(`\nSpatial features enabled. PostGIS ${rows[0]?.version ?? "?"}.`);
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  const e = err as { code?: string; message?: string };
  // A stack trace for "the database did not answer" tells you nothing you can
  // act on, and this script exists to be run against a database you may have
  // named wrongly.
  if (e.code === "ECONNREFUSED" || e.code === "ENOTFOUND" || e.code === "ETIMEDOUT") {
    let target = "the configured DATABASE_URL";
    try {
      const u = new URL(process.env.DATABASE_URL ?? "");
      target = `${u.hostname}:${u.port || 5432}`;
    } catch {
      /* leave the generic wording */
    }
    console.error(
      `Could not reach ${target}.\n\n` +
        "Point DATABASE_URL at the database you mean — the one in backend/.env is\n" +
        "usually a local dev instance. For Railway, copy the connection string from\n" +
        "the Postgres service's Variables tab, or run this through `railway run`.",
    );
    process.exit(1);
  }
  console.error(e.message ?? err);
  process.exit(1);
});
