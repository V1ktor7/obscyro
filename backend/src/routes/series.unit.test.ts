import assert from "node:assert/strict";
import { test } from "node:test";

import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";

import errorHandler from "../plugins/error-handler.js";
import seriesRoutes from "./series.js";

/**
 * The routes register and their schemas compile, the way the API boots them,
 * without a database: nothing here reaches a handler's body.
 */
async function server() {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest("apiKey", null);
  await app.register(errorHandler);
  await app.register(seriesRoutes, { prefix: "/v1" });
  await app.ready();
  return app;
}

const DRAFT = {
  label: "Respiratory virus detections",
  datasetId: "5f0c1a3e-8b1d-4c56-9a44-0b6d2f1e7a90",
  timeColumn: "date",
  timeZone: "America/Toronto",
  valueColumn: "detections",
  entityColumns: ["province", "virus"],
  step: "week",
};
const READ = { key: "twin:occupancy", from: "2026-11-27T00:00:00Z", to: "2026-11-28T00:00:00Z", step: "hour" };

test("the series routes register and compile", async () => {
  const app = await server();
  for (const [method, url] of [
    ["GET", "/v1/ontology/:env/series"],
    ["POST", "/v1/ontology/:env/series"],
    ["DELETE", "/v1/ontology/:env/series/:key"],
    ["POST", "/v1/ontology/:env/series/read"],
  ] as const) {
    assert.ok(app.hasRoute({ method, url }), `${method} ${url}`);
  }
  await app.close();
});

test("a series is validated before anything is read or written", async () => {
  const app = await server();
  const declare = (payload: object) => app.inject({ method: "POST", url: "/v1/ontology/mtl/series", payload });

  assert.equal((await declare({ ...DRAFT, label: "" })).statusCode, 400);
  assert.equal((await declare({ ...DRAFT, datasetId: "the emergency file" })).statusCode, 400);
  // The source's own step is an hour, a day or a week, and nothing else.
  assert.equal((await declare({ ...DRAFT, step: "month" })).statusCode, 400);
  assert.equal((await declare({ ...DRAFT, entityColumns: ["a", "b", "c", "d", "e"] })).statusCode, 400);
  // Well formed: it stops at the door, for want of a key.
  assert.equal((await declare(DRAFT)).statusCode, 401);
  assert.equal((await app.inject({ method: "GET", url: "/v1/ontology/mtl/series" })).statusCode, 401);
  assert.equal((await app.inject({ method: "DELETE", url: "/v1/ontology/mtl/series/respiratory_virus_detections" })).statusCode, 401);
  // A measure of the twin has no key of that shape: it is not removed by this route.
  assert.equal((await app.inject({ method: "DELETE", url: "/v1/ontology/mtl/series/twin:occupancy" })).statusCode, 400);
  await app.close();
});

test("a read is validated before anything is read", async () => {
  const app = await server();
  const read = (payload: object) => app.inject({ method: "POST", url: "/v1/ontology/mtl/series/read", payload });

  // A grid is by the hour or by the day.
  assert.equal((await read({ ...READ, step: "minute" })).statusCode, 400);
  assert.equal((await read({ ...READ, agg: "median" })).statusCode, 400);
  // An instant says its zone: "27 November" does not say where.
  assert.equal((await read({ ...READ, from: "2026-11-27" })).statusCode, 400);
  assert.equal((await read({ ...READ, asOf: "yesterday" })).statusCode, 400);
  assert.equal((await read({ ...READ, entities: Array.from({ length: 301 }, (_, i) => `e${i}`) })).statusCode, 400);
  assert.equal((await read(READ)).statusCode, 401);
  assert.equal((await read({ ...READ, asOf: "2026-11-28T00:00:00Z", agg: "last", entities: ["x"] })).statusCode, 401);
  await app.close();
});
