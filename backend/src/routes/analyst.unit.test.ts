import assert from "node:assert/strict";
import { test } from "node:test";

import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";

import Anthropic from "@anthropic-ai/sdk";

import analystRoutes, { failureMessage } from "./analyst.js";

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

test("a run on the server needs a scenario, a horizon and an activity, and a key like any other route", async () => {
  const app = await server();
  assert.ok(app.hasRoute({ method: "POST", url: "/v1/ontology/:env/analyst/run" }));
  const post = (payload: object) => app.inject({ method: "POST", url: "/v1/ontology/mtl/analyst/run", payload });
  const whole = { scenarioId: "0d0f1a52-6b1e-4a53-9d0b-2f3f6c1a7e10", horizon: 60, activity: "lit" };

  assert.equal((await post({ horizon: 60, activity: "lit" })).statusCode, 400);
  assert.equal((await post({ ...whole, scenarioId: "calibrated" })).statusCode, 400);
  assert.equal((await post({ ...whole, horizon: 0 })).statusCode, 400);
  assert.equal((await post({ ...whole, activity: "" })).statusCode, 400);
  // Well formed: it stops at the door, for want of a key. It calls no model, but it reads a project.
  assert.equal((await post(whole)).statusCode, 401);
  await app.close();
});

test("a search for events needs a request, and never takes the twin's data from the caller", async () => {
  const app = await server();
  assert.ok(app.hasRoute({ method: "POST", url: "/v1/ontology/:env/analyst/events" }));
  const post = (payload: object) => app.inject({ method: "POST", url: "/v1/ontology/mtl/analyst/events", payload });

  assert.equal((await post({ request: "?" })).statusCode, 400);
  assert.equal((await post({ request: "What measures were in force in Montréal?", scenarioId: "not-an-id" })).statusCode, 400);
  // Well formed: it stops at the door, for want of a key. A run sent along is not part of a search and is dropped.
  assert.equal((await post({ request: "What measures were in force in Montréal?" })).statusCode, 401);
  assert.equal((await post({ request: "What measures were in force in Montréal?", scenarioId: null, run: { horizon: 60 } })).statusCode, 401);
  await app.close();
});

test("an account out of credit is said as such, not as something to try again", () => {
  // What the API answered on 2026-11-20, in the middle of a replay: a 400, with this message.
  const body = { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." } };
  const outOfCredit = failureMessage(Anthropic.APIError.generate(400, body, undefined, new Headers()));
  assert.match(outOfCredit, /no credit left/);
  assert.match(outOfCredit, /administrator/);
  assert.doesNotMatch(outOfCredit, /Try again/);
  // The billing error the API also documents, whatever its message says.
  assert.match(failureMessage(Anthropic.APIError.generate(402, { type: "error", error: { type: "billing_error", message: "Payment required." } }, undefined, new Headers())), /no credit left/);

  // Any other bad request keeps its own message, and its status.
  const other = failureMessage(Anthropic.APIError.generate(400, { type: "error", error: { type: "invalid_request_error", message: "messages: too long" } }, undefined, new Headers()));
  assert.equal(other, "The analyst's model returned an error (400). Try again.");
  // A refused key is still the key's message.
  assert.match(failureMessage(Anthropic.APIError.generate(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, undefined, new Headers())), /key was refused/);
});
