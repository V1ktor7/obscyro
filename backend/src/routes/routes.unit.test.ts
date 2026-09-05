import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * Two route files must not declare the same address.
 *
 * This is here because it shipped. `lab-models.ts` declared
 * `GET /ontology/:env/lab/models`, which `lab.ts` had declared for years.
 * Fastify refuses a duplicate route at registration, so the container built
 * cleanly, started, threw `FST_ERR_DUPLICATED_ROUTE`, and failed its
 * healthcheck — four commits in a row, while tsc and four hundred unit tests
 * stayed green. Nothing in the suite booted the server, so nothing registered a
 * route.
 *
 * The check is static: it reads the source rather than starting Fastify, so it
 * costs nothing and runs with the rest. Parameter names are erased before
 * comparing, because Fastify matches on position — `/:env/x` and `/:id/x` are
 * the same address to the router even though they read differently.
 */

const ROUTES_DIR = dirname(fileURLToPath(import.meta.url));

/** `app.get("/a/:b", …)` and friends, including `app.route({ method, url })`. */
const VERB = /\b(?:app|fastify|server)\s*\.\s*(get|post|put|patch|delete|head|options)\s*\(\s*(["'`])([^"'`]+)\2/g;

interface Declared {
  file: string;
  method: string;
  path: string;
}

function declaredRoutes(): Declared[] {
  const out: Declared[] = [];
  for (const file of readdirSync(ROUTES_DIR)) {
    if (!file.endsWith(".ts") || file.includes(".test.")) continue;
    const src = readFileSync(join(ROUTES_DIR, file), "utf8");
    for (const m of src.matchAll(VERB)) {
      out.push({ file, method: m[1]!.toUpperCase(), path: m[3]! });
    }
  }
  return out;
}

/** What the router sees: names of parameters carry no meaning to it. */
function address(method: string, path: string): string {
  return `${method} ${path.replace(/:[A-Za-z0-9_]+/g, ":p")}`;
}

describe("every route has one owner", () => {
  it("finds the route files at all", () => {
    // A regex that matches nothing would make every assertion below pass.
    const routes = declaredRoutes();
    assert.ok(routes.length > 100, `only ${routes.length} routes found — the scan is broken`);
    assert.ok(routes.some((r) => r.path.includes("/lab/")));
  });

  it("declares no address twice", () => {
    const seen = new Map<string, Declared>();
    const clashes: string[] = [];
    for (const r of declaredRoutes()) {
      const key = address(r.method, r.path);
      const first = seen.get(key);
      if (first) {
        clashes.push(`${key}\n    ${first.file}\n    ${r.file}`);
        continue;
      }
      seen.set(key, r);
    }
    assert.deepEqual(
      clashes,
      [],
      `Fastify refuses these at startup, and the container never serves a request:\n  ${clashes.join("\n  ")}`,
    );
  });

  it("treats a differently-named parameter in the same position as the same address", () => {
    // The guard above is only worth anything if it models the router rather
    // than the source text.
    assert.equal(address("GET", "/a/:env/b"), address("GET", "/a/:id/b"));
    assert.notEqual(address("GET", "/a/:env/b"), address("POST", "/a/:env/b"));
  });
});

/**
 * `lab/ml/` is our namespace. The simulation service does not have one.
 *
 * Moving the ML lab under that prefix was a blind string replace, and it moved
 * the calls *to* the simulation service with it: the backend started asking a
 * FastAPI app for `/lab/ml/estimators`, which does not exist there, and every
 * estimator list came back 502 with a message blaming the network.
 *
 * The upstream paths are the service's own — `/lab/estimators`, `/lab/train`,
 * `/lab/cell`, `/lab/forecast/*`. None of them is under `ml`.
 */
describe("what we ask the simulation service for", () => {
  const CALL = /proxyToSimService\s*(?:<[^>]*>)?\s*\(\s*(["'`])([^"'`]+)\1/g;

  function upstreamPaths(): { file: string; path: string }[] {
    const out: { file: string; path: string }[] = [];
    const roots = [ROUTES_DIR, join(ROUTES_DIR, "..", "services")];
    for (const dir of roots) {
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".ts") || file.includes(".test.")) continue;
        const src = readFileSync(join(dir, file), "utf8");
        for (const m of src.matchAll(CALL)) out.push({ file, path: m[2]! });
      }
    }
    return out;
  }

  it("finds the calls at all", () => {
    assert.ok(upstreamPaths().length >= 5);
  });

  it("never asks it for a path under our own prefix", () => {
    const wrong = upstreamPaths().filter((c) => c.path.startsWith("/lab/ml/"));
    assert.deepEqual(
      wrong.map((c) => `${c.file}: ${c.path}`),
      [],
      "the simulation service has no `ml` namespace — that prefix is ours",
    );
  });
});
