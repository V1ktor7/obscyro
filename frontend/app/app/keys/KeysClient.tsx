"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Check, Copy, Eye, EyeOff, KeyRound, Sparkles } from "lucide-react";

import { useAppContext } from "../AppShell";
import { useT } from "@/lib/i18n/context";
import { getStoredKey } from "@/lib/auth";
import { cn } from "@/lib/cn";

export default function KeysClient() {
  const t = useT();
  const { me } = useAppContext();
  const params = useSearchParams();
  const isWelcome = params.get("welcome") === "1";

  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!me) return null;

  const fullKey = isWelcome ? getStoredKey() : null;
  const display = revealed && fullKey ? fullKey : `${me.apiKey.prefix}${"•".repeat(24)}`;

  async function copy() {
    const value = fullKey ?? me?.apiKey.prefix ?? "";
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  }

  const usagePercent =
    Math.min(
      100,
      Math.round((me.usageThisMonth / Math.max(1, me.apiKey.monthlyQuota)) * 100),
    );

  return (
    <div className="space-y-8">
      <header>
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-fg-secondary">
          {t("app.nav.keys")}
        </p>
        <h1 className="mt-2 text-balance text-3xl font-semibold tracking-tighter sm:text-4xl">
          {t("app.keys.title")}
        </h1>
        <p className="mt-2 max-w-xl text-pretty text-fg-secondary">
          {t("app.keys.subtitle")}
        </p>
      </header>

      {isWelcome ? (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
          <p className="text-sm text-fg-primary">{t("app.keys.welcomeBanner")}</p>
        </div>
      ) : null}

      <section className="rounded-xl border border-border-subtle bg-bg-secondary p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-fg-secondary" aria-hidden />
            <h2 className="text-base font-semibold tracking-tight">
              {t("app.keys.your")}
            </h2>
          </div>
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-emerald-700">
            {me.apiKey.plan}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <code className="flex-1 truncate rounded-md border border-border-subtle bg-bg-primary px-3 py-2 font-mono text-sm text-fg-primary">
            {display}
          </code>
          {fullKey ? (
            <button
              type="button"
              onClick={() => setRevealed((r) => !r)}
              className="inline-flex h-9 items-center gap-1 rounded-md border border-border-subtle bg-bg-primary px-3 text-xs text-fg-secondary transition-colors hover:text-fg-primary"
            >
              {revealed ? (
                <>
                  <EyeOff className="h-3.5 w-3.5" />
                  {t("app.keys.hide")}
                </>
              ) : (
                <>
                  <Eye className="h-3.5 w-3.5" />
                  {t("app.keys.reveal")}
                </>
              )}
            </button>
          ) : null}
          <button
            type="button"
            onClick={copy}
            className="inline-flex h-9 items-center gap-1 rounded-md border border-border-subtle bg-bg-primary px-3 text-xs text-fg-secondary transition-colors hover:text-fg-primary"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5" />
                {t("app.keys.copied")}
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                {t("app.keys.copy")}
              </>
            )}
          </button>
        </div>
        {!fullKey ? (
          <p className="mt-3 text-xs text-fg-secondary">
            {t("app.keys.regenerateSoon")}
          </p>
        ) : null}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-border-subtle bg-bg-secondary p-6">
          <h3 className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-fg-secondary">
            {t("app.keys.usage")}
          </h3>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-semibold tracking-tight text-fg-primary">
              {me.usageThisMonth.toLocaleString()}
            </span>
            <span className="text-sm text-fg-secondary">
              / {me.apiKey.monthlyQuota.toLocaleString()} {t("app.keys.usageLimit")}
            </span>
          </div>
          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-bg-tertiary">
            <div
              className={cn(
                "h-full rounded-full bg-fg-primary transition-all",
                usagePercent > 80 && "bg-amber-500",
                usagePercent > 95 && "bg-rose-500",
              )}
              style={{ width: `${usagePercent}%` }}
            />
          </div>
        </section>

        <section className="rounded-xl border border-border-subtle bg-bg-secondary p-6">
          <h3 className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-fg-secondary">
            {t("app.keys.plan")}
          </h3>
          <p className="mt-4 text-3xl font-semibold capitalize tracking-tight text-fg-primary">
            {me.apiKey.plan}
          </p>
          <p className="mt-2 text-sm text-fg-secondary">{t("app.keys.upgrade")}</p>
        </section>
      </div>
    </div>
  );
}
