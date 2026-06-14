"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowRight, KeyRound, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { useT } from "@/lib/i18n/context";
import { setSession, verifyCredentials } from "@/lib/auth";

export default function SignInForm() {
  const t = useT();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !code) return;
    setSubmitting(true);
    setError(null);
    // Frontend-only gate. Replace with a real backend login when wired.
    if (verifyCredentials(trimmedEmail, code)) {
      setSession();
      router.replace("/studio");
      return;
    }
    setError(t("signin.invalid"));
    setSubmitting(false);
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
            {t("signin.subtitle")}
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-xl bg-bg-secondary p-0 sm:border sm:border-border-subtle sm:p-6 lg:p-7"
        >
          <label
            htmlFor="email"
            className="mb-1.5 block text-sm font-medium text-fg-primary"
          >
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

          <label
            htmlFor="code"
            className="mb-1.5 mt-4 block text-sm font-medium text-fg-primary"
          >
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
            <p
              role="alert"
              className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700"
            >
              {error}
            </p>
          ) : null}

          <div className="mt-6 sm:flex sm:justify-end">
            <Button
              type="submit"
              width="fullMobile"
              disabled={submitting || email.trim().length === 0 || code.length === 0}
            >
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
      </div>
    </section>
  );
}
