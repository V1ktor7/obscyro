"use client";

import { useState } from "react";

import { runSourceFetch, type SourceFetchResult } from "@/lib/platform-api";

import type {
  AuthType,
  BodyType,
  HttpMethod,
  KeyValue,
  PaginationMode,
  ResponseFormat,
  SourceRequest,
} from "./source-schema";

const inputCls =
  "w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10";
const labelCls = "mb-1 block text-xs font-medium text-gray-700";

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const AUTH_TYPES: { value: AuthType; label: string; disabled?: boolean }[] = [
  { value: "none", label: "None" },
  { value: "basic", label: "Basic" },
  { value: "header", label: "Header" },
  { value: "queryAuth", label: "Query param" },
  { value: "oauth2", label: "Bearer token" },
  { value: "predefinedCredential", label: "Stored credential (coming soon)", disabled: true },
];
const BODY_TYPES: BodyType[] = ["json", "form-urlencoded", "form-data", "raw", "binary"];
const PAGINATION_MODES: PaginationMode[] = [
  "none",
  "offset",
  "cursor",
  "linkHeader",
  "nextUrlInBody",
];
const RESPONSE_FORMATS: ResponseFormat[] = ["json", "text", "binary"];

function Section({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className="mb-3 rounded-md border border-gray-200">
      <summary className="cursor-pointer select-none px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {title}
      </summary>
      <div className="border-t border-gray-100 p-2.5">{children}</div>
    </details>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="mb-2 flex items-center gap-2 text-xs text-gray-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-gray-900"
      />
      {label}
    </label>
  );
}

function KeyValueRows({
  rows,
  onChange,
}: {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
}) {
  const update = (i: number, patch: Partial<KeyValue>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((row, i) => (
        <div key={i} className="flex gap-1.5">
          <input
            value={row.name}
            placeholder="name"
            onChange={(e) => update(i, { name: e.target.value })}
            className={inputCls}
          />
          <input
            value={row.value}
            placeholder="value"
            onChange={(e) => update(i, { value: e.target.value })}
            className={inputCls}
          />
          <button
            type="button"
            onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
            aria-label="Remove row"
            className="shrink-0 rounded-md border border-gray-300 px-2 text-gray-500 hover:bg-gray-50"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...rows, { name: "", value: "" }])}
        className="mt-1 self-start rounded-md border border-gray-300 bg-white px-2.5 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
      >
        + Add
      </button>
    </div>
  );
}

