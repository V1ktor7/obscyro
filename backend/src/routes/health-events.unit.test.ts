import assert from "node:assert/strict";
import { test } from "node:test";

import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";

import errorHandler from "../plugins/error-handler.js";
import healthEventRoutes from "./health-events.js";

/**
 * The calendar's routes register, their schemas compile, and an event cannot
 * be accepted with a title or a source of the caller's own.
 *
 * Booted the way the API boots them, without a database: nothing here reaches
 * a handler's body.
 */
async function server() {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest("apiKey", null);
  await app.register(errorHandler);
  await app.register(healthEventRoutes, { prefix: "/v1" });
  await app.ready();
  return app;
}

const EXCHANGE = "3f0c9a52-6b1e-4a53-9d0b-2f3f6c1a7e10";

test("the calendar's routes register and compile", async () => {
  const app = await server();
  assert.ok(app.hasRoute({ method: "GET", url: "/v1/ontology/:env/health-events" }));
  assert.ok(app.hasRoute({ method: "POST", url: "/v1/ontology/:env/health-events" }));
  assert.ok(app.hasRoute({ method: "DELETE", url: "/v1/ontology/:env/health-events/:id" }));
  assert.ok(app.hasRoute({ method: "GET", url: "/v1/ontology/:env/web-sources" }));
  assert.ok(app.hasRoute({ method: "PUT", url: "/v1/ontology/:env/web-sources" }));
  await app.close();
});

test("an acceptance names a search, a candidate and the validated dates, and nothing else counts", async () => {
  const app = await server();
  const post = (payload: unknown) => app.inject({ method: "POST", url: "/v1/ontology/mtl/health-events", payload: payload as object });
  const whole = { exchangeId: EXCHANGE, candidate: "c1", startsOn: "2021-12-31", endsOn: null };

  assert.equal((await post({ candidate: "c1", startsOn: "2021-12-31" })).statusCode, 400);
  assert.equal((await post({ ...whole, exchangeId: "not-an-id" })).statusCode, 400);
  assert.equal((await post({ ...whole, candidate: "the curfew" })).statusCode, 400);
  // A start date is the one thing the person must have validated.
  assert.equal((await post({ exchangeId: EXCHANGE, candidate: "c1" })).statusCode, 400);
  assert.equal((await post({ ...whole, startsOn: "31 December 2021" })).statusCode, 400);
  assert.equal((await post({ ...whole, endsOn: "soon" })).statusCode, 400);
  // Well formed: it stops at the door, for want of a key.
  assert.equal((await post(whole)).statusCode, 401);
  // A title or a link sent along is not what an event is made from: dropped at
  // validation, the record is copied from the journalled search.
  assert.equal((await post({ ...whole, title: "Something else", sourceUrl: "https://example.org" })).statusCode, 401);
  await app.close();
});

test("there is no route to reject a candidate: rejecting records nothing", async () => {
  const app = await server();
  for (const url of ["/v1/ontology/mtl/health-events/reject", "/v1/ontology/mtl/health-events/c1/reject", "/v1/ontology/mtl/analyst/events/reject"]) {
    assert.equal((await app.inject({ method: "POST", url, payload: { exchangeId: EXCHANGE, candidate: "c1" } })).statusCode, 404);
  }
  await app.close();
});

test("the calendar and the sources are validated before anything is read", async () => {
  const app = await server();
  assert.equal((await app.inject({ method: "GET", url: "/v1/ontology/mtl/health-events?from=yesterday" })).statusCode, 400);
  assert.equal((await app.inject({ method: "GET", url: "/v1/ontology/mtl/health-events?from=2021-12-01&to=2022-02-28" })).statusCode, 401);
  assert.equal((await app.inject({ method: "DELETE", url: "/v1/ontology/mtl/health-events/nope" })).statusCode, 400);
  assert.equal((await app.inject({ method: "DELETE", url: `/v1/ontology/mtl/health-events/${EXCHANGE}` })).statusCode, 401);

  assert.equal((await app.inject({ method: "GET", url: "/v1/ontology/mtl/web-sources" })).statusCode, 401);
  const put = (payload: unknown) => app.inject({ method: "PUT", url: "/v1/ontology/mtl/web-sources", payload: payload as object });
  assert.equal((await put({ domains: "quebec.ca" })).statusCode, 400);
  assert.equal((await put({})).statusCode, 400);
  assert.equal((await put({ domains: ["quebec.ca"] })).statusCode, 401);
  await app.close();
});
