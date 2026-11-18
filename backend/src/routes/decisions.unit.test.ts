import assert from "node:assert/strict";
import { test } from "node:test";

import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";

import errorHandler from "../plugins/error-handler.js";
import decisionRoutes from "./decisions.js";

/**
 * The decision routes register, their schemas compile, and a decision cannot
 * be posted with figures of the caller's own.
 *
 * Booted the way the API boots them, without a database: nothing here reaches
 * a handler's body.
 */
async function server() {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest("apiKey", null);
  // The API's own error envelope: these routes declare it as their 400 and 404.
  await app.register(errorHandler);
  await app.register(decisionRoutes, { prefix: "/v1" });
  await app.ready();
  return app;
}

const EXCHANGE = "3f0c9a52-6b1e-4a53-9d0b-2f3f6c1a7e10";

test("the decision routes register and compile", async () => {
  const app = await server();
  assert.ok(app.hasRoute({ method: "POST", url: "/v1/ontology/:env/decisions" }));
  assert.ok(app.hasRoute({ method: "GET", url: "/v1/ontology/:env/decisions" }));
  assert.ok(app.hasRoute({ method: "GET", url: "/v1/ontology/:env/decisions/:id/follow-up" }));
  await app.close();
});

test("a decision names an exchange and a step, and is validated before anything is read", async () => {
  const app = await server();
  const post = (payload: unknown) => app.inject({ method: "POST", url: "/v1/ontology/mtl/decisions", payload: payload as object });

  assert.equal((await post({ step: "s2" })).statusCode, 400);
  assert.equal((await post({ exchangeId: "not-an-id", step: "s2" })).statusCode, 400);
  assert.equal((await post({ exchangeId: EXCHANGE, step: "the second one" })).statusCode, 400);
  // Well formed: it stops at the door, for want of a key.
  assert.equal((await post({ exchangeId: EXCHANGE, step: "s2" })).statusCode, 401);
  // Figures sent along are not part of what a decision is made from. They are
  // dropped at validation; the record is copied from the journal.
  assert.equal((await post({ exchangeId: EXCHANGE, step: "s2", expected: { withOption: { waitingDays: 0 } } })).statusCode, 401);

  assert.equal((await app.inject({ method: "GET", url: "/v1/ontology/mtl/decisions?scenarioId=nope" })).statusCode, 400);
  assert.equal((await app.inject({ method: "GET", url: "/v1/ontology/mtl/decisions" })).statusCode, 401);
  assert.equal((await app.inject({ method: "GET", url: "/v1/ontology/mtl/decisions/nope/follow-up" })).statusCode, 400);
  assert.equal((await app.inject({ method: "GET", url: `/v1/ontology/mtl/decisions/${EXCHANGE}/follow-up` })).statusCode, 401);
  await app.close();
});