export default function SourceNodeForm({
  request,
  onChange,
}: {
  request: SourceRequest;
  onChange: (request: SourceRequest) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SourceFetchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const patch = (partial: Partial<SourceRequest>) => onChange({ ...request, ...partial });
  const auth = request.authentication;
  const setAuth = (partial: Partial<SourceRequest["authentication"]>) =>
    patch({ authentication: { ...auth, ...partial } });

  async function testFetch() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await runSourceFetch(request);
      setResult(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const preview =
    result &&
    (typeof result.body === "string"
      ? result.body
      : JSON.stringify(result.body, null, 2));

  return (
    <div>
      {/* Method + URL */}
      <div className="mb-3 flex gap-1.5">
        <select
          value={request.method}
          onChange={(e) => patch({ method: e.target.value as HttpMethod })}
          className={`${inputCls} w-24 shrink-0`}
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input
          value={request.url}
          placeholder="https://{{$env.HOST}}/v1/patients"
          onChange={(e) => patch({ url: e.target.value })}
          className={`${inputCls} font-mono`}
        />
      </div>

      {/* Authentication */}
      <Section title="Authentication" defaultOpen={auth.type !== "none"}>
        <label className={labelCls}>Type</label>
        <select
          value={auth.type}
          onChange={(e) => setAuth({ type: e.target.value as AuthType })}
          className={`${inputCls} mb-2`}
        >
          {AUTH_TYPES.map((a) => (
            <option key={a.value} value={a.value} disabled={a.disabled}>
              {a.label}
            </option>
          ))}
        </select>
        {auth.type === "basic" && (
          <div className="flex gap-1.5">
            <input
              value={auth.username ?? ""}
              placeholder="username"
              onChange={(e) => setAuth({ username: e.target.value })}
              className={inputCls}
            />
            <input
              type="password"
              value={auth.password ?? ""}
              placeholder="password"
              onChange={(e) => setAuth({ password: e.target.value })}
              className={inputCls}
            />
          </div>
        )}
        {auth.type === "header" && (
          <div className="flex gap-1.5">
            <input
              value={auth.headerName ?? ""}
              placeholder="X-API-Key"
              onChange={(e) => setAuth({ headerName: e.target.value })}
              className={inputCls}
            />
            <input
              type="password"
              value={auth.headerValue ?? ""}
              placeholder="value"
              onChange={(e) => setAuth({ headerValue: e.target.value })}
              className={inputCls}
            />
          </div>
        )}
        {auth.type === "queryAuth" && (
          <div className="flex gap-1.5">
            <input
              value={auth.queryName ?? ""}
              placeholder="api_key"
              onChange={(e) => setAuth({ queryName: e.target.value })}
              className={inputCls}
            />
            <input
              type="password"
              value={auth.queryValue ?? ""}
              placeholder="value"
              onChange={(e) => setAuth({ queryValue: e.target.value })}
              className={inputCls}
            />
          </div>
        )}
        {auth.type === "oauth2" && (
          <input
            type="password"
            value={auth.token ?? ""}
            placeholder="access token"
            onChange={(e) => setAuth({ token: e.target.value })}
            className={inputCls}
          />
        )}
        <p className="mt-2 text-[10px] leading-relaxed text-gray-400">
          Secrets are sent only at request time to the server-side egress and are
          never persisted in the graph.
        </p>
      </Section>

      {/* Query parameters */}
      <Section title="Query parameters" defaultOpen={request.sendQuery}>
        <Toggle
          label="Send query parameters"
          checked={request.sendQuery}
          onChange={(v) => patch({ sendQuery: v })}
        />
        {request.sendQuery && (
          <KeyValueRows
            rows={request.queryParameters}
            onChange={(queryParameters) => patch({ queryParameters })}
          />
        )}
      </Section>

      {/* Headers */}
      <Section title="Headers" defaultOpen={request.sendHeaders}>
        <Toggle
          label="Send headers"
          checked={request.sendHeaders}
          onChange={(v) => patch({ sendHeaders: v })}
        />
        {request.sendHeaders && (
          <KeyValueRows
            rows={request.headerParameters}
            onChange={(headerParameters) => patch({ headerParameters })}
          />
        )}
      </Section>

      {/* Body */}
      <Section title="Body" defaultOpen={request.sendBody}>
        <Toggle
          label="Send body"
          checked={request.sendBody}
          onChange={(v) => patch({ sendBody: v })}
        />
        {request.sendBody && (
          <>
            <label className={labelCls}>Body type</label>
            <select
              value={request.bodyType}
              onChange={(e) => patch({ bodyType: e.target.value as BodyType })}
              className={`${inputCls} mb-2`}
            >
              {BODY_TYPES.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            {(request.bodyType === "raw" || request.bodyType === "binary") && (
              <input
                value={request.rawContentType ?? ""}
                placeholder="Content-Type (e.g. text/xml)"
                onChange={(e) => patch({ rawContentType: e.target.value || null })}
                className={`${inputCls} mb-2`}
              />
            )}
            <textarea
              value={request.body ?? ""}
              onChange={(e) => patch({ body: e.target.value || null })}
              rows={5}
              placeholder={
                request.bodyType === "binary"
                  ? "base64-encoded bytes"
                  : request.bodyType === "json"
                    ? '{ "key": "value" }'
                    : "request body"
              }
              className={`${inputCls} resize-none font-mono`}
            />
          </>
        )}
      </Section>

      {/* Pagination */}
      <Section title="Pagination" defaultOpen={request.pagination.mode !== "none"}>
        <label className={labelCls}>Mode</label>
        <select
          value={request.pagination.mode}
          onChange={(e) =>
            patch({
              pagination: {
                ...request.pagination,
                mode: e.target.value as PaginationMode,
              },
            })
          }
          className={`${inputCls} mb-2`}
        >
          {PAGINATION_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {request.pagination.mode === "offset" && (
          <div className="mb-2 flex gap-1.5">
            <input
              value={request.pagination.limitParam}
              placeholder="limitParam"
              onChange={(e) =>
                patch({ pagination: { ...request.pagination, limitParam: e.target.value } })
              }
              className={inputCls}
            />
            <input
              value={request.pagination.offsetParam}
              placeholder="offsetParam"
              onChange={(e) =>
                patch({ pagination: { ...request.pagination, offsetParam: e.target.value } })
              }
              className={inputCls}
            />
          </div>
        )}
        {request.pagination.mode === "cursor" && (
          <input
            value={request.pagination.cursorPath}
            placeholder="$.meta.nextCursor"
            onChange={(e) =>
              patch({ pagination: { ...request.pagination, cursorPath: e.target.value } })
            }
            className={`${inputCls} mb-2 font-mono`}
          />
        )}
        {request.pagination.mode === "nextUrlInBody" && (
          <input
            value={request.pagination.nextUrlPath ?? ""}
            placeholder="$.links.next"
            onChange={(e) =>
              patch({ pagination: { ...request.pagination, nextUrlPath: e.target.value } })
            }
            className={`${inputCls} mb-2 font-mono`}
          />
        )}
        {request.pagination.mode !== "none" && (
          <label className="block">
            <span className={labelCls}>Max pages</span>
            <input
              type="number"
              min={1}
              max={200}
              value={request.pagination.maxPages}
              onChange={(e) =>
                patch({
                  pagination: {
                    ...request.pagination,
                    maxPages: Number(e.target.value) || 1,
                  },
                })
              }
              className={inputCls}
            />
          </label>
        )}
      </Section>

      {/* Options */}
      <Section title="Options">
        <label className="mb-2 block">
          <span className={labelCls}>Timeout (ms)</span>
          <input
            type="number"
            value={request.options.timeoutMs}
            onChange={(e) =>
              patch({
                options: { ...request.options, timeoutMs: Number(e.target.value) || 1000 },
              })
            }
            className={inputCls}
          />
        </label>
        <Toggle
          label="Retry on failure"
          checked={request.options.retry.enabled}
          onChange={(v) =>
            patch({ options: { ...request.options, retry: { ...request.options.retry, enabled: v } } })
          }
        />
        {request.options.retry.enabled && (
          <div className="mb-2 flex gap-1.5">
            <label className="block flex-1">
              <span className={labelCls}>Max attempts</span>
              <input
                type="number"
                min={1}
                max={10}
                value={request.options.retry.maxAttempts}
                onChange={(e) =>
                  patch({
                    options: {
                      ...request.options,
                      retry: { ...request.options.retry, maxAttempts: Number(e.target.value) || 1 },
                    },
                  })
                }
                className={inputCls}
              />
            </label>
            <label className="block flex-1">
              <span className={labelCls}>Backoff (ms)</span>
              <input
                type="number"
                min={0}
                value={request.options.retry.backoffMs}
                onChange={(e) =>
                  patch({
                    options: {
                      ...request.options,
                      retry: { ...request.options.retry, backoffMs: Number(e.target.value) || 0 },
                    },
                  })
                }
                className={inputCls}
              />
            </label>
          </div>
        )}
        <Toggle
          label="Follow redirects"
          checked={request.options.followRedirects}
          onChange={(v) => patch({ options: { ...request.options, followRedirects: v } })}
        />
        <Toggle
          label="Ignore SSL errors"
          checked={request.options.ignoreSslErrors}
          onChange={(v) => patch({ options: { ...request.options, ignoreSslErrors: v } })}
        />
      </Section>

      {/* Response */}
      <Section title="Response" defaultOpen>
        <label className={labelCls}>Format</label>
        <select
          value={request.response.format}
          onChange={(e) =>
            patch({ response: { ...request.response, format: e.target.value as ResponseFormat } })
          }
          className={`${inputCls} mb-2`}
        >
          {RESPONSE_FORMATS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        {request.response.format === "json" && (
          <input
            value={request.response.jsonPath ?? ""}
            placeholder="$.entry[*].resource (optional)"
            onChange={(e) =>
              patch({ response: { ...request.response, jsonPath: e.target.value || null } })
            }
            className={`${inputCls} mb-2 font-mono`}
          />
        )}
        <Toggle
          label="Include response headers"
          checked={request.response.includeHeaders}
          onChange={(v) => patch({ response: { ...request.response, includeHeaders: v } })}
        />
        <Toggle
          label="Never error on non-2xx"
          checked={request.response.neverError}
          onChange={(v) => patch({ response: { ...request.response, neverError: v } })}
        />
      </Section>

      {/* Test */}
      <button
        type="button"
        disabled={busy || !request.url.trim()}
        onClick={testFetch}
        className="w-full rounded-md bg-gray-900 px-3 py-2 text-xs text-white hover:bg-gray-700 disabled:opacity-40"
      >
        {busy ? "Fetching…" : "Test fetch"}
      </button>

      {error && <p className="mt-2 text-[11px] text-rose-600">{error}</p>}
      {result && (
        <div className="mt-2">
          <p className="text-[11px] text-gray-500">
            {result.status} {result.statusText} · {result.pages} page
            {result.pages === 1 ? "" : "s"}
          </p>
          <pre className="mt-1 max-h-48 overflow-auto rounded-md border border-gray-200 bg-gray-50 p-2 font-mono text-[10px] text-gray-700">
            {preview}
          </pre>
        </div>
      )}
    </div>
  );
}
