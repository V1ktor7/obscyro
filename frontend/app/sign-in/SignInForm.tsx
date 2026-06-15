"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowRight, Check, Copy, KeyRound, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { useT } from "@/lib/i18n/context";
import { ApiError } from "@/lib/auth";
import {
  activateKey,
  login,
  matchingStoredKey,
  mintKey,
  type ApiKeySummary,
  type LoginUser,
} from "@/lib/platform-api";

type Step = "credentials" | "keys";

export default function SignInForm() {
  const t = useT();
  const router = useRouter();
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [user, setUser] = useState<LoginUser | null>(null);
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [keyName, setKeyName] = useState("Studio session");
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onCredentials(e: FormEvent) {
    e.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !code) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await login(trimmedEmail, code);
      setUser(result.user);
      setKeys(result.keys);

      const match = matchingStoredKey(result.keys);
      if (match) {
        const stored = localStorage.getItem("obs_api_key");
        if (stored) {
          activateKey(stored);
          router.replace("/studio");
          return;
        }
      }

      setStep("keys");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError(t("signin.invalid"));
      } else {
        setError((err as Error).message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function onMintKey(e: FormEvent) {
    e.preventDefault();
    if (!keyName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const { key } = await mintKey(email.trim(), code, keyName.trim());
      setNewRawKey(key.rawKey);
      activateKey(key.rawKey);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function continueToStudio() {
    router.replace("/studio");
  }

  async function copyKey() {
    if (!newRawKey) return;
    try {
      await navigator.clipboard.writeText(newRawKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  }

  return (
    <section className="container flex min-h-[calc(100vh-12rem)] items-center py-10 sm:py-16">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 flex flex-col items-start gap-3 sm:gap-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-bg-secondary px-3 py-1 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-fg-secondary sm:text-[0.65rem] sm:tracking-[0.2em]">
            <KeyRound className="h-3 w-3" aria-hidden />
            {t("nav.signin")}
          </div>
          <h1 className="text-balance text-2xl font-semibold tracking-tighter sm:text-3xl lg:text-4xl">
            {t("signin.title")}
          </h1>
          <p className="text-pretty text-sm text-fg-secondary sm:text-base">
            {step === "credentials" ? t("signin.subtitle") : t("signin.keysSubtitle")}
          </p>
        </div>

        {step === "credentials" ? (
          <form
            onSubmit={onCredentials}
            className="rounded-xl bg-bg-secondary p-0 sm:border sm:border-border-subtle sm:p-6 lg:p-7"
          >
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-fg-primary">
              {t("signin.emailLabel")}
            </label>
            <input
              id="email"
              type="email"
              spellCheck={false}
              autoComplete="email"
              required
              placeholder={t("signin.emailPlaceholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-border-subtle bg-bg-primary px-3 py-2.5 text-base text-fg-primary placeholder:text-fg-secondary/70 focus:border-fg-primary focus:outline-none focus:ring-2 focus:ring-fg-primary/10 sm:py-2 sm:text-sm"
            />

            <label htmlFor="code" className="mb-1.5 mt-4 block text-sm font-medium text-fg-primary">
              {t("signin.codeLabel")}
            </label>
            <input
              id="code"
              type="password"
              spellCheck={false}
              autoComplete="current-password"
              required
              placeholder={t("signin.codePlaceholder")}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full rounded-lg border border-border-subtle bg-bg-primary px-3 py-2.5 font-mono text-base text-fg-primary placeholder:text-fg-secondary/70 focus:border-fg-primary focus:outline-none focus:ring-2 focus:ring-fg-primary/10 sm:py-2 sm:text-sm"
            />

            {error ? (
              <p role="alert" className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700">
                {error}
              </p>
            ) : null}

            <div className="mt-6 sm:flex sm:justify-end">
              <Button type="submit" width="fullMobile" disabled={submitting || !email.trim() || !code}>
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("signin.submitting")}
                  </>
                ) : (
                  <>
                    {t("signin.submit")}
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </form>
        ) : (
          <div className="rounded-xl bg-bg-secondary p-0 sm:border sm:border-border-subtle sm:p-6 lg:p-7">
            {user ? (
              <p className="mb-4 text-sm text-fg-secondary">
                {t("signin.welcomeUser")}{" "}
                <span className="font-medium text-fg-primary">{user.name}</span>
              </p>
            ) : null}

            {keys.length > 0 ? (
              <div className="mb-4">
                <p className="mb-2 text-xs font-medium text-fg-secondary">{t("signin.existingKeys")}</p>
                <ul className="space-y-2">
                  {keys.map((k) => (
                    <li
                      key={k.id}
                      className="rounded-lg border border-border-subtle bg-bg-primary px-3 py-2 text-sm"
                    >
                      <span className="font-medium">{k.name}</span>
                      <code className="ml-2 font-mono text-xs text-fg-secondary">{k.prefix}…</code>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-fg-secondary">{t("signin.keyNotRecoverable")}</p>
              </div>
            ) : null}

            {newRawKey ? (
              <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
                <p className="mb-2 text-sm font-medium text-fg-primary">{t("signin.keyCreatedOnce")}</p>
                <code className="block break-all rounded-md border border-border-subtle bg-bg-primary px-3 py-2 font-mono text-xs">
                  {newRawKey}
                </code>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={copyKey}
                    className="inline-flex items-center gap-1 rounded-md border border-border-subtle px-3 py-1.5 text-xs hover:bg-bg-tertiary"
                  >
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {t("signin.copyKey")}
                  </button>
                  <Button type="button" onClick={continueToStudio}>
                    {t("signin.continueStudio")}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={onMintKey}>
                <label htmlFor="keyName" className="mb-1.5 block text-sm font-medium text-fg-primary">
                  {t("signin.newKeyName")}
                </label>
                <input
                  id="keyName"
                  type="text"
                  required
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  placeholder={t("signin.newKeyPlaceholder")}
                  className="w-full rounded-lg border border-border-subtle bg-bg-primary px-3 py-2.5 text-sm focus:border-fg-primary focus:outline-none focus:ring-2 focus:ring-fg-primary/10"
                />
                {error ? (
                  <p role="alert" className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700">
                    {error}
                  </p>
                ) : null}
                <div className="mt-6">
                  <Button type="submit" width="fullMobile" disabled={submitting}>
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t("signin.creatingKey")}
                      </>
                    ) : (
                      t("signin.createKey")
                    )}
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
