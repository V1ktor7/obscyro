import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { AppError, BadRequest, NotFound } from "../lib/errors.js";
import { resolveUserIdForApiKey } from "../services/login.js";

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

const keyValue = z.object({ name: z.string(), value: z.string() });

const sourceRequestSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
  url: z.string().min(1),
  authentication: z.object({
    type: z.enum([
      "none",
      "basic",
      "header",
      "queryAuth",
      "oauth2",
      "predefinedCredential",
    ]),
    credentialId: z.string().nullable().default(null),
    username: z.string().optional(),
    password: z.string().optional(),
    headerName: z.string().optional(),
    headerValue: z.string().optional(),
    queryName: z.string().optional(),
    queryValue: z.string().optional(),
    token: z.string().optional(),
  }),
  sendQuery: z.boolean().default(false),
  queryParameters: z.array(keyValue).default([]),
  sendHeaders: z.boolean().default(false),
  headerParameters: z.array(keyValue).default([]),
  sendBody: z.boolean().default(false),
  bodyType: z
    .enum(["json", "form-urlencoded", "form-data", "raw", "binary"])
    .default("json"),
  body: z.string().nullable().default(null),
  rawContentType: z.string().nullable().default(null),
  pagination: z.object({
    mode: z
      .enum(["none", "offset", "cursor", "linkHeader", "nextUrlInBody"])
      .default("none"),
    limitParam: z.string().default("limit"),
    offsetParam: z.string().default("offset"),
    cursorPath: z.string().default("$.meta.nextCursor"),
    nextUrlPath: z.string().default("$.links.next"),
    maxPages: z.number().int().min(1).max(200).default(50),
  }),
  options: z.object({
    timeoutMs: z.number().int().min(1).max(120_000).default(30_000),
    retry: z.object({
      enabled: z.boolean().default(true),
      maxAttempts: z.number().int().min(1).max(10).default(3),
      backoffMs: z.number().int().min(0).max(30_000).default(1000),
    }),
    followRedirects: z.boolean().default(true),
    ignoreSslErrors: z.boolean().default(false),
    proxy: z.string().nullable().default(null),
  }),
  response: z.object({
    format: z.enum(["json", "text", "binary"]).default("json"),
    jsonPath: z.string().nullable().default(null),
    includeHeaders: z.boolean().default(false),
    neverError: z.boolean().default(false),
  }),
});

type SourceRequest = z.infer<typeof sourceRequestSchema>;

// ---------------------------------------------------------------------------
// Expression resolution: {{$env.NAME}} -> process.env.SOURCE_ENV_NAME
// Only an allow-listed, prefixed set of server vars is reachable, so the node
// can never read arbitrary backend secrets.
// ---------------------------------------------------------------------------

const ENV_EXPR = /\{\{\s*\$env\.([A-Za-z0-9_]+)\s*\}\}/g;

function resolveExpr(input: string): string {
  return input.replace(ENV_EXPR, (_m, name: string) => {
    const value = process.env[`SOURCE_ENV_${name}`];
    return value ?? "";
  });
}

// ---------------------------------------------------------------------------
// SSRF guard: refuse egress to loopback / link-local / private ranges unless
// SOURCE_ALLOW_PRIVATE=1 (handy for local development against your own API).
// ---------------------------------------------------------------------------

