"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowRight, KeyRound, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { useT } from "@/lib/i18n/context";
import { ApiError, fetchMe, setStoredKey } from "@/lib/auth";

export default function SignInForm() {
  const t = useT();
  const router = useRouter();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      await fetchMe(trimmed);
      setStoredKey(trimmed);
      router.replace("/app");
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setError(t("signin.invalid"));
      } else {
        setError((err as Error).message);
      }
      setSubmitting(false);
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
            {t("signin.subtitle")}
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-xl bg-bg-secondary p-0 sm:border sm:border-border-subtle sm:p-6 lg:p-7"
        >
          <label
            htmlFor="apiKey"
            className="mb-1.5 block text-sm font-medium text-fg-primary"
          >
            {t("signin.label")}
          </label>
          <input
            id="apiKey"
            type="text"
            spellCheck={false}
            autoComplete="off"
            required
            placeholder={t("signin.placeholder")}
            value={key}
            onChange={(e) => setKey(e.target.value)}
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
              disabled={submitting || key.trim().length === 0}
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

        <p className="mt-6 text-center text-sm text-fg-secondary">
          {t("signin.noAccount")}{" "}
          <Link
            href="/sign-up"
            className="font-medium text-fg-primary underline decoration-border-subtle underline-offset-4 transition-colors hover:decoration-fg-primary"
          >
            {t("signin.signupHere")}
          </Link>
        </p>
      </div>
    </section>
  );
}
