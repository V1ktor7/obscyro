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

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
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
            "\nThis Postgres build does not ship PostGIS. On Railway, use a Postgres\n" +
              "image that includes it (postgis/postgis), or add the extension to the\n" +
              "existing one. Nothing else in the product is affected — the geo routes\n" +
              "report the capability as unavailable and every other feature works.",
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
