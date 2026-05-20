"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, KeyRound, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import StepIndicator from "@/components/onboarding/StepIndicator";
import { useT } from "@/lib/i18n/context";
import type { DictKey } from "@/lib/i18n/dictionary";
import {
  ApiError,
  onboard,
  setStoredKey,
  type OnboardPayload,
} from "@/lib/auth";

type Step = 1 | 2 | 3;

interface FormState {
  email: string;
  name: string;
  company: string;
  useCase: OnboardPayload["useCase"] | "";
  agreedToTerms: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const useCaseOptions: Array<{ id: OnboardPayload["useCase"]; key: DictKey }> = [
  { id: "developer", key: "signup.useCase.developer" },
  { id: "research", key: "signup.useCase.research" },
  { id: "clinical", key: "signup.useCase.clinical" },
  { id: "other", key: "signup.useCase.other" },
];

export default function SignUpWizard() {
  const t = useT();
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    email: "",
    name: "",
    company: "",
    useCase: "",
    agreedToTerms: false,
  });

  const steps = [
    { id: "account", label: t("signup.account") },
    { id: "use-case", label: t("signup.useCase") },
    { id: "review", label: t("signup.review") },
  ];

  const canAdvanceStep1 =
    form.name.trim().length > 0 && EMAIL_RE.test(form.email.trim());
  const canAdvanceStep2 = form.useCase !== "";
  const canSubmit = step === 3 && form.agreedToTerms && !submitting;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (step === 1 && canAdvanceStep1) {
      setStep(2);
      return;
    }
    if (step === 2 && canAdvanceStep2) {
      setStep(3);
      return;
    }
    if (step !== 3 || !canSubmit) return;

    setSubmitting(true);
    setError(null);
    try {
      const result = await onboard({
        email: form.email.trim().toLowerCase(),
        name: form.name.trim(),
        company: form.company.trim() || null,
        useCase: form.useCase as OnboardPayload["useCase"],
        agreedToTerms: true,
      });
      setStoredKey(result.apiKey.rawKey);
      router.replace("/app/keys?welcome=1");
    } catch (err) {
      if (err instanceof ApiError && err.code === "EMAIL_ALREADY_HAS_KEY") {
        setError(t("signup.errorEmailExists"));
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError((err as Error).message);
      }
      setSubmitting(false);
    }
  }

  function formatUseCaseLabel(id: OnboardPayload["useCase"] | ""): string {
    if (!id) return "—";
    const opt = useCaseOptions.find((o) => o.id === id);
    return opt ? t(opt.key) : "—";
  }

  return (
    <section className="container py-16 md:py-24">
      <div className="mx-auto max-w-xl">
        <div className="mb-8 flex flex-col items-start gap-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-bg-secondary px-3 py-1 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-fg-secondary">
            <KeyRound className="h-3 w-3" aria-hidden />
            {t("signup.stepLabel")} {step} {t("signup.of")} 3
          </div>
          <h1 className="text-balance text-3xl font-semibold tracking-tighter sm:text-4xl">
            {t("signup.title")}
          </h1>
          <p className="text-pretty text-fg-secondary">{t("signup.subtitle")}</p>
        </div>

        <div className="mb-8">
          <StepIndicator steps={steps} current={step} />
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-border-subtle bg-bg-secondary p-6 sm:p-8"
        >
          {step === 1 ? (
            <div className="space-y-5">
              <Field label={t("signup.email")} htmlFor="email">
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder={t("signup.emailPlaceholder")}
                  value={form.email}
                  onChange={(e) => update("email", e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label={t("signup.name")} htmlFor="name">
                <input
                  id="name"
                  type="text"
                  autoComplete="name"
                  required
                  placeholder={t("signup.namePlaceholder")}
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  className={inputCls}
                />
              </Field>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-6">
              <Field label={t("signup.company")} htmlFor="company">
                <input
                  id="company"
                  type="text"
                  autoComplete="organization"
                  placeholder={t("signup.companyPlaceholder")}
                  value={form.company}
                  onChange={(e) => update("company", e.target.value)}
                  className={inputCls}
                />
              </Field>
              <fieldset>
                <legend className="mb-3 block text-sm font-medium text-fg-primary">
                  {t("signup.useCaseQuestion")}
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {useCaseOptions.map((opt) => {
                    const active = form.useCase === opt.id;
                    return (
                      <label
                        key={opt.id}
                        className={
                          "flex cursor-pointer items-center gap-3 rounded-lg border bg-bg-primary p-3 text-sm transition-colors " +
                          (active
                            ? "border-fg-primary"
                            : "border-border-subtle hover:border-fg-secondary/50")
                        }
                      >
                        <input
                          type="radio"
                          name="useCase"
                          value={opt.id}
                          checked={active}
                          onChange={() => update("useCase", opt.id)}
                          className="h-4 w-4 accent-fg-primary"
                        />
                        <span>{t(opt.key)}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-5">
              <ReviewItem label={t("signup.summaryEmail")} value={form.email} />
              <ReviewItem label={t("signup.summaryName")} value={form.name} />
              <ReviewItem
                label={t("signup.summaryCompany")}
                value={form.company || "—"}
              />
              <ReviewItem
                label={t("signup.summaryUseCase")}
                value={formatUseCaseLabel(form.useCase)}
              />
              <ReviewItem
                label={t("signup.summaryPlan")}
                value={t("signup.planFree")}
              />
              <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-border-subtle bg-bg-primary p-3 text-sm">
                <input
                  type="checkbox"
                  required
                  checked={form.agreedToTerms}
                  onChange={(e) => update("agreedToTerms", e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-fg-primary"
                />
                <span className="text-fg-secondary">{t("signup.terms")}</span>
              </label>
            </div>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="mt-5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700"
            >
              {error}
            </p>
          ) : null}

          <div className="mt-7 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setStep((s) => (s > 1 ? ((s - 1) as Step) : s))}
              disabled={step === 1 || submitting}
              className="inline-flex h-10 items-center gap-1 rounded-md px-3 text-sm text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary disabled:pointer-events-none disabled:opacity-40"
            >
              <ArrowLeft className="h-4 w-4" />
              {t("signup.back")}
            </button>

            {step < 3 ? (
              <Button
                type="submit"
                disabled={
                  (step === 1 && !canAdvanceStep1) ||
                  (step === 2 && !canAdvanceStep2)
                }
              >
                {t("signup.next")}
                <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button type="submit" disabled={!canSubmit}>
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("signup.submitting")}
                  </>
                ) : (
                  <>
                    {t("signup.submit")}
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            )}
          </div>
        </form>

        <p className="mt-6 text-center text-sm text-fg-secondary">
          {t("signup.alreadyHaveKey")}{" "}
          <Link
            href="/sign-in"
            className="font-medium text-fg-primary underline decoration-border-subtle underline-offset-4 transition-colors hover:decoration-fg-primary"
          >
            {t("signup.signinHere")}
          </Link>
        </p>
      </div>
    </section>
  );
}

const inputCls =
  "w-full rounded-lg border border-border-subtle bg-bg-primary px-3 py-2 text-sm text-fg-primary placeholder:text-fg-secondary/70 focus:border-fg-primary focus:outline-none focus:ring-2 focus:ring-fg-primary/10";

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-sm font-medium text-fg-primary"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function ReviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border-subtle py-2">
      <span className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-fg-secondary">
        {label}
      </span>
      <span className="text-right text-sm text-fg-primary">{value}</span>
    </div>
  );
}
