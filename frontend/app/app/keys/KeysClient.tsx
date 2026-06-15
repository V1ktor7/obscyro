"use client";

import { useEffect, useState } from "react";
import { Check, Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";

import { useAppContext } from "../AppShell";
import { useT } from "@/lib/i18n/context";
import { setStoredKey } from "@/lib/auth";
import {
  createKey,
  listKeys,
  revokeKey,
  type ApiKeySummary,
} from "@/lib/platform-api";
import { Button } from "@/components/ui/Button";

export default function KeysClient() {
  const t = useT();
  const { me } = useAppContext();
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyName, setKeyName] = useState("");
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await listKeys();
      setKeys(res.keys);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!keyName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const { key } = await createKey(keyName.trim());
      setNewRawKey(key.rawKey);
      setStoredKey(key.rawKey);
      setKeyName("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function onRevoke(id: string) {
    if (!confirm(t("app.keys.revokeConfirm"))) return;
    try {
      await revokeKey(id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function copy() {
    if (!newRawKey) return;
    try {
      await navigator.clipboard.writeText(newRawKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  }

  if (!me) return null;

  return (
    <div className="space-y-6 sm:space-y-8">
      <header>
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-fg-secondary sm:text-[0.65rem] sm:tracking-[0.2em]">
          {t("app.nav.keys")}
        </p>
        <h1 className="mt-2 text-balance text-2xl font-semibold tracking-tighter sm:text-3xl lg:text-4xl">
          {t("app.keys.title")}
        </h1>
        <p className="mt-2 max-w-xl text-pretty text-sm text-fg-secondary sm:text-base">
          {t("app.keys.subtitle")}
        </p>
      </header>

      {newRawKey ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="mb-2 text-sm font-medium">{t("signin.keyCreatedOnce")}</p>
          <code className="block break-all rounded-md border border-border-subtle bg-bg-primary px-3 py-2 font-mono text-xs">
            {newRawKey}
          </code>
          <button
            type="button"
            onClick={copy}
            className="mt-3 inline-flex items-center gap-1 rounded-md border border-border-subtle px-3 py-1.5 text-xs"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {t("signin.copyKey")}
          </button>
        </div>
      ) : null}

      <section className="rounded-xl border border-border-subtle bg-bg-secondary p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <KeyRound className="h-4 w-4" />
          {t("app.keys.manage")}
        </h2>

        {loading ? (
          <div className="mt-4 flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-fg-secondary" />
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {keys.map((k) => (
              <li
                key={k.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-bg-primary px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-sm">{k.name}</p>
                  <code className="font-mono text-xs text-fg-secondary">{k.prefix}…</code>
                  {k.lastUsedAt ? (
                    <p className="text-[10px] text-fg-secondary">
                      {t("app.keys.lastUsed")}: {new Date(k.lastUsedAt).toLocaleString()}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => onRevoke(k.id)}
                  className="shrink-0 rounded-md p-2 text-fg-secondary hover:bg-bg-tertiary hover:text-rose-600"
                  aria-label={t("app.keys.revoke")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
            {keys.length === 0 ? (
              <p className="text-sm text-fg-secondary">{t("app.keys.empty")}</p>
            ) : null}
          </ul>
        )}

        <form onSubmit={onCreate} className="mt-6 flex flex-col gap-2 sm:flex-row">
          <input
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            placeholder={t("signin.newKeyPlaceholder")}
            className="min-w-0 flex-1 rounded-lg border border-border-subtle bg-bg-primary px-3 py-2 text-sm"
          />
          <Button type="submit" disabled={submitting || !keyName.trim()}>
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Plus className="h-4 w-4" />
                {t("app.keys.create")}
              </>
            )}
          </Button>
        </form>
        {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}
      </section>

      <section className="rounded-xl border border-border-subtle bg-bg-secondary p-5 sm:p-6">
        <h3 className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-fg-secondary">
          {t("app.keys.usage")}
        </h3>
        <p className="mt-2 font-mono text-2xl font-semibold">
          {me.usageThisMonth.toLocaleString()} / {me.apiKey.monthlyQuota.toLocaleString()}
        </p>
      </section>
    </div>
  );
}
