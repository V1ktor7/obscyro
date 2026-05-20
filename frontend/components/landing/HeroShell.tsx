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
      <div className="container py-20 lg:py-28">
        <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
          <HeroReveal>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-fg-secondary">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
              <span className="font-semibold text-amber-700">{t("hero.pill.beta")}</span>
              <span>{t("hero.pill.body")}</span>
            </div>
            <h1 className="text-balance text-4xl font-semibold tracking-tighter text-fg-primary sm:text-5xl lg:text-6xl">
              {t("hero.title")}
            </h1>
            <p className="mt-6 max-w-xl text-pretty text-lg leading-relaxed text-fg-secondary">
              {t("hero.subtitle")}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button href="/sign-up" size="lg">
                {t("hero.cta.getKey")}
                <ArrowRight className="h-4 w-4" />
              </Button>
              <Button href="/docs" size="lg" variant="secondary">
                <BookOpen className="h-4 w-4" />
                {t("hero.cta.docs")}
              </Button>
            </div>
            <dl className="mt-10 grid grid-cols-3 gap-6 max-w-md">
              {stats.map((stat) => (
                <div key={stat.label}>
                  <dt className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-fg-secondary">
                    {stat.label}
                  </dt>
                  <dd className="mt-1 font-mono text-2xl font-semibold tracking-tight text-fg-primary">
                    {stat.value}
                  </dd>
                </div>
              ))}
            </dl>
          </HeroReveal>

          <HeroReveal delay={0.15}>
            <div className="space-y-3">
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
          </HeroReveal>
        </div>
      </div>
    </section>
  );
}
