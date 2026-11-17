import { PassThrough } from "node:stream";

import type { FastifyReply } from "fastify";

/**
 * A response that arrives one JSON object per line, as the work produces them.
 *
 * For work that takes a minute and has something to show along the way. The
 * response is sent through Fastify rather than by taking over the socket, so
 * the headers the plugins set (CORS, above all) travel with it: a stream the
 * browser refuses is the same as no stream.
 *
 * `work` writes lines and returns when it is done. It should not throw — a
 * failure is a line to write, since the status code has already gone — but if
 * it does, the stream still ends rather than hanging the client.
 *
 * `gone` aborts when the client leaves before the end, so work that costs
 * something can stop doing it for nobody.
 */
export function streamLines<E>(
  reply: FastifyReply,
  work: (write: (line: E) => void, gone: AbortSignal) => Promise<void>,
  opts: { heartbeatMs?: number } = {},
): FastifyReply {
  const out = new PassThrough();
  const gone = new AbortController();
  // Closed without having been ended: the reader went away.
  out.on("close", () => {
    if (!out.writableEnded) gone.abort();
  });
  const write = (line: unknown) => {
    if (!out.writableEnded && !out.destroyed) out.write(`${JSON.stringify(line)}\n`);
  };
  // A line every few seconds keeps a proxy from deciding the connection died
  // while the work is thinking.
  const beat = setInterval(() => write({ type: "ping" }), opts.heartbeatMs ?? 10_000);
  void work(write, gone.signal)
    .catch((err) => reply.log.error({ err }, "stream work failed"))
    .finally(() => {
      clearInterval(beat);
      out.end();
    });
  return reply
    .header("Content-Type", "application/x-ndjson; charset=utf-8")
    .header("Cache-Control", "no-cache, no-transform")
    .header("X-Accel-Buffering", "no")
    .send(out);
}
