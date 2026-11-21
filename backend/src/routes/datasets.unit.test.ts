import assert from "node:assert/strict";
import { test } from "node:test";

import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";

import { FILE_BODY_LIMIT } from "../lib/body-limit.js";
import errorHandler from "../plugins/error-handler.js";
import datasetRoutes from "./datasets.js";

/**
 * Loading a file's rows is not held to the API's default 1 MiB body.
 *
 * Booted the way the API boots the routes, without a database: a body that
 * passes the limit stops at the door for want of a key (401); a body over it
 * is refused before that (413).
 */
async function server() {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest("apiKey", null);
  await app.register(errorHandler);
  await app.register(datasetRoutes, { prefix: "/v1" });
  await app.ready();
  return app;
}

const DATASET = "3f0c9a52-6b1e-4a53-9d0b-2f3f6c1a7e10";

/** Rows shaped like a wide public-health CSV: 50 named columns per day. */
function wideRows(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => {
    const row: Record<string, unknown> = { date: `2021-01-${String((i % 28) + 1).padStart(2, "0")}` };
    for (let c = 0; c < 50; c++) row[`cumulative_cases_column_${c}`] = i * 1000 + c;
    return row;
  });
}

test("a file's rows over 1 MiB are taken", async () => {
  const app = await server();
  const payload = JSON.stringify({ rows: wideRows(1500) });
  assert.ok(payload.length > 2 * 1024 * 1024, "the body is over the default limit");
  assert.ok(payload.length < FILE_BODY_LIMIT, "and under the file limit");

  const res = await app.inject({
    method: "POST",
    url: `/v1/datasets/${DATASET}/rows`,
    headers: { "content-type": "application/json" },
    payload,
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("a body over the file limit is refused before anything is read", async () => {
  const app = await server();
  const payload = JSON.stringify({ rows: [{ text: "x".repeat(FILE_BODY_LIMIT) }] });
  const res = await app.inject({
    method: "POST",
    url: `/v1/datasets/${DATASET}/rows`,
    headers: { "content-type": "application/json" },
    payload,
  });
  assert.equal(res.statusCode, 413);
  await app.close();
});

test("the rest of the API keeps the 1 MiB default", async () => {
  const app = await server();
  const payload = JSON.stringify({ name: "x".repeat(2 * 1024 * 1024) });
  const res = await app.inject({
    method: "POST",
    url: "/v1/ontology/mtl/datasets",
    headers: { "content-type": "application/json" },
    payload,
  });
  assert.equal(res.statusCode, 413);
  await app.close();
});
