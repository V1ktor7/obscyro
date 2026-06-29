import type { FastifyReply, FastifyRequest } from "fastify";

import { config } from "./config.js";

export interface SseOptions {
  /** Produce the next payload to serialize and push to the client. */
  produce: () => Promise<unknown>;
  /** Recompute cadence in milliseconds. */
  intervalMs: number;
  /** Short label used in structured logs (e.g. "twin", "metrics"). */
  name: string;
}

/**
 * Establish a hardened Server-Sent Events stream:
 *  - emits a `retry:` hint so EventSource clients reconnect with backoff,
 *  - applies backpressure (waits for socket drain before scheduling more work),
 *  - never lets recompute ticks overlap or pile up on a slow client,
 *  - sends heartbeats so proxies don't kill idle connections,
 *  - cleans up all timers and listeners on disconnect or socket error.
 *
 * The caller must not write to `reply` afterwards; this hijacks the response.
 */
export function startSseStream(
  req: FastifyRequest,
  reply: FastifyReply,
  opts: SseOptions,
): void {
  reply.hijack();
  const raw = reply.raw;

  raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Disable proxy buffering (nginx) so events flush immediately.
    "X-Accel-Buffering": "no",
  });
  raw.write(`retry: ${config.sseRetryMs}\n\n`);

  let closed = false;
  let inFlight = false;

  /** Resolve once the socket can accept more data (handles backpressure). */
  const waitForDrain = (): Promise<void> =>
    new Promise((resolve) => {
      if (raw.writableNeedDrain) raw.once("drain", () => resolve());
      else resolve();
    });

  const tick = async (): Promise<void> => {
    if (closed || inFlight) return; // skip overlap / slow consumer
    inFlight = true;
    try {
      const payload = await opts.produce();
      if (closed) return;
      const ok = raw.write(`data: ${JSON.stringify(payload)}\n\n`);
      if (!ok) await waitForDrain();
    } catch (err) {
      req.log.warn({ err, sse: opts.name }, "sse produce failed");
    } finally {
      inFlight = false;
    }
  };

  const interval = setInterval(() => void tick(), opts.intervalMs);
  const heartbeat = setInterval(() => {
    if (!closed) raw.write(": ping\n\n");
  }, config.sseHeartbeatMs);

  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(interval);
    clearInterval(heartbeat);
  };

  req.raw.on("close", cleanup);
  raw.on("error", (err) => {
    req.log.debug({ err, sse: opts.name }, "sse socket error");
    cleanup();
  });

  req.log.info({ sse: opts.name, intervalMs: opts.intervalMs }, "sse stream opened");
  void tick();
}
