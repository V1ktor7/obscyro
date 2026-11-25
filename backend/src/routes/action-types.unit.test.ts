import assert from "node:assert/strict";
import { test } from "node:test";

import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";

import errorHandler from "../plugins/error-handler.js";
import actionTypeRoutes from "./action-types.js";

/**
 * The routes register and their schemas compile, the way the API boots them,
 * without a database: nothing here reaches a handler's body.
 */
async function server() {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest("apiKey", null);
  // The API's own error handler: a refusal has to leave in the envelope the routes declare.
  await app.register(errorHandler);
  await app.register(actionTypeRoutes, { prefix: "/v1" });
  await app.ready();
  return app;
}

const OVERFLOW = { name: "Open overflow beds", effect: "capacity", bounds: { activity: "lit", minUnits: 10, maxUnits: 60 }, leadDays: 2, approver: "Director of nursing" };

test("the action type routes register and compile", async () => {
  const app = await server();
  for (const [method, url] of [
    ["GET", "/v1/ontology/:env/action-types"],
    ["POST", "/v1/ontology/:env/action-types"],
    ["PUT", "/v1/ontology/:env/action-types/:key"],
    ["DELETE", "/v1/ontology/:env/action-types/:key"],
    ["GET", "/v1/ontology/:env/analyst/tools"],
    ["PUT", "/v1/ontology/:env/analyst/tools/:name"],
  ] as const) {
    assert.ok(app.hasRoute({ method, url }), `${method} ${url}`);
  }
  await app.close();
});

test("an action type is validated before anything is read or written", async () => {
  const app = await server();
  const post = (payload: object) => app.inject({ method: "POST", url: "/v1/ontology/mtl/action-types", payload });
  const put = (key: string, payload: object) => app.inject({ method: "PUT", url: `/v1/ontology/mtl/action-types/${key}`, payload });

  assert.equal((await post({ ...OVERFLOW, name: "" })).statusCode, 400);
  // Only what a run can be made to change: staff is not one of the four.
  assert.equal((await post({ ...OVERFLOW, effect: "staff" })).statusCode, 400);
  assert.equal((await post({ ...OVERFLOW, leadDays: -1 })).statusCode, 400);
  assert.equal((await post({ ...OVERFLOW, leadDays: 1.5 })).statusCode, 400);
  assert.equal((await put("Open Overflow Beds", OVERFLOW)).statusCode, 400);
  assert.equal((await put("-beds", OVERFLOW)).statusCode, 400);
  // Well formed: it stops at the door, for want of a key.
  assert.equal((await post(OVERFLOW)).statusCode, 401);
  assert.equal((await put("capacity", { ...OVERFLOW, active: false })).statusCode, 401);
  assert.equal((await app.inject({ method: "DELETE", url: "/v1/ontology/mtl/action-types/overflow-beds" })).statusCode, 401);
  assert.equal((await app.inject({ method: "GET", url: "/v1/ontology/mtl/action-types" })).statusCode, 401);
  await app.close();
});

test("switching a tool takes a yes or a no, and a key like any other route", async () => {
  const app = await server();
  const put = (payload: object) => app.inject({ method: "PUT", url: "/v1/ontology/mtl/analyst/tools/web_search", payload });
  assert.equal((await put({})).statusCode, 400);
  assert.equal((await put({ on: "no" })).statusCode, 400);
  assert.equal((await put({ on: false })).statusCode, 401);
  assert.equal((await app.inject({ method: "GET", url: "/v1/ontology/mtl/analyst/tools" })).statusCode, 401);
  await app.close();
});
