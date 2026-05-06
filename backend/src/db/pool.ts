import pg from "pg";

const { Pool, types } = pg;

types.setTypeParser(types.builtins.INT8, (v) => v);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on("error", (err) => {
  console.error("[pg] idle client error", err);
});
