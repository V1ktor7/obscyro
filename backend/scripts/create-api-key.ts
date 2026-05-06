import "dotenv/config";

import { Client } from "pg";

import { generateApiKey, type Plan } from "../src/services/auth.js";

const PLAN_DEFAULT_QUOTA: Record<Plan, number> = {
  free: 1_000,
  starter: 10_000,
  pro: 100_000,
  enterprise: 10_000_000,
};

interface Args {
  name: string;
  email: string;
  plan: Plan;
  quota?: number;
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    let key: string;
    let value: string;
    if (eq >= 0) {
      key = arg.slice(2, eq);
      value = arg.slice(eq + 1);
    } else {
      key = arg.slice(2);
      value = argv[++i] ?? "";
    }

    switch (key) {
      case "name":
        out.name = value;
        break;
      case "email":
        out.email = value;
        break;
      case "plan":
        if (!isPlan(value)) {
          throw new Error(
            `--plan must be one of: free, starter, pro, enterprise (got "${value}")`,
          );
        }
        out.plan = value;
        break;
      case "quota":
        out.quota = Number(value);
        if (!Number.isInteger(out.quota) || out.quota <= 0) {
          throw new Error(`--quota must be a positive integer (got "${value}")`);
        }
        break;
      default:
        throw new Error(`Unknown flag --${key}`);
    }
  }

  if (!out.name) throw new Error("Missing required --name");
  if (!out.email) throw new Error("Missing required --email");
  if (!out.plan) out.plan = "free";

  return out as Args;
}

function isPlan(value: string): value is Plan {
  return value === "free" || value === "starter" || value === "pro" || value === "enterprise";
}

function usage(): never {
  console.error(
    [
      "Usage: npm run create-key -- --name=\"My Key\" --email=\"me@example.com\" [--plan=free] [--quota=1000]",
      "",
      "Plans: free | starter | pro | enterprise",
    ].join("\n"),
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set. Copy backend/.env.example to backend/.env first.");
    process.exit(1);
  }

  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error((err as Error).message);
    console.error("");
    usage();
  }

  const { rawKey, hash, prefix } = generateApiKey();
  const quota = args.quota ?? PLAN_DEFAULT_QUOTA[args.plan];

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const { rows } = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO app.api_keys (key_hash, key_prefix, name, owner_email, plan, monthly_quota)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at`,
      [hash, prefix, args.name, args.email, args.plan, quota],
    );
    const row = rows[0];

    const banner = "=".repeat(60);
    console.log("");
    console.log(banner);
    console.log("API KEY (copy now \u2014 cannot be retrieved later)");
    console.log(banner);
    console.log(rawKey);
    console.log(banner);
    console.log(`id:            ${row.id}`);
    console.log(`name:          ${args.name}`);
    console.log(`owner_email:   ${args.email}`);
    console.log(`plan:          ${args.plan}`);
    console.log(`monthly_quota: ${quota}`);
    console.log(`prefix:        ${prefix}`);
    console.log(`created_at:    ${row.created_at.toISOString()}`);
    console.log("");
    console.log("Send the bearer token in the Authorization header:");
    console.log(`  Authorization: Bearer ${rawKey}`);
    console.log("");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
