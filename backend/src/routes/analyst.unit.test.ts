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
