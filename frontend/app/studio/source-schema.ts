// ---------------------------------------------------------------------------
// Source node request schema (n8n-style HTTP Request)
//
// This is the configuration shape for the configurable "Source" intake node.
// The actual HTTP call is performed server-side by POST /v1/source/fetch — the
// browser never makes the cross-origin request, so there is no CORS problem and
// secrets stay off the wire to third parties.
// ---------------------------------------------------------------------------

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export type AuthType =
  | "none"
  | "basic"
  | "header"
  | "queryAuth"
  | "oauth2"
  | "predefinedCredential";

export type BodyType = "json" | "form-urlencoded" | "form-data" | "raw" | "binary";

export type PaginationMode =
  | "none"
  | "offset"
  | "cursor"
  | "linkHeader"
  | "nextUrlInBody";

export type ResponseFormat = "json" | "text" | "binary";

export type KeyValue = { name: string; value: string };

export type SourceAuth = {
  type: AuthType;
  /** References a stored, server-side credential — never inlined into the graph. */
  credentialId: string | null;
  /** Inline secrets (basic | header | queryAuth). Sent per-request, never persisted. */
  username?: string;
  password?: string;
  headerName?: string;
  headerValue?: string;
  queryName?: string;
  queryValue?: string;
  /** oauth2: a pasted bearer token, treated like a header credential. */
  token?: string;
};

export type SourcePagination = {
  mode: PaginationMode;
  limitParam: string;
  offsetParam: string;
  cursorPath: string;
  /** dot/JSONPath-ish path to the next page URL when mode = nextUrlInBody */
  nextUrlPath?: string;
  maxPages: number;
};

export type SourceRetry = {
  enabled: boolean;
  maxAttempts: number;
  backoffMs: number;
};

export type SourceOptions = {
  timeoutMs: number;
  retry: SourceRetry;
  followRedirects: boolean;
  ignoreSslErrors: boolean;
  proxy: string | null;
};

export type SourceResponseOptions = {
  format: ResponseFormat;
  /** optional: extract a sub-tree, e.g. "$.entry[*].resource" */
  jsonPath: string | null;
  includeHeaders: boolean;
  /** if true, non-2xx still returns instead of throwing */
  neverError: boolean;
};

export type SourceRequest = {
  method: HttpMethod;
  /** supports expressions: https://{{$env.HOST}}/v1/patients */
  url: string;

  authentication: SourceAuth;

  sendQuery: boolean;
  queryParameters: KeyValue[];

  sendHeaders: boolean;
  headerParameters: KeyValue[];

  sendBody: boolean;
  bodyType: BodyType;
  /** Edited as text in the form; shape depends on bodyType. */
  body: string | null;
  /** only when bodyType = raw */
  rawContentType: string | null;

  pagination: SourcePagination;
  options: SourceOptions;
  response: SourceResponseOptions;
};

export function defaultSourceRequest(): SourceRequest {
  return {
    method: "GET",
    url: "",
    authentication: { type: "none", credentialId: null },
    sendQuery: false,
    queryParameters: [],
    sendHeaders: false,
    headerParameters: [],
    sendBody: false,
    bodyType: "json",
    body: null,
    rawContentType: null,
    pagination: {
      mode: "none",
      limitParam: "limit",
      offsetParam: "offset",
      cursorPath: "$.meta.nextCursor",
      nextUrlPath: "$.links.next",
      maxPages: 50,
    },
    options: {
      timeoutMs: 30000,
      retry: { enabled: true, maxAttempts: 3, backoffMs: 1000 },
      followRedirects: true,
      ignoreSslErrors: false,
      proxy: null,
    },
    response: {
      format: "json",
      jsonPath: null,
      includeHeaders: false,
      neverError: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Deterministic text harvester
//
// Downstream NLP nodes operate on plain text. This collects every string leaf
// from an arbitrary JSON body (depth-first, in document order) and joins them.
// No paraphrasing, no inference — only verbatim string values are surfaced, so
// the text fed forward is provably a concatenation of the source's own strings.
// ---------------------------------------------------------------------------

const MAX_HARVEST_CHARS = 100_000;

export function harvestText(body: unknown, format: ResponseFormat = "json"): string {
  if (format === "text") {
    return typeof body === "string" ? body : String(body ?? "");
  }
  if (format === "binary") {
    return "";
  }
  if (typeof body === "string") {
    return body;
  }

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
    if (typeof value === "number" || typeof value === "boolean") {
      return;
    }
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
