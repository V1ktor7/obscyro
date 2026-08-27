import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// ---------------------------------------------------------------------------
// The REST connector: one configurable HTTP call, repeated until the source
// stops handing back rows.
//
// Fetching a URL is the easy part. What makes an API usable as a data source is
// the three things around it: finding the array inside the response, flattening
// the nested objects that array contains, and following pagination so you get
// more than the first page. Each of those fails silently when absent — you get
// one row, or zero, or twenty out of ten thousand, and nothing errors.
// ---------------------------------------------------------------------------

export interface RestAuth {
  kind: "none" | "bearer" | "header" | "query";
  /** Header name ("X-Api-Key") or query parameter name ("key"). */
  name?: string;
  token?: string;
}

export interface RestPagination {
  kind: "none" | "page" | "offset" | "cursor";
  /** Query parameter carrying the page number or row offset. */
  param?: string;
  /** Query parameter carrying the page size, if the API takes one. */
  sizeParam?: string;
  pageSize?: number;
  /** Where the next cursor lives in the response body, e.g. "next_page_token". */
  cursorPath?: string;
  /** Query parameter to send that cursor back as. */
  cursorParam?: string;
  maxPages?: number;
}

export interface RestConfig {
  url: string;
  method?: "GET" | "POST";
  query?: Record<string, string>;
  headers?: Record<string, string>;
  /** Request body for POST, sent as-is. */
  body?: string;
  auth?: RestAuth;
  /** Dot path to the array of records, e.g. "results" or "data.items". */
  recordPath?: string;
  /** Flatten nested objects into a_b_c columns. On by default. */
  flatten?: boolean;
  format?: "json" | "csv" | "auto";
  pagination?: RestPagination;
}

const MAX_PAGES = 50;
const MAX_ROWS = 50_000;
const TIMEOUT_MS = 30_000;
const MAX_FLATTEN_DEPTH = 4;

// --- reading the response ---------------------------------------------------

/** Follow a dot path. Returns undefined rather than throwing on a bad path. */
export function pickPath(root: unknown, path?: string): unknown {
  if (!path) return root;
  let cur: unknown = root;
  for (const seg of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/**
 * Flatten nested objects so a dataset column exists for every leaf:
 * { geometry: { location: { lat: 45.5 } } } becomes geometry_location_lat.
 * Arrays are kept as JSON text — a pipeline node can expand them later, but
 * silently dropping them would lose data without saying so.
 */
export function flattenRecord(
  row: Record<string, unknown>,
  prefix = "",
  out: Record<string, unknown> = {},
  depth = 0,
): Record<string, unknown> {
  for (const [k, v] of Object.entries(row)) {
    const key = prefix ? `${prefix}_${k}` : k;
    if (Array.isArray(v)) {
      out[key] = JSON.stringify(v);
    } else if (v && typeof v === "object" && depth < MAX_FLATTEN_DEPTH) {
      flattenRecord(v as Record<string, unknown>, key, out, depth + 1);
    } else {
      out[key] = v;
    }
  }
  return out;
}

/**
 * Locate the array of records. An explicit recordPath wins; otherwise try the
 * conventional wrappers, then give up rather than guess wrong.
 */
export function extractRecords(body: unknown, recordPath?: string): Record<string, unknown>[] {
  // Only walk a path that was actually given — pickPath returns the whole body
  // for an empty path, which would mask the conventional wrappers below.
  let raw: unknown = recordPath ? pickPath(body, recordPath) : undefined;
  if (raw === undefined && !recordPath && body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    raw = o.records ?? o.data ?? o.items ?? o.results ?? o.rows ?? o.value;
  }
  if (raw === undefined) raw = body;
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object");
}

/**
 * Which character actually separates the fields.
 *
 * Counted, not detected. Asking whether the header *contains* a tab reads a
 * single stray tab as "this whole file is tab-separated", and one real file
 * does exactly that: the ministry's hourly emergency-department release has
 * tabs padding the inside of a column name. That header holds eight commas and
 * two tabs, the presence test picked tabs, and a nine-column file came back as
 * three columns of joined text — with no error, because splitting on the wrong
 * character always succeeds.
 *
 * A genuine TSV has far more tabs than commas in its header, so counting gets
 * both cases right where presence gets one of them silently wrong.
 */
export function sniffDelimiter(text: string): string {
  const end = text.indexOf("\n");
  const header = end === -1 ? text : text.slice(0, end);
  const count = (ch: string) => header.split(ch).length - 1;
  const tabs = count("\t");
  const commas = count(",");
  const semis = count(";");
  // Semicolons win only outright: several European exports use them, and a
  // decimal comma inside such a file would otherwise outvote the real
  // separator. Ties go to the comma, which is what most files are.
  if (semis > tabs && semis > commas) return ";";
  return tabs > commas ? "\t" : ",";
}

/** Minimal RFC 4180 CSV/TSV reader: quoted fields, doubled quotes, CRLF. */
export function parseDelimited(text: string): Record<string, unknown>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const delim = sniffDelimiter(text);

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  const header = rows.shift();
  if (!header) return [];
  return rows
    .filter((r) => r.some((v) => v !== ""))
    .map((r) => {
      const o: Record<string, unknown> = {};
      header.forEach((h, i) => {
        o[h.trim()] = r[i] ?? null;
      });
      return o;
    });
}

// --- where we are allowed to call ------------------------------------------

function isPrivateAddress(ip: string): boolean {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    return (
      v === "::1" ||
      v === "::" ||
      v.startsWith("fe80") ||
      v.startsWith("fc") ||
      v.startsWith("fd") ||
      v.startsWith("::ffff:127.") ||
      v.startsWith("::ffff:10.") ||
      v.startsWith("::ffff:169.254.")
    );
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  const [a, b] = p as [number, number, number, number];
  return (
    a === 0 ||
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) // cloud instance metadata
  );
}

