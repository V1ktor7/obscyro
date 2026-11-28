import assert from "node:assert/strict";
import { test } from "node:test";

import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";

import errorHandler from "../plugins/error-handler.js";
import forecastModelRoutes from "./forecast-models.js";

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
  await app.register(forecastModelRoutes, { prefix: "/v1" });
  await app.ready();
  return app;
}

const DRAFT = { label: "Chronos-2, stretcher occupancy", source: "service", serviceModel: "chronos-2", metric: "occupancy", step: "hour", historySteps: 336, horizonSteps: 72 };

test("the forecast model routes register and compile", async () => {
  const app = await server();
  for (const [method, url] of [
    ["GET", "/v1/ontology/:env/forecast-models"],
    ["POST", "/v1/ontology/:env/forecast-models"],
    ["DELETE", "/v1/ontology/:env/forecast-models/:key"],
    ["POST", "/v1/ontology/:env/forecast-models/:key/verify"],
    ["POST", "/v1/ontology/:env/forecast-models/:key/backtest"],
    ["POST", "/v1/ontology/:env/forecast-models/:key/trial"],
    ["GET", "/v1/ontology/:env/forecasts"],
  ] as const) {
    assert.ok(app.hasRoute({ method, url }), `${method} ${url}`);
  }
  await app.close();
});

test("an import is validated before anything is read or written", async () => {
  const app = await server();
  const post = (payload: object) => app.inject({ method: "POST", url: "/v1/ontology/mtl/forecast-models", payload });

  assert.equal((await post({ ...DRAFT, label: "" })).statusCode, 400);
  // Three sources, and no other: a file of a model is not one of them.
  assert.equal((await post({ ...DRAFT, source: "file" })).statusCode, 400);
  assert.equal((await post({ ...DRAFT, step: "minute" })).statusCode, 400);
  assert.equal((await post({ ...DRAFT, horizonSteps: 337 })).statusCode, 400);
  assert.equal((await post({ ...DRAFT, historySteps: 2161 })).statusCode, 400);
  assert.equal((await post({ ...DRAFT, endpointUrl: "not an address" })).statusCode, 400);
  assert.equal((await post({ ...DRAFT, units: ["the CHUM"] })).statusCode, 400);
  assert.equal((await post({ ...DRAFT, companions: [{ name: "air", kind: "future", series: "twin:iqa" }] })).statusCode, 400);
  // Well formed: it stops at the door, for want of a key.
  assert.equal((await post(DRAFT)).statusCode, 401);
  assert.equal((await app.inject({ method: "GET", url: "/v1/ontology/mtl/forecast-models" })).statusCode, 401);
  await app.close();
});

test("a model is named by its key, and a replay goes back a bounded number of days", async () => {
  const app = await server();
  const call = (method: "POST" | "DELETE", url: string, payload?: object) => app.inject({ method, url: `/v1/ontology/mtl/forecast-models/${url}`, ...(payload ? { payload } : {}) });

  assert.equal((await call("DELETE", "Chronos 2")).statusCode, 400);
  assert.equal((await call("DELETE", "chronos_2")).statusCode, 401);
  assert.equal((await call("POST", "chronos_2/verify")).statusCode, 401);
  assert.equal((await call("POST", "chronos_2/backtest", {})).statusCode, 401);
  assert.equal((await call("POST", "chronos_2/backtest", { days: 14 })).statusCode, 401);
  assert.equal((await call("POST", "chronos_2/backtest", { days: 0 })).statusCode, 400);
  assert.equal((await call("POST", "chronos_2/backtest", { days: 61 })).statusCode, 400);
  // A trial is turned on or off, and says so: there is no default to guess.
  assert.equal((await call("POST", "chronos_2/trial", {})).statusCode, 400);
  assert.equal((await call("POST", "chronos_2/trial", { on: "yes" })).statusCode, 400);
  assert.equal((await call("POST", "chronos_2/trial", { on: true, everyHours: 48 })).statusCode, 400);
  assert.equal((await call("POST", "chronos_2/trial", { on: true, everyHours: 6 })).statusCode, 401);
  assert.equal((await call("POST", "chronos_2/trial", { on: false })).statusCode, 401);
  // What a screen may show is asked for one unit, by its identifier.
  assert.equal((await app.inject({ method: "GET", url: "/v1/ontology/mtl/forecasts" })).statusCode, 400);
  assert.equal((await app.inject({ method: "GET", url: "/v1/ontology/mtl/forecasts?unit=the-chum" })).statusCode, 400);
  assert.equal((await app.inject({ method: "GET", url: "/v1/ontology/mtl/forecasts?unit=5f0c1a3e-8b1d-4c56-9a44-0b6d2f1e7a90" })).statusCode, 401);
  await app.close();
});