function assertEgressAllowed(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw BadRequest("SOURCE_BAD_URL", `Invalid URL: ${rawUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw BadRequest("SOURCE_BAD_PROTOCOL", "Only http(s) URLs are allowed.");
  }
  if (process.env.SOURCE_ALLOW_PRIVATE === "1") return url;

  const host = url.hostname.toLowerCase();
  const blockedHost =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".internal") ||
    host.endsWith(".local");
  const privateIp =
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host);
  if (blockedHost || privateIp) {
    throw BadRequest(
      "SOURCE_EGRESS_BLOCKED",
      `Egress to "${host}" is blocked. Set SOURCE_ALLOW_PRIVATE=1 to allow private hosts.`,
    );
  }
  return url;
}

// ---------------------------------------------------------------------------
// Minimal JSONPath subset: $, .key, [n], [*]
// ---------------------------------------------------------------------------

function jsonPathQuery(root: unknown, path: string): unknown[] {
  const cleaned = path.replace(/^\$\.?/, "").trim();
  if (!cleaned) return [root];
  const tokens = cleaned
    .replace(/\[(\*|\d+)\]/g, ".[$1]")
    .split(".")
    .filter(Boolean);

  let current: unknown[] = [root];
  for (const token of tokens) {
    const next: unknown[] = [];
    const arrayMatch = /^\[(\*|\d+)\]$/.exec(token);
    for (const node of current) {
      if (node == null) continue;
      if (arrayMatch) {
        if (!Array.isArray(node)) continue;
        if (arrayMatch[1] === "*") next.push(...node);
        else {
          const idx = Number(arrayMatch[1]);
          if (idx < node.length) next.push(node[idx]);
        }
      } else if (typeof node === "object") {
        const value = (node as Record<string, unknown>)[token];
        if (value !== undefined) next.push(value);
      }
    }
    current = next;
  }
  return current;
}

function extractBody(raw: unknown, jsonPath: string | null): unknown {
  if (!jsonPath) return raw;
  const matches = jsonPathQuery(raw, jsonPath);
  if (matches.length === 0) return null;
  if (matches.length === 1 && !/\[\*\]/.test(jsonPath)) return matches[0];
  return matches;
}

function pageItems(raw: unknown, jsonPath: string | null): unknown[] {
  if (jsonPath) return jsonPathQuery(raw, jsonPath);
  if (Array.isArray(raw)) return raw;
  return raw == null ? [] : [raw];
}

// ---------------------------------------------------------------------------
// Deterministic text harvester (mirror of the frontend one): every string leaf
// in document order, joined with newlines. Verbatim only — no inference.
// ---------------------------------------------------------------------------

const MAX_HARVEST_CHARS = 100_000;

function harvestText(body: unknown, format: "json" | "text" | "binary"): string {
  if (format === "text") return typeof body === "string" ? body : String(body ?? "");
  if (format === "binary") return "";
  if (typeof body === "string") return body;

  const leaves: string[] = [];
  let budget = MAX_HARVEST_CHARS;
  const walk = (value: unknown): void => {
    if (budget <= 0 || value == null) return;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) {
        leaves.push(trimmed);
        budget -= trimmed.length + 1;
      }
      return;
    }
    if (typeof value === "number" || typeof value === "boolean") return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (typeof value === "object") {
      for (const v of Object.values(value as Record<string, unknown>)) walk(v);
    }
  };
  walk(body);
  return leaves.join("\n");
}

// ---------------------------------------------------------------------------
// Request construction + execution
// ---------------------------------------------------------------------------

type RequestBody = string | Buffer | FormData;

type BuiltRequest = {
  url: URL;
  headers: Record<string, string>;
  body?: RequestBody;
};

function buildRequest(req: SourceRequest): BuiltRequest {
  const resolvedUrl = resolveExpr(req.url);
  const url = assertEgressAllowed(resolvedUrl);
  const headers: Record<string, string> = {};

  if (req.sendHeaders) {
    for (const h of req.headerParameters) {
      if (h.name) headers[h.name] = resolveExpr(h.value);
    }
  }
  if (req.sendQuery) {
    for (const q of req.queryParameters) {
      if (q.name) url.searchParams.append(q.name, resolveExpr(q.value));
    }
  }

  const auth = req.authentication;
  switch (auth.type) {
    case "basic":
      if (auth.username != null) {
        const raw = `${auth.username}:${auth.password ?? ""}`;
        headers.Authorization = `Basic ${Buffer.from(raw).toString("base64")}`;
      }
      break;
    case "header":
      if (auth.headerName) headers[auth.headerName] = resolveExpr(auth.headerValue ?? "");
      break;
    case "queryAuth":
      if (auth.queryName) url.searchParams.append(auth.queryName, resolveExpr(auth.queryValue ?? ""));
      break;
    case "oauth2":
      if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
      break;
    case "predefinedCredential":
      throw BadRequest(
        "SOURCE_CREDENTIALS_UNSUPPORTED",
        "Predefined/server-side credentials are not available yet. Use inline auth.",
      );
    case "none":
    default:
      break;
  }

  let body: RequestBody | undefined;
  const hasBody = req.sendBody && req.method !== "GET" && req.method !== "HEAD";
  if (hasBody && req.body != null) {
    const resolved = resolveExpr(req.body);
    switch (req.bodyType) {
      case "json": {
        headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
        body = resolved;
        break;
      }
      case "form-urlencoded": {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        body = toFormUrlEncoded(resolved);
        break;
      }
      case "form-data": {
        // Content-Type auto-set (boundary) by fetch when given FormData.
        body = toFormData(resolved);
        break;
      }
      case "raw": {
        if (req.rawContentType) headers["Content-Type"] = req.rawContentType;
        body = resolved;
        break;
      }
      case "binary": {
        headers["Content-Type"] = req.rawContentType ?? "application/octet-stream";
        body = Buffer.from(resolved, "base64");
        break;
      }
    }
  }

  return { url, headers, body };
}

function toFormUrlEncoded(input: string): string {
  try {
    const obj = JSON.parse(input) as Record<string, unknown>;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(obj)) params.append(k, String(v));
    return params.toString();
  } catch {
    return input;
  }
}

function toFormData(input: string): FormData {
  const fd = new FormData();
  try {
    const obj = JSON.parse(input) as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) fd.append(k, String(v));
  } catch {
    fd.append("body", input);
  }
  return fd;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: SourceRequest["options"],
): Promise<Response> {
  const attempts = options.retry.enabled ? options.retry.maxAttempts : 1;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        redirect: options.followRedirects ? "follow" : "manual",
        signal: controller.signal,
      });
      clearTimeout(timer);
      // Retry only transient server-side failures.
      if (res.status >= 500 && attempt < attempts) {
        await sleep(options.retry.backoffMs * attempt);
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < attempts) {
        await sleep(options.retry.backoffMs * attempt);
        continue;
      }
    }
  }
  throw new AppError(
    "SOURCE_FETCH_FAILED",
    lastErr instanceof Error ? lastErr.message : "Upstream request failed.",
    502,
  );
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

async function parseResponse(
  res: Response,
  format: "json" | "text" | "binary",
): Promise<{ body: unknown; contentType?: string }> {
  if (format === "binary") {
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      body: buf.toString("base64"),
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
    };
  }
  if (format === "text") {
    return { body: await res.text() };
  }
  const text = await res.text();
  if (!text) return { body: null };
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { body: text };
  }
}

function headerRecord(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

const sourceRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/source/fetch",
    {
      schema: {
        summary: "Execute a configurable HTTP request (server-side egress)",
        description:
          "Runs the Source node's HTTP request on the server: kills CORS, hides credentials, and supports retries, pagination, and response shaping.",
        tags: ["source"],
        body: sourceRequestSchema,
        response: {
          200: z.object({
            status: z.number(),
            statusText: z.string(),
            ok: z.boolean(),
            headers: z.record(z.string()).optional(),
            body: z.any(),
            text: z.string(),
            pages: z.number(),
            contentType: z.string().optional(),
          }),
          400: errorEnvelope,
          401: errorEnvelope,
          502: errorEnvelope,
        },
      },
    },
    async (req) => {
      const apiKey = req.apiKey!;
      const userId = await resolveUserIdForApiKey(req.db, apiKey.id);
      if (!userId) throw NotFound("USER_NOT_FOUND", "User not found for API key.");

      const cfg = req.body;
      const built = buildRequest(cfg);
      const init: RequestInit = {
        method: cfg.method,
        headers: built.headers,
        ...(built.body !== undefined ? { body: built.body } : {}),
      };

      const mode = cfg.pagination.mode;
      const maxPages = cfg.pagination.maxPages;

      // ---- single request (no pagination) ----
      if (mode === "none") {
        const res = await fetchWithRetry(built.url.toString(), init, cfg.options);
        if (!res.ok && !cfg.response.neverError) {
          throw new AppError(
            "SOURCE_UPSTREAM_ERROR",
            `Upstream responded ${res.status} ${res.statusText}.`,
            502,
            { status: res.status },
          );
        }
        const { body, contentType } = await parseResponse(res, cfg.response.format);
        const shaped = extractBody(body, cfg.response.jsonPath);
        return {
          status: res.status,
          statusText: res.statusText,
          ok: res.ok,
          ...(cfg.response.includeHeaders ? { headers: headerRecord(res) } : {}),
          body: shaped,
          text: harvestText(shaped, cfg.response.format),
          pages: 1,
          ...(contentType ? { contentType } : {}),
        };
      }

      // ---- paginated request (best-effort) ----
      const collected: unknown[] = [];
      let lastStatus = 0;
      let lastStatusText = "";
      let lastOk = false;
      let pages = 0;
      let nextUrl: string | null = built.url.toString();
      let offset = 0;
      const limit = readLimit(cfg);

      while (nextUrl && pages < maxPages) {
        const pageUrl = new URL(nextUrl);
        if (mode === "offset") pageUrl.searchParams.set(cfg.pagination.offsetParam, String(offset));

        const res = await fetchWithRetry(pageUrl.toString(), init, cfg.options);
        lastStatus = res.status;
        lastStatusText = res.statusText;
        lastOk = res.ok;
        pages += 1;

        if (!res.ok && !cfg.response.neverError) {
          throw new AppError(
            "SOURCE_UPSTREAM_ERROR",
            `Upstream responded ${res.status} ${res.statusText} on page ${pages}.`,
            502,
            { status: res.status, page: pages },
          );
        }

        const linkHeader = res.headers.get("link");
        const { body } = await parseResponse(res, cfg.response.format);
        const items = pageItems(body, cfg.response.jsonPath);
        collected.push(...items);

        // Decide the next page.
        nextUrl = null;
        if (mode === "offset") {
          if (items.length === 0) break;
          offset += limit;
          nextUrl = built.url.toString();
        } else if (mode === "cursor") {
          const cursor = jsonPathQuery(body, cfg.pagination.cursorPath)[0];
          if (cursor) {
            const u = new URL(built.url.toString());
            u.searchParams.set("cursor", String(cursor));
            nextUrl = u.toString();
          }
        } else if (mode === "linkHeader") {
          nextUrl = parseLinkNext(linkHeader);
        } else if (mode === "nextUrlInBody") {
          const next = jsonPathQuery(body, cfg.pagination.nextUrlPath)[0];
          nextUrl = next ? String(next) : null;
        }
      }

      return {
        status: lastStatus,
        statusText: lastStatusText,
        ok: lastOk,
        body: collected,
        text: harvestText(collected, cfg.response.format),
        pages,
      };
    },
  );
};

function readLimit(cfg: SourceRequest): number {
  const fromQuery = cfg.queryParameters.find((q) => q.name === cfg.pagination.limitParam);
  const n = fromQuery ? Number(fromQuery.value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 50;
}

function parseLinkNext(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = /<([^>]+)>\s*;\s*rel="?next"?/i.exec(part.trim());
    if (match) return match[1];
  }
  return null;
}

export default sourceRoutes;