/**
 * Refuse to fetch private, loopback or link-local addresses. A sync URL is
 * user-supplied and the server makes the call, so without this the platform is
 * an open proxy into its own network — 169.254.169.254 being the classic prize.
 *
 * Resolution happens here and the connection happens later, so this does not
 * defeat a deliberate DNS-rebinding attack; it defeats the ordinary case.
 * Set ALLOW_PRIVATE_SYNC_TARGETS=1 to permit localhost in development.
 */
export async function assertFetchableUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`"${raw}" is not a valid URL.`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`Only http and https are supported, got "${u.protocol}".`);
  }
  if (process.env.ALLOW_PRIVATE_SYNC_TARGETS === "1") return u;

  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addresses.length === 0) {
    throw new Error(`Could not resolve "${host}".`);
  }
  for (const a of addresses) {
    if (isPrivateAddress(a)) {
      throw new Error(
        `"${host}" resolves to a private address (${a}). Sources must point at a public endpoint.`,
      );
    }
  }
  return u;
}

// --- the call ---------------------------------------------------------------

function applyAuth(url: URL, headers: Record<string, string>, auth?: RestAuth): void {
  if (!auth || auth.kind === "none" || !auth.token) return;
  if (auth.kind === "bearer") headers.Authorization = `Bearer ${auth.token}`;
  else if (auth.kind === "header" && auth.name) headers[auth.name] = auth.token;
  else if (auth.kind === "query" && auth.name) url.searchParams.set(auth.name, auth.token);
}

export interface FetchOutcome {
  records: Record<string, unknown>[];
  pages: number;
  truncated: boolean;
}

/**
 * Call the endpoint, following pagination until it runs out, a cap is hit, or a
 * page comes back empty. Caps exist so a misconfigured cursor cannot loop.
 */
export async function fetchRecords(cfg: RestConfig, maxRows = MAX_ROWS): Promise<FetchOutcome> {
  const pag = cfg.pagination ?? { kind: "none" };
  const pageLimit = Math.min(Math.max(pag.maxPages ?? MAX_PAGES, 1), MAX_PAGES);
  const size = pag.pageSize ?? 100;

  const all: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  let pages = 0;
  let truncated = false;

  for (let page = 0; page < pageLimit; page++) {
    const url = await assertFetchableUrl(cfg.url);
    for (const [k, v] of Object.entries(cfg.query ?? {})) url.searchParams.set(k, v);

    if (pag.kind === "page" && pag.param) {
      url.searchParams.set(pag.param, String(page + 1));
      if (pag.sizeParam) url.searchParams.set(pag.sizeParam, String(size));
    } else if (pag.kind === "offset" && pag.param) {
      url.searchParams.set(pag.param, String(page * size));
      if (pag.sizeParam) url.searchParams.set(pag.sizeParam, String(size));
    } else if (pag.kind === "cursor" && pag.cursorParam) {
      if (cursor) url.searchParams.set(pag.cursorParam, cursor);
      else if (page > 0) break;
    }

    const headers: Record<string, string> = {
      Accept: "application/json, text/csv;q=0.9, */*;q=0.8",
      ...(cfg.headers ?? {}),
    };
    applyAuth(url, headers, cfg.auth);

    const method = cfg.method ?? "GET";
    if (method === "POST" && cfg.body && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(url, {
      method,
      headers,
      body: method === "POST" ? (cfg.body ?? undefined) : undefined,
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} from ${url.origin}${url.pathname}`);
    }
    pages++;

    const ctype = res.headers.get("content-type") ?? "";
    const text = await res.text();
    const isCsv =
      cfg.format === "csv" ||
      (cfg.format !== "json" && (ctype.includes("csv") || ctype.includes("text/tab")));

    let batch: Record<string, unknown>[];
    let body: unknown = null;
    if (isCsv) {
      batch = parseDelimited(text);
    } else {
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error("Response was not valid JSON. Set the format to CSV if that is what it is.");
      }
      batch = extractRecords(body, cfg.recordPath);
    }

    if (cfg.flatten !== false) batch = batch.map((r) => flattenRecord(r));
    all.push(...batch);

    if (all.length >= maxRows) {
      all.length = maxRows;
      truncated = true;
      break;
    }
    if (batch.length === 0) break;
    if (pag.kind === "none") break;
    if (pag.kind === "cursor") {
      const next = pickPath(body, pag.cursorPath);
      cursor = next == null || next === "" ? null : String(next);
      if (!cursor) break;
    } else if (batch.length < size) break;
    if (page === pageLimit - 1) truncated = true;
  }

  return { records: all, pages, truncated };
}

/** Fields that must never be returned to a client once stored. */
const SECRET_KEYS = new Set(["token", "password", "secret", "apiKey", "api_key"]);

/** Replace stored credentials with a marker so reads never echo them back. */
export function redactConfig(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    if (SECRET_KEYS.has(k) && v) out[k] = "••••••••";
    else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = redactConfig(v as Record<string, unknown>);
    } else out[k] = v;
  }
  return out;
}
