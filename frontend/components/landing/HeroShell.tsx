"use client";

import { ArrowRight, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/Button";
import HeroReveal from "./HeroReveal";
import { useT } from "@/lib/i18n/context";
import type { DictKey } from "@/lib/i18n/dictionary";

/**
 * The hero used to open on a curl call to /v1/normalize, which was honest when
 * the product was a terminology API. It is not the product any more: the API is
 * one layer of a platform that connects a network's published data, models it,
 * runs it, and compares what could be done about it.
 *
 * So the panel shows the chain instead of an endpoint. It is structural rather
 * than numeric on purpose — figures from a simulation need the context that
 * produced them, and a hero has no room to give it.
 */

const CHAIN: { label: DictKey; body: DictKey }[] = [
  { label: "hero.chain.1.label", body: "hero.chain.1.body" },
  { label: "hero.chain.2.label", body: "hero.chain.2.body" },
  { label: "hero.chain.3.label", body: "hero.chain.3.body" },
  { label: "hero.chain.4.label", body: "hero.chain.4.body" },
  { label: "hero.chain.5.label", body: "hero.chain.5.body" },
];

export default function HeroShell() {
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
              <Button href="/studio" size="lg" width="fullMobile">
                {t("hero.cta.studio")}
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

          <HeroReveal delay={0.15} className="w-full min-w-0">
            <div className="rounded-xl border border-border-subtle bg-bg-secondary p-4 sm:p-5">
              <div className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-fg-secondary">
                {t("hero.chain.title")}
              </div>

              <ol className="mt-4 flex flex-col">
                {CHAIN.map((step, i) => (
                  <li key={step.label} className="flex flex-col">
                    <div className="flex items-baseline gap-3">
                      <span className="w-5 shrink-0 font-mono text-[0.65rem] tabular-nums text-fg-secondary">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold tracking-tight text-fg-primary">
                          {t(step.label)}
                        </div>
                        <div className="font-mono text-[0.7rem] leading-relaxed text-fg-secondary">
                          {t(step.body)}
                        </div>
                      </div>
                    </div>
                    {i < CHAIN.length - 1 ? (
                      <span
                        aria-hidden
                        className="my-1.5 ml-[0.5625rem] h-3 w-px bg-border-subtle"
                      />
                    ) : null}
                  </li>
                ))}
              </ol>

              <p className="mt-4 border-t border-border-subtle pt-3 text-[0.7rem] leading-relaxed text-fg-secondary">
                {t("hero.chain.caption")}
              </p>
            </div>
          </HeroReveal>
        </div>
      </div>
    </section>
  );
}
