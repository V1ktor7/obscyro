import assert from "node:assert/strict";
import { test } from "node:test";

import cors from "@fastify/cors";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { streamLines } from "./ndjson.js";

/** A server set up the way the API is, with one streaming route. */
async function server(work: (write: (line: unknown) => void) => Promise<void>) {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(cors, { origin: ["https://obscyro.vercel.app"], credentials: true });
  app.post("/ask", { schema: { body: z.object({ question: z.string().min(3) }) } }, async (_req, reply) =>
    streamLines(reply, work, { heartbeatMs: 5 }),
  );
  return app;
}

const lines = (body: string) =>
  body
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { type: string });

test("lines arrive in order, with the headers a browser on another origin needs", async () => {
  const app = await server(async (write) => {
    write({ type: "status", message: "Reading" });
    write({ type: "step", step: { id: "s1" } });
    write({ type: "done" });
  });
  const res = await app.inject({
    method: "POST",
    url: "/ask",
    headers: { origin: "https://obscyro.vercel.app" },
    payload: { question: "Where does it break?" },
  });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers["content-type"]), /application\/x-ndjson/);
  assert.equal(res.headers["access-control-allow-origin"], "https://obscyro.vercel.app");
  assert.equal(res.headers["access-control-allow-credentials"], "true");
  assert.deepEqual(
    lines(res.body).map((l) => l.type),
    ["status", "step", "done"],
  );
  await app.close();
});

test("a slow piece of work is kept alive with pings, and they stop when it ends", async () => {
  const app = await server(async (write) => {
    await new Promise((r) => setTimeout(r, 40));
    write({ type: "done" });
  });
  const res = await app.inject({ method: "POST", url: "/ask", payload: { question: "Where does it break?" } });
  const types = lines(res.body).map((l) => l.type);
  assert.ok(types.filter((t) => t === "ping").length >= 2, `expected pings, got ${types.join(",")}`);
  assert.equal(types.at(-1), "done");
  await app.close();
});

test("work that throws still ends the stream instead of hanging the client", async () => {
  const app = await server(async (write) => {
    write({ type: "status", message: "Reading" });
    throw new Error("boom");
  });
  const res = await app.inject({ method: "POST", url: "/ask", payload: { question: "Where does it break?" } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(
    lines(res.body).map((l) => l.type),
    ["status"],
  );
  await app.close();
});

test("a question refused before the work starts is an ordinary error, not a stream", async () => {
  const app = await server(async () => {});
  const res = await app.inject({ method: "POST", url: "/ask", payload: { question: "?" } });
  assert.equal(res.statusCode, 400);
  await app.close();
});
