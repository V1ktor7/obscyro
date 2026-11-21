import { PassThrough } from "node:stream";

import type { FastifyReply, FastifyRequest } from "fastify";

import { config } from "./config.js";

export interface SseOptions {
  /** Produce the next payload to serialize and push to the client. */
  produce: () => Promise<unknown>;
  /** Recompute cadence in milliseconds. */
  intervalMs: number;
  /** Short label used in structured logs (e.g. "twin", "metrics"). */
  name: string;
  /** Heartbeat cadence in milliseconds; the configured one when absent. */
  heartbeatMs?: number;
}

/**
 * A Server-Sent Events stream that recomputes on a cadence:
 *  - emits a `retry:` hint so EventSource clients reconnect with backoff,
 *  - applies backpressure (waits for the reader before scheduling more work),
 *  - never lets recompute ticks overlap or pile up on a slow client,
 *  - sends heartbeats so proxies don't kill idle connections,
 *  - cleans up its timers when the reader leaves.
 *
 * The response goes through Fastify, like `streamLines` (./ndjson.ts). It used
 * to take over the socket (`reply.hijack()`) and write its own headers, which
 * dropped the ones the plugins set, CORS above all. The Studio is served from
 * another origin than the API: the browser refused every one of these streams,
 * and the pages fell back to reading again every five seconds after half a
 * minute of showing nothing new. A stream the browser refuses is the same as
 * no stream.
 *
 * The handler returns what this returns.
 */
export function startSseStream(
  req: FastifyRequest,
  reply: FastifyReply,
  opts: SseOptions,
): FastifyReply {
  const out = new PassThrough();
  let closed = false;
  let inFlight = false;

  /** Write unless the reader has gone. False when the reader is behind and the next write should wait. */
  const send = (chunk: string): boolean => (closed || out.destroyed ? true : out.write(chunk));

  /** Resolve once the reader has taken what is buffered, or has gone. */
  const drained = (): Promise<void> =>
    new Promise((resolve) => {
      if (closed || !out.writableNeedDrain) {
        resolve();
        return;
      }
      const done = (): void => {
        out.off("drain", done);
        out.off("close", done);
        resolve();
      };
      out.once("drain", done);
      out.once("close", done);
    });

  const tick = async (): Promise<void> => {
    if (closed || inFlight) return; // skip overlap / slow consumer
    inFlight = true;
    try {
      const payload = await opts.produce();
      if (closed) return;
      if (!send(`data: ${JSON.stringify(payload)}\n\n`)) await drained();
    } catch (err) {
      req.log.warn({ err, sse: opts.name }, "sse produce failed");
    } finally {
      inFlight = false;
    }
  };

  const interval = setInterval(() => void tick(), opts.intervalMs);
  const heartbeat = setInterval(() => {
    send(": ping\n\n");
  }, opts.heartbeatMs ?? config.sseHeartbeatMs);

  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(interval);
    clearInterval(heartbeat);
    if (!out.destroyed) out.destroy();
  };

  // The reader left: the response closes, and Fastify destroys the stream it was sending.
  out.on("close", cleanup);
  reply.raw.on("close", cleanup);
  out.on("error", (err) => {
    req.log.debug({ err, sse: opts.name }, "sse stream error");
    cleanup();
  });

  send(`retry: ${config.sseRetryMs}\n\n`);
  req.log.info({ sse: opts.name, intervalMs: opts.intervalMs }, "sse stream opened");
  void tick();

  return reply
    .header("Content-Type", "text/event-stream")
    .header("Cache-Control", "no-cache, no-transform")
    // Disable proxy buffering (nginx) so events flush immediately.
    .header("X-Accel-Buffering", "no")
    .send(out);
}
