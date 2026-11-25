import assert from "node:assert/strict";
import { test } from "node:test";

import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";

import errorHandler from "../plugins/error-handler.js";
import { toolCatalogue } from "../services/analyst-settings.js";
import { CODE_TOOL_NAMES } from "../services/function-reads.js";
import functionTypeRoutes from "./function-types.js";

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
  await app.register(functionTypeRoutes, { prefix: "/v1" });
  await app.ready();
  return app;
}

const BY_SITE = {
  label: "Ventilators available by site",
  description: "The ventilators that are free, at each site.",
  block: "aggregate",
  config: { type: "Ventilator", where: [{ property: "status", equals: { value: "available" } }], agg: "count", groupBy: { value: "site" }, as: "ventilators_available" },
};

test("the function type routes register and compile", async () => {
  const app = await server();
  for (const [method, url] of [
    ["GET", "/v1/ontology/:env/function-types"],
    ["POST", "/v1/ontology/:env/function-types"],
    ["PUT", "/v1/ontology/:env/function-types/:key"],
    ["DELETE", "/v1/ontology/:env/function-types/:key"],
    ["POST", "/v1/ontology/:env/function-types/:key/try"],
  ] as const) {
    assert.ok(app.hasRoute({ method, url }), `${method} ${url}`);
  }
  await app.close();
});

test("a function type is validated before anything is read or written", async () => {
  const app = await server();
  const post = (payload: object) => app.inject({ method: "POST", url: "/v1/ontology/mtl/function-types", payload });
  const put = (key: string, payload: object) => app.inject({ method: "PUT", url: `/v1/ontology/mtl/function-types/${key}`, payload });

  assert.equal((await post({ ...BY_SITE, label: "" })).statusCode, 400);
  // What the model reads to decide to call it cannot be three words.
  assert.equal((await post({ ...BY_SITE, description: "Vents." })).statusCode, 400);
  // Five blocks, and no other: nothing a person types is run as code.
  assert.equal((await post({ ...BY_SITE, block: "sql" })).statusCode, 400);
  assert.equal((await post({ ...BY_SITE, inputs: [{ name: "Site Name", kind: "text", says: "x" }] })).statusCode, 400);
  assert.equal((await post({ ...BY_SITE, inputs: Array.from({ length: 7 }, (_, i) => ({ name: `in_${i}`, kind: "text", says: "x" })) })).statusCode, 400);
  assert.equal((await put("Ventilators", BY_SITE)).statusCode, 400);
  // Well formed: it stops at the door, for want of a key.
  assert.equal((await post(BY_SITE)).statusCode, 401);
  assert.equal((await put("ventilators_available_by_site", BY_SITE)).statusCode, 401);
  assert.equal((await app.inject({ method: "DELETE", url: "/v1/ontology/mtl/function-types/ventilators_available_by_site" })).statusCode, 401);
  assert.equal((await app.inject({ method: "GET", url: "/v1/ontology/mtl/function-types" })).statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: "/v1/ontology/mtl/function-types/ventilators_available_by_site/try", payload: { input: {} } })).statusCode, 401);
  await app.close();
});

test("a declared tool cannot take the name of a tool written in the code", () => {
  for (const name of ["describe_twin", "calculate", "test_option", "list_actions", "web_search", "give_answer"]) assert.ok(CODE_TOOL_NAMES.has(name), name);
});

test("the list of tools names the declared ones, with their own switch", () => {
  const declared = [
    { key: "ventilators_available_by_site", label: "Ventilators available by site", description: "The ventilators that are free.", active: true, inputs: [{ name: "site", kind: "text", required: false, says: "The site." }] },
    { key: "beds_closed", label: "Beds closed", description: "Beds closed for want of staff.", active: false, inputs: [] },
    // A name the code has since taken: the code's tool stands, and the declared one is not listed.
    { key: "describe_twin", label: "Mine", description: "x", active: true, inputs: [] },
  ];
  const lines = toolCatalogue(new Set(), declared);
  const own = lines.filter((l) => l.origin === "project");
  assert.deepEqual(own.map((l) => [l.name, l.on, l.group, l.where]), [
    ["ventilators_available_by_site", true, "Declared in this project", ["ask", "options"]],
    ["beds_closed", false, "Declared in this project", ["ask", "options"]],
  ]);
  assert.equal(own[0]!.reads, "Ventilators available by site. The ventilators that are free.");
  assert.deepEqual(own[0]!.inputs, [{ name: "site", kind: "text", required: false, says: "The site." }]);
  assert.equal(own[0]!.switchable, false);
  assert.match(own[0]!.why!, /switched on or off where it is declared, under Ontology, Functions/);
  assert.equal(lines.filter((l) => l.name === "describe_twin").length, 1);
  assert.equal(lines.find((l) => l.name === "describe_twin")!.origin, "code");
  // Declared tools come after the code's, which keep their order.
  assert.deepEqual(lines.slice(0, toolCatalogue().length), toolCatalogue());
});
