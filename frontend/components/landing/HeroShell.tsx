"use client";

import { ArrowRight, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/Button";
import StaticCodeBlock from "@/components/ui/StaticCodeBlock";
import HeroReveal from "./HeroReveal";
import { useT } from "@/lib/i18n/context";

interface HeroShellProps {
  curlCode: string;
  curlHtml: string;
  responseCode: string;
  responseHtml: string;
}

export default function HeroShell({
  curlCode,
  curlHtml,
  responseCode,
  responseHtml,
}: HeroShellProps) {
  const t = useT();

  const stats = [
    { label: t("hero.stat.edition"), value: t("hero.stat.editionValue") },
    { label: t("hero.stat.translate"), value: t("hero.stat.translateValue") },
    { label: t("hero.stat.phase"), value: t("hero.stat.phaseValue") },
  ];

  return (
    <section className="relative border-b border-border-subtle">
      <div
        className="absolute inset-0 -z-10 overflow-hidden grid-bg opacity-50"
        aria-hidden
      />
      <div className="container py-12 sm:py-16 md:py-20 lg:py-28">
        <div className="grid w-full min-w-0 items-center gap-8 sm:gap-10 md:gap-12 lg:grid-cols-[1.1fr_1fr]">
          <HeroReveal className="w-full">
            <div className="mb-5 inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-fg-secondary sm:text-[0.65rem] sm:tracking-[0.2em] md:mb-6">
              <span className="inline-flex shrink-0 items-center gap-2">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" aria-hidden />
                <span className="font-semibold text-amber-700">{t("hero.pill.beta")}</span>
              </span>
              <span className="text-pretty leading-snug">{t("hero.pill.body")}</span>
            </div>
            <h1 className="text-balance text-[2rem] font-semibold leading-[1.08] tracking-tighter text-fg-primary min-[380px]:text-[2.25rem] sm:text-5xl md:text-6xl lg:text-6xl xl:text-7xl">
              {t("hero.title")}
            </h1>
            <p className="mt-4 max-w-xl text-pretty text-base leading-relaxed text-fg-secondary sm:mt-6 sm:text-lg lg:text-xl">
              {t("hero.subtitle")}
            </p>
            <div className="mt-7 flex w-full min-w-0 flex-col gap-3 sm:mt-8 sm:flex-row">
              <Button href="/sign-up" size="lg" width="fullMobile">
                {t("hero.cta.getKey")}
                <ArrowRight className="h-4 w-4 shrink-0" />
              </Button>
              <Button href="/docs" size="lg" variant="secondary" width="fullMobile">
                <BookOpen className="h-4 w-4 shrink-0" />
                {t("hero.cta.docs")}
              </Button>
            </div>
            <dl className="mt-8 flex max-w-md justify-between gap-2 sm:mt-10 sm:grid sm:grid-cols-3 sm:gap-6">
              {stats.map((stat) => (
                <div key={stat.label} className="min-w-0 flex-1 text-center sm:text-left">
                  <dt className="text-pretty font-mono text-[0.5rem] uppercase leading-tight tracking-[0.12em] text-fg-secondary min-[380px]:text-[0.55rem] sm:text-[0.65rem] sm:tracking-[0.2em]">
                    {stat.label}
                  </dt>
                  <dd className="mt-1 font-mono text-lg font-semibold tracking-tight text-fg-primary min-[380px]:text-xl sm:text-2xl">
                    {stat.value}
                  </dd>
                </div>
              ))}
            </dl>
          </HeroReveal>

          {/* Desktop (lg+): full split with curl + response */}
          <HeroReveal delay={0.15} className="w-full min-w-0">
            <div className="hidden min-w-0 space-y-3 lg:block">
              <StaticCodeBlock
                html={curlHtml}
                rawValue={curlCode}
                language="bash"
                filename="POST /v1/normalize"
                solidDarkCode
                className="min-w-0"
              />
              <div className="flex items-center justify-center">
                <div className="rounded-full border border-border-subtle bg-bg-secondary px-3 py-1 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-fg-secondary">
                  {t("hero.responseLabel")}
                </div>
              </div>
              <StaticCodeBlock
                html={responseHtml}
                rawValue={responseCode}
                language="json"
                filename="200 OK"
                solidDarkCode
                className="min-w-0"
              />
            </div>

            {/* Tablette (md-lg): centered single curl block under copy */}
            <div className="hidden min-w-0 md:block lg:hidden">
              <div className="mx-auto w-full max-w-2xl">
                <StaticCodeBlock
                  html={curlHtml}
                  rawValue={curlCode}
                  language="bash"
                  filename="POST /v1/normalize"
                  solidDarkCode
                  className="min-w-0"
                />
              </div>
            </div>

            {/* Mobile (<md): compact endpoint teaser — no full curl block (avoids horizontal clip) */}
            <div className="w-full min-w-0 md:hidden">
              <div className="rounded-xl border border-border-subtle bg-code-bg px-3 py-3 font-mono text-[0.7rem] leading-relaxed text-code-fg shadow-code">
                <span className="text-fg-secondary">POST </span>
                <span className="break-all">/v1/normalize</span>
                <span className="mt-2 block text-[0.65rem] text-fg-secondary">
                  Authorization: Bearer obs_live_…
                </span>
              </div>
            </div>
          </HeroReveal>
        </div>
      </div>
    </section>
  );
}
