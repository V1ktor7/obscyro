"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

import {
  createIngestSource,
  testWebhook,
  updateIngestSource,
} from "@/lib/platform-api";

import {
  WEBHOOK_METHODS,
  fromSanitized,
  type SanitizedWebhookConfig,
  type WebhookAuthType,
  type WebhookConfig,
  type WebhookHeaderKv,
  type WebhookMethod,
} from "./webhook-schema";

const inputCls =
  "w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10";
const labelCls = "mb-1 block text-xs font-medium text-gray-700";

const AUTH_TYPES: { value: WebhookAuthType; label: string }[] = [
  { value: "none", label: "None" },
  { value: "basic", label: "Basic auth" },
  { value: "header", label: "Header auth" },
  { value: "jwt", label: "JWT (HS256)" },
];

export interface WebhookNodeConfigSlice {
  sourceId?: string;
  webhookUrl?: string;
  webhookMethod?: WebhookMethod;
  webhookConfig?: SanitizedWebhookConfig;
  lastEventPayload?: unknown;
}

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

function HeaderRows({
  rows,
  onChange,
}: {
  rows: WebhookHeaderKv[];
  onChange: (rows: WebhookHeaderKv[]) => void;
}) {
  const update = (i: number, patch: Partial<WebhookHeaderKv>) =>
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
            aria-label="Remove header"
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
        + Add header
      </button>
    </div>
  );
}

