import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * The two failures a caller has to be able to tell apart.
 *
 * A run that took too long is not a service that is down. Reporting the first
 * as the second sent a reader to check whether the thing was up while it was
 * answering in seventy milliseconds.
 *
 * The environment is set before anything is imported: `config` reads it once at
 * module load, and a test that sets it afterwards is testing the default.
 */

process.env.SIM_SERVICE_URL = "http://sim.invalid";
process.env.SIM_SERVICE_TIMEOUT_MS = "1000";

const { proxyToSimService, upstreamDetail } = await import("./ml-simulation.js");
const { AppError } = await import("../lib/errors.js");

const realFetch = globalThis.fetch;

test("a run cut off for taking too long says so, and is not called unreachable", async () => {
  globalThis.fetch = ((_url: string, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
      );
    })) as typeof fetch;
  try {
    await proxyToSimService("/events/compare", {});
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof AppError, `threw ${String(err)}`);
    assert.equal(err.code, "SIM_TIMEOUT");
    assert.equal(err.statusCode, 504);
    assert.match(err.message, /still going/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a transport failure is still reported as unreachable", async () => {
  globalThis.fetch = (() => Promise.reject(new Error("ECONNREFUSED"))) as typeof fetch;
  try {
    await proxyToSimService("/events/compare", {});
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof AppError);
    assert.equal(err.code, "SIM_UNAVAILABLE");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("an upstream error keeps its own code rather than becoming a timeout", async () => {
  globalThis.fetch = (() =>
    Promise.resolve({
      ok: false,
      json: () => Promise.resolve({ detail: "no care model" }),
    })) as unknown as typeof fetch;
  try {
    await proxyToSimService("/events/compare", {});
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof AppError);
    assert.equal(err.code, "SIM_UPSTREAM_ERROR");
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---------------------------------------------------------------------------
// A refusal is not an outage.

function answering(status: number, body: unknown): typeof fetch {
  return (() =>
    Promise.resolve({
      ok: status < 400,
      status,
      json: () => Promise.resolve(body),
    })) as unknown as typeof fetch;
}

test("a 400 from the lab keeps its status and its sentence", async () => {
  // The lab refuses with a sentence written for the person who chose the
  // columns. Flattening it to 502 "Simulation service returned an error" turned
  // a fixable configuration into what reads as an outage, and the sentence —
  // the only part that says what to do — was thrown away.
  globalThis.fetch = answering(400, { detail: "Two rows carry the same date." });
  try {
    await proxyToSimService("/lab/forecast/train", {});
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof AppError);
    assert.equal(err.statusCode, 400);
    assert.equal(err.message, "Two rows carry the same date.");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a 500 from the lab stays a 502, because that one is ours", async () => {
  globalThis.fetch = answering(500, { detail: "Traceback (most recent call last)…" });
  try {
    await proxyToSimService("/lab/train", {});
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof AppError);
    assert.equal(err.statusCode, 502);
    assert.equal(err.code, "SIM_UPSTREAM_ERROR");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a 4xx with nothing readable in it falls back rather than showing blank", async () => {
  globalThis.fetch = answering(404, null);
  try {
    await proxyToSimService("/lab/nowhere", {});
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof AppError);
    assert.equal(err.statusCode, 502);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a validation array is made readable instead of dropped", () => {
  // "Invalid request" sends the reader back to guessing which field.
  assert.equal(
    upstreamDetail({
      detail: [
        { loc: ["body", "lags"], msg: "must be >= 1" },
        { loc: ["body", "horizon"], msg: "must be <= 90" },
      ],
    }),
    "lags: must be >= 1 · horizon: must be <= 90",
  );
});

test("nothing readable means nothing, not an invented sentence", () => {
  assert.equal(upstreamDetail(null), null);
  assert.equal(upstreamDetail({}), null);
  assert.equal(upstreamDetail({ detail: "   " }), null);
  assert.equal(upstreamDetail({ detail: [] }), null);
});
