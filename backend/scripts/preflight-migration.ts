import "dotenv/config";

import { Client } from "pg";

import { compareVersions } from "../src/lib/version-compare.js";

/**
 * Can this database be restored into that one?
 *
 * Asked before a dump, not discovered during a restore. Moving Postgres images
 * fails in exactly one boring way — the target is missing an extension the dump
 * calls CREATE EXTENSION on, or has an older version of one — and it fails
 * partway through, after the schema is in and before the data is, which is the
 * worst moment for it.
 *
 * Everything here is read-only on both sides.
 *
 *     DATABASE_URL=… TARGET_DATABASE_URL=… npm run preflight
 *
 * Both connection strings come from the environment, and that is not a style
 * choice. `npm run x -- --target "postgres://user:pass@…"` echoes the whole
 * command line back to the terminal before running it, so the password lands
 * in shell history and in any CI log — and npm eats a bare `--target` anyway,
 * treating it as one of its own config flags. A URL on argv is still accepted
 * as a positional, for the case where an env var is genuinely inconvenient,
 * but it is not what the docs tell anyone to do.
 *
 * Neither URL is ever printed by this script.
 */

interface Ext {
  name: string;
  version: string;
}

interface Snapshot {
  label: string;
  host: string;
  serverVersion: string;
  serverVersionNum: number;
  user: string;
  superuser: boolean;
  installed: Ext[];
  available: Map<string, string>;
  appTables: number;
  sizeBytes: number;
}

/** Host and port only — never the credentials in between. */
function describeHost(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || 5432}`;
  } catch {
    return "(unparseable URL)";
  }
}

async function snapshot(url: string, label: string): Promise<Snapshot> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows: srv } = await client.query<{
      version: string;
      num: string;
      usr: string;
      superuser: boolean | null;
    }>(
      `SELECT version() AS version,
              current_setting('server_version_num') AS num,
              current_user AS usr,
              (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser`,
    );
    const { rows: installed } = await client.query<{ extname: string; extversion: string }>(
      `SELECT extname, extversion FROM pg_extension ORDER BY extname`,
    );
    const { rows: available } = await client.query<{ name: string; default_version: string }>(
      `SELECT name, default_version FROM pg_available_extensions`,
    );
    const { rows: tables } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.tables WHERE table_schema = 'app'`,
    );
    const { rows: size } = await client.query<{ b: string }>(
      `SELECT pg_database_size(current_database())::text AS b`,
    );

    return {
      label,
      host: describeHost(url),
      serverVersion: (srv[0]?.version ?? "").split(" ").slice(0, 2).join(" "),
      serverVersionNum: Number(srv[0]?.num ?? 0),
      user: srv[0]?.usr ?? "?",
      superuser: srv[0]?.superuser === true,
      installed: installed.map((r) => ({ name: r.extname, version: r.extversion })),
      available: new Map(available.map((r) => [r.name, r.default_version])),
      appTables: Number(tables[0]?.n ?? 0),
      sizeBytes: Number(size[0]?.b ?? 0),
    };
  } finally {
    await client.end();
  }
}