export default function WebhookNodeForm({
  config,
  onConfig,
}: {
  config: WebhookNodeConfigSlice;
  onConfig: (patch: WebhookNodeConfigSlice) => void;
}) {
  const [method, setMethod] = useState<WebhookMethod>(config.webhookMethod ?? "POST");
  const [cfg, setCfg] = useState<WebhookConfig>(() => fromSanitized(config.webhookConfig));
  const [busy, setBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Re-hydrate local editing state whenever the underlying source changes
  // (e.g. after creating or regenerating the webhook).
  useEffect(() => {
    setMethod(config.webhookMethod ?? "POST");
    setCfg(fromSanitized(config.webhookConfig));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.sourceId]);

  const auth = cfg.auth;
  const setAuth = (patch: Partial<WebhookConfig["auth"]>) =>
    setCfg({ ...cfg, auth: { ...cfg.auth, ...patch } });
  const setResponse = (patch: Partial<WebhookConfig["response"]>) =>
    setCfg({ ...cfg, response: { ...cfg.response, ...patch } });
  const setOptions = (patch: Partial<WebhookConfig["options"]>) =>
    setCfg({ ...cfg, options: { ...cfg.options, ...patch } });

  async function createSource(regenerate = false) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await createIngestSource("Webhook source", "webhook", { method, config: cfg });
      onConfig({
        sourceId: res.source.id,
        webhookUrl: res.source.webhookUrl ?? "",
        webhookMethod: res.source.method,
        webhookConfig: res.source.config,
      });
      setMsg(regenerate ? "New webhook URL generated." : "Webhook created — copy the URL above.");
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!config.sourceId) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await updateIngestSource(config.sourceId, { method, config: cfg });
      onConfig({
        webhookMethod: res.source.method,
        webhookConfig: res.source.config,
      });
      setCfg(fromSanitized(res.source.config));
      setMsg("Saved.");
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    if (!config.sourceId) return;
    setTestBusy(true);
    setMsg(null);
    try {
      await testWebhook(config.sourceId);
      setMsg("Test event sent — it appears below shortly.");
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setTestBusy(false);
    }
  }

  async function copyUrl() {
    if (!config.webhookUrl) return;
    try {
      await navigator.clipboard.writeText(config.webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  }

  if (!config.sourceId) {
    return (
      <div>
        <div className="mb-3">
          <label className={labelCls}>HTTP Method</label>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as WebhookMethod)}
            className={inputCls}
          >
            {WEBHOOK_METHODS.map((m) => (
              <option key={m} value={m}>
                {m === "ANY" ? "ANY (accept all methods)" : m}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => createSource(false)}
          className="w-full rounded-md bg-gray-900 px-3 py-2 text-xs text-white hover:bg-gray-700 disabled:opacity-40"
        >
          {busy ? "Creating…" : "Create webhook"}
        </button>
        {msg && <p className="mt-2 text-[10px] text-gray-500">{msg}</p>}
      </div>
    );
  }

  return (
    <div>
      {/* Production URL */}
      <label className={labelCls}>Production URL</label>
      <div className="mb-3 flex gap-1.5">
        <input
          readOnly
          value={config.webhookUrl ?? ""}
          className="min-w-0 flex-1 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 font-mono text-[10px] text-gray-700"
        />
        <button
          type="button"
          onClick={copyUrl}
          aria-label="Copy webhook URL"
          className="inline-flex items-center justify-center rounded-md border border-gray-300 px-2 text-gray-600 hover:bg-gray-50"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-600" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Method */}
      <div className="mb-3">
        <label className={labelCls}>HTTP Method</label>
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as WebhookMethod)}
          className={inputCls}
        >
          {WEBHOOK_METHODS.map((m) => (
            <option key={m} value={m}>
              {m === "ANY" ? "ANY (accept all methods)" : m}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[10px] leading-relaxed text-gray-400">
          A request with a different method gets a clear 405 message instead of a
          confusing 404 (e.g. opening the URL in a browser does a GET).
        </p>
      </div>

      {/* Authentication */}
      <Section title="Authentication" defaultOpen={auth.type !== "none"}>
        <label className={labelCls}>Type</label>
        <select
          value={auth.type}
          onChange={(e) => setAuth({ type: e.target.value as WebhookAuthType })}
          className={`${inputCls} mb-2`}
        >
          {AUTH_TYPES.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
        {auth.type === "basic" && (
          <div className="flex gap-1.5">
            <input
              value={auth.basic.username}
              placeholder="username"
              onChange={(e) => setAuth({ basic: { ...auth.basic, username: e.target.value } })}
              className={inputCls}
            />
            <input
              type="password"
              value={auth.basic.password}
              placeholder="password (leave blank to keep)"
              onChange={(e) => setAuth({ basic: { ...auth.basic, password: e.target.value } })}
              className={inputCls}
            />
          </div>
        )}
        {auth.type === "header" && (
          <div className="flex gap-1.5">
            <input
              value={auth.header.name}
              placeholder="X-Api-Key"
              onChange={(e) => setAuth({ header: { ...auth.header, name: e.target.value } })}
              className={inputCls}
            />
            <input
              type="password"
              value={auth.header.value}
              placeholder="value (leave blank to keep)"
              onChange={(e) => setAuth({ header: { ...auth.header, value: e.target.value } })}
              className={inputCls}
            />
          </div>
        )}
        {auth.type === "jwt" && (
          <input
            type="password"
            value={auth.jwt.secret}
            placeholder="HS256 shared secret (leave blank to keep)"
            onChange={(e) => setAuth({ jwt: { ...auth.jwt, secret: e.target.value } })}
            className={inputCls}
          />
        )}
        <p className="mt-2 text-[10px] leading-relaxed text-gray-400">
          Basic and header secrets are stored as SHA-256 hashes and never returned.
          The JWT secret is stored server-side to verify signatures.
        </p>
      </Section>

      {/* Respond */}
      <Section title="Respond" defaultOpen>
        <p className="mb-2 text-[10px] leading-relaxed text-gray-400">
          Mode: <span className="font-medium text-gray-600">Immediately</span>. The
          webhook stores the event and responds at once (store-and-poll). “When last
          node finishes” is not supported.
        </p>
        <div className="mb-2 flex gap-1.5">
          <label className="block w-24 shrink-0">
            <span className={labelCls}>Code</span>
            <input
              type="number"
              min={100}
              max={599}
              value={cfg.response.code}
              onChange={(e) => setResponse({ code: Number(e.target.value) || 200 })}
              className={inputCls}
            />
          </label>
          <label className="block flex-1">
            <span className={labelCls}>Content-Type</span>
            <input
              value={cfg.response.contentType}
              onChange={(e) => setResponse({ contentType: e.target.value })}
              className={inputCls}
            />
          </label>
        </div>
        <Toggle
          label="No response body"
          checked={cfg.response.noBody}
          onChange={(v) => setResponse({ noBody: v })}
        />
        {!cfg.response.noBody && (
          <>
            <label className={labelCls}>Response data (blank = default JSON)</label>
            <textarea
              value={cfg.response.body ?? ""}
              onChange={(e) => setResponse({ body: e.target.value || null })}
              rows={3}
              placeholder='e.g. {"ok":true} — supports {{eventId}} and {{receivedAt}}'
              className={`${inputCls} mb-2 resize-none font-mono`}
            />
            <label className={labelCls}>Response headers</label>
            <HeaderRows rows={cfg.response.headers} onChange={(headers) => setResponse({ headers })} />
          </>
        )}
      </Section>

      {/* Options */}
      <Section title="Options">
        <label className="mb-2 block">
          <span className={labelCls}>Allowed origins (CORS), comma-separated</span>
          <input
            value={cfg.options.allowedOrigins}
            placeholder="* or https://app.example.com"
            onChange={(e) => setOptions({ allowedOrigins: e.target.value })}
            className={inputCls}
          />
        </label>
        <label className="mb-2 block">
          <span className={labelCls}>IP allowlist, comma-separated (blank = any)</span>
          <input
            value={cfg.options.ipWhitelist.join(", ")}
            placeholder="203.0.113.5, 198.51.100.0"
            onChange={(e) =>
              setOptions({
                ipWhitelist: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            className={inputCls}
          />
        </label>
        <Toggle
          label="Ignore bots (silently accept, don't store)"
          checked={cfg.options.ignoreBots}
          onChange={(v) => setOptions({ ignoreBots: v })}
        />
        <Toggle
          label="Raw body (store payload verbatim under `raw`)"
          checked={cfg.options.rawBody}
          onChange={(v) => setOptions({ rawBody: v })}
        />
        <label className="mt-1 block">
          <span className={labelCls}>Binary property (store bytes as base64 under this key)</span>
          <input
            value={cfg.options.binaryProperty ?? ""}
            placeholder="e.g. data (blank = off)"
            onChange={(e) => setOptions({ binaryProperty: e.target.value || null })}
            className={inputCls}
          />
        </label>
      </Section>

      {/* Actions */}
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="flex-1 rounded-md bg-gray-900 px-3 py-2 text-xs text-white hover:bg-gray-700 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={testBusy}
          onClick={sendTest}
          className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          {testBusy ? "Sending…" : "Send test request"}
        </button>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => createSource(true)}
        className="mt-1.5 w-full rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[11px] text-gray-500 hover:bg-gray-50 disabled:opacity-40"
      >
        Regenerate URL
      </button>

      {msg && <p className="mt-2 text-[10px] text-gray-500">{msg}</p>}

      {config.lastEventPayload != null && (
        <div className="mt-3">
          <span className="mb-1 block font-mono text-[9px] uppercase tracking-wide text-sky-600">
            Latest received payload
          </span>
          <pre className="max-h-40 overflow-auto rounded-md border border-gray-200 bg-gray-50 p-2 font-mono text-[10px] leading-snug text-gray-700">
            {JSON.stringify(config.lastEventPayload, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
