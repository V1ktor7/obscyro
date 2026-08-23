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

const { proxyToSimService } = await import("./ml-simulation.js");
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
