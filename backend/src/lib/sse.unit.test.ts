import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import cors from "@fastify/cors";
import Fastify from "fastify";

import { startSseStream } from "./sse.js";

const STUDIO = "https://obscyro.vercel.app";

/** A server set up the way the API is, with one stream that recomputes every few milliseconds. */
async function server(produce: () => Promise<unknown>, intervalMs = 5) {
  const app = Fastify({ forceCloseConnections: true });
  await app.register(cors, { origin: [STUDIO], credentials: true });
  app.get("/stream", async (req, reply) => startSseStream(req, reply, { name: "test", intervalMs, heartbeatMs: 5, produce }));
  await app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = app.server.address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${port}/stream` };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Read a stream as a browser would, until `enough` says so. The connection is then dropped. */
async function read(url: string, enough: (text: string) => boolean) {
  const gone = new AbortController();
  const res = await fetch(url, { headers: { origin: STUDIO, accept: "text/event-stream" }, signal: gone.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + 2000;
  while (!enough(text) && Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  gone.abort();
  return { res, text };
}

const events = (text: string) =>
  text
    .split("\n\n")
    .filter((block) => block.startsWith("data: "))
    .map((block) => JSON.parse(block.slice("data: ".length)) as { n: number });

test("the stream reaches a browser on another origin, and keeps arriving", async () => {
  let n = 0;
  const { app, url } = await server(async () => ({ n: (n += 1) }));
  const { res, text } = await read(url, (t) => events(t).length >= 3);

  assert.equal(res.status, 200);
  assert.match(String(res.headers.get("content-type")), /^text\/event-stream/);
  // Without these two a page served from another origin is refused the response: it was the case
  // while the stream wrote its own headers on the socket.
  assert.equal(res.headers.get("access-control-allow-origin"), STUDIO);
  assert.equal(res.headers.get("access-control-allow-credentials"), "true");
  assert.equal(res.headers.get("cache-control"), "no-cache, no-transform");

  assert.match(text, /^retry: \d+\n\n/);
  assert.deepEqual(
    events(text)
      .slice(0, 3)
      .map((e) => e.n),
    [1, 2, 3],
  );
  await app.close();
});

test("the work stops when the reader leaves", async () => {
  let calls = 0;
  const { app, url } = await server(async () => ({ n: (calls += 1) }));
  await read(url, (t) => events(t).length >= 2);

  // The connection is dropped: give the server the time to see it, then nothing more is computed.
  await sleep(60);
  const after = calls;
  await sleep(60);
  assert.equal(calls, after, "the stream kept recomputing for a reader that had left");
  await app.close();
});

test("ticks never overlap on work slower than the cadence", async () => {
  let running = 0;
  let most = 0;
  let n = 0;
  const { app, url } = await server(async () => {
    running += 1;
    most = Math.max(most, running);
    await sleep(20);
    running -= 1;
    return { n: (n += 1) };
  }, 2);
  await read(url, (t) => events(t).length >= 3);
  assert.equal(most, 1);
  await app.close();
});

test("a recompute that fails is skipped, and the stream goes on", async () => {
  let n = 0;
  const { app, url } = await server(async () => {
    n += 1;
    if (n === 1) throw new Error("boom");
    return { n };
  });
  const { res, text } = await read(url, (t) => events(t).length >= 2);
  assert.equal(res.status, 200);
  assert.deepEqual(
    events(text)
      .slice(0, 2)
      .map((e) => e.n),
    [2, 3],
  );
  await app.close();
});

test("a quiet stream is kept alive with heartbeats", async () => {
  // One event, then nothing for a long time: only the heartbeats tell a proxy the connection lives.
  const { app, url } = await server(async () => ({ n: 1 }), 60_000);
  const { text } = await read(url, (t) => (t.match(/: ping\n\n/g) ?? []).length >= 2);
  assert.ok((text.match(/: ping\n\n/g) ?? []).length >= 2, `expected heartbeats, got ${JSON.stringify(text)}`);
  assert.equal(events(text).length, 1);
  await app.close();
});
