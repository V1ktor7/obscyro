import assert from "node:assert/strict";
import { test } from "node:test";

import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";

import analystRoutes from "./analyst.js";

/**
 * The routes register and their schemas compile.
 *
 * Fastify compiles a route's validators when the server becomes ready, not when
 * the file is imported, so a schema it cannot compile passes tsc and every
 * service test and then stops the container at boot. This boots the routes the
 * way the API does, without a database: nothing here reaches a handler's body.
 */
async function server() {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  // No key was presented: the same state the auth plugin leaves an anonymous request in.
  app.decorateRequest("apiKey", null);
  await app.register(analystRoutes, { prefix: "/v1" });
  await app.ready();
  return app;
}

test("the analyst's routes register and compile", async () => {
  const app = await server();
  assert.ok(app.hasRoute({ method: "GET", url: "/v1/ontology/:env/analyst" }));
  assert.ok(app.hasRoute({ method: "POST", url: "/v1/ontology/:env/analyst/ask" }));
  await app.close();
});

test("a question is validated before anything is read", async () => {
  const app = await server();
  const tooShort = await app.inject({ method: "POST", url: "/v1/ontology/mtl/analyst/ask", payload: { question: "?" } });
  assert.equal(tooShort.statusCode, 400);
  const badRun = await app.inject({
    method: "POST",
    url: "/v1/ontology/mtl/analyst/ask",
    payload: { question: "Where does it break?", run: { horizon: 60 } },
  });
  assert.equal(badRun.statusCode, 400);
  // A well-formed question gets past validation and stops at the door: no key.
  const anonymous = await app.inject({
    method: "POST",
    url: "/v1/ontology/mtl/analyst/ask",
    payload: { question: "Where does it break?", scenarioId: null, looking: "reality", run: null },
  });
  assert.equal(anonymous.statusCode, 401);
  await app.close();
});

test("an objective needs a scenario, a horizon and an activity before anything is read", async () => {
  const app = await server();
  assert.ok(app.hasRoute({ method: "POST", url: "/v1/ontology/:env/analyst/options" }));
  const post = (payload: object) => app.inject({ method: "POST", url: "/v1/ontology/mtl/analyst/options", payload });
  const whole = { objective: "Nobody waits at Lakeshore", scenarioId: "0d0f1a52-6b1e-4a53-9d0b-2f3f6c1a7e10", horizon: 60, activity: "lit" };

  // Options are tested on a scenario, over the days and the activity the page runs.
  assert.equal((await post({ ...whole, scenarioId: null })).statusCode, 400);
  assert.equal((await post({ objective: whole.objective, scenarioId: whole.scenarioId })).statusCode, 400);
  assert.equal((await post({ ...whole, horizon: 0 })).statusCode, 400);
  assert.equal((await post({ ...whole, objective: "?" })).statusCode, 400);
  // Well formed: it stops at the door, for want of a key.
  assert.equal((await post(whole)).statusCode, 401);
  await app.close();
});
