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
    { label: t("hero.stat.concepts"), value: "470K+" },
    { label: t("hero.stat.mappings"), value: "1.2M" },
    { label: t("hero.stat.latency"), value: "< 80ms" },
  ];

  return (
    <section className="relative overflow-hidden border-b border-border-subtle">
      <div className="absolute inset-0 -z-10 grid-bg opacity-50" aria-hidden />
      <div className="container py-12 sm:py-16 md:py-20 lg:py-28">
        <div className="grid items-center gap-10 md:gap-12 lg:grid-cols-[1.1fr_1fr]">
          <HeroReveal>
            <div className="mb-5 inline-flex max-w-full flex-wrap items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-fg-secondary sm:text-[0.65rem] sm:tracking-[0.2em] md:mb-6">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" aria-hidden />
              <span className="font-semibold text-amber-700">{t("hero.pill.beta")}</span>
              <span className="truncate">{t("hero.pill.body")}</span>
            </div>
            <h1 className="text-balance text-[2.25rem] font-semibold leading-[1.05] tracking-tighter text-fg-primary sm:text-5xl md:text-6xl lg:text-6xl xl:text-7xl">
              {t("hero.title")}
            </h1>
            <p className="mt-4 max-w-xl text-pretty text-base leading-relaxed text-fg-secondary sm:mt-6 sm:text-lg lg:text-xl">
              {t("hero.subtitle")}
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:mt-8 sm:flex-row">
              <Button href="/sign-up" size="lg" width="fullMobile">
                {t("hero.cta.getKey")}
                <ArrowRight className="h-4 w-4" />
              </Button>
              <Button href="/docs" size="lg" variant="secondary" width="fullMobile">
                <BookOpen className="h-4 w-4" />
                {t("hero.cta.docs")}
              </Button>
            </div>
            <dl className="mt-8 grid max-w-md grid-cols-3 gap-3 sm:gap-6 md:mt-10">
              {stats.map((stat) => (
                <div key={stat.label} className="min-w-0">
                  <dt className="truncate font-mono text-[0.55rem] uppercase tracking-[0.18em] text-fg-secondary sm:text-[0.65rem] sm:tracking-[0.2em]">
                    {stat.label}
                  </dt>
                  <dd className="mt-1 font-mono text-xl font-semibold tracking-tight text-fg-primary sm:text-2xl">
                    {stat.value}
                  </dd>
                </div>
              ))}
            </dl>
          </HeroReveal>

          {/* Desktop (lg+): full split with curl + response */}
          <HeroReveal delay={0.15}>
            <div className="hidden space-y-3 lg:block">
              <StaticCodeBlock
                html={curlHtml}
                rawValue={curlCode}
                language="bash"
                filename="POST /v1/normalize"
                solidDarkCode
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
              />
            </div>

            {/* Tablette (md-lg): centered single curl block under copy */}
            <div className="hidden md:block lg:hidden">
              <div className="mx-auto max-w-2xl">
                <StaticCodeBlock
                  html={curlHtml}
                  rawValue={curlCode}
                  language="bash"
                  filename="POST /v1/normalize"
                  solidDarkCode
                />
              </div>
            </div>

            {/* Mobile (<md): single compact curl block, full-bleed feel */}
            <div className="md:hidden">
              <StaticCodeBlock
                html={curlHtml}
                rawValue={curlCode}
                language="bash"
                filename="POST /v1/normalize"
                solidDarkCode
              />
            </div>
          </HeroReveal>
        </div>
      </div>
    </section>
  );
}