function gib(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

function report(source: Snapshot, target: Snapshot): { blockers: string[]; warnings: string[] } {
  const blockers: string[] = [];
  const warnings: string[] = [];

  for (const snap of [source, target]) {
    console.log(
      `${snap.label.padEnd(6)} ${snap.host}  ${snap.serverVersion}  ` +
        `role ${snap.user}${snap.superuser ? " (superuser)" : ""}  ` +
        `${snap.appTables} app tables  ${gib(snap.sizeBytes)}`,
    );
  }
  console.log("");

  // A dump taken from a newer server does not restore into an older one, and
  // pg_dump is explicit that it only guarantees forward.
  if (target.serverVersionNum < source.serverVersionNum) {
    blockers.push(
      `target runs an older Postgres (${target.serverVersion}) than the source ` +
        `(${source.serverVersion}). A dump does not travel backwards.`,
    );
  } else if (
    Math.floor(target.serverVersionNum / 10_000) !== Math.floor(source.serverVersionNum / 10_000)
  ) {
    warnings.push(
      `major version differs: ${source.serverVersion} → ${target.serverVersion}. ` +
        `Restorable, but it is a version upgrade as well as a move — do them separately if you can.`,
    );
  }

  // The point of the exercise.
  console.log("extension            source     target");
  for (const ext of source.installed) {
    const there = target.installed.find((e) => e.name === ext.name);
    const avail = target.available.get(ext.name);
    const have = there?.version ?? avail;
    const state = there ? "installed" : avail ? "available" : "MISSING";
    console.log(
      `${ext.name.padEnd(20)} ${ext.version.padEnd(10)} ${(have ?? "—").padEnd(10)} ${state}`,
    );

    if (!have) {
      blockers.push(
        `${ext.name} is not installed on the target and not in its ` +
          `pg_available_extensions. The restore will stop at CREATE EXTENSION ${ext.name}.`,
      );
    } else if (compareVersions(have, ext.version) < 0) {
      blockers.push(
        `${ext.name} is older on the target (${have} < ${ext.version}). ` +
          `A dump can be restored into a newer extension, not an older one.`,
      );
    }
  }
  console.log("");

  // Extensions the target has that the source does not are fine — they simply
  // go unused — so they are not reported. The asymmetry is deliberate.

  if (target.appTables > 0) {
    blockers.push(
      `the target already has ${target.appTables} tables in schema "app". ` +
        `Restoring into it would merge two databases. Use an empty one.`,
    );
  }

  return { blockers, warnings };
}

async function main(): Promise<void> {
  const sourceUrl = process.env.DATABASE_URL;
  const targetUrl =
    process.env.TARGET_DATABASE_URL ??
    // Positional fallback. `--target=…` survives npm; a bare `--target …` does
    // not, so it is not offered.
    process.argv.slice(2).find((a) => a.startsWith("postgres://") || a.startsWith("postgresql://")) ??
    process.argv
      .slice(2)
      .find((a) => a.startsWith("--target="))
      ?.slice("--target=".length);

  if (!sourceUrl) {
    console.error("DATABASE_URL is not set — that is the source database.");
    process.exit(1);
  }
  if (!targetUrl) {
    console.error(
      "TARGET_DATABASE_URL is not set — that is the new database.\n\n" +
        "  DATABASE_URL=… TARGET_DATABASE_URL=… npm run preflight\n\n" +
        "Passed as environment variables on purpose: npm echoes the command line\n" +
        "before running it, so a connection string given as an argument ends up in\n" +
        "shell history and in CI logs. Both databases are read only here, and\n" +
        "neither URL is printed.",
    );
    process.exit(1);
  }

  const [source, target] = await Promise.all([
    snapshot(sourceUrl, "source"),
    snapshot(targetUrl, "target"),
  ]);

  const { blockers, warnings } = report(source, target);

  for (const w of warnings) console.log(`warn   ${w}`);
  for (const b of blockers) console.error(`BLOCK  ${b}`);

  if (blockers.length > 0) {
    console.error(`\n${blockers.length} blocker(s). Do not start the migration.`);
    process.exit(1);
  }
  console.log(
    (warnings.length > 0 ? "\n" : "") +
      "No blockers. The target can take this dump.\n" +
      "Take a backup you have restored at least once before going further.",
  );
}

// Importable for tests without running.
if (process.argv[1]?.includes("preflight-migration")) {
  main().catch((err: unknown) => {
    const e = err as { code?: string; message?: string };
    if (e.code === "ECONNREFUSED" || e.code === "ENOTFOUND" || e.code === "ETIMEDOUT") {
      console.error(
        "Could not reach one of the two databases. Check both connection strings —\n" +
          "the one in backend/.env is usually a local dev instance, not production.",
      );
      process.exit(1);
    }
    console.error(e.message ?? err);
    process.exit(1);
  });
}
